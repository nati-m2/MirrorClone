"""Apprise-based notification provider registry.

Stores user-defined notification endpoints (Telegram, Slack, Email, Pushover,
Discord, ...) in `/config/notifications.json` and exposes a helper to fire an
alert through a specific subset of them.

Apprise accepts a URL-style scheme per provider (tgram://, mailto://,
slack://, pover://, discord://, ...). We simply persist the raw URL so any
backend supported by Apprise works out of the box.
"""
from __future__ import annotations

import json
import logging
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import apprise


@contextmanager
def _capture_apprise_log(level: int = logging.WARNING):
    """Capture Apprise's internal logger so we can surface the *real* failure
    reason to the UI (e.g. "Connection refused", "404 Not Found").

    Apprise's `notify()` returns just True/False; the actual error only goes
    to its logger. We attach a temporary in-memory handler for the duration
    of the call and yield the buffer.
    """
    buf: list[str] = []

    class _Collector(logging.Handler):
        def emit(self, record: logging.LogRecord):
            try:
                buf.append(self.format(record))
            except Exception:
                pass

    handler = _Collector(level=level)
    handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    logger = logging.getLogger("apprise")
    prev_level = logger.level
    logger.addHandler(handler)
    if logger.level == logging.NOTSET or logger.level > level:
        logger.setLevel(level)
    try:
        yield buf
    finally:
        logger.removeHandler(handler)
        logger.setLevel(prev_level)


def _summarise(buf: list[str], fallback: str) -> str:
    """Pick the most relevant Apprise log line for display."""
    if not buf:
        return fallback
    # Prefer ERRORs, then WARNINGs, else last entry. Keep messages short.
    errors = [m for m in buf if m.startswith("ERROR")]
    warnings = [m for m in buf if m.startswith("WARNING")]
    chosen = (errors or warnings or buf)[-1]
    # Trim very long URLs / stack noise
    return chosen[:400]

from app.config import settings
from app.models import (
    NotificationProvider,
    NotificationProviderCreate,
    NotificationProviderUpdate,
)


class NotificationsManager:
    def __init__(self):
        # Sibling of jobs.json inside the config volume.
        self.file: Path = settings.config_dir / "notifications.json"
        self.providers: dict[str, NotificationProvider] = {}
        self._load()

    # ── persistence ──────────────────────────────────────────────────────────
    def _load(self):
        if not self.file.exists():
            self._save()
            return
        try:
            with open(self.file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for raw in data.get("providers", []):
                p = NotificationProvider(**raw)
                self.providers[p.id] = p
        except Exception as e:
            print(f"Error loading notifications: {e}")
            self.providers = {}

    def _save(self):
        settings.config_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.file, "w", encoding="utf-8") as f:
                json.dump(
                    {"providers": [p.model_dump() for p in self.providers.values()]},
                    f,
                    indent=2,
                )
        except Exception as e:
            print(f"Error saving notifications: {e}")

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def list(self) -> list[NotificationProvider]:
        return list(self.providers.values())

    def get(self, provider_id: str) -> Optional[NotificationProvider]:
        return self.providers.get(provider_id)

    def create(self, payload: NotificationProviderCreate) -> NotificationProvider:
        provider = NotificationProvider(id=str(uuid.uuid4()), **payload.model_dump())
        self.providers[provider.id] = provider
        self._save()
        return provider

    def update(
        self, provider_id: str, payload: NotificationProviderUpdate
    ) -> Optional[NotificationProvider]:
        provider = self.providers.get(provider_id)
        if not provider:
            return None
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(provider, key, value)
        self._save()
        return provider

    def delete(self, provider_id: str) -> bool:
        if provider_id in self.providers:
            del self.providers[provider_id]
            self._save()
            return True
        return False

    # ── sending ──────────────────────────────────────────────────────────────
    def _build_apprise(self, provider_ids: list[str]) -> apprise.Apprise:
        """Build a fresh Apprise bag with only the requested, enabled providers."""
        ap = apprise.Apprise()
        for pid in provider_ids:
            p = self.providers.get(pid)
            if p and p.enabled and p.url:
                ap.add(p.url)
        return ap

    def notify(self, provider_ids: list[str], title: str, body: str) -> tuple[bool, str]:
        """Fire a notification through the selected providers. Safe to call
        even with an empty list — returns (False, "no providers") in that case.
        """
        if not provider_ids:
            return False, "no providers selected"
        ap = self._build_apprise(provider_ids)
        if not ap.servers:
            return False, "no enabled providers matched"
        try:
            with _capture_apprise_log() as buf:
                ok = ap.notify(title=title, body=body)
            if ok:
                return True, "sent"
            return False, _summarise(buf, "apprise reported failure")
        except Exception as e:
            return False, f"apprise error: {e}"

    def test(self, provider_id: str) -> tuple[bool, str]:
        """Send a test notification through a single provider."""
        p = self.providers.get(provider_id)
        if not p:
            return False, "provider not found"
        ap = apprise.Apprise()
        if not ap.add(p.url):
            return False, "invalid Apprise URL"
        try:
            with _capture_apprise_log() as buf:
                ok = ap.notify(
                    title="MirrorClone test notification",
                    body=f"This is a test message from provider '{p.name}'.",
                )
            if ok:
                return True, "sent"
            return False, _summarise(buf, "apprise reported failure")
        except Exception as e:
            return False, f"apprise error: {e}"
