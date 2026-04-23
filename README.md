# MirrorClone

Self-hosted backup solution with Google Drive integration. Dockerized web UI for scheduling and managing rclone backups.

## Features

- **One-click Google Drive connection** - OAuth flow built-in, no manual config needed
- **Scheduled backups** - Cron-based scheduling with preset options
- **File browser** - Tree view with multi-select support
- **Retention policy** - Auto-delete old backups (keep last N)
- **Dated backups** - Each backup creates a timestamped folder (e.g., `MyBackup-23.04.2026-21:30:00`)
- **ZIP compression** - Optional compression with AES-256 password encryption
- **Real-time status** - See connection status, job progress, and backup duration
- **Non-blocking UI** - Page stays responsive during backups
- **Self-backup** - Config automatically backed up to cloud

## Quick Start

```bash
docker-compose up -d
```

Open `http://localhost:8000`, click **Connect to Google Drive**, and create your first backup job.

## Docker Compose

```yaml
services:
  mirrorclone:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./mirrorclone/config:/config
      - ./mirrorclone/backups:/backups
      - /path/to/your/data:/data:ro
    restart: unless-stopped
```

## Configuration

| Volume | Description |
|--------|-------------|
| `/config` | Stores `rclone.conf` and `jobs.json` |
| `/backups` | Local ZIP files before upload |
| `/data` | Source files to backup (read-only) |

## Job Options

| Option | Description |
|--------|-------------|
| **Backup Folder Name** | Destination folder in Google Drive (under `MirrorCloneBackups/`) |
| **Schedule** | Cron expression with preset options (daily, weekly, etc.) |
| **Keep backups** | Number of backups to retain (0 = keep all) |
| **Create ZIP** | Compress files before upload |
| **ZIP Password** | AES-256 encryption for ZIP files |

## Tech Stack

- **Backend**: Python 3.11, FastAPI, APScheduler
- **Frontend**: React, TailwindCSS, Vite
- **Engine**: Rclone, 7-Zip

## License

MIT
