import subprocess
import asyncio
import shutil
import tempfile
import re
import fnmatch
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Callable
from app.models import Job, JobStatus, JobLog
from app.config import settings


class JobEngine:
    """Executes backup jobs using Rclone"""
    
    def __init__(self, on_log: Optional[Callable] = None):
        self.config_path = settings.rclone_config
        self.on_log = on_log
        self.running_jobs: dict[str, subprocess.Popen] = {}

    @staticmethod
    def _matches_exclude(rel_posix: str, name: str, patterns: list[str]) -> bool:
        """Return True if a file/dir should be excluded based on glob patterns.

        Each pattern is matched (using fnmatch) against both the basename and
        the relative POSIX path. ``**`` is normalized to ``*`` so that simple
        rclone-style patterns like ``media/**`` or ``**/.env`` keep working.
        """
        if not patterns:
            return False
        for raw in patterns:
            pat = (raw or "").strip()
            if not pat:
                continue
            # Normalize rclone-style ** to fnmatch-compatible *
            norm = pat.replace("**", "*")
            if fnmatch.fnmatch(name, norm) or fnmatch.fnmatch(rel_posix, norm):
                return True
            # Also exclude anything inside an excluded directory
            if "/" not in norm and fnmatch.fnmatch(rel_posix.split("/", 1)[0], norm):
                return True
        return False
    
    async def execute_job(self, job: Job, on_progress=None) -> tuple[bool, str, int]:
        """Execute a backup job"""
        if job.id in self.running_jobs:
            return False, "Job is already running", -1
        
        self._log(job.id, "started", f"Starting backup: {job.name}")
        
        try:
            # Handle multiple source paths (comma-separated)
            source_paths = [p.strip() for p in job.source_path.split(',') if p.strip()]
            
            # Create ZIP if needed
            if job.compress_before_upload:
                self._log(job.id, "progress", "Creating ZIP archive...")
                if on_progress:
                    await on_progress("zipping", "Creating ZIP archive...", 0)
                # Run ZIP creation in thread pool to not block
                loop = asyncio.get_event_loop()
                zip_path = await loop.run_in_executor(
                    None,
                    lambda: self._create_zip_multi(
                        source_paths, job.name, job.zip_password, job.exclude_patterns or []
                    )
                )
                if zip_path:
                    self._log(job.id, "progress", f"ZIP created: {zip_path}")
                    # Cleanup old local ZIPs if local retention is configured
                    if job.local_retention_count > 0:
                        await self._cleanup_old_local_zips_async(job)
                    if on_progress:
                        await on_progress("uploading", "Uploading files...", 0)
                    return await self._upload_file(job, zip_path, on_progress)
                else:
                    self._log(job.id, "failed", "Failed to create ZIP archive", -1)
                    return False, "Failed to create ZIP archive", -1
            
            # No ZIP - upload each path preserving structure
            if on_progress:
                await on_progress("uploading", "Uploading files...", 0)
            return await self._upload_paths(job, source_paths, on_progress)
            
        except Exception as e:
            error_msg = f"Exception during backup: {str(e)}"
            self._log(job.id, "failed", error_msg, -1, str(e))
            return False, error_msg, -1
    
    async def _upload_file(self, job: Job, file_path: str, on_progress=None) -> tuple[bool, str, int]:
        """Upload a single file to destination with date and time in folder name.
        Streams rclone progress via _run_rclone_with_progress to avoid pipe-buffer
        deadlocks when --progress produces large volumes of output.
        """
        # Create dated folder: JobName-DD.MM.YYYY-HH:MM:SS
        date_str = datetime.now().strftime("%d.%m.%Y-%H:%M:%S")
        clean_name = "".join(c if c.isalnum() or c in '-_ ' else '_' for c in job.name)
        dated_folder = f"{clean_name}-{date_str}"
        dest = f"{job.destination.rstrip('/')}/{dated_folder}"

        cmd = [
            "rclone", "copy",
            file_path,
            dest,
            "--config", str(self.config_path),
            "--transfers", "4",
            "--checkers", "8",
            "--stats", "1s",
            "--stats-one-line",
            "-v",
        ]

        self._log(job.id, "progress", f"Uploading to: {dest}")

        # Stream progress instead of buffering with capture_output (which deadlocks
        # on large --progress output).
        loop = asyncio.get_event_loop()
        result_code, result_output = await loop.run_in_executor(
            None,
            lambda: self._run_rclone_with_progress(cmd, on_progress, loop)
        )

        if result_code == 0:
            # Cleanup old backups if retention is set
            if job.retention_count > 0:
                await self._cleanup_old_backups_async(job, clean_name)
            self._log(job.id, "success", f"Backup completed: {dest}", 0, result_output)
            return True, f"Backup completed: {dest}", 0
        else:
            self._log(job.id, "failed", f"Upload failed: {result_output}", result_code)
            return False, result_output, result_code
    
    async def _upload_paths(self, job: Job, source_paths: list[str], on_progress=None) -> tuple[bool, str, int]:
        """Upload multiple paths preserving directory structure with date and time in folder name"""
        # Create dated folder: JobName-DD.MM.YYYY-HH:MM:SS
        date_str = datetime.now().strftime("%d.%m.%Y-%H:%M:%S")
        clean_name = "".join(c if c.isalnum() or c in '-_ ' else '_' for c in job.name)
        dated_folder = f"{clean_name}-{date_str}"
        base_dest = f"{job.destination.rstrip('/')}/{dated_folder}"
        
        # Calculate total size
        total_size = 0
        for source_path in source_paths:
            path = Path(source_path)
            if path.exists():
                if path.is_file():
                    total_size += path.stat().st_size
                else:
                    for f in path.rglob('*'):
                        if f.is_file():
                            total_size += f.stat().st_size
        
        size_mb = total_size / (1024 * 1024)
        self._log(job.id, "progress", f"Uploading {len(source_paths)} item(s) ({size_mb:.1f} MB) to {base_dest}")
        
        # Create a files-from list for rclone
        files_list = []
        for source_path in source_paths:
            if source_path.startswith('/data/'):
                files_list.append(source_path[6:])  # Remove /data/ prefix
            else:
                files_list.append(source_path)
        
        # Write files list to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write('\n'.join(files_list))
            files_from_path = f.name
        
        try:
            cmd = [
                "rclone", "copy",
                "/data",
                base_dest,
                "--config", str(self.config_path),
                "--files-from", files_from_path,
                "--transfers", "4",
                "--checkers", "8",
                "--stats", "1s",
                "--stats-one-line",
                "-v",
            ]

            # Apply user-defined exclude patterns (rclone-native filter syntax).
            for pat in (job.exclude_patterns or []):
                pat = (pat or "").strip()
                if pat:
                    cmd.extend(["--exclude", pat])
            
            loop = asyncio.get_event_loop()
            result_code, result_output = await loop.run_in_executor(
                None,
                lambda: self._run_rclone_with_progress(cmd, on_progress, loop)
            )
            
        finally:
            # Clean up temp file
            Path(files_from_path).unlink(missing_ok=True)
        
        if result_code == 0:
            # Cleanup old backups if retention is set
            if job.retention_count > 0:
                await self._cleanup_old_backups_async(job, clean_name)
            self._log(job.id, "success", f"Backup completed: {base_dest}", 0)
            return True, f"Backup completed: {base_dest}", 0
        else:
            self._log(job.id, "failed", f"Upload failed: {result_output}", result_code)
            return False, result_output, result_code
    
    def _run_rclone_with_progress(self, cmd, on_progress, loop):
        """Run rclone and parse progress"""
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        
        last_percent = -1
        output_lines = []
        
        for line in process.stdout:
            output_lines.append(line)
            # Parse rclone progress: "Transferred: 1.234 MiB / 5.678 MiB, 22%"
            if '%' in line:
                try:
                    percent_match = re.search(r'(\d+)%', line)
                    if percent_match:
                        percent = int(percent_match.group(1))
                        if percent != last_percent:
                            last_percent = percent
                            if on_progress and loop:
                                asyncio.run_coroutine_threadsafe(
                                    on_progress("uploading", f"Uploading files... {percent}%", percent),
                                    loop
                                )
                except:
                    pass
        
        process.wait()
        return (process.returncode, ''.join(output_lines))
    
    def _cleanup_old_backups(self, job: Job, job_name_prefix: str):
        """Keep only the latest N backups"""
        try:
            self._log(job.id, "progress", f"Keeping only {job.retention_count} latest backup(s)...")
            
            # List all folders in destination
            result = subprocess.run(
                [
                    "rclone", "lsf",
                    job.destination.rstrip('/'),
                    "--config", str(self.config_path),
                    "--dirs-only"
                ],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode != 0:
                return
            
            folders = [f.strip().rstrip('/') for f in result.stdout.strip().split('\n') if f.strip()]
            
            # Filter folders matching this job's pattern: JobName-DD.MM.YYYY-HH:MM:SS
            job_folders = []
            for folder in folders:
                # Match pattern with time: JobName-DD.MM.YYYY-HH:MM:SS
                match = re.match(rf"^{re.escape(job_name_prefix)}-(\d{{2}})\.(\d{{2}})\.(\d{{4}})-(\d{{2}}):(\d{{2}}):(\d{{2}})$", folder)
                if match:
                    day, month, year, hour, minute, second = match.groups()
                    try:
                        folder_date = datetime(int(year), int(month), int(day), int(hour), int(minute), int(second))
                        job_folders.append((folder, folder_date))
                    except ValueError:
                        continue
                else:
                    # Also match old patterns
                    match_old = re.match(rf"^{re.escape(job_name_prefix)}-(\d{{2}})\.(\d{{2}})\.(\d{{4}})", folder)
                    if match_old:
                        day, month, year = match_old.groups()
                        try:
                            folder_date = datetime(int(year), int(month), int(day))
                            job_folders.append((folder, folder_date))
                        except ValueError:
                            continue
            
            # Sort by date (newest first)
            job_folders.sort(key=lambda x: x[1], reverse=True)
            
            # Delete folders beyond retention count
            folders_to_delete = job_folders[job.retention_count:]
            deleted_count = 0
            
            for folder, _ in folders_to_delete:
                delete_result = subprocess.run(
                    [
                        "rclone", "purge",
                        f"{job.destination.rstrip('/')}/{folder}",
                        "--config", str(self.config_path)
                    ],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                if delete_result.returncode == 0:
                    deleted_count += 1
            
            if deleted_count > 0:
                self._log(job.id, "progress", f"Deleted {deleted_count} old backup(s)")
                
        except Exception as e:
            print(f"Cleanup error: {e}")
    
    async def _cleanup_old_backups_async(self, job: Job, job_name_prefix: str):
        """Async version - Keep only the latest N backups"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self._cleanup_old_backups(job, job_name_prefix))

    def _cleanup_old_local_zips(self, job: Job):
        """Keep only the latest N local ZIP backups in /backups for this job"""
        try:
            backups_dir = Path("/backups")
            if not backups_dir.exists():
                return

            clean_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in job.name)
            # Match files: JobName_YYYYMMDD_HHMMSS.zip
            pattern = re.compile(rf"^{re.escape(clean_name)}_(\d{{8}})_(\d{{6}})\.zip$")

            matching = []
            for f in backups_dir.iterdir():
                if not f.is_file() or f.suffix != '.zip':
                    continue
                m = pattern.match(f.name)
                if m:
                    # Sort key: timestamp string (YYYYMMDDHHMMSS)
                    matching.append((f, m.group(1) + m.group(2)))

            # Sort newest first
            matching.sort(key=lambda x: x[1], reverse=True)

            # Delete files beyond retention count
            to_delete = matching[job.local_retention_count:]
            deleted = 0
            for f, _ in to_delete:
                try:
                    f.unlink()
                    deleted += 1
                except Exception as e:
                    print(f"Failed to delete {f}: {e}")

            if deleted > 0:
                self._log(job.id, "progress", f"Deleted {deleted} old local ZIP backup(s)")
        except Exception as e:
            print(f"Local cleanup error: {e}")

    async def _cleanup_old_local_zips_async(self, job: Job):
        """Async wrapper for local ZIP cleanup"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self._cleanup_old_local_zips(job))
    
    def _create_zip_multi(self, source_paths: list[str], job_name: str, password: Optional[str] = None, exclude_patterns: Optional[list[str]] = None) -> Optional[str]:
        """Create ZIP archive from multiple source paths preserving structure.

        ``exclude_patterns`` follows the same simple glob conventions as the
        rclone path: matches against the basename or the path relative to the
        copied source root (e.g. ``.env``, ``media/**``, ``*.log``).
        """
        try:
            patterns = exclude_patterns or []
            backups_dir = Path("/backups")
            backups_dir.mkdir(parents=True, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            # Clean job name for filename
            clean_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in job_name)
            zip_name = f"{clean_name}_{timestamp}"
            zip_path = backups_dir / f"{zip_name}.zip"
            
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_path = Path(tmpdir)
                
                for source_path_str in source_paths:
                    source = Path(source_path_str)
                    if not source.exists():
                        continue
                    
                    # Preserve directory structure from /data
                    if str(source).startswith('/data/'):
                        relative = source.relative_to('/data')
                        dest = tmp_path / relative
                    else:
                        dest = tmp_path / source.name
                    
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    
                    if source.is_dir():
                        # Build a copytree ignore callback that consults the
                        # user's exclude patterns. Names are matched against the
                        # basename and the path relative to the copied root.
                        src_root = source

                        def _ignore(dir_path, names, _root=src_root, _pats=patterns):
                            if not _pats:
                                return []
                            try:
                                rel_dir = Path(dir_path).resolve().relative_to(_root.resolve())
                                rel_prefix = rel_dir.as_posix()
                                if rel_prefix == ".":
                                    rel_prefix = ""
                            except Exception:
                                rel_prefix = ""
                            ignored = []
                            for n in names:
                                rel_posix = f"{rel_prefix}/{n}" if rel_prefix else n
                                if self._matches_exclude(rel_posix, n, _pats):
                                    ignored.append(n)
                            return ignored

                        shutil.copytree(source, dest, ignore=_ignore)
                    else:
                        # Single file: skip if its name matches any pattern.
                        if self._matches_exclude(source.name, source.name, patterns):
                            continue
                        shutil.copy2(source, dest)
                
                # Create ZIP with or without password
                if password:
                    # Use 7z for password-protected ZIP with AES encryption
                    cmd = [
                        "7z", "a", "-tzip", "-mx=5",
                        f"-p{password}",
                        "-mem=AES256",
                        str(zip_path),
                        "."
                    ]
                    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(tmp_path))
                    if result.returncode != 0:
                        print(f"7z error: {result.stderr}")
                        return None
                else:
                    shutil.make_archive(str(backups_dir / zip_name), 'zip', tmp_path)
            
            return str(zip_path)
        except Exception as e:
            print(f"Error creating ZIP: {e}")
            return None

    def _log(self, job_id: str, status: str, message: str, exit_code: Optional[int] = None, output: Optional[str] = None):
        """Log job event"""
        if self.on_log:
            log = JobLog(
                job_id=job_id,
                timestamp=datetime.now(),
                status=status,
                message=message,
                exit_code=exit_code,
                output=output
            )
            self.on_log(log)
    
    def is_running(self, job_id: str) -> bool:
        """Check if a job is currently running"""
        return job_id in self.running_jobs
    
    def stop_job(self, job_id: str) -> bool:
        """Stop a running job"""
        if job_id in self.running_jobs:
            process = self.running_jobs[job_id]
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
            del self.running_jobs[job_id]
            return True
        return False
