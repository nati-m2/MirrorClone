import json
from pathlib import Path
from typing import Optional
from datetime import datetime
from app.models import Job, JobCreate, JobUpdate, JobStatus, JobLog
from app.config import settings
import uuid


class JobManager:
    """Manages job persistence and CRUD operations"""
    
    def __init__(self):
        self.jobs_file = settings.jobs_file
        self.jobs: dict[str, Job] = {}
        self.logs: list[JobLog] = []
        self._load_jobs()
    
    def _load_jobs(self):
        """Load jobs from JSON file"""
        if not self.jobs_file.exists():
            self._save_jobs()
            return
        
        try:
            with open(self.jobs_file, 'r') as f:
                data = json.load(f)
                for job_data in data.get('jobs', []):
                    job = Job(**job_data)
                    self.jobs[job.id] = job
        except Exception as e:
            print(f"Error loading jobs: {e}")
            self.jobs = {}
    
    def _save_jobs(self):
        """Save jobs to JSON file"""
        settings.config_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            data = {
                'jobs': [job.model_dump(mode='json') for job in self.jobs.values()],
                'last_updated': datetime.now().isoformat()
            }
            with open(self.jobs_file, 'w') as f:
                json.dump(data, f, indent=2, default=str)
        except Exception as e:
            print(f"Error saving jobs: {e}")
    
    def create_job(self, job_create: JobCreate) -> Job:
        """Create a new job"""
        job = Job(
            id=str(uuid.uuid4()),
            **job_create.model_dump()
        )
        self.jobs[job.id] = job
        self._save_jobs()
        return job
    
    def get_job(self, job_id: str) -> Optional[Job]:
        """Get a job by ID"""
        return self.jobs.get(job_id)
    
    def get_all_jobs(self) -> list[Job]:
        """Get all jobs"""
        return list(self.jobs.values())
    
    def update_job(self, job_id: str, job_update: JobUpdate) -> Optional[Job]:
        """Update a job"""
        job = self.jobs.get(job_id)
        if not job:
            return None
        
        update_data = job_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(job, key, value)
        
        self._save_jobs()
        return job
    
    def delete_job(self, job_id: str) -> bool:
        """Delete a job"""
        if job_id in self.jobs:
            del self.jobs[job_id]
            self._save_jobs()
            return True
        return False
    
    def update_job_status(self, job_id: str, status: JobStatus, 
                         last_error: Optional[str] = None, duration: Optional[int] = None):
        """Update job status"""
        job = self.jobs.get(job_id)
        if not job:
            return
        
        job.status = status
        job.last_run = datetime.now()
        
        if duration is not None:
            job.last_duration = duration
        
        if status == JobStatus.SUCCESS:
            job.last_success = datetime.now()
            job.last_error = None
        elif status == JobStatus.FAILED and last_error:
            job.last_error = last_error
        
        self._save_jobs()
    
    def add_log(self, log: JobLog):
        """Add a job log entry"""
        self.logs.append(log)
        if len(self.logs) > 1000:
            self.logs = self.logs[-1000:]
    
    def get_logs(self, job_id: Optional[str] = None, limit: int = 100) -> list[JobLog]:
        """Get job logs"""
        logs = self.logs
        if job_id:
            logs = [log for log in logs if log.job_id == job_id]
        return logs[-limit:]
