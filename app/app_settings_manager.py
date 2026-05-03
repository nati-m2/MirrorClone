"""Persistent user-editable app settings (/config/app_settings.json).

Currently stores only the Google Drive OAuth client credentials so users can
replace rclone's default (rate-limited) client ID with their own Google Cloud
project without editing environment variables.

The file is the single source of truth at runtime; env vars are used only as
initial defaults when the file doesn't override them.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from app.config import settings


class GoogleDriveCredentials(BaseModel):
    client_id: str = ""
    client_secret: str = ""


class GoogleDriveCredentialsUpdate(BaseModel):
    client_id: Optional[str] = None
    client_secret: Optional[str] = None


# rclone's shared OAuth client. Used as the effective default when the user
# hasn't configured their own credentials.
RCLONE_DEFAULT_CLIENT_ID = "202264815644.apps.googleusercontent.com"
RCLONE_DEFAULT_CLIENT_SECRET = "X4Z3ca8xfWDb1Voo-F9a7ZxJ"


class AppSettingsManager:
    def __init__(self):
        self.file: Path = settings.config_dir / "app_settings.json"
        self._data: dict = {}
        self._load()

    def _load(self):
        if not self.file.exists():
            self._data = {}
            return
        try:
            with open(self.file, "r", encoding="utf-8") as f:
                self._data = json.load(f) or {}
        except Exception as e:
            print(f"Error loading app_settings: {e}")
            self._data = {}

    def _save(self):
        settings.config_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.file, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2)
        except Exception as e:
            print(f"Error saving app_settings: {e}")

    # ── Google Drive OAuth credentials ───────────────────────────────────────
    def get_google_drive_credentials(self) -> GoogleDriveCredentials:
        """Return user-configured credentials, or env-based defaults."""
        gd = self._data.get("google_drive") or {}
        client_id = (gd.get("client_id") or "").strip() or settings.google_client_id
        client_secret = (gd.get("client_secret") or "").strip() or settings.google_client_secret
        return GoogleDriveCredentials(client_id=client_id, client_secret=client_secret)

    def update_google_drive_credentials(
        self, payload: GoogleDriveCredentialsUpdate
    ) -> GoogleDriveCredentials:
        gd = dict(self._data.get("google_drive") or {})
        data = payload.model_dump(exclude_unset=True)
        if "client_id" in data:
            gd["client_id"] = (data["client_id"] or "").strip()
        if "client_secret" in data:
            gd["client_secret"] = (data["client_secret"] or "").strip()
        self._data["google_drive"] = gd
        self._save()
        return self.get_google_drive_credentials()

    def is_using_custom_google_client(self) -> bool:
        """True when effective client_id differs from rclone's shared client."""
        creds = self.get_google_drive_credentials()
        return bool(creds.client_id) and creds.client_id != RCLONE_DEFAULT_CLIENT_ID
