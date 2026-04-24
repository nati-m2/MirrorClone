from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_name: str = "MirrorClone"
    app_version: str = "1.0.0"
    
    config_dir: Path = Path("/config")
    data_dir: Path = Path("/data")
    
    jobs_file: Path = config_dir / "jobs.json"
    rclone_config: Path = config_dir / "rclone.conf"
    
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    
    # Google OAuth - use custom Client ID for proper redirect
    google_client_id: str = "202264815644.apps.googleusercontent.com"  # rclone default
    google_client_secret: str = "X4Z3ca8xfWDb1Voo-F9a7ZxJ"  # rclone default
    oauth_redirect_uri: str = ""  # Empty = auto-detect from request
    
    alert_emails: list[str] = []
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
