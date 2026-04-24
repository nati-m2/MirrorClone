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
        
    def is_configured(self) -> bool:
        """Check if rclone is configured"""
        return self.config_path.exists() and self.config_path.stat().st_size > 0
    
    def get_remotes(self) -> list[str]:
        """Get list of configured remotes"""
        if not self.is_configured():
            return []
        
        try:
            result = subprocess.run(
                ["rclone", "listremotes", "--config", str(self.config_path)],
                capture_output=True,
                text=True,
                check=True
            )
            remotes = [line.strip().rstrip(':') for line in result.stdout.strip().split('\n') if line.strip()]
            return remotes
        except subprocess.CalledProcessError:
            return []
    
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
        """Get installed rclone version"""
        try:
            result = subprocess.run(
                ["rclone", "version"],
                capture_output=True,
                text=True,
                check=True
            )
            lines = result.stdout.strip().split('\n')
            if lines:
                return lines[0]
            return None
        except Exception:
            return None
    
    def start_google_drive_auth(self, remote_name: str = "gdrive") -> Dict[str, str]:
        """Start Google Drive OAuth authentication process with loopback redirect"""
        try:
            state = secrets.token_urlsafe(32)
            self.config_dir.mkdir(parents=True, exist_ok=True)
            
            # Generate OAuth URL with loopback redirect
            # User will copy the redirect URL containing the code
            # Using rclone's built-in OAuth client ID
            auth_url = (
                "https://accounts.google.com/o/oauth2/auth?"
                "client_id=202264815644.apps.googleusercontent.com&"
                "redirect_uri=http://127.0.0.1:53682/&"
                "response_type=code&"
                "scope=https://www.googleapis.com/auth/drive&"
                f"state={state}&"
                "access_type=offline&"
                "prompt=consent"
            )
            
            # Save state
            state_data = {
                "state": state,
                "remote_name": remote_name,
                "timestamp": datetime.now().isoformat()
            }
            with self._config_lock:
                self.oauth_state_file.write_text(json.dumps(state_data))
            
            return {
                "auth_url": auth_url,
                "state": state,
                "remote_name": remote_name,
                "message": "Open the URL, authorize, then copy the full URL from the browser address bar"
            }
                
        except Exception as e:
            return {"error": f"Authorization failed: {str(e)}"}
    
    def exchange_code_for_token(self, code: str, remote_name: str = "gdrive") -> tuple[bool, str]:
        """Exchange authorization code for token (loopback flow)"""
        with self._config_lock:
            try:
                # Extract code from URL if full URL was pasted
                actual_code = code.strip()
                if "code=" in actual_code:
                    # Parse code from URL
                    from urllib.parse import urlparse, parse_qs
                    parsed = urlparse(actual_code.replace("http://127.0.0.1:53682/?" , "http://127.0.0.1:53682/?"))
                    params = parse_qs(parsed.query)
                    if "code" in params:
                        actual_code = params["code"][0]
                    else:
                        return False, "Could not find authorization code in URL"
                
                # Exchange code for token using loopback redirect URI
                token_url = "https://oauth2.googleapis.com/token"
                data = {
                    "code": actual_code,
                    "client_id": "202264815644.apps.googleusercontent.com",
                    "client_secret": "X4Z3ca8xfWDb1Voo-F9a7ZxJ",  # rclone's public secret
                    "redirect_uri": "http://127.0.0.1:53682/",
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
                
                return True, f"Remote '{remote_name}' deleted successfully"
                
            except Exception as e:
                return False, f"Failed to delete remote: {str(e)}"
