"""Admin authentication profile manager (/config/auth_profile.json).

Handles:
  - Profile creation on first setup (admin password + JWT secret)
  - Password hashing/verification (PBKDF2-HMAC-SHA256, stdlib only)
  - JWT token generation and verification (httpOnly cookie)
  - Profile persistence and cloud sync via self-backup

The profile file is the lock: when it holds a password hash, all UI API
routes require a valid JWT cookie. When it's missing (or predates the
password field), the app is in setup mode (open) so an admin can set one.

Recovery: delete /config/auth_profile.json on the host — the app notices the
file is gone, returns to setup mode and asks for a new password. The file is
never backed up to cloud, so nothing restores it behind your back.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import jwt
from pydantic import BaseModel

from app.config import settings


class AuthProfile(BaseModel):
    """Persisted admin profile.

    Older profiles carried `owner_email`/`allowed_emails`; those fields are
    ignored on load (pydantic drops extras) and are not written back.
    """
    profile_id: str
    password_hash: str = ""
    jwt_secret: str
    created_at: str


_ALGORITHM = "HS256"
_TOKEN_EXPIRY_DAYS = 30
_COOKIE_NAME = "mc_session"
_SUBJECT = "admin"

# PBKDF2 parameters. Format stored in the file:
#   pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
_PBKDF2_ITERATIONS = 240_000
_MIN_PASSWORD_LENGTH = 8


def hash_password(password: str, *, iterations: int = _PBKDF2_ITERATIONS) -> str:
    """Hash a password with a fresh random salt."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of a password against a stored hash string."""
    if not stored:
        return False
    try:
        algorithm, iterations, salt_hex, digest_hex = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


class AuthProfileManager:
    """Manages the admin authentication profile and JWT tokens."""

    min_password_length = _MIN_PASSWORD_LENGTH

    def __init__(self):
        self.file: Path = settings.config_dir / "auth_profile.json"
        self._profile: Optional[AuthProfile] = None
        self._signature: Optional[tuple] = None
        self._load()

    # ── persistence ───────────────────────────────────────────────────────────
    def _file_signature(self) -> Optional[tuple]:
        """(mtime, size) of the profile file, or None when it's gone."""
        try:
            stat = self.file.stat()
        except OSError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def _load(self):
        self._signature = self._file_signature()
        if self._signature is None:
            self._profile = None
            return
        try:
            with open(self.file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._profile = AuthProfile(**data)
        except Exception as e:
            print(f"Error loading auth profile: {e}")
            self._profile = None

    def _sync(self):
        """Re-read the profile when the file changed underneath us.

        The manager is a module-level singleton, so without this an admin who
        deletes /config/auth_profile.json to reset a forgotten password would
        still be told "Password already set" until the container restarts.
        """
        if self._file_signature() != self._signature:
            self._load()

    def _save(self):
        if not self._profile:
            return
        settings.config_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.file, "w", encoding="utf-8") as f:
                json.dump(self._profile.model_dump(), f, indent=2)
            self._signature = self._file_signature()
        except Exception as e:
            print(f"Error saving auth profile: {e}")

    def reload(self):
        """Reload profile from disk (e.g. after cloud restore)."""
        self._load()

    # ── queries ───────────────────────────────────────────────────────────────
    @property
    def profile_exists(self) -> bool:
        self._sync()
        return self._profile is not None

    @property
    def setup_mode(self) -> bool:
        """True when no password is configured — UI is open.

        A profile restored from an older version has no password_hash, so it
        counts as setup mode rather than locking the admin out.
        """
        self._sync()
        return self._profile is None or not self._profile.password_hash

    # ── profile lifecycle ─────────────────────────────────────────────────────
    def create_profile(self, password: str) -> AuthProfile:
        """Create a new admin profile with the given password.

        Reuses the existing profile_id/jwt_secret when a password-less profile
        was restored from cloud, so nothing else about it changes.
        """
        self._sync()
        existing = self._profile
        self._profile = AuthProfile(
            profile_id=existing.profile_id if existing else str(uuid.uuid4()),
            password_hash=hash_password(password),
            jwt_secret=existing.jwt_secret if existing else secrets.token_hex(32),
            created_at=existing.created_at if existing else datetime.now(timezone.utc).isoformat(),
        )
        self._save()
        return self._profile

    def delete_profile(self) -> bool:
        """Delete the auth profile (returns to setup mode)."""
        self._profile = None
        try:
            if self.file.exists():
                self.file.unlink()
            return True
        except Exception as e:
            print(f"Error deleting auth profile: {e}")
            return False

    # ── password ──────────────────────────────────────────────────────────────
    def check_password(self, password: str) -> bool:
        """Verify a password against the stored hash."""
        self._sync()
        if not self._profile:
            return False
        return verify_password(password, self._profile.password_hash)

    # ── JWT ───────────────────────────────────────────────────────────────────
    def create_token(self) -> str:
        """Create a signed JWT for the admin session."""
        if not self._profile:
            raise RuntimeError("No auth profile configured")
        payload = {
            "sub": _SUBJECT,
            "pid": self._profile.profile_id,
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(days=_TOKEN_EXPIRY_DAYS),
        }
        return jwt.encode(payload, self._profile.jwt_secret, algorithm=_ALGORITHM)

    def verify_token(self, token: str) -> bool:
        """Verify a JWT — True when it's a valid session for this profile."""
        self._sync()
        if not self._profile:
            return False
        try:
            payload = jwt.decode(
                token,
                self._profile.jwt_secret,
                algorithms=[_ALGORITHM],
            )
        except jwt.InvalidTokenError:  # covers ExpiredSignatureError
            return False
        return payload.get("pid") == self._profile.profile_id

    @staticmethod
    def cookie_name() -> str:
        return _COOKIE_NAME

    @staticmethod
    def cookie_max_age() -> int:
        return _TOKEN_EXPIRY_DAYS * 24 * 60 * 60
