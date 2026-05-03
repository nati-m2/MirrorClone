import subprocess
from pathlib import Path
from datetime import datetime
from app.config import settings


class SelfBackup:
    """Handles backup of configuration files to cloud"""
    
    def __init__(self, remote_name: str = "gdrive", backup_folder: str = "MirrorCloneBackups/mirrorclone-config"):
        self.remote_name = remote_name
        self.backup_folder = backup_folder
        self.config_path = settings.rclone_config
    
    async def backup_config(self) -> tuple[bool, str]:
        """Backup configuration files to cloud (overwrites existing)"""
        if not self.config_path.exists():
            return False, "Rclone config not found"
        
        files_to_backup = [
            settings.jobs_file,
            settings.rclone_config
        ]
        
        # Single destination - always overwrite
        destination = f"{self.remote_name}:{self.backup_folder}"
        
        try:
            for file_path in files_to_backup:
                if not file_path.exists():
                    continue
                
                result = subprocess.run(
                    [
                        "rclone", "copy",
                        str(file_path),
                        destination,
                        "--config", str(self.config_path)
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                
                if result.returncode != 0:
                    return False, f"Failed to backup {file_path.name}: {result.stderr}"
            
            return True, f"Configuration backed up to {destination}"
            
        except Exception as e:
            return False, f"Backup failed: {str(e)}"
    
    async def restore_config(self, backup_timestamp: str = None) -> tuple[bool, str]:
        """Restore configuration from backup"""
        source = f"{self.remote_name}:{self.backup_folder}"
        
        try:
            result = subprocess.run(
                [
                    "rclone", "copy",
                    source,
                    str(settings.config_dir),
                    "--config", str(self.config_path)
                ],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode == 0:
                return True, "Configuration restored successfully"
            else:
                return False, f"Restore failed: {result.stderr}"
                
        except Exception as e:
            return False, f"Restore failed: {str(e)}"
    
    async def restore_jobs_only(self, remote_name: str) -> tuple[bool, str]:
        """Pull ONLY jobs.json from `<remote_name>:<backup_folder>/jobs.json`.

        Used as auto-sync after a successful first-time connection test:
        we never want to overwrite the freshly added rclone.conf with an
        old one from the cloud, so we copy a single file only.

        Returns (success, message). `success=False` with a friendly message
        when there's simply no jobs.json on that remote — that's not an error.
        """
        if not self.config_path.exists():
            return False, "Rclone config not found"
        if not remote_name:
            return False, "Remote name is required"

        source = f"{remote_name}:{self.backup_folder}/jobs.json"
        try:
            # First check the file actually exists, to distinguish "no backup"
            # from "transport error".
            check = subprocess.run(
                [
                    "rclone", "lsf", source,
                    "--config", str(self.config_path),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if check.returncode != 0 or not check.stdout.strip():
                return False, "No jobs.json backup on this remote"

            # Copy the single file into /config (overwrites local jobs.json).
            result = subprocess.run(
                [
                    "rclone", "copyto",
                    source,
                    str(settings.jobs_file),
                    "--config", str(self.config_path),
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode == 0:
                return True, f"jobs.json restored from {remote_name}"
            return False, f"Restore failed: {result.stderr.strip()}"
        except subprocess.TimeoutExpired:
            return False, "Restore timed out"
        except Exception as e:
            return False, f"Restore failed: {str(e)}"

    async def list_backups(self) -> list[str]:
        """List available configuration backup files"""
        try:
            result = subprocess.run(
                [
                    "rclone", "lsf",
                    f"{self.remote_name}:{self.backup_folder}",
                    "--config", str(self.config_path)
                ],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                files = [f.strip() for f in result.stdout.strip().split('\n') if f.strip()]
                return files
            
            return []
            
        except Exception:
            return []
