from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from croniter import croniter
from datetime import datetime
from typing import Callable, Optional
from app.models import Job
import asyncio


class JobScheduler:
    """Manages job scheduling with APScheduler"""
    
    def __init__(self, on_job_execute: Callable):
        self.scheduler = AsyncIOScheduler()
        self.on_job_execute = on_job_execute
        self.scheduled_jobs: dict[str, str] = {}
    
    def start(self):
        """Start the scheduler"""
        if not self.scheduler.running:
            self.scheduler.start()
    
    def stop(self):
        """Stop the scheduler"""
        if self.scheduler.running:
            self.scheduler.shutdown()
    
    def schedule_job(self, job: Job):
        """Schedule or reschedule a job"""
        self.unschedule_job(job.id)
        
        if not job.enabled:
            return
        
        if not self._validate_cron(job.cron_expression):
            raise ValueError(f"Invalid cron expression: {job.cron_expression}")
        
        trigger = CronTrigger.from_crontab(job.cron_expression)
        
        apscheduler_job = self.scheduler.add_job(
            self._execute_job,
            trigger=trigger,
            args=[job.id],
            id=job.id,
            name=job.name,
            replace_existing=True
        )
        
        self.scheduled_jobs[job.id] = job.cron_expression
    
    def unschedule_job(self, job_id: str):
        """Remove a job from the scheduler"""
        if job_id in self.scheduled_jobs:
            try:
                self.scheduler.remove_job(job_id)
            except:
                pass
            del self.scheduled_jobs[job_id]
    
    def get_next_run(self, job_id: str) -> Optional[datetime]:
        """Get next scheduled run time for a job"""
        job = self.scheduler.get_job(job_id)
        if job:
            return job.next_run_time
        return None
    
    async def _execute_job(self, job_id: str):
        """Execute a job (called by scheduler)"""
        await self.on_job_execute(job_id)
    
    def _validate_cron(self, cron_expression: str) -> bool:
        """Validate cron expression"""
        try:
            croniter(cron_expression)
            return True
        except:
            return False
    
    def get_scheduled_jobs(self) -> list[dict]:
        """Get all scheduled jobs info"""
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run": job.next_run_time
            })
        return jobs
