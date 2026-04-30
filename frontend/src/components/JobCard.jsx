import React from 'react'
import {
  Play, Square, Trash2, Edit, FileArchive,
  CheckCircle, XCircle, Loader
} from 'lucide-react'
import Button from './ui/Button'
import { formatRelativeTime } from '../lib/utils'
import cronstrue from 'cronstrue'

/**
 * Compact backup card styled after sabeechen/hassio-google-drive-backup:
 *  - file icon column on the left
 *  - title row
 *  - colored status line ('Backed Up' / 'Running' / 'Failed')
 *  - secondary line for schedule / type
 *  - relative timestamp at the bottom
 *  - action buttons revealed on hover
 */
const JobCard = ({ job, progress, onRun, onStop, onEdit, onDelete }) => {
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
            <h3 className="font-medium truncate" title={job.name}>
              {job.name}
              {!job.enabled && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground align-middle">
                  Disabled
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
