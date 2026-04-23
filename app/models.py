from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
from enum import Enum


class JobStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class Job(BaseModel):
    id: str = Field(..., description="Unique job identifier")
    name: str = Field(..., description="Human-readable job name")
    source_path: str = Field(..., description="Source directory path")
    destination: str = Field(..., description="Rclone remote destination (e.g., gdrive:backup)")
    cron_expression: str = Field(..., description="Cron expression for scheduling")
    enabled: bool = Field(default=True, description="Whether the job is enabled")
    preserve_metadata: bool = Field(default=True, description="Preserve file metadata and permissions")
    preserve_links: bool = Field(default=True, description="Preserve symbolic links")
    compress_before_upload: bool = Field(default=False, description="Create ZIP archive before upload")
    zip_password: Optional[str] = Field(default=None, description="Password for ZIP encryption")
    retention_count: int = Field(default=0, description="Keep only X latest backups (0 = keep all)")
    
    status: JobStatus = Field(default=JobStatus.IDLE, description="Current job status")
    last_run: Optional[datetime] = Field(default=None, description="Last execution timestamp")
    last_success: Optional[datetime] = Field(default=None, description="Last successful execution")
    last_error: Optional[str] = Field(default=None, description="Last error message")
    last_duration: Optional[int] = Field(default=None, description="Last backup duration in seconds")
    next_run: Optional[datetime] = Field(default=None, description="Next scheduled run")


class JobCreate(BaseModel):
    name: str
    source_path: str
    destination: str
    cron_expression: str
    enabled: bool = True
    preserve_metadata: bool = True
    preserve_links: bool = True
    compress_before_upload: bool = False
    zip_password: Optional[str] = None
    retention_count: int = 0


class JobUpdate(BaseModel):
    name: Optional[str] = None
    source_path: Optional[str] = None
    destination: Optional[str] = None
    cron_expression: Optional[str] = None
    enabled: Optional[bool] = None
    preserve_metadata: Optional[bool] = None
    preserve_links: Optional[bool] = None
    compress_before_upload: Optional[bool] = None
    zip_password: Optional[str] = None
    retention_count: Optional[int] = None


class JobLog(BaseModel):
    job_id: str
    timestamp: datetime
    status: Literal["started", "progress", "success", "failed"]
    message: str
    exit_code: Optional[int] = None
    output: Optional[str] = None


class RcloneConfig(BaseModel):
    config_content: str = Field(..., description="Content of rclone.conf file")


class SystemStatus(BaseModel):
    rclone_installed: bool
    rclone_version: Optional[str] = None
    config_exists: bool
    total_jobs: int
    active_jobs: int
    running_jobs: int = 0
