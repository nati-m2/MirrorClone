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
    compress_before_upload: bool = Field(default=True, description="Create ZIP archive before upload (default: True)")
    zip_password: Optional[str] = Field(default=None, description="DEPRECATED: migrated into an EncryptionKey on startup")
    encryption_key_id: Optional[str] = Field(default=None, description="Id of the encryption key used to protect the archive (None = no encryption)")
    retention_count: int = Field(default=0, description="Keep only X latest remote backups (0 = keep all)")
    local_retention_count: int = Field(default=0, description="Keep only X latest local ZIP backups in /backups (0 = keep all)")
    exclude_patterns: list[str] = Field(default_factory=list, description="Glob patterns to exclude from backup (e.g. '.env', 'media/**', '*.log')")
    # Notification preferences (Apprise provider ids + event flags)
    notification_ids: list[str] = Field(default_factory=list, description="Notification provider IDs to fire for this job")
    notify_on_success: bool = Field(default=False, description="Send notification when job succeeds")
    notify_on_failure: bool = Field(default=True, description="Send notification when job fails")
    
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
    compress_before_upload: bool = True
    encryption_key_id: Optional[str] = None
    retention_count: int = 0
    local_retention_count: int = 0
    exclude_patterns: list[str] = []
    notification_ids: list[str] = []
    notify_on_success: bool = False
    notify_on_failure: bool = True


class JobUpdate(BaseModel):
    name: Optional[str] = None
    source_path: Optional[str] = None
    destination: Optional[str] = None
    cron_expression: Optional[str] = None
    enabled: Optional[bool] = None
    preserve_metadata: Optional[bool] = None
    preserve_links: Optional[bool] = None
    compress_before_upload: Optional[bool] = None
    encryption_key_id: Optional[str] = None
    retention_count: Optional[int] = None
    local_retention_count: Optional[int] = None
    exclude_patterns: Optional[list[str]] = None
    notification_ids: Optional[list[str]] = None
    notify_on_success: Optional[bool] = None
    notify_on_failure: Optional[bool] = None


class NotificationProvider(BaseModel):
    """A single Apprise-compatible notification endpoint."""
    id: str = Field(..., description="Unique provider id")
    name: str = Field(..., description="Human-readable label")
    url: str = Field(..., description="Apprise URL (e.g. tgram://, mailto://, slack://, pover://)")
    enabled: bool = Field(default=True, description="Whether the provider is active")


class NotificationProviderCreate(BaseModel):
    name: str
    url: str
    enabled: bool = True


class NotificationProviderUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    enabled: Optional[bool] = None


class EncryptionKey(BaseModel):
    """A named passphrase used to encrypt backup archives (AES-256 ZIP).

    Lives only in /config/encryption_keys.json on this server. Jobs reference
    it by id, so jobs.json carries no secret and stays safe to copy to a
    backup destination — the key never travels with the data it opens.
    """
    id: str = Field(..., description="Unique key identifier")
    name: str = Field(..., description="Human-readable label, e.g. 'apps archive key'")
    secret: str = Field(..., description="The passphrase itself — never leaves this server")
    algo: str = Field(default="zip-aes256", description="Cipher the archives are written with")
    created_at: datetime = Field(default_factory=datetime.now)


class EncryptionKeyPublic(BaseModel):
    """What the API hands out: everything except the secret."""
    id: str
    name: str
    algo: str
    created_at: datetime
    fingerprint: str = Field(..., description="First 8 hex chars of sha256(secret) — identifies a key without revealing it")
    in_use_by: list[str] = Field(default_factory=list, description="Names of jobs currently encrypting with this key")


class EncryptionKeyCreate(BaseModel):
    name: str
    secret: str


class EncryptionKeyUpdate(BaseModel):
    name: Optional[str] = None
    secret: Optional[str] = None


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
