"""Append-only record of what each backup run actually did.

Deliberately not a database. The destination stays the source of truth: every
archive carries a `.meta.json` sidecar, so a complete picture of the successful
runs can always be rebuilt from the remote alone. This file adds two things
that the remote cannot tell you — runs that *failed* (they leave no archive)
and the local-side numbers — and it is safe to delete at any time. Losing it
costs history, never a restore.

Format is JSONL so appending is a single write with no read-modify-cycle, and
a corrupted line can never take the rest of the file with it.
"""
from __future__ import annotations

import json
import os
import statistics
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from app.config import settings

# Roughly a year of 4 daily jobs. Old lines are dropped from the front.
MAX_RECORDS = 5000

# A run is flagged when its archive is this many times larger than the median
# of the preceding runs — the "a container started dumping assets" signal.
GROWTH_FACTOR = 1.5
# ...but only once it is big enough that the jump is worth a human look.
GROWTH_MIN_BYTES = 50 * 1024 * 1024


class RunHistory:
    def __init__(self):
        self.file: Path = settings.config_dir / "history.jsonl"

    # ── writing ──────────────────────────────────────────────────────────────
    def append(self, record: dict[str, Any]) -> None:
        record.setdefault("ts", datetime.now().isoformat())
        try:
            settings.config_dir.mkdir(parents=True, exist_ok=True)
            with open(self.file, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, default=str) + "\n")
            self._trim()
        except Exception as e:
            # History is a convenience; never let it fail a backup.
            print(f"Error writing run history: {e}")

    def _trim(self) -> None:
        try:
            if not self.file.exists() or self.file.stat().st_size < 2_000_000:
                return
            lines = self.file.read_text(encoding="utf-8").splitlines()
            if len(lines) <= MAX_RECORDS:
                return
            keep = lines[-MAX_RECORDS:]
            tmp = self.file.with_suffix(".jsonl.tmp")
            tmp.write_text("\n".join(keep) + "\n", encoding="utf-8")
            os.replace(tmp, self.file)
        except Exception as e:
            print(f"Error trimming run history: {e}")

    # ── reading ──────────────────────────────────────────────────────────────
    def read(
        self,
        days: Optional[int] = None,
        job_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[dict]:
        if not self.file.exists():
            return []

        cutoff = datetime.now() - timedelta(days=days) if days else None
        out: list[dict] = []
        try:
            with open(self.file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue  # one bad line never hides the rest
                    if job_id and rec.get("job_id") != job_id:
                        continue
                    if cutoff:
                        try:
                            if datetime.fromisoformat(rec["ts"]) < cutoff:
                                continue
                        except (KeyError, ValueError):
                            pass
                    out.append(rec)
        except Exception as e:
            print(f"Error reading run history: {e}")
            return []

        return out[-limit:] if limit else out

    # ── analysis ─────────────────────────────────────────────────────────────
    def daily_outcomes(self, days: int = 30) -> list[dict]:
        """One bucket per calendar day: how many runs succeeded and failed.

        Days with no runs are included as zeroes so the chart keeps an even
        time axis instead of squeezing gaps shut.
        """
        today = datetime.now().date()
        buckets = {
            (today - timedelta(days=i)).isoformat(): {"date": (today - timedelta(days=i)).isoformat(),
                                                      "success": 0, "failed": 0}
            for i in range(days)
        }

        for rec in self.read(days=days):
            try:
                day = datetime.fromisoformat(rec["ts"]).date().isoformat()
            except (KeyError, ValueError):
                continue
            bucket = buckets.get(day)
            if not bucket:
                continue
            if rec.get("status") == "success":
                bucket["success"] += 1
            else:
                bucket["failed"] += 1

        return [buckets[k] for k in sorted(buckets)]

    def growth(self, days: int = 90) -> list[dict]:
        """Archive size over time per job, with sudden jumps marked.

        The comparison is against the median of the earlier runs rather than
        the previous one, so a single spike does not raise the bar for
        everything that follows it.
        """
        per_job: dict[str, dict] = {}

        for rec in self.read(days=days):
            if rec.get("status") != "success" or not rec.get("archive_bytes"):
                continue
            job = per_job.setdefault(
                rec.get("job_id", "?"),
                {"job_id": rec.get("job_id", "?"), "job_name": rec.get("job_name", "?"), "points": []},
            )
            job["job_name"] = rec.get("job_name", job["job_name"])
            job["points"].append({
                "ts": rec.get("ts"),
                "archive_bytes": rec.get("archive_bytes"),
                "source_bytes": rec.get("source_bytes"),
                "file_count": rec.get("file_count"),
                "spike": False,
                "factor": None,
            })

        for job in per_job.values():
            points = job["points"]
            for i, point in enumerate(points):
                previous = [p["archive_bytes"] for p in points[max(0, i - 5):i] if p["archive_bytes"]]
                if len(previous) < 2:
                    continue
                baseline = statistics.median(previous)
                if baseline <= 0:
                    continue
                factor = point["archive_bytes"] / baseline
                if factor >= GROWTH_FACTOR and point["archive_bytes"] >= GROWTH_MIN_BYTES:
                    point["spike"] = True
                    point["factor"] = round(factor, 2)

            job["latest_bytes"] = points[-1]["archive_bytes"] if points else 0
            job["spikes"] = [p for p in points if p["spike"]]

        return sorted(per_job.values(), key=lambda j: j["job_name"].lower())

    def summary(self, days: int = 30) -> dict:
        records = self.read(days=days)
        succeeded = sum(1 for r in records if r.get("status") == "success")
        failed = len(records) - succeeded
        durations = [r["duration"] for r in records if isinstance(r.get("duration"), (int, float))]
        uploaded = sum(r.get("archive_bytes") or 0 for r in records if r.get("status") == "success")

        return {
            "days": days,
            "runs": len(records),
            "succeeded": succeeded,
            "failed": failed,
            "success_rate": round(succeeded / len(records) * 100, 1) if records else None,
            "avg_duration": round(statistics.mean(durations)) if durations else None,
            "bytes_uploaded": uploaded,
        }
