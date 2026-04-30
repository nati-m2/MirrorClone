from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime
from typing import Optional
import asyncio
import json

from app.config import settings

# Event broadcaster for SSE
class EventBroadcaster:
    def __init__(self):
        self.clients: list[asyncio.Queue] = []
    
    async def subscribe(self):
        queue = asyncio.Queue()
        self.clients.append(queue)
        try:
            while True:
                data = await queue.get()
                yield f"data: {json.dumps(data)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            self.clients.remove(queue)
    
    async def broadcast(self, event: str, data: dict = None):
        message = {"event": event, "data": data}
        for queue in self.clients:
            await queue.put(message)

broadcaster = EventBroadcaster()
from app.models import (
    Job, JobCreate, JobUpdate, JobStatus, JobLog, 
    RcloneConfig, SystemStatus
)
from app.auth_manager import AuthManager
from app.job_engine import JobEngine
from app.job_manager import JobManager
from app.scheduler import JobScheduler
from app.guardian import Guardian
from app.self_backup import SelfBackup


job_manager = JobManager()
auth_manager = AuthManager()
guardian = Guardian()
job_engine = JobEngine(on_log=job_manager.add_log)
self_backup = SelfBackup()


async def execute_job_wrapper(job_id: str):
    """Wrapper for job execution with status updates and alerts"""
    import time
    job = job_manager.get_job(job_id)
    if not job:
        return
    
    job_manager.update_job_status(job_id, JobStatus.RUNNING)
    await broadcaster.broadcast("job_progress", {"job_id": job_id, "stage": "preparing", "message": "מכין קבצים..."})
    
    start_time = time.time()
    
    # Pass progress callback to job engine
    async def on_progress(stage: str, message: str, percent: int = None):
        await broadcaster.broadcast("job_progress", {
            "job_id": job_id,
            "stage": stage,
            "message": message,
            "percent": percent
        })
    
    success, output, exit_code = await job_engine.execute_job(job, on_progress)
    duration = int(time.time() - start_time)
    
    # Format duration message
    if duration < 60:
        duration_msg = f"{duration} שניות"
    else:
        mins = duration // 60
        secs = duration % 60
        duration_msg = f"{mins} דקות" + (f" ו-{secs} שניות" if secs > 0 else "")
    
    if success:
        job_manager.update_job_status(job_id, JobStatus.SUCCESS, duration=duration)
        await broadcaster.broadcast("job_progress", {
            "job_id": job_id, 
            "stage": "completed", 
            "message": f"הגיבוי הסתיים בהצלחה תוך {duration_msg}"
        })
        logs = job_manager.get_logs(job_id, limit=1)
        if logs:
            await guardian.on_job_success(job.name, logs[0])
        
        await self_backup.backup_config()
    else:
        job_manager.update_job_status(job_id, JobStatus.FAILED, output, duration=duration)
        await broadcaster.broadcast("job_progress", {
            "job_id": job_id, 
            "stage": "failed", 
            "message": f"הגיבוי נכשל: {output[:100]}"
        })
        logs = job_manager.get_logs(job_id, limit=1)
        if logs:
            await guardian.on_job_failed(job.name, logs[0])
    
    # Broadcast job status change
    await broadcaster.broadcast("job_updated", {"job_id": job_id})


scheduler = JobScheduler(on_job_execute=execute_job_wrapper)


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.start()
    
    for job in job_manager.get_all_jobs():
        if job.enabled:
            try:
                scheduler.schedule_job(job)
                next_run = scheduler.get_next_run(job.id)
                if next_run:
                    job.next_run = next_run
            except Exception as e:
                print(f"Failed to schedule job {job.name}: {e}")
    
    yield
    
    scheduler.stop()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
async def get_status() -> SystemStatus:
    """Get system status"""
    rclone_version = auth_manager.get_rclone_version()
    config_exists = auth_manager.config_path.exists()
    
    jobs = job_manager.get_all_jobs()
    active_jobs = sum(1 for job in jobs if job.enabled)
    
    return SystemStatus(
        rclone_installed=rclone_version is not None,
        rclone_version=rclone_version,
        config_exists=config_exists,
        total_jobs=len(jobs),
        active_jobs=active_jobs
    )


# Cache Google Drive status to avoid hammering the API on every page load.
_GDRIVE_STATUS_CACHE: dict = {"value": None, "ts": 0.0}
_GDRIVE_STATUS_TTL = 30.0  # seconds


@app.get("/api/gdrive/status")
async def get_gdrive_status():
    """Check Google Drive connection status (cached, off-loop)."""
    import subprocess
    import time as _time

    if not auth_manager.config_path.exists():
        return {"connected": False, "error": "No config file"}

    # Serve from short-lived cache to keep the UI snappy
    now = _time.time()
    cached = _GDRIVE_STATUS_CACHE["value"]
    if cached is not None and (now - _GDRIVE_STATUS_CACHE["ts"]) < _GDRIVE_STATUS_TTL:
        return cached

    def _run():
        try:
            result = subprocess.run(
                ["rclone", "about", "gdrive:", "--config", str(auth_manager.config_path)],
                capture_output=True,
                text=True,
                timeout=15
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                info = {}
                for line in lines:
                    if ':' in line:
                        key, value = line.split(':', 1)
                        info[key.strip().lower().replace(' ', '_')] = value.strip()
                return {"connected": True, "info": info}
            return {"connected": False, "error": "Authentication expired"}
        except subprocess.TimeoutExpired:
            return {"connected": False, "error": "Connection timeout"}
        except Exception as e:
            return {"connected": False, "error": str(e)}

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, _run)
    _GDRIVE_STATUS_CACHE["value"] = response
    _GDRIVE_STATUS_CACHE["ts"] = now
    return response


@app.delete("/api/gdrive/disconnect")
async def disconnect_gdrive():
    """Disconnect Google Drive (delete config)"""
    try:
        if auth_manager.config_path.exists():
            auth_manager.config_path.unlink()
        return {"message": "Disconnected successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/browse")
async def browse_files(path: str = "/data"):
    """Browse files and directories in /data"""
    import os
    from pathlib import Path
    
    try:
        browse_path = Path(path)
        if not browse_path.exists():
            raise HTTPException(status_code=404, detail="Path not found")
        
        if not str(browse_path).startswith("/data"):
            raise HTTPException(status_code=403, detail="Access denied")
        
        items = []
        for item in sorted(browse_path.iterdir()):
            try:
                stat = item.stat()
                # Skip hidden files starting with .
                if item.name.startswith('.'):
                    continue
                    
                items.append({
                    "name": item.name,
                    "path": str(item),
                    "type": "directory" if item.is_dir() else "file",
                    "size": stat.st_size if item.is_file() else 0,
                    "modified": stat.st_mtime
                })
            except (PermissionError, OSError) as e:
                print(f"Error accessing {item}: {e}")
                continue
        
        print(f"Browse {browse_path}: found {len(items)} items")
        
        return {
            "current_path": str(browse_path),
            "parent_path": str(browse_path.parent) if browse_path != Path("/data") else None,
            "items": items
        }
    except Exception as e:
        print(f"Browse error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/config/remotes")
async def get_remotes() -> list[str]:
    """Get configured rclone remotes (legacy - names only)."""
    return auth_manager.get_remotes()


@app.get("/api/config/remotes/detailed")
async def get_remotes_detailed() -> list[dict]:
    """Get configured rclone remotes with their type, e.g. [{name: "gdrive", type: "drive"}]."""
    return auth_manager.get_remotes_detailed()


@app.get("/api/providers")
async def get_providers():
    """Return rclone's full provider catalogue (name, description, options).

    Lets the frontend render dynamic forms for any backend (S3, B2, SFTP, ...)
    without baking provider knowledge into the UI.
    """
    return {"providers": auth_manager.get_providers()}


@app.post("/api/config/remotes")
async def create_remote(payload: dict):
    """Create a new generic rclone remote (any non-OAuth provider).

    Body: {"name": "...", "type": "s3"|"b2"|"sftp"|..., "params": {key: value, ...}}
    For Google Drive prefer the OAuth endpoints under /api/auth/google-drive/.
    """
    name = (payload or {}).get("name", "").strip()
    remote_type = (payload or {}).get("type", "").strip()
    params = (payload or {}).get("params") or {}
    if not name or not remote_type:
        raise HTTPException(status_code=400, detail="name and type are required")
    success, message = auth_manager.create_remote(name, remote_type, params)
    if success:
        return {"message": message, "name": name}
    raise HTTPException(status_code=400, detail=message)


@app.delete("/api/config/remotes/{remote_name}")
async def delete_remote(remote_name: str):
    """Delete an rclone remote from the config."""
    success, message = auth_manager.delete_remote(remote_name)
    if success:
        return {"message": message}
    raise HTTPException(status_code=404 if "not found" in message.lower() else 500, detail=message)


@app.post("/api/config/upload")
async def upload_config(file: UploadFile = File(...)):
    """Upload rclone configuration file"""
    content = await file.read()
    success = auth_manager.save_config(content.decode('utf-8'))
    
    if success:
        return {"message": "Configuration uploaded successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save configuration")


@app.get("/api/config/download")
async def download_config():
    """Download current rclone configuration"""
    config = auth_manager.get_config()
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    
    return {"config": config}


@app.post("/api/config/test/{remote_name}")
async def test_remote(remote_name: str):
    """Test remote connection"""
    success, message = auth_manager.test_remote(remote_name)
    return {"success": success, "message": message}


@app.post("/api/auth/google-drive/start")
async def start_google_drive_auth(request: Request, remote_name: str = "gdrive"):
    """Start Google Drive OAuth flow"""
    # Get base URL from request for redirect URI
    base_url = str(request.base_url).rstrip('/')
    result = auth_manager.start_google_drive_auth(remote_name, base_url)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@app.post("/api/auth/google-drive/exchange-code")
async def exchange_google_drive_code(remote_name: str = "gdrive", code: str = ""):
    """Exchange authorization code for token (OOB flow)"""
    if not code or not code.strip():
        raise HTTPException(status_code=400, detail="Authorization code is required")
    
    success, message = auth_manager.exchange_code_for_token(code.strip(), remote_name)
    if success:
        return {"message": message, "success": True}
    else:
        raise HTTPException(status_code=400, detail=message)


@app.get("/api/auth/google-drive/callback")
async def google_drive_oauth_callback(code: str, state: str):
    """Handle OAuth callback from Google - automatically exchange code for token"""
    success, message = auth_manager.handle_oauth_callback(code, state)
    
    if success:
        return HTMLResponse(content="""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Authorization Complete</title>
            <style>
                body {
                    font-family: system-ui, -apple-system, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    color: white;
                }
                .container {
                    text-align: center;
                    background: rgba(255, 255, 255, 0.1);
                    padding: 3rem;
                    border-radius: 1rem;
                    backdrop-filter: blur(10px);
                    max-width: 500px;
                }
                h1 { margin: 0 0 1rem 0; }
                p { opacity: 0.9; }
            </style>
            <script>
                setTimeout(() => window.close(), 3000);
            </script>
        </head>
        <body>
            <div class="container">
                <h1>✅ Connected Successfully!</h1>
                <p>Google Drive has been connected.</p>
                <p style="font-size: 0.9rem;">This window will close automatically...</p>
            </div>
        </body>
        </html>
        """)
    else:
        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Authorization Failed</title>
            <style>
                body {{
                    font-family: system-ui, -apple-system, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    color: white;
                }}
                .container {{
                    text-align: center;
                    background: rgba(255, 255, 255, 0.1);
                    padding: 3rem;
                    border-radius: 1rem;
                    backdrop-filter: blur(10px);
                    max-width: 500px;
                }}
                h1 {{ margin: 0 0 1rem 0; }}
                p {{ opacity: 0.9; }}
                .error {{ background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 0.5rem; margin: 1rem 0; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>❌ Authorization Failed</h1>
                <p>Could not connect to Google Drive:</p>
                <div class="error">{message}</div>
                <p style="font-size: 0.9rem;">Please close this window and try again.</p>
            </div>
        </body>
        </html>
        """, status_code=400)


@app.post("/api/auth/google-drive/complete")
async def complete_google_drive_auth(remote_name: str, token: str):
    """Complete Google Drive OAuth with token"""
    success, message = auth_manager.create_google_drive_remote(remote_name, token)
    if success:
        return {"message": message}
    else:
        raise HTTPException(status_code=500, detail=message)


@app.post("/api/auth/google-drive/quick-setup")
async def quick_setup_google_drive(remote_name: str = "gdrive"):
    """Quick setup Google Drive (interactive)"""
    success, message = auth_manager.setup_google_drive_interactive(remote_name)
    if success:
        return {"message": message}
    else:
        raise HTTPException(status_code=500, detail=message)


@app.get("/api/jobs", response_model=list[Job])
async def get_jobs():
    """Get all jobs"""
    jobs = job_manager.get_all_jobs()
    
    for job in jobs:
        next_run = scheduler.get_next_run(job.id)
        if next_run:
            job.next_run = next_run
    
    return jobs


@app.get("/api/jobs/{job_id}", response_model=Job)
async def get_job(job_id: str):
    """Get a specific job"""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    next_run = scheduler.get_next_run(job_id)
    if next_run:
        job.next_run = next_run
    
    return job


@app.post("/api/jobs", response_model=Job)
async def create_job(job_create: JobCreate):
    """Create a new job"""
    job = job_manager.create_job(job_create)
    
    if job.enabled:
        try:
            scheduler.schedule_job(job)
            next_run = scheduler.get_next_run(job.id)
            if next_run:
                job.next_run = next_run
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid cron expression: {str(e)}")
    
    return job


@app.put("/api/jobs/{job_id}", response_model=Job)
async def update_job(job_id: str, job_update: JobUpdate):
    """Update a job"""
    job = job_manager.update_job(job_id, job_update)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    scheduler.unschedule_job(job_id)
    
    if job.enabled:
        try:
            scheduler.schedule_job(job)
            next_run = scheduler.get_next_run(job.id)
            if next_run:
                job.next_run = next_run
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid cron expression: {str(e)}")
    
    return job


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    """Delete a job"""
    # Stop the job if it's running
    job = job_manager.get_job(job_id)
    if job and job.status == JobStatus.RUNNING:
        job_engine.stop_job(job_id)
        job_manager.update_job_status(job_id, JobStatus.IDLE)
    
    scheduler.unschedule_job(job_id)
    
    success = job_manager.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {"message": "Job deleted successfully"}


@app.post("/api/jobs/{job_id}/run")
async def run_job_now(job_id: str):
    """Run a job immediately"""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status == JobStatus.RUNNING:
        raise HTTPException(status_code=409, detail="Job is already running")
    
    import asyncio
    asyncio.create_task(execute_job_wrapper(job_id))
    
    return {"message": "Job started"}


@app.post("/api/jobs/{job_id}/stop")
async def stop_job(job_id: str):
    """Stop a running job"""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != JobStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Job is not running")
    
    success = job_engine.stop_job(job_id)
    if success:
        job_manager.update_job_status(job_id, JobStatus.IDLE, "Job stopped by user")
        return {"message": "Job stopped successfully"}
    else:
        raise HTTPException(status_code=400, detail="Failed to stop job")


@app.post("/api/jobs/{job_id}/reset")
async def reset_job_status(job_id: str):
    """Reset job status to IDLE (for stuck jobs)"""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Force stop if running
    job_engine.stop_job(job_id)
    
    # Reset status
    job_manager.update_job_status(job_id, JobStatus.IDLE, "Status reset by user")
    
    return {"message": "Job status reset successfully"}


@app.get("/api/logs", response_model=list[JobLog])
async def get_logs(job_id: str = None, limit: int = 100):
    """Get job logs"""
    return job_manager.get_logs(job_id, limit)


@app.get("/api/events")
async def events():
    """Server-Sent Events endpoint for real-time updates"""
    return StreamingResponse(
        broadcaster.subscribe(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/api/backup/config")
async def backup_config():
    """Backup configuration to cloud"""
    success, message = await self_backup.backup_config()
    if success:
        return {"message": message}
    else:
        raise HTTPException(status_code=500, detail=message)


@app.get("/api/backup/list")
async def list_backups():
    """List available configuration backups"""
    backups = await self_backup.list_backups()
    return {"backups": backups}


@app.post("/api/backup/restore/{timestamp}")
async def restore_backup(timestamp: str):
    """Restore configuration from backup"""
    success, message = await self_backup.restore_config(timestamp)
    if success:
        return {"message": message}
    else:
        raise HTTPException(status_code=500, detail=message)


@app.post("/api/test/notifications")
async def test_notifications():
    """Test notification system"""
    success, message = guardian.test_notifications()
    return {"success": success, "message": message}


# Short-lived cache for the restore backups listing — heavy due to multiple
# rclone roundtrips per job. The TTL is small so freshness stays acceptable
# while a refresh button click within the window is instant.
_RESTORE_LIST_CACHE: dict = {"value": None, "ts": 0.0}
_RESTORE_LIST_TTL = 5.0  # seconds


@app.get("/api/restore/backups")
async def list_restore_backups(refresh: bool = False):
    """List all available backup snapshots.
    Sources:
      1. Remote destinations from configured Jobs
      2. Local /backups directory (ZIP files created by Jobs)
      3. If no jobs exist, attempt to restore jobs.json from self-backup first
    Cached briefly (5s) — pass ?refresh=true to bypass.
    """
    import subprocess
    import re
    import os
    import time as _time

    if not refresh:
        now = _time.time()
        cached = _RESTORE_LIST_CACHE["value"]
        if cached is not None and (now - _RESTORE_LIST_CACHE["ts"]) < _RESTORE_LIST_TTL:
            return cached

    has_config = auth_manager.config_path.exists()
    jobs = job_manager.get_all_jobs()

    # If no jobs and config exists, try to pull jobs.json from self-backup cloud copy
    if not jobs and has_config:
        try:
            await self_backup.restore_config()
            jobs = job_manager.get_all_jobs()
        except Exception:
            pass

    results = []
    seen_job_names = set()

    # ── Source 1: Remote destinations from known Jobs ──────────────────────────
    # Run all `rclone lsf` calls in PARALLEL to avoid sequential cloud round-trips.
    if has_config:
        loop = asyncio.get_event_loop()

        def _lsf(dest: str):
            return subprocess.run(
                ["rclone", "lsf", dest.rstrip('/'),
                 "--config", str(auth_manager.config_path),
                 "--dirs-only", "--max-depth", "1"],
                capture_output=True, text=True, timeout=30
            )

        for job in jobs:
            seen_job_names.add(job.name)

        # Kick off all listings concurrently
        listings = await asyncio.gather(
            *[loop.run_in_executor(None, lambda d=j.destination: _lsf(d)) for j in jobs],
            return_exceptions=True,
        )

        for job, result in zip(jobs, listings):
            if isinstance(result, Exception):
                print(f"Error listing remote backups for {job.name}: {result}")
                continue
            snapshots = []
            if result.returncode == 0:
                for line in result.stdout.strip().split('\n'):
                    folder = line.strip().rstrip('/')
                    if not folder:
                        continue
                    # Match: JobName-DD.MM.YYYY-HH:MM:SS
                    match = re.match(
                        rf"^{re.escape(''.join(c if c.isalnum() or c in '-_ ' else '_' for c in job.name))}"
                        r"-(\d{2})\.(\d{2})\.(\d{4})-(\d{2}):(\d{2}):(\d{2})$",
                        folder
                    )
                    if match:
                        day, month, year, hour, minute, second = match.groups()
                        snapshots.append({
                            "folder": folder,
                            "path": f"{job.destination.rstrip('/')}/{folder}",
                            "timestamp": f"{year}-{month}-{day}T{hour}:{minute}:{second}",
                            "display": f"{day}/{month}/{year} {hour}:{minute}:{second}",
                            "encrypted": bool(job.zip_password),
                            "compressed": job.compress_before_upload,
                            "job_id": job.id,
                            "job_name": job.name,
                            "source": "remote"
                        })
            snapshots.sort(key=lambda x: x["timestamp"], reverse=True)
            if snapshots:
                results.append({
                    "job_id": job.id,
                    "job_name": job.name,
                    "destination": job.destination,
                    "snapshots": snapshots
                })

    # ── Source 2: Local /backups directory (ZIP files) ─────────────────────────
    backups_dir = Path("/backups")
    if backups_dir.exists():
        # Pattern: JobName_YYYYMMDD_HHMMSS.zip
        local_pattern = re.compile(r"^(.+)_(\d{8})_(\d{6})\.zip$")
        local_by_job: dict[str, list] = {}

        try:
            for f in sorted(backups_dir.iterdir()):
                if not f.is_file() or f.suffix != '.zip':
                    continue
                m = local_pattern.match(f.name)
                if not m:
                    continue
                job_name_raw, date_str, time_str = m.groups()
                # Restore display name (underscores → spaces for display)
                try:
                    dt = datetime.strptime(date_str + time_str, "%Y%m%d%H%M%S")
                    ts = dt.strftime("%Y-%m-%dT%H:%M:%S")
                    display = dt.strftime("%d/%m/%Y %H:%M:%S")
                except ValueError:
                    continue

                stat = f.stat()
                size_mb = round(stat.st_size / (1024 * 1024), 1)

                snap = {
                    "folder": f.name,
                    "path": str(f),
                    "timestamp": ts,
                    "display": display,
                    "encrypted": False,
                    "compressed": True,
                    "job_name": job_name_raw,
                    "job_id": None,
                    "size_mb": size_mb,
                    "source": "local"
                }

                # Try to match with a known job
                for job in jobs:
                    clean = "".join(c if c.isalnum() or c in '-_' else '_' for c in job.name)
                    if job_name_raw == clean:
                        snap["job_id"] = job.id
                        snap["encrypted"] = bool(job.zip_password)
                        break

                local_by_job.setdefault(job_name_raw, []).append(snap)
        except Exception as e:
            print(f"Error scanning /backups: {e}")

        # Merge local snapshots into results (keep both cloud + local entries;
        # the UI distinguishes them via the `source` field).
        for job_name_raw, snaps in local_by_job.items():
            snaps.sort(key=lambda x: x["timestamp"], reverse=True)
            # Check if already in results (remote job with same name or matched by job_id)
            existing = next((r for r in results if r["job_name"] == job_name_raw or
                             any(s.get("job_id") == snaps[0].get("job_id") for s in snaps if snaps[0].get("job_id"))), None)
            if existing:
                existing["snapshots"].extend(snaps)
                existing["snapshots"].sort(key=lambda x: x["timestamp"], reverse=True)
            else:
                results.append({
                    "job_id": snaps[0].get("job_id"),
                    "job_name": job_name_raw,
                    "destination": "/backups (local)",
                    "snapshots": snaps
                })

    # ── Safeguard: dedupe only exact duplicates (same folder path + same source) ──
    for r in results:
        seen = set()
        unique = []
        for s in r["snapshots"]:
            key = (s.get("source"), s.get("path"))
            if key in seen:
                continue
            seen.add(key)
            unique.append(s)
        r["snapshots"] = unique

    # ── Source 3: Scan remote MirrorCloneBackups root (for fresh container) ──────
    # Only if we still have no results and have rclone config
    if has_config and not results:
        try:
            # Detect remote name from self_backup or rclone config
            remote_name = self_backup.remote_name  # e.g. "gdrive"
            root_path = f"{remote_name}:MirrorCloneBackups"

            # List top-level dirs in root
            r = subprocess.run(
                ["rclone", "lsf", root_path, "--config", str(auth_manager.config_path),
                 "--dirs-only", "--max-depth", "1"],
                capture_output=True, text=True, timeout=30
            )
            if r.returncode == 0:
                EXCLUDED = {"mirrorclone-config", "mirrorclone-config/"}
                job_dirs = []
                for line in r.stdout.strip().split('\n'):
                    job_dir = line.strip().rstrip('/')
                    if not job_dir or job_dir in EXCLUDED:
                        continue
                    job_dirs.append(job_dir)

                # Parallelize per-job-dir snapshot listings
                loop3 = asyncio.get_event_loop()
                snap_listings = await asyncio.gather(
                    *[loop3.run_in_executor(
                        None,
                        lambda d=f"{root_path}/{jd}": subprocess.run(
                            ["rclone", "lsf", d, "--config", str(auth_manager.config_path),
                             "--dirs-only", "--max-depth", "1"],
                            capture_output=True, text=True, timeout=30
                        )
                    ) for jd in job_dirs],
                    return_exceptions=True,
                )

                for job_dir, r2 in zip(job_dirs, snap_listings):
                    if isinstance(r2, Exception):
                        continue
                    job_dest = f"{root_path}/{job_dir}"
                    snapshots = []
                    if r2.returncode == 0:
                        snap_pattern = re.compile(
                            r"^(.+)-(\d{2})\.(\d{2})\.(\d{4})-(\d{2}):(\d{2}):(\d{2})/?$"
                        )
                        for snap_line in r2.stdout.strip().split('\n'):
                            folder = snap_line.strip().rstrip('/')
                            if not folder:
                                continue
                            m = snap_pattern.match(folder)
                            if not m:
                                continue
                            _, day, month, year, hour, minute, second = m.groups()
                            snapshots.append({
                                "folder": folder,
                                "path": f"{job_dest}/{folder}",
                                "timestamp": f"{year}-{month}-{day}T{hour}:{minute}:{second}",
                                "display": f"{day}/{month}/{year} {hour}:{minute}:{second}",
                                "encrypted": False,
                                "compressed": False,
                                "job_id": None,
                                "job_name": job_dir,
                                "source": "remote_scan"
                            })
                    snapshots.sort(key=lambda x: x["timestamp"], reverse=True)
                    if snapshots:
                        results.append({
                            "job_id": None,
                            "job_name": job_dir,
                            "destination": job_dest,
                            "snapshots": snapshots
                        })
        except Exception as e:
            print(f"Error scanning remote root: {e}")

    response = {"jobs": results, "config_available": has_config}
    # Populate cache for subsequent fast reads
    import time as _time
    _RESTORE_LIST_CACHE["value"] = response
    _RESTORE_LIST_CACHE["ts"] = _time.time()
    return response


def _browse_local_zip(zip_path: Path, backup_path: str, sub_path: str, source_label: str = "local"):
    """Helper: list entries inside a local ZIP at the given sub_path."""
    import zipfile as _zipfile
    try:
        with _zipfile.ZipFile(str(zip_path), 'r') as zf:
            prefix = sub_path.rstrip('/') + '/' if sub_path else ''
            seen_dirs = set()
            items = []
            for name in zf.namelist():
                if not name.startswith(prefix):
                    continue
                rest = name[len(prefix):]
                if not rest or rest == '/':
                    continue
                parts = rest.split('/')
                child_name = parts[0]
                if not child_name:
                    continue
                is_dir = len(parts) > 1
                child_path = (prefix + child_name).lstrip('/')
                if is_dir:
                    if child_name not in seen_dirs:
                        seen_dirs.add(child_name)
                        items.append({
                            "name": child_name,
                            "path": child_path,
                            "type": "directory",
                            "size": 0
                        })
                else:
                    info = zf.getinfo(name)
                    items.append({
                        "name": child_name,
                        "path": child_path,
                        "type": "file",
                        "size": info.file_size
                    })
            items.sort(key=lambda x: (0 if x["type"] == "directory" else 1, x["name"]))
            return {
                "backup_path": backup_path,
                "sub_path": sub_path,
                "parent_sub_path": str(Path(sub_path).parent) if sub_path and sub_path != "." else None,
                "items": items,
                "source": source_label,
                "is_zip": True,
            }
    except _zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid or encrypted ZIP (cannot browse without extraction)")


class _RcloneRemoteFile:
    """Read-only, seekable file-like wrapper over a remote file via `rclone cat`
    with byte-range offsets. Each read spawns an rclone subprocess, so callers
    should minimize reads (e.g. zipfile only reads the central directory).
    """

    def __init__(self, remote_path: str, config_path: Path, size: Optional[int] = None):
        import subprocess as _sub
        self._sub = _sub
        self.remote_path = remote_path
        self.config_path = config_path
        self._size = size
        self._pos = 0

    def _ensure_size(self) -> int:
        if self._size is None:
            res = self._sub.run(
                ["rclone", "lsjson", self.remote_path,
                 "--config", str(self.config_path),
                 "--no-modtime", "--no-mimetype"],
                capture_output=True, text=True, timeout=120
            )
            if res.returncode != 0:
                raise IOError(f"rclone lsjson failed: {res.stderr}")
            data = json.loads(res.stdout)
            if not data:
                raise IOError(f"Remote file not found: {self.remote_path}")
            self._size = data[0].get("Size", 0)
        return self._size

    # file-like protocol
    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self._pos = offset
        elif whence == 1:
            self._pos += offset
        elif whence == 2:
            self._pos = self._ensure_size() + offset
        else:
            raise ValueError(f"invalid whence: {whence}")
        if self._pos < 0:
            self._pos = 0
        return self._pos

    def read(self, size: int = -1) -> bytes:
        total = self._ensure_size()
        if self._pos >= total:
            return b""
        if size is None or size < 0:
            size = total - self._pos
        if size == 0:
            return b""
        # Clamp to file size to avoid rclone errors
        count = min(size, total - self._pos)
        res = self._sub.run(
            ["rclone", "cat", self.remote_path,
             "--offset", str(self._pos),
             "--count", str(count),
             "--config", str(self.config_path)],
            capture_output=True, timeout=180
        )
        if res.returncode != 0:
            raise IOError(f"rclone cat failed at offset {self._pos}: {res.stderr!r}")
        data = res.stdout or b""
        self._pos += len(data)
        return data

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


# In-memory cache of ZIP entry listings keyed by (remote_path, size).
# Avoids re-reading the central directory when the user navigates between
# sub-folders of the same archive.
_REMOTE_ZIP_ENTRY_CACHE: dict = {}
_REMOTE_ZIP_CACHE_MAX = 32


def _read_remote_range(remote_path: str, offset: int, count: int, timeout: int = 180) -> bytes:
    """Fetch a single byte range from a remote file via `rclone cat`."""
    import subprocess as _sub
    res = _sub.run(
        ["rclone", "cat", remote_path,
         "--offset", str(offset),
         "--count", str(count),
         "--config", str(auth_manager.config_path)],
        capture_output=True, timeout=timeout
    )
    if res.returncode != 0:
        raise IOError(f"rclone cat failed at offset {offset}: {res.stderr!r}")
    return res.stdout or b""


def _fetch_remote_zip_entries(remote_zip_path: str, zip_size: int) -> list:
    """Return [{name, size, is_dir}, ...] for all entries in a remote ZIP,
    using only ONE byte-range read for the central directory tail.

    Strategy: read the last min(1MB, zip_size) bytes (covers EOCD + most CDs),
    then let zipfile parse from BytesIO. Fall back to a larger read for very
    large central directories.
    """
    import io
    import zipfile as _zipfile

    cache_key = (remote_zip_path, zip_size)
    cached = _REMOTE_ZIP_ENTRY_CACHE.get(cache_key)
    if cached is not None:
        return cached

    # Initial tail size: 1 MiB or whole file, whichever is smaller.
    tail_size = min(1024 * 1024, zip_size)

    def _try_with_tail(tail_bytes: int) -> Optional[list]:
        offset = max(0, zip_size - tail_bytes)
        data = _read_remote_range(remote_zip_path, offset, tail_bytes)
        if len(data) < 22:  # ZIP EOCD is at least 22 bytes
            return None
        # Build a sparse buffer: pad with zeros from 0..offset, then real bytes.
        # zipfile only seeks within the real (tail) region after locating EOCD,
        # so we just need a file-like that returns 0xFF for unread regions.
        class _Tail(io.RawIOBase):
            def __init__(self, padding: int, payload: bytes):
                self._padding = padding
                self._payload = payload
                self._pos = 0
                self._size = padding + len(payload)
            def readable(self):
                return True
            def seekable(self):
                return True
            def tell(self):
                return self._pos
            def seek(self, off, whence=0):
                if whence == 0:
                    self._pos = off
                elif whence == 1:
                    self._pos += off
                elif whence == 2:
                    self._pos = self._size + off
                if self._pos < 0:
                    self._pos = 0
                return self._pos
            def read(self, n=-1):
                if self._pos >= self._size:
                    return b""
                if n is None or n < 0:
                    n = self._size - self._pos
                end = min(self._size, self._pos + n)
                if end <= self._padding:
                    out = b"\x00" * (end - self._pos)
                elif self._pos >= self._padding:
                    s = self._pos - self._padding
                    e = end - self._padding
                    out = self._payload[s:e]
                else:
                    pad_part = b"\x00" * (self._padding - self._pos)
                    payload_part = self._payload[: end - self._padding]
                    out = pad_part + payload_part
                self._pos = end
                return out

        tail_fp = _Tail(offset, data)
        try:
            with _zipfile.ZipFile(tail_fp, 'r') as zf:
                return [
                    {"name": info.filename, "size": info.file_size, "is_dir": info.is_dir()}
                    for info in zf.infolist()
                ]
        except _zipfile.BadZipFile:
            return None

    entries = _try_with_tail(tail_size)
    if entries is None and tail_size < zip_size:
        # Central directory is larger than 1MB - try 8MB then full file size.
        for bigger in (8 * 1024 * 1024, zip_size):
            entries = _try_with_tail(min(bigger, zip_size))
            if entries is not None:
                break

    if entries is None:
        raise IOError("Could not parse ZIP central directory from remote tail")

    # Cache the result (basic size-bounded cache)
    if len(_REMOTE_ZIP_ENTRY_CACHE) >= _REMOTE_ZIP_CACHE_MAX:
        _REMOTE_ZIP_ENTRY_CACHE.pop(next(iter(_REMOTE_ZIP_ENTRY_CACHE)))
    _REMOTE_ZIP_ENTRY_CACHE[cache_key] = entries
    return entries


def _browse_remote_zip_via_byterange(remote_zip_path: str, zip_size: Optional[int],
                                     backup_path: str, sub_path: str):
    """Open a remote ZIP over rclone byte ranges and list its central directory.

    Reads only the tail of the archive (typically <1MB) in a SINGLE rclone call
    and caches the resulting entry list in memory for instant sub-folder browsing.
    """
    if not zip_size:
        # Need to know the size to read from the tail; fall back to lsjson once.
        rf = _RcloneRemoteFile(remote_zip_path, auth_manager.config_path)
        zip_size = rf._ensure_size()

    entries = _fetch_remote_zip_entries(remote_zip_path, zip_size)
    return _browse_manifest(
        {"entries": entries, "zip_filename": Path(remote_zip_path).name},
        backup_path, sub_path,
    )


def _browse_manifest(manifest: dict, backup_path: str, sub_path: str):
    """Build a directory listing at `sub_path` from a flat entries list.
    Used internally by the byte-range ZIP browser.
    """
    entries = manifest.get("entries", [])
    prefix = sub_path.rstrip('/') + '/' if sub_path else ''
    seen_dirs = set()
    items = []
    for entry in entries:
        name = entry.get("name", "")
        if not name or not name.startswith(prefix):
            continue
        rest = name[len(prefix):]
        if not rest or rest == '/':
            continue
        parts = rest.split('/')
        child_name = parts[0]
        if not child_name:
            continue
        is_dir = len(parts) > 1 or entry.get("is_dir", False)
        child_path = (prefix + child_name).lstrip('/')
        if is_dir:
            if child_name not in seen_dirs:
                seen_dirs.add(child_name)
                items.append({
                    "name": child_name,
                    "path": child_path,
                    "type": "directory",
                    "size": 0,
                })
        else:
            items.append({
                "name": child_name,
                "path": child_path,
                "type": "file",
                "size": entry.get("size", 0),
            })
    items.sort(key=lambda x: (0 if x["type"] == "directory" else 1, x["name"]))
    return {
        "backup_path": backup_path,
        "sub_path": sub_path,
        "parent_sub_path": str(Path(sub_path).parent) if sub_path and sub_path != "." else None,
        "items": items,
        "source": "remote_manifest",
        "is_zip": True,
    }


@app.get("/api/restore/browse")
async def browse_backup(backup_path: str, sub_path: str = ""):
    """Browse files inside a backup snapshot.

    Supported sources:
      • Local ZIP file (path on disk ending in .zip)
      • Remote folder via rclone — if the folder contains a single ZIP, the ZIP
        is auto-downloaded to a cache dir and browsed transparently.
      • Remote folder with raw files — listed directly via rclone.
    """
    import subprocess
    import zipfile as _zipfile

    # ── Local ZIP file (direct path on disk) ──────────────────────────────────
    local_path = Path(backup_path)
    if local_path.exists() and local_path.is_file() and local_path.suffix == '.zip':
        return _browse_local_zip(local_path, backup_path, sub_path, source_label="local")

    # ── Remote via rclone ──────────────────────────────────────────────────────
    if not auth_manager.config_path.exists():
        raise HTTPException(status_code=400, detail="No rclone config found")

    loop = asyncio.get_event_loop()

    def _list_remote(remote_path: str):
        res = subprocess.run(
            [
                "rclone", "lsjson", remote_path,
                "--config", str(auth_manager.config_path),
                "--no-modtime",
                "--no-mimetype",
                "--fast-list",
            ],
            capture_output=True, text=True, timeout=120
        )
        return res

    # ── If the snapshot folder contains a single ZIP, browse INTO it via ──────
    # byte-range reads of the ZIP's central directory (no full download).
    try:
        top = await loop.run_in_executor(None, lambda: _list_remote(backup_path.rstrip('/')))
        if top.returncode == 0 and top.stdout.strip():
            top_items = json.loads(top.stdout)
            zip_files = [i for i in top_items if not i.get("IsDir") and i.get("Name", "").lower().endswith(".zip")]
            non_zip = [i for i in top_items if i not in zip_files]

            if len(zip_files) == 1 and not non_zip:
                zip_info = zip_files[0]
                remote_zip = f"{backup_path.rstrip('/')}/{zip_info['Name']}"
                zip_size = zip_info.get("Size")
                return await loop.run_in_executor(
                    None,
                    lambda: _browse_remote_zip_via_byterange(remote_zip, zip_size, backup_path, sub_path)
                )
    except HTTPException:
        raise
    except Exception as e:
        # If byte-range reading fails (encrypted ZIP, exotic remote, etc.),
        # surface a clear error instead of silently falling back.
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read ZIP central directory from remote: {e}"
        )

    # ── Plain remote folder listing (no ZIP, or multiple files) ───────────────
    full_path = f"{backup_path.rstrip('/')}/{sub_path}".rstrip('/')
    try:
        result = await loop.run_in_executor(None, lambda: _list_remote(full_path))
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr)

        raw = json.loads(result.stdout) if result.stdout.strip() else []
        items = []
        for item in raw:
            items.append({
                "name": item.get("Name", ""),
                "path": f"{sub_path}/{item['Name']}".lstrip('/') if sub_path else item["Name"],
                "type": "directory" if item.get("IsDir") else "file",
                "size": item.get("Size", 0)
            })
        items.sort(key=lambda x: (0 if x["type"] == "directory" else 1, x["name"]))
        return {
            "backup_path": backup_path,
            "sub_path": sub_path,
            "parent_sub_path": str(Path(sub_path).parent) if sub_path and sub_path != "." else None,
            "items": items,
            "source": "remote"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/restore/execute")
async def execute_restore(request: dict):
    """Execute a restore operation"""
    import subprocess
    import os
    
    backup_path = request.get("backup_path", "").strip()
    selected_items = request.get("selected_items", [])  # list of relative paths inside backup
    destination = request.get("destination", "").strip()
    password = request.get("password", "")
    restore_permissions = request.get("restore_permissions", False)
    
    if not backup_path:
        raise HTTPException(status_code=400, detail="backup_path is required")
    if not destination:
        raise HTTPException(status_code=400, detail="destination is required")

    dest_path = Path(destination)
    loop = asyncio.get_event_loop()

    def _do_restore():
        import tempfile, zipfile as _zipfile

        dest_path.mkdir(parents=True, exist_ok=True)

        # ── Case 1: backup_path is a local ZIP file ────────────────────────────
        local_zip_path = Path(backup_path)
        if local_zip_path.exists() and local_zip_path.is_file() and local_zip_path.suffix == '.zip':
            if password:
                # Use 7z for encrypted ZIPs
                extract_cmd = ["7z", "x", f"-p{password}", f"-o{dest_path}", "-y", str(local_zip_path)]
                if selected_items:
                    extract_cmd.extend(selected_items)
                res = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=600)
                if res.returncode != 0:
                    return False, f"Extraction failed (wrong password?): {res.stderr}"
                return True, f"Restored to {destination}"
            else:
                try:
                    with _zipfile.ZipFile(str(local_zip_path), 'r') as zf:
                        if selected_items:
                            for item in selected_items:
                                for zname in zf.namelist():
                                    if zname == item or zname.startswith(item.rstrip('/') + '/'):
                                        zf.extract(zname, str(dest_path))
                        else:
                            zf.extractall(str(dest_path))
                    return True, f"Restored to {destination}"
                except _zipfile.BadZipFile as e:
                    return False, f"Bad zip file: {e}"

        # ── Case 2: remote rclone path ─────────────────────────────────────────
        if not auth_manager.config_path.exists():
            return False, "No rclone config found"

        # Check if the remote snapshot contains a ZIP inside
        zip_result = subprocess.run(
            ["rclone", "lsjson", backup_path, "--config", str(auth_manager.config_path), "--no-modtime"],
            capture_output=True, text=True, timeout=30
        )
        is_zip_backup = False
        zip_remote_path = None
        if zip_result.returncode == 0 and zip_result.stdout.strip():
            remote_items = json.loads(zip_result.stdout)
            zip_files = [i for i in remote_items if not i.get("IsDir") and i["Name"].endswith(".zip")]
            if zip_files:
                is_zip_backup = True
                zip_remote_path = f"{backup_path.rstrip('/')}/{zip_files[0]['Name']}"

        if is_zip_backup and zip_remote_path:
            # Download ZIP to temp dir then extract
            with tempfile.TemporaryDirectory() as tmpdir:
                dl = subprocess.run(
                    ["rclone", "copy", zip_remote_path, tmpdir,
                     "--config", str(auth_manager.config_path)],
                    capture_output=True, text=True, timeout=600
                )
                if dl.returncode != 0:
                    return False, f"Failed to download backup: {dl.stderr}"

                local_zip = str(next(Path(tmpdir).glob("*.zip")))

                if password:
                    extract_cmd = ["7z", "x", f"-p{password}", f"-o{dest_path}", "-y", local_zip]
                    if selected_items:
                        extract_cmd.extend(selected_items)
                    res = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=600)
                    if res.returncode != 0:
                        return False, f"Extraction failed (wrong password?): {res.stderr}"
                else:
                    try:
                        with _zipfile.ZipFile(local_zip, 'r') as zf:
                            if selected_items:
                                for item in selected_items:
                                    for zname in zf.namelist():
                                        if zname == item or zname.startswith(item.rstrip('/') + '/'):
                                            zf.extract(zname, str(dest_path))
                            else:
                                zf.extractall(str(dest_path))
                    except _zipfile.BadZipFile as e:
                        return False, f"Bad zip file: {e}"

                return True, f"Restored to {destination}"
        else:
            # Direct rclone copy from remote
            if selected_items:
                import tempfile
                with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
                    f.write('\n'.join(selected_items))
                    files_from = f.name
                
                try:
                    cmd = [
                        "rclone", "copy",
                        backup_path,
                        destination,
                        "--config", str(auth_manager.config_path),
                        "--files-from", files_from,
                        "--transfers", "4",
                    ]
                    res = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
                finally:
                    Path(files_from).unlink(missing_ok=True)
            else:
                cmd = [
                    "rclone", "copy",
                    backup_path,
                    destination,
                    "--config", str(auth_manager.config_path),
                    "--transfers", "4",
                ]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
            
            if res.returncode != 0:
                return False, f"Restore failed: {res.stderr}"
            
            # Restore permissions if requested (Linux/Mac only)
            if restore_permissions and os.name != 'nt':
                try:
                    for root, dirs, files in os.walk(destination):
                        for fname in files:
                            fpath = os.path.join(root, fname)
                            os.chmod(fpath, 0o644)
                        for dname in dirs:
                            os.chmod(os.path.join(root, dname), 0o755)
                except Exception as e:
                    print(f"Permission restore warning: {e}")
            
            return True, f"Restored {len(selected_items) if selected_items else 'all'} item(s) to {destination}"
    
    try:
        success, message = await loop.run_in_executor(None, _do_restore)
        if success:
            return {"success": True, "message": message}
        else:
            raise HTTPException(status_code=500, detail=message)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/restore/destinations")
async def list_restore_destinations():
    """List possible restore destinations inside /data"""
    import os
    
    destinations = []
    data_path = Path("/data")
    
    if data_path.exists():
        try:
            for item in sorted(data_path.iterdir()):
                if item.is_dir() and not item.name.startswith('.'):
                    destinations.append({
                        "name": item.name,
                        "path": str(item),
                        "type": "directory"
                    })
        except Exception as e:
            print(f"Error listing destinations: {e}")
    
    return {"destinations": destinations, "data_root": "/data"}


frontend_path = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_path.exists():
    app.mount("/assets", StaticFiles(directory=frontend_path / "assets"), name="assets")
    
    @app.get("/")
    async def serve_frontend():
        return FileResponse(frontend_path / "index.html")
    
    @app.get("/{full_path:path}")
    async def serve_frontend_routes(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        # Serve the actual static file if it exists (e.g. logo.svg, favicon.ico)
        candidate = frontend_path / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        # SPA fallback to index.html for client-side routing
        return FileResponse(frontend_path / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
