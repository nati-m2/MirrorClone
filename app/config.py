from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_name: str = "MirrorClone"
    app_version: str = "2.0.0"
    
    config_dir: Path = Path("/config")
    data_dir: Path = Path("/data")
    
    jobs_file: Path = config_dir / "jobs.json"
    rclone_config: Path = config_dir / "rclone.conf"

    # Google OAuth defaults. Users override these from the UI
    # (AppSettingsManager writes /config/app_settings.json).
    google_client_id: str = "202264815644.apps.googleusercontent.com"  # rclone default
    google_client_secret: str = "X4Z3ca8xfWDb1Voo-F9a7ZxJ"  # rclone default
    oauth_redirect_uri: str = ""  # Empty = auto-detect from request

    # Browsers are not meant to call this API from another origin: the UI is
    # served by this same app. Set CORS_ORIGINS to a comma-separated list only
    # if you front it with a separate web app.
    cors_origins: str = ""
    # "auto" marks the session cookie Secure when the request arrived over
    # HTTPS (directly or via X-Forwarded-Proto). "true"/"false" force it.
    cookie_secure: str = "auto"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
