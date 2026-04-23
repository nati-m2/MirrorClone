from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from contextlib import asynccontextmanager
from pathlib import Path
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


@app.get("/api/gdrive/status")
async def get_gdrive_status():
    """Check Google Drive connection status"""
    import subprocess
    
    if not auth_manager.config_path.exists():
        return {"connected": False, "error": "No config file"}
    
    try:
        result = subprocess.run(
            ["rclone", "about", "gdrive:", "--config", str(auth_manager.config_path)],
            capture_output=True,
            text=True,
            timeout=15
        )
        
        if result.returncode == 0:
            # Parse storage info
            lines = result.stdout.strip().split('\n')
            info = {}
            for line in lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    info[key.strip().lower().replace(' ', '_')] = value.strip()
            return {"connected": True, "info": info}
        else:
            return {"connected": False, "error": "Authentication expired"}
    except subprocess.TimeoutExpired:
        return {"connected": False, "error": "Connection timeout"}
    except Exception as e:
        return {"connected": False, "error": str(e)}


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
    """Get configured rclone remotes"""
    return auth_manager.get_remotes()


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
async def start_google_drive_auth(remote_name: str = "gdrive"):
    """Start Google Drive OAuth flow"""
    result = auth_manager.start_google_drive_auth(remote_name)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@app.get("/api/auth/google-drive/callback")
async def google_drive_oauth_callback(code: str, state: str):
    """Handle OAuth callback from Google"""
    success, message = auth_manager.handle_oauth_callback(code, state)
    
    if success:
        # Return HTML that closes the window and notifies parent
        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Authorization Successful</title>
            <style>
                body {{
                    font-family: system-ui, -apple-system, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }}
                .container {{
                    text-align: center;
                    background: rgba(255, 255, 255, 0.1);
                    padding: 3rem;
                    border-radius: 1rem;
                    backdrop-filter: blur(10px);
                }}
                .success-icon {{
                    font-size: 4rem;
                    margin-bottom: 1rem;
                }}
                h1 {{ margin: 0 0 1rem 0; }}
                p {{ opacity: 0.9; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="success-icon">✓</div>
                <h1>Authorization Successful!</h1>
                <p>{message}</p>
                <p style="margin-top: 2rem; font-size: 0.9rem;">You can close this window now.</p>
            </div>
            <script>
                // Notify parent window and close
                if (window.opener) {{
                    window.opener.postMessage({{type: 'oauth-success'}}, '*');
                }}
                setTimeout(() => window.close(), 2000);
            </script>
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
                    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                    color: white;
                }}
                .container {{
                    text-align: center;
                    background: rgba(255, 255, 255, 0.1);
                    padding: 3rem;
                    border-radius: 1rem;
                    backdrop-filter: blur(10px);
                }}
                .error-icon {{
                    font-size: 4rem;
                    margin-bottom: 1rem;
                }}
                h1 {{ margin: 0 0 1rem 0; }}
                p {{ opacity: 0.9; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="error-icon">✗</div>
                <h1>Authorization Failed</h1>
                <p>{message}</p>
                <p style="margin-top: 2rem; font-size: 0.9rem;">Please try again.</p>
            </div>
            <script>
                setTimeout(() => window.close(), 3000);
            </script>
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


frontend_path = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_path.exists():
    app.mount("/assets", StaticFiles(directory=frontend_path / "assets"), name="assets")
    
    @app.get("/")
    async def serve_frontend():
        return FileResponse(frontend_path / "index.html")
    
    @app.get("/{full_path:path}")
    async def serve_frontend_routes(full_path: str):
        if not full_path.startswith("api/"):
            return FileResponse(frontend_path / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
