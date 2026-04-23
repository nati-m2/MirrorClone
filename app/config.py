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
    
    alert_emails: list[str] = []
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
