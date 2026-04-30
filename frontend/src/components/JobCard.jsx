import React from 'react'
import {
  Play, Square, Trash2, Edit, FileArchive,
  CheckCircle, XCircle, Loader, Link2, AlertTriangle, Unplug, Settings as SettingsIcon
} from 'lucide-react'
import Button from './ui/Button'
import { formatRelativeTime } from '../lib/utils'
import cronstrue from 'cronstrue'

// Extract the remote name from a destination like "gdrive:MirrorCloneBackups/foo".
const parseRemoteName = (destination) => {
  if (!destination) return ''
  const idx = destination.indexOf(':')
  return idx === -1 ? '' : destination.slice(0, idx)
}

/**
 * Compact backup card styled after sabeechen/hassio-google-drive-backup:
 *  - file icon column on the left
 *  - title row
 *  - colored status line ('Backed Up' / 'Running' / 'Failed')
 *  - secondary line for schedule / type
 *  - relative timestamp at the bottom
 *  - action buttons revealed on hover
 */
const JobCard = ({
  job, progress, connectionStatus, connectionMissing,
  onRun, onStop, onEdit, onDelete, onReconnect, onManageConnections,
}) => {
  // Flag used to show a red banner + Reconnect button on this card.
  const remoteName = parseRemoteName(job.destination)
  const connectionOffline = connectionStatus && connectionStatus.state === 'fail'
  // Resolve schedule description (cron → human-readable).
  const getCronDescription = () => {
    try {
      return cronstrue.toString(job.cron_expression)
    } catch {
      return job.cron_expression
    }
  }

  // Status line: matches HA add-on "Backed Up / Partial / Failed" tone.
  const renderStatusLine = () => {
    if (job.status === 'running') {
      return (
        <span className="inline-flex items-center gap-1.5 text-primary">
          <Loader className="h-3.5 w-3.5 animate-spin" />
          Running
        </span>
      )
    }
    if (job.status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          Failed
        </span>
      )
    }
    if (job.status === 'success') {
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-400">
          <CheckCircle className="h-3.5 w-3.5" />
          Backed Up
        </span>
      )
    }
    return <span className="text-muted-foreground">Idle</span>
  }

  // Card root: dark surface, hover ring; uses --card / --border tokens.
  return (
    <div className="group relative rounded-lg bg-card border border-border hover:border-primary/40 transition-colors p-4">
      <div className="flex items-start gap-3">
        {/* Left icon column */}
        <div className="flex-shrink-0 mt-0.5 h-10 w-10 rounded bg-background/60 border border-border flex items-center justify-center">
          <FileArchive className="h-5 w-5 text-muted-foreground" />
        </div>

        {/* Main column */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium truncate flex items-center gap-2" title={job.name}>
              <span className="truncate">{job.name}</span>
              {!job.enabled && (
                <span className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground align-middle flex-shrink-0">
                  Disabled
                </span>
              )}
              {/* Small inline badge if the underlying connection is missing
                  or offline — visible even when the card is collapsed. */}
              {connectionMissing && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/40 flex items-center gap-1 flex-shrink-0"
                  title={`Connection "${remoteName}" is not configured`}
                >
                  <Unplug className="h-3 w-3" />
                  No connection
                </span>
              )}
              {!connectionMissing && connectionOffline && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/40 flex items-center gap-1 flex-shrink-0"
                  title={connectionStatus?.message || 'Connection offline'}
                >
                  <AlertTriangle className="h-3 w-3" />
                  Offline
                </span>
              )}
            </h3>
          </div>

          {/* Status line, mimics "1.7 GB - Backed Up" */}
          <div className="text-sm mt-1 flex items-center gap-2 flex-wrap">
            {renderStatusLine()}
            <span className="text-muted-foreground text-xs truncate">
              · {getCronDescription()}
            </span>
          </div>

          {/* Source → destination, akin to the "Full backup" subtitle. */}
          <div className="text-xs text-muted-foreground mt-1 truncate" title={`${job.source_path} → ${job.destination}`}>
            {job.source_path} → {job.destination}
          </div>

          {/* Relative timestamp */}
          <div className="text-xs text-muted-foreground mt-2">
            {job.status === 'running'
              ? 'Running now'
              : job.last_run
                ? `Last run ${formatRelativeTime(job.last_run)}`
                : job.next_run
                  ? `Next run ${formatRelativeTime(job.next_run)}`
                  : 'Never run'}
          </div>

          {/* Live progress (uploading %) */}
          {progress && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-xs">
                {progress.stage === 'completed' ? (
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                ) : progress.stage === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Loader className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
                <span className="truncate">{progress.message}</span>
              </div>
              {progress.percent != null && progress.stage === 'uploading' && (
                <div className="mt-1.5 h-1.5 bg-background/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {job.last_error && (
            <div className="mt-2 text-xs text-destructive font-mono truncate" title={job.last_error}>
              {job.last_error}
            </div>
          )}

          {/* Missing-connection banner. Appears when the remote referenced
              by the job's destination is not present in rclone.conf at all
              (e.g. deleted, or the job was imported from another install).
              The only fix is to create / re-add the connection, so we send
              the user straight to the Connections page. */}
          {connectionMissing && (
            <div className="mt-2 flex items-start gap-2 p-2 rounded-md border border-destructive/40 bg-destructive/10">
              <Unplug className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-medium text-destructive">
                  Connection "{remoteName}" not configured
                </div>
                <div className="text-muted-foreground">
                  This job can't run until the connection is created or re-added.
                </div>
              </div>
              {onManageConnections && (
                <Button
                  size="sm"
                  onClick={onManageConnections}
                  className="h-7 px-2 text-xs gap-1.5 flex-shrink-0"
                >
                  <SettingsIcon className="h-3.5 w-3.5" />
                  Fix
                </Button>
              )}
            </div>
          )}

          {/* Connection-offline banner. Appears when the remote this job
              depends on fails its health check. Gives the user a one-click
              Reconnect path without hunting through the settings. */}
          {!connectionMissing && connectionOffline && (
            <div className="mt-2 flex items-start gap-2 p-2 rounded-md border border-destructive/40 bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-medium text-destructive">
                  Connection "{remoteName}" offline
                </div>
                <div className="text-muted-foreground truncate" title={connectionStatus.message}>
                  {connectionStatus.message || 'Cannot reach this remote'}
                </div>
              </div>
              {onReconnect && (
                <Button
                  size="sm"
                  onClick={() => onReconnect(remoteName)}
                  className="h-7 px-2 text-xs gap-1.5 flex-shrink-0"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Reconnect
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action bar: visible on hover (md+); always visible on small screens for touch. */}
      <div className="mt-3 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        {job.status === 'running' ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onStop(job.id)}
            className="flex items-center gap-1 h-7 px-2 text-xs"
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => onRun(job.id)}
            disabled={!job.enabled}
            className="flex items-center gap-1 h-7 px-2 text-xs"
          >
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEdit(job)}
          className="flex items-center gap-1 h-7 px-2 text-xs"
        >
          <Edit className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(job.id)}
          className="flex items-center gap-1 h-7 px-2 text-xs text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  )
}

export default JobCard
