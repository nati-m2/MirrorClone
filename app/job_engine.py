import subprocess
import asyncio
import shutil
import tempfile
import re
import fnmatch
import os
import stat
import zipfile
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Callable
from app.models import Job, JobStatus, JobLog
from app.config import settings
from app.encryption_keys_manager import fingerprint as key_fingerprint


class JobEngine:
    """Executes backup jobs using Rclone"""
    
    def __init__(self, on_log: Optional[Callable] = None, key_store=None):
        self.config_path = settings.rclone_config
        self.on_log = on_log
        # Resolves a job's encryption_key_id to the passphrase and to the key's
        # label. Injected so the engine never reads a secret off the job.
        self.key_store = key_store
        self.running_jobs: dict[str, subprocess.Popen] = {}
        # Facts about the most recent run of each job, picked up by the caller
        # for the run history. Transient by design.
        self.last_run_metrics: dict[str, dict] = {}

    def _resolve_password(self, job: Job) -> Optional[str]:
        """Passphrase for this job's archive, or None when it is unencrypted.

        `zip_password` is the pre-key-store field; startup migration empties
        it, and this fallback only covers a job written by an older version
        before that ran.
        """
        if job.encryption_key_id and self.key_store:
            return self.key_store.get_secret(job.encryption_key_id)
        return getattr(job, "zip_password", None)

    def _encryption_meta(self, job: Job) -> dict:
        """How this archive is protected, for the sidecar. Never the secret —
        the fingerprint is enough to tell which key an archive needs."""
        if not job.encryption_key_id or not self.key_store:
            return {"algo": "none"}

        key = self.key_store.get(job.encryption_key_id)
        if not key:
            return {"algo": "unknown", "key_id": job.encryption_key_id}

        return {
            "algo": key.algo,
            "key_id": key.id,
            "key_name": key.name,
            "fingerprint": key_fingerprint(key.secret),
        }

    @staticmethod
    def _archive_contents(zip_path: str) -> tuple[Optional[int], Optional[int]]:
        """(file count, uncompressed bytes) read back from the archive itself.

        Works for AES-256 archives too: ZIP encrypts contents, not the central
        directory, so the listing stays readable without the passphrase.
        """
        try:
            with zipfile.ZipFile(zip_path) as zf:
                entries = [i for i in zf.infolist() if not i.is_dir()]
                return len(entries), sum(i.file_size for i in entries)
        except Exception as e:
            print(f"Could not read archive contents for stats: {e}")
            return None, None

    def _write_sidecar(self, job: Job, zip_path: str) -> tuple[Optional[str], dict]:
        """Describe the archive in a small JSON file stored beside it.

        The point is that the archive explains itself: years from now, on a
        machine that never ran MirrorClone, this says where the data came
        from, what is inside, and which key opens it. It is also what lets the
        statistics be rebuilt from the destination after the local history is
        gone.
        """
        path = Path(zip_path)
        file_count, source_bytes = self._archive_contents(zip_path)

        try:
            archive_bytes = path.stat().st_size
        except OSError:
            archive_bytes = None

        meta = {
            "tool": f"MirrorClone {settings.app_version}",
            "created": datetime.now().isoformat(),
            "job_name": job.name,
            "job_id": job.id,
            "sources": [p.strip() for p in job.source_path.split(',') if p.strip()],
            "excludes": job.exclude_patterns or [],
            "archive": path.name,
            "archive_bytes": archive_bytes,
            "source_bytes": source_bytes,
            "file_count": file_count,
            "destination": job.destination,
            "encryption": self._encryption_meta(job),
            "restore": f"rclone copy <remote>:<folder>/{path.name} . && unzip {path.name}",
        }

        sidecar = path.with_suffix(path.suffix + ".meta.json")
        try:
            sidecar.write_text(json.dumps(meta, indent=2), encoding="utf-8")
            return str(sidecar), meta
        except OSError as e:
            print(f"Could not write sidecar: {e}")
            return None, meta

    @staticmethod
    def _matches_exclude(rel_posix: str, name: str, patterns: list[str]) -> bool:
        """Return True if a file/dir should be excluded based on glob patterns.

        Each pattern is matched against the basename and the relative POSIX path.
        Supports common rclone-style patterns including ``**`` wildcards.
        """
        if not patterns:
            return False
        for raw in patterns:
            pat = (raw or "").strip()
            if not pat:
                continue
            # Handle rclone-style ** patterns before falling back to fnmatch.
            if "**" in pat:
                if pat.endswith("/**"):
                    prefix = pat[:-3].strip("/")
                    if rel_posix == prefix or rel_posix.startswith(prefix + "/"):
                        return True
                    continue
                if pat.startswith("**/"):
                    suffix = pat[3:].strip("/")
                    if name == suffix or rel_posix == suffix or rel_posix.endswith("/" + suffix):
                        return True
                    continue
                if "/**/" in pat:
                    prefix, suffix = pat.split("/**/", 1)
                    prefix = prefix.strip("/")
                    suffix = suffix.strip("/")
                    if rel_posix.startswith(prefix + "/") and (
                        name == suffix or rel_posix.endswith("/" + suffix)
                    ):
                        return True
                    continue

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
        self.running_jobs[job.id] = None
        self.last_run_metrics.pop(job.id, None)

        try:
            # Handle multiple source paths (comma-separated)
            source_paths = [p.strip() for p in job.source_path.split(',') if p.strip()]

            # A job that asks for encryption but whose key was deleted must
            # fail loudly. Writing a readable archive where the user expects
            # an encrypted one is the worse outcome.
            password = self._resolve_password(job)
            if job.encryption_key_id and not password:
                msg = "Encryption key not found — refusing to write an unencrypted archive"
                self._log(job.id, "failed", msg, -1)
                return False, msg, -1

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
                        source_paths, job.name, password, job.exclude_patterns or [], job.preserve_links
                    )
                )
                if zip_path:
                    self._log(job.id, "progress", f"ZIP created: {zip_path}")

                    sidecar_path, meta = self._write_sidecar(job, zip_path)
                    self.last_run_metrics[job.id] = {
                        "archive": meta.get("archive"),
                        "archive_bytes": meta.get("archive_bytes"),
                        "source_bytes": meta.get("source_bytes"),
                        "file_count": meta.get("file_count"),
                        "key_fingerprint": meta.get("encryption", {}).get("fingerprint"),
                    }

                    # Cleanup old local ZIPs if local retention is configured
                    if job.local_retention_count > 0:
                        await self._cleanup_old_local_zips_async(job)
                    if on_progress:
                        await on_progress("uploading", "Uploading files...", 0)
                    return await self._upload_file(job, zip_path, on_progress, sidecar_path)
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
        finally:
            self.running_jobs.pop(job.id, None)
    
    def _rclone_perf_flags(self, job: Job) -> list[str]:
        """Return performance-oriented flags for rclone copy commands."""
        flags = [
            "--fast-list",
            "--transfers", "8",
            "--checkers", "16",
            "--buffer-size", "32M",
        ]
        # Larger chunks help Google Drive upload big archives.
        if job.destination.split(":", 1)[0].lower() == "gdrive":
            flags.extend(["--drive-chunk-size", "64M"])
        return flags

    async def _upload_file(self, job: Job, file_path: str, on_progress=None,
                           sidecar_path: Optional[str] = None) -> tuple[bool, str, int]:
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
            "--stats", "1s",
            "--stats-one-line",
            "-v",
        ]
        cmd.extend(self._rclone_perf_flags(job))

        self._log(job.id, "progress", f"Uploading to: {dest}")

        # Stream progress instead of buffering with capture_output (which deadlocks
        # on large --progress output).
        loop = asyncio.get_event_loop()
        result_code, result_output = await loop.run_in_executor(
            None,
            lambda: self._run_rclone_with_progress(cmd, on_progress, loop, job.id)
        )

        if result_code == 0:
            # The sidecar travels with the archive, so the destination keeps
            # explaining itself even if this server is gone. Failing to upload
            # it is logged, never fatal to the backup.
            if sidecar_path:
                side = subprocess.run(
                    ["rclone", "copy", sidecar_path, dest, "--config", str(self.config_path)],
                    capture_output=True, text=True, timeout=120,
                )
                if side.returncode != 0:
                    self._log(job.id, "progress", f"Sidecar upload failed: {side.stderr.strip()[:200]}")

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
        
        # Calculate total size without following directory symlinks to avoid loops.
        total_size = 0
        for source_path in source_paths:
            path = Path(source_path)
            if not path.exists():
                continue
            if path.is_file():
                total_size += path.stat().st_size
            else:
                for root, _dirs, files in os.walk(source_path, followlinks=False):
                    for fname in files:
                        fp = Path(root) / fname
                        if fp.is_file():
                            total_size += fp.stat().st_size
        
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
                "--stats", "1s",
                "--stats-one-line",
                "-v",
            ]
            cmd.extend(self._rclone_perf_flags(job))

            # Apply user-defined exclude patterns (rclone-native filter syntax).
            for pat in (job.exclude_patterns or []):
                pat = (pat or "").strip()
                if pat:
                    cmd.extend(["--exclude", pat])
            
            loop = asyncio.get_event_loop()
            result_code, result_output = await loop.run_in_executor(
                None,
                lambda: self._run_rclone_with_progress(cmd, on_progress, loop, job.id)
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
    
    def _run_rclone_with_progress(self, cmd, on_progress, loop, job_id: Optional[str] = None):
        """Run rclone and parse progress"""
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        if job_id is not None:
            self.running_jobs[job_id] = process

        last_percent = -1
        output_lines = []

        try:
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
        finally:
            if job_id is not None:
                self.running_jobs.pop(job_id, None)
            if process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except Exception:
                    pass
    
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
                # The sidecar describes that archive and nothing else, so it
                # goes with it. Left behind, it would pile up forever: the
                # pattern above only ever matches .zip files.
                sidecar = f.with_suffix(f.suffix + ".meta.json")
                try:
                    sidecar.unlink(missing_ok=True)
                except Exception as e:
                    print(f"Failed to delete {sidecar}: {e}")

            if deleted > 0:
                self._log(job.id, "progress", f"Deleted {deleted} old local ZIP backup(s)")
        except Exception as e:
            print(f"Local cleanup error: {e}")

    async def _cleanup_old_local_zips_async(self, job: Job):
        """Async wrapper for local ZIP cleanup"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self._cleanup_old_local_zips(job))
    
    def _create_zip_multi(
        self,
        source_paths: list[str],
        job_name: str,
        password: Optional[str] = None,
        exclude_patterns: Optional[list[str]] = None,
        preserve_links: bool = True,
    ) -> Optional[str]:
        """Create ZIP archive from multiple source paths preserving structure.

        For non-password archives the source tree is zipped directly; there is no
        intermediate copy to a temporary directory. This roughly halves disk I/O
        for large backups. Password-protected archives fall back to the legacy
        temp-copy path because 7z handles exclusions and encryption for us.
        """
        if password:
            return self._create_zip_multi_legacy(
                source_paths, job_name, password, exclude_patterns or [], preserve_links
            )

        try:
            patterns = exclude_patterns or []
            backups_dir = Path("/backups")
            backups_dir.mkdir(parents=True, exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            clean_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in job_name)
            zip_name = f"{clean_name}_{timestamp}"
            zip_path = backups_dir / f"{zip_name}.zip"

            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
                for source_path_str in source_paths:
                    source = Path(source_path_str)
                    if not source.exists():
                        continue

                    src_str = str(source)
                    if src_str.startswith('/data/'):
                        zip_base = Path('/data')
                    else:
                        zip_base = source.parent

                    # Exclusion patterns are evaluated relative to the selected
                    # source root (e.g. /data/hermes), while archive paths keep
                    # the broader /data or source.parent structure.
                    exclude_base = source if source.is_dir() else source.parent

                    def _zip_rel(entry: Path) -> str:
                        return entry.relative_to(zip_base).as_posix()

                    def _excl_rel(entry: Path) -> str:
                        return entry.relative_to(exclude_base).as_posix()

                    if source.is_dir():
                        for dirpath, dirnames, filenames in os.walk(source, followlinks=False):
                            dir_path = Path(dirpath)

                            # Prune excluded directories before descending into them.
                            keep = []
                            for d in dirnames:
                                child = dir_path / d
                                rel_posix = _excl_rel(child)
                                if not self._matches_exclude(rel_posix, d, patterns):
                                    keep.append(d)
                            dirnames[:] = keep

                            for name in filenames:
                                file_path = dir_path / name
                                rel_posix = _excl_rel(file_path)
                                if self._matches_exclude(rel_posix, name, patterns):
                                    continue

                                arc = _zip_rel(file_path)
                                if preserve_links and file_path.is_symlink():
                                    target = os.readlink(file_path)
                                    info = zipfile.ZipInfo(filename=arc)
                                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                                    info.compress_type = zipfile.ZIP_STORED
                                    zf.writestr(info, target)
                                elif file_path.is_file():
                                    zf.write(file_path, arc)
                    else:
                        rel_posix = _excl_rel(source)
                        if self._matches_exclude(rel_posix, source.name, patterns):
                            continue

                        arc = _zip_rel(source)
                        if preserve_links and source.is_symlink():
                            target = os.readlink(source)
                            info = zipfile.ZipInfo(filename=arc)
                            info.external_attr = (stat.S_IFLNK | 0o777) << 16
                            info.compress_type = zipfile.ZIP_STORED
                            zf.writestr(info, target)
                        elif source.is_file():
                            zf.write(source, arc)

            return str(zip_path)
        except Exception as e:
            print(f"Error creating ZIP: {e}")
            return None

    def _create_zip_multi_legacy(
        self,
        source_paths: list[str],
        job_name: str,
        password: str,
        patterns: list[str],
        preserve_links: bool,
    ) -> Optional[str]:
        """Legacy temp-copy ZIP creation, kept for password-protected archives."""
        try:
            backups_dir = Path("/backups")
            backups_dir.mkdir(parents=True, exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            clean_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in job_name)
            zip_name = f"{clean_name}_{timestamp}"
            zip_path = backups_dir / f"{zip_name}.zip"

            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_path = Path(tmpdir)

                for source_path_str in source_paths:
                    source = Path(source_path_str)
                    if not source.exists():
                        continue

                    if str(source).startswith('/data/'):
                        relative = source.relative_to('/data')
                        dest = tmp_path / relative
                    else:
                        dest = tmp_path / source.name

                    dest.parent.mkdir(parents=True, exist_ok=True)

                    if source.is_dir():
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

                        shutil.copytree(
                            source, dest, ignore=_ignore, symlinks=preserve_links,
                            ignore_dangling_symlinks=True
                        )
                    else:
                        if self._matches_exclude(source.name, source.name, patterns):
                            continue
                        shutil.copy2(source, dest, follow_symlinks=not preserve_links)

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
            process = self.running_jobs.pop(job_id)
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
            return True
        return False
