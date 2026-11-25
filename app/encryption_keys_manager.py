"""Registry of archive encryption keys.

Backups are written as AES-256 ZIPs by 7z, which needs a passphrase. Keeping
that passphrase on the job itself meant it was written into jobs.json — the
very file `SelfBackup` copies to the cloud, right next to the archives it
unlocks. Here the secret lives in its own file that never leaves the server,
and jobs only store a key id.

Changing or deleting a key has no effect on archives already written: they
stay encrypted with whatever key produced them. The fingerprint recorded
beside each archive is what tells you which key that was.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Optional

from app.config import settings
from app.models import (
    EncryptionKey,
    EncryptionKeyCreate,
    EncryptionKeyPublic,
    EncryptionKeyUpdate,
)


def fingerprint(secret: str) -> str:
    """Short, stable id for a passphrase. Safe to store next to an archive:
    it identifies the key without being reversible to it."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:8]


class EncryptionKeysManager:
    def __init__(self):
        # Sibling of jobs.json, but deliberately absent from SelfBackup's
        # upload list — same reasoning as auth_profile.json.
        self.file: Path = settings.config_dir / "encryption_keys.json"
        self.keys: dict[str, EncryptionKey] = {}
        self._load()

    # ── persistence ──────────────────────────────────────────────────────────
    def _load(self):
        if not self.file.exists():
            self._save()
            return
        try:
            with open(self.file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for raw in data.get("keys", []):
                key = EncryptionKey(**raw)
                self.keys[key.id] = key
        except Exception as e:
            print(f"Error loading encryption keys: {e}")
            self.keys = {}

    def _save(self):
        settings.config_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.file, "w", encoding="utf-8") as f:
                json.dump(
                    {"keys": [k.model_dump(mode="json") for k in self.keys.values()]},
                    f,
                    indent=2,
                )
            # The file holds plaintext passphrases: keep it readable by the
            # service account only, in case the config volume is shared.
            try:
                self.file.chmod(0o600)
            except OSError:
                pass
        except Exception as e:
            print(f"Error saving encryption keys: {e}")

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def list(self) -> list[EncryptionKey]:
        return list(self.keys.values())

    def get(self, key_id: str) -> Optional[EncryptionKey]:
        return self.keys.get(key_id)

    def get_secret(self, key_id: Optional[str]) -> Optional[str]:
        """Resolve a job's key id to the passphrase, or None when the job is
        unencrypted. A dangling id also yields None — see `is_dangling`."""
        if not key_id:
            return None
        key = self.keys.get(key_id)
        return key.secret if key else None

    def is_dangling(self, key_id: Optional[str]) -> bool:
        """True when a job points at a key that no longer exists. The job
        engine refuses to run those rather than silently writing a plaintext
        archive where the user asked for an encrypted one."""
        return bool(key_id) and key_id not in self.keys

    def find_by_secret(self, secret: str) -> Optional[EncryptionKey]:
        fp = fingerprint(secret)
        for key in self.keys.values():
            if fingerprint(key.secret) == fp:
                return key
        return None

    def create(self, payload: EncryptionKeyCreate) -> EncryptionKey:
        key = EncryptionKey(id=str(uuid.uuid4()), **payload.model_dump())
        self.keys[key.id] = key
        self._save()
        return key

    def update(self, key_id: str, payload: EncryptionKeyUpdate) -> Optional[EncryptionKey]:
        key = self.keys.get(key_id)
        if not key:
            return None
        for field, value in payload.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(key, field, value)
        self._save()
        return key

    def delete(self, key_id: str) -> bool:
        if key_id in self.keys:
            del self.keys[key_id]
            self._save()
            return True
        return False

    # ── presentation ─────────────────────────────────────────────────────────
    def public(self, key: EncryptionKey, in_use_by: Optional[list[str]] = None) -> EncryptionKeyPublic:
        return EncryptionKeyPublic(
            id=key.id,
            name=key.name,
            algo=key.algo,
            created_at=key.created_at,
            fingerprint=fingerprint(key.secret),
            in_use_by=in_use_by or [],
        )

    # ── migration ────────────────────────────────────────────────────────────
    def migrate_job_passwords(self, job_manager) -> list[str]:
        """Move any legacy `zip_password` off the jobs and into this store.

        Jobs that shared a password end up sharing one key, so the list stays
        as short as the user's actual set of secrets. Returns the names of the
        jobs that were migrated.
        """
        migrated: list[str] = []
        for job in job_manager.get_all_jobs():
            secret = getattr(job, "zip_password", None)
            if not secret:
                continue

            key = self.find_by_secret(secret)
            if not key:
                key = self.create(EncryptionKeyCreate(name=f"{job.name} key", secret=secret))

            job.encryption_key_id = key.id
            job.zip_password = None
            migrated.append(job.name)

        if migrated:
            job_manager._save_jobs()
        return migrated
