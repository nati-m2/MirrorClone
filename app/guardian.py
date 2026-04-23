import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import Optional
from app.models import JobLog
from app.config import settings
import apprise


class Guardian:
    """Monitors jobs and sends alerts on failures"""
    
    def __init__(self):
        self.apprise = apprise.Apprise()
        self._setup_apprise()
    
    def _setup_apprise(self):
        """Setup Apprise notification services"""
        if settings.smtp_host and settings.smtp_user:
            smtp_url = f"mailto://{settings.smtp_user}:{settings.smtp_password}@{settings.smtp_host}:{settings.smtp_port}"
            self.apprise.add(smtp_url)
    
    async def on_job_failed(self, job_name: str, job_log: JobLog):
        """Handle job failure"""
        await self._send_failure_alert(job_name, job_log)
    
    async def on_job_success(self, job_name: str, job_log: JobLog):
        """Handle job success (optional notification)"""
        pass
    
    async def _send_failure_alert(self, job_name: str, job_log: JobLog):
        """Send failure alert via email/notifications"""
        subject = f"🚨 Backup Failed: {job_name}"
        
        body = f"""
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
        
        if settings.alert_emails:
            await self._send_email(subject, body, settings.alert_emails)
        
        if self.apprise.servers:
            self.apprise.notify(
                title=subject,
                body=body
            )
    
    async def _send_email(self, subject: str, body: str, recipients: list[str]):
        """Send email notification"""
        if not settings.smtp_host or not settings.smtp_user:
            return
        
        try:
            msg = MIMEMultipart()
            msg['From'] = settings.smtp_from or settings.smtp_user
            msg['To'] = ', '.join(recipients)
            msg['Subject'] = subject
            
            msg.attach(MIMEText(body, 'plain'))
            
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                server.starttls()
                server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
                
        except Exception as e:
            print(f"Failed to send email: {e}")
    
    def test_notifications(self) -> tuple[bool, str]:
        """Test notification system"""
        try:
            subject = "🧪 Nati-Backup Test Notification"
            body = f"This is a test notification sent at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            
            if settings.alert_emails:
                import asyncio
                asyncio.create_task(self._send_email(subject, body, settings.alert_emails))
            
            if self.apprise.servers:
                self.apprise.notify(title=subject, body=body)
                return True, "Test notification sent successfully"
            
            return False, "No notification services configured"
        except Exception as e:
            return False, f"Failed to send test notification: {str(e)}"
