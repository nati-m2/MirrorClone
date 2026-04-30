import subprocess
import os
import json
import secrets
import requests
import threading
from pathlib import Path
from typing import Optional, Dict
from datetime import datetime
from app.config import settings


class AuthManager:
    """Manages Rclone authentication and configuration"""
    
    def __init__(self):
        self.config_path = settings.rclone_config
        self.config_dir = settings.config_dir
        self.oauth_state_file = self.config_dir / "oauth_state.json"
        self._config_lock = threading.Lock()
        # Cache rarely-changing values to avoid spawning rclone on every request
        self._rclone_version_cache: Optional[str] = None
        self._remotes_cache: Optional[list[str]] = None
        self._remotes_cache_time: float = 0.0
        self._remotes_cache_ttl: float = 5.0  # seconds
        
    def is_configured(self) -> bool:
        """Check if rclone is configured"""
        return self.config_path.exists() and self.config_path.stat().st_size > 0
    
    def get_remotes(self) -> list[str]:
        """Get list of configured remotes (cached for a few seconds)."""
        if not self.is_configured():
            return []

        import time
        now = time.time()
        if self._remotes_cache is not None and (now - self._remotes_cache_time) < self._remotes_cache_ttl:
            return self._remotes_cache

        try:
            result = subprocess.run(
                ["rclone", "listremotes", "--config", str(self.config_path)],
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            remotes = [line.strip().rstrip(':') for line in result.stdout.strip().split('\n') if line.strip()]
            self._remotes_cache = remotes
            self._remotes_cache_time = now
            return remotes
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return self._remotes_cache or []
    
    def save_config(self, config_content: str) -> bool:
        """Save rclone configuration from uploaded content"""
        with self._config_lock:
            try:
                self.config_dir.mkdir(parents=True, exist_ok=True)
                self.config_path.write_text(config_content)
                return True
            except Exception as e:
                print(f"Error saving config: {e}")
                return False
    
    def get_config(self) -> Optional[str]:
        """Get current rclone configuration"""
        if not self.is_configured():
            return None
        return self.config_path.read_text()
    
    def test_remote(self, remote_name: str) -> tuple[bool, str]:
        """Test if a remote is accessible"""
        try:
            result = subprocess.run(
                ["rclone", "lsd", f"{remote_name}:", "--config", str(self.config_path), "--max-depth", "1"],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode == 0:
                return True, "Remote is accessible"
            else:
                return False, result.stderr
        except subprocess.TimeoutExpired:
            return False, "Connection timeout"
        except Exception as e:
            return False, str(e)
    
    def get_rclone_version(self) -> Optional[str]:
        """Get installed rclone version (cached - rclone binary doesn't change at runtime)."""
        if self._rclone_version_cache is not None:
            return self._rclone_version_cache
        try:
            result = subprocess.run(
                ["rclone", "version"],
                capture_output=True,
                text=True,
                check=True,
                timeout=5,
            )
            lines = result.stdout.strip().split('\n')
            if lines:
                self._rclone_version_cache = lines[0]
                return self._rclone_version_cache
            return None
        except Exception:
            return None
    
    def start_google_drive_auth(self, remote_name: str = "gdrive", base_url: str = None) -> Dict[str, str]:
        """Start Google Drive OAuth authentication process"""
        try:
            state = secrets.token_urlsafe(32)
            self.config_dir.mkdir(parents=True, exist_ok=True)
            
            # Check if using custom Client ID (not rclone's default)
            rclone_default_client = "202264815644.apps.googleusercontent.com"
            using_custom_client = settings.google_client_id != rclone_default_client
            
            # Determine redirect URI
            if using_custom_client:
                # Custom Client ID - can use server's callback URL
                if settings.oauth_redirect_uri:
                    redirect_uri = settings.oauth_redirect_uri
                elif base_url:
                    redirect_uri = f"{base_url.rstrip('/')}/api/auth/google-drive/callback"
                else:
                    redirect_uri = "http://127.0.0.1:53682/"
                auto_redirect = True
            else:
                # Using rclone's Client ID - must use localhost (manual flow)
                redirect_uri = "http://127.0.0.1:53682/"
                auto_redirect = False
            
            from urllib.parse import quote
            auth_url = (
                "https://accounts.google.com/o/oauth2/auth?"
                f"client_id={settings.google_client_id}&"
                f"redirect_uri={quote(redirect_uri, safe='')}&"
                "response_type=code&"
                "scope=https://www.googleapis.com/auth/drive&"
                f"state={state}&"
                "access_type=offline&"
                "prompt=consent"
            )
            
            # Save state with redirect URI
            state_data = {
                "state": state,
                "remote_name": remote_name,
                "redirect_uri": redirect_uri,
                "timestamp": datetime.now().isoformat()
            }
            with self._config_lock:
                self.oauth_state_file.write_text(json.dumps(state_data))
            
            return {
                "auth_url": auth_url,
                "state": state,
                "remote_name": remote_name,
                "redirect_uri": redirect_uri,
                "auto_redirect": auto_redirect,
                "message": "Open the URL and authorize access" if auto_redirect else "Open the URL, authorize, then copy the redirect URL"
            }
                
        except Exception as e:
            return {"error": f"Authorization failed: {str(e)}"}
    
    def exchange_code_for_token(self, code: str, remote_name: str = "gdrive") -> tuple[bool, str]:
        """Exchange authorization code for token"""
        with self._config_lock:
            try:
                # Extract code from URL if full URL was pasted
                actual_code = code.strip()
                if "code=" in actual_code:
                    # Parse code from URL
                    from urllib.parse import urlparse, parse_qs
                    parsed = urlparse(actual_code)
                    params = parse_qs(parsed.query)
                    if "code" in params:
                        actual_code = params["code"][0]
                    else:
                        return False, "Could not find authorization code in URL"
                
                # Get redirect URI from saved state
                redirect_uri = "http://127.0.0.1:53682/"
                if self.oauth_state_file.exists():
                    try:
                        state_data = json.loads(self.oauth_state_file.read_text())
                        redirect_uri = state_data.get("redirect_uri", redirect_uri)
                    except:
                        pass
                
                # Exchange code for token
                token_url = "https://oauth2.googleapis.com/token"
                data = {
                    "code": actual_code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code"
                }
                
                response = requests.post(token_url, data=data, timeout=30)
                
                if response.status_code != 200:
                    error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
                    error_msg = error_data.get('error_description', error_data.get('error', response.text))
                    return False, f"Token exchange failed: {error_msg}"
                
                token_data = response.json()
                
                # Add expiry timestamp for rclone compatibility
                if 'expires_in' in token_data and 'expiry' not in token_data:
                    from datetime import timezone, timedelta
                    expiry = datetime.now(timezone.utc) + timedelta(seconds=token_data['expires_in'])
                    token_data['expiry'] = expiry.isoformat()
                
                # Save token to rclone config
                token_json = json.dumps(token_data)
                config_content = f"""[{remote_name}]
type = drive
scope = drive
token = {token_json}
team_drive = 
"""
                
                # Update config atomically
                self.config_dir.mkdir(parents=True, exist_ok=True)
                
                if self.config_path.exists():
                    existing = self.config_path.read_text()
                    # Remove old remote if exists
                    lines = existing.split('\n')
                    new_lines = []
                    skip = False
                    for line in lines:
                        if line.strip().startswith(f'[{remote_name}]'):
                            skip = True
                        elif line.strip().startswith('[') and skip:
                            skip = False
                        
                        if not skip:
                            new_lines.append(line)
                    
                    existing = '\n'.join(new_lines).strip()
                    final_content = existing + "\n\n" + config_content if existing else config_content
                else:
                    final_content = config_content
                
                self.config_path.write_text(final_content)
                
                # Clean up state file if exists
                if self.oauth_state_file.exists():
                    self.oauth_state_file.unlink()
                
                return True, f"Successfully connected to Google Drive as '{remote_name}'"
                
            except requests.exceptions.Timeout:
                return False, "Connection timeout while exchanging code"
            except Exception as e:
                return False, f"OAuth failed: {str(e)}"
    
    def handle_oauth_callback(self, code: str, state: str) -> tuple[bool, str]:
        """Handle OAuth callback (legacy - kept for compatibility)"""
        with self._config_lock:
            try:
                # Verify state
                if not self.oauth_state_file.exists():
                    return False, "OAuth state not found"
                
                state_data = json.loads(self.oauth_state_file.read_text())
                if state_data.get("state") != state:
                    return False, "Invalid state parameter"
                
                remote_name = state_data.get("remote_name", "gdrive")
            except Exception as e:
                return False, f"State verification failed: {str(e)}"
        
        # Use the new exchange method (it handles its own locking)
        return self.exchange_code_for_token(code, remote_name)
    
    def create_google_drive_remote(self, remote_name: str, token: str) -> tuple[bool, str]:
        """Create Google Drive remote with OAuth token"""
        with self._config_lock:
            try:
                self.config_dir.mkdir(parents=True, exist_ok=True)
                
                config_content = f"""[{remote_name}]
type = drive
scope = drive
token = {token}
team_drive = 
"""
                
                if self.config_path.exists():
                    existing = self.config_path.read_text()
                    if f"[{remote_name}]" not in existing:
                        config_content = existing + "\n" + config_content
                    else:
                        return False, f"Remote '{remote_name}' already exists"
                
                self.config_path.write_text(config_content)
                
            except Exception as e:
                return False, f"Failed to create remote: {str(e)}"
        
        # Test outside the lock
        success, message = self.test_remote(remote_name)
        if success:
            return True, f"Google Drive remote '{remote_name}' created successfully"
        else:
            return False, f"Remote created but test failed: {message}"
    
    def setup_google_drive_interactive(self, remote_name: str = "gdrive") -> tuple[bool, str]:
        """Setup Google Drive using interactive rclone config"""
        with self._config_lock:
            try:
                self.config_dir.mkdir(parents=True, exist_ok=True)
                
                process = subprocess.Popen(
                    ["rclone", "config", "create", remote_name, "drive", 
                     "--config", str(self.config_path),
                     "config_is_local=false"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
                
                stdout, stderr = process.communicate(input="\n\n\n", timeout=60)
                
                if process.returncode == 0:
                    return True, f"Google Drive remote '{remote_name}' configured successfully"
                else:
                    return False, f"Configuration failed: {stderr}"
                    
            except subprocess.TimeoutExpired:
                process.kill()
                return False, "Configuration timeout"
            except Exception as e:
                return False, f"Configuration failed: {str(e)}"
    
    # ── Generic remote management (any rclone provider) ────────────────────────
    _providers_cache: Optional[list] = None

    def get_providers(self) -> list:
        """Return all rclone providers (cached): name, description, options.

        Calls `rclone config providers --json`. The output is the canonical
        rclone schema describing every backend and every option each backend
        accepts (Required, IsPassword, Default, Examples, Hide, Advanced, ...).
        """
        if AuthManager._providers_cache is not None:
            return AuthManager._providers_cache
        try:
            result = subprocess.run(
                ["rclone", "config", "providers"],
                capture_output=True, text=True, check=True, timeout=10,
            )
            data = json.loads(result.stdout)
            # rclone returns {"providers": [...]} on newer versions, or a raw list on older.
            providers = data.get("providers", data) if isinstance(data, dict) else data
            AuthManager._providers_cache = providers
            return providers
        except Exception as e:
            print(f"Failed to read rclone providers: {e}")
            return []

    def get_remotes_detailed(self) -> list[dict]:
        """Parse rclone.conf and return [{name, type}] for every configured remote."""
        if not self.is_configured():
            return []
        result = []
        try:
            content = self.config_path.read_text()
        except Exception:
            return []

        current = None
        for raw in content.split('\n'):
            line = raw.strip()
            if not line or line.startswith('#') or line.startswith(';'):
                continue
            if line.startswith('[') and line.endswith(']'):
                if current:
                    result.append(current)
                current = {"name": line[1:-1].strip(), "type": ""}
            elif current and '=' in line:
                key, _, value = line.partition('=')
                if key.strip() == 'type':
                    current["type"] = value.strip()
        if current:
            result.append(current)
        return result

    def create_remote(self, name: str, remote_type: str, params: dict) -> tuple[bool, str]:
        """Create a generic rclone remote via `rclone config create`.

        Works for every non-OAuth backend (S3, B2, SFTP, FTP, WebDAV, Local, ...).
        For OAuth-based backends (drive, dropbox, onedrive, box) prefer the
        dedicated OAuth helpers — but this still works if the caller passes a
        prepared `token` field.
        """
        if not name or not remote_type:
            return False, "Connection name and provider type are required"
        # Validate name (rclone requires alnum + - _ + space)
        clean_name = name.strip()
        if not clean_name or any(c in clean_name for c in '[]:'):
            return False, f"Invalid connection name: '{name}'"

        with self._config_lock:
            try:
                self.config_dir.mkdir(parents=True, exist_ok=True)

                # Refuse to overwrite an existing remote silently
                if self.config_path.exists():
                    existing = self.config_path.read_text()
                    if f"[{clean_name}]" in existing:
                        return False, f"Connection '{clean_name}' already exists"

                cmd = [
                    "rclone", "config", "create", clean_name, remote_type,
                    "--config", str(self.config_path),
                    "--non-interactive",  # never prompt
                    "--obscure",          # auto-obscure password fields
                ]
                # Pass each parameter as key=value
                for k, v in (params or {}).items():
                    if v is None or v == "":
                        continue
                    cmd.append(f"{k}={v}")

                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=60,
                )
                if result.returncode != 0:
                    err = result.stderr.strip() or result.stdout.strip()
                    return False, f"rclone refused config: {err[:300]}"

                # Bust caches
                self._remotes_cache = None
                AuthManager._providers_cache = None  # safe even if unrelated
                return True, f"Connection '{clean_name}' created"
            except subprocess.TimeoutExpired:
                return False, "rclone timed out while creating the connection"
            except Exception as e:
                return False, f"Failed to create connection: {e}"

    def delete_remote(self, remote_name: str) -> tuple[bool, str]:
        """Delete a remote from config"""
        with self._config_lock:
            try:
                if not self.config_path.exists():
                    return False, "Config file not found"
                
                existing = self.config_path.read_text()
                if f"[{remote_name}]" not in existing:
                    return False, f"Remote '{remote_name}' not found"
                
                # Remove remote section
                lines = existing.split('\n')
                new_lines = []
                skip = False
                for line in lines:
                    if line.strip().startswith(f'[{remote_name}]'):
                        skip = True
                    elif line.strip().startswith('[') and skip:
                        skip = False
                    
                    if not skip:
                        new_lines.append(line)
                
                # Clean up extra newlines
                final_content = '\n'.join(new_lines).strip()
                self.config_path.write_text(final_content + '\n' if final_content else '')
                # Bust the remotes cache so the UI sees the change instantly
                self._remotes_cache = None
                return True, f"Remote '{remote_name}' deleted successfully"
                
            except Exception as e:
                return False, f"Failed to delete remote: {str(e)}"
