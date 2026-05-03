from datetime import datetime
from app.models import Job, JobLog


class Guardian:
    """Monitors jobs and sends alerts on success/failure.

    All notifications are dispatched through a NotificationsManager (Apprise).
    Email is just one Apprise provider (mailto://) configured per-job from the
    UI — there is no separate legacy SMTP path anymore.
    """

    def __init__(self, notifications_manager=None):
        self.notifications = notifications_manager

    # ── Per-job hooks ────────────────────────────────────────────────────────
    async def on_job_failed(self, job: Job, job_log: JobLog):
        """Handle job failure — fires per-job providers when configured."""
        subject = f"🚨 Backup Failed: {job.name}"
        body = self._format_failure_body(job.name, job_log)
        self._dispatch(job, subject, body, on_failure=True)

    async def on_job_success(self, job: Job, job_log: JobLog):
        """Handle job success — only fires when the job opts in."""
        subject = f"✅ Backup Succeeded: {job.name}"
        body = self._format_success_body(job.name, job_log)
        self._dispatch(job, subject, body, on_failure=False)

    def _dispatch(self, job: Job, subject: str, body: str, on_failure: bool):
        """Route an alert to the job's configured Apprise providers."""
        should_fire = job.notify_on_failure if on_failure else job.notify_on_success
        if not should_fire:
            return
        if not self.notifications or not job.notification_ids:
            return
        try:
            self.notifications.notify(job.notification_ids, subject, body)
        except Exception as e:
            print(f"Notification dispatch error: {e}")

    # ── body helpers ─────────────────────────────────────────────────────────
    def _format_failure_body(self, job_name: str, job_log: JobLog) -> str:
        return f"""
Backup Job Failed
=================

Job: {job_name}
Time: {job_log.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
Exit Code: {job_log.exit_code}

Error Message:
{job_log.message}

Output:
{job_log.output or 'No output available'}

---
MirrorClone System
"""

    def _format_success_body(self, job_name: str, job_log: JobLog) -> str:
        return f"""
Backup Job Succeeded
====================

Job: {job_name}
Time: {job_log.timestamp.strftime('%Y-%m-%d %H:%M:%S')}

Message:
{job_log.message}

---
MirrorClone System
"""
