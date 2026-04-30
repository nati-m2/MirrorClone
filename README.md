# MirrorClone

Self-hosted, Dockerized backup manager with a modern web UI. Backs up any local
folder to **any storage backend that rclone supports** — Google Drive, S3,
Backblaze B2, Dropbox, OneDrive, SFTP, WebDAV, local disks, and dozens more.

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![stack](https://img.shields.io/badge/stack-FastAPI%20%2B%20React-informational)

## Highlights

- **Multiple connections, any provider.** Add as many cloud or storage
  connections as you need, each of any type. Forms are generated dynamically
  from `rclone config providers`, so every rclone backend is supported out of
  the box.
- **Quick setup for Google Drive.** Built-in OAuth flow — one click, no
  manual token editing.
- **Per-job connection.** Each backup job picks which connection to use, so
  one install can mirror different folders to different destinations.
- **Live connection health.** Each connection shows a status pill
  (`Connected` / `Disconnected`), jobs get a warning banner + one-click
  **Reconnect** when their connection is offline or missing.
- **Scheduled & on-demand runs.** Cron scheduler with presets, manual "Run
  now" button, stoppable mid-flight.
- **Browse sources & snapshots.** Tree-view file browser with multi-select
  for sources, rich restore screen listing every snapshot (local + cloud)
  with size, format, encryption, job and creation date.
- **Restore wizard.** Pick a snapshot, browse its contents (even inside
  remote encrypted ZIPs via byte-range reads — no full download), choose a
  destination, restore.
- **ZIP compression + AES-256 encryption.** Optional per-job.
- **Retention policies.** Keep the last *N* cloud snapshots and/or local
  ZIPs, the rest are pruned automatically.
- **Self-backup of config.** `rclone.conf` and `jobs.json` are pushed to
  your primary remote so a fresh container can recover itself.
- **Real-time UI.** Server-Sent Events stream progress and job updates; no
  polling spam.
- **Notifications.** Optional SMTP alerts on job failures via the built-in
  Guardian.

## Quick Start

```bash
docker compose up -d
```

Open `http://localhost:8000` and:

1. Go to **Connections** → **Add Connection**.
2. Pick a provider (Google Drive = one-click OAuth, anything else = a short
   form with host/keys/etc.).
3. Switch to **Backup** → **+** to create your first job. Choose the
   connection you just added, a source folder, a schedule, and you're done.

## Docker Compose

```yaml
services:
  mirrorclone:
    build: .
    container_name: mirrorclone
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./mirrorclone/config:/config      # rclone.conf + jobs.json
      - ./mirrorclone/backups:/backups    # local ZIPs before upload
      - /srv/appdata:/data                # source data (mount what you
                                          # want to back up)
    environment:
      - TZ=Asia/Jerusalem
      # Optional — SMTP for failure alerts
      - SMTP_HOST=${SMTP_HOST:-}
      - SMTP_PORT=${SMTP_PORT:-587}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASSWORD=${SMTP_PASSWORD:-}
      - SMTP_FROM=${SMTP_FROM:-}
      # Optional — use your own Google OAuth client for a fully automatic
      # redirect flow (otherwise the built-in rclone client ID is used and
      # the user pastes the redirect URL manually).
      # - GOOGLE_CLIENT_ID=your-client-id
      # - GOOGLE_CLIENT_SECRET=your-client-secret
```

## Volumes

| Mount | Purpose |
|-------|---------|
| `/config` | Persistent `rclone.conf`, `jobs.json` and OAuth state. |
| `/backups` | Local ZIP snapshots produced by jobs (before/after upload). |
| `/data` | Source data to back up. Mount whatever you want to protect. |

## Supported providers

Every backend `rclone` ships with, including (non-exhaustive):
Google Drive, Amazon S3 (and any S3-compatible storage like MinIO, Wasabi,
Cloudflare R2), Backblaze B2, Microsoft OneDrive, Dropbox, Box, pCloud,
Mega, Yandex Disk, Azure Blob, Google Cloud Storage, OpenStack Swift,
SFTP, FTP, WebDAV, HTTP, and local filesystem.

Provider fields in the UI are generated automatically from rclone's own
schema — if rclone supports it, MirrorClone supports it.

## Jobs

Each job has:

- **Connection** — which configured remote to use.
- **Source Path** — one or more folders under `/data`.
- **Backup Folder Name** — the subfolder created under
  `<connection>:MirrorCloneBackups/` for this job's snapshots.
- **Schedule** — cron expression (with one-click presets).
- **Compression** — toggle ZIP + optional AES-256 password.
- **Retention** — separate counts for cloud and local ZIPs.
- **Preserve metadata / permissions / symlinks** — toggles.

Snapshot folder names follow the pattern:
`<JobName>-DD.MM.YYYY-HH:MM:SS`.

## Restore

The **Restore** tab shows every snapshot found — local ZIPs in `/backups`
and cloud snapshots across all connections — as a unified grid with:

- Job it belongs to and creation date
- Local vs. Cloud badge
- Format (ZIP / plain folder) and size
- Lock icon for encrypted archives
- One-click **Restore** that opens a 4-step wizard (snapshot → file selection →
  destination → execute).

The file browser can peek **inside remote ZIPs** without downloading them by
reading only the archive's central directory via `rclone cat --offset --count`.

## Tech stack

- **Backend** — Python 3.11, FastAPI, APScheduler, rclone, 7-Zip
- **Frontend** — React, Vite, TailwindCSS, lucide-react
- **Transport** — Server-Sent Events for live updates
- **Storage glue** — `rclone config create` (any backend), per-provider OAuth
  for Google Drive

## License

MIT

