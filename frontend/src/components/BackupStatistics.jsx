import React, { useEffect, useState } from 'react'
import { HardDrive, Cloud, Clock, CalendarClock, Loader2, Database, RefreshCw } from 'lucide-react'
import { getStatus, getUsageStats } from '../lib/api'
import { formatRelativeTime } from '../lib/utils'

// Human-readable byte formatter (1.23 MB / 4.5 GB / …).
const formatBytes = (n) => {
  if (n == null) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/**
 * Left sidebar that mirrors the "Backup Statistics" panel from
 * sabeechen/hassio-google-drive-backup. Aggregates info from the loaded jobs
 * (count + last/next run) and the global /api/status endpoint.
 */
const BackupStatistics = ({ jobs, remoteStatuses = {} }) => {
  const [status, setStatus] = useState(null)
  const [usage, setUsage] = useState(null)
  const [usageLoading, setUsageLoading] = useState(false)

  useEffect(() => {
    let active = true
    getStatus()
      .then(r => { if (active) setStatus(r.data) })
      .catch(() => {})
    return () => { active = false }
  }, [jobs])

  // Fetch usage once on mount + whenever the number of jobs changes (new job
  // usually means new data soon). Backend caches for 60s so this is cheap.
  const loadUsage = (refresh = false) => {
    setUsageLoading(true)
    getUsageStats(refresh)
      .then(r => setUsage(r.data))
      .catch(() => {})
      .finally(() => setUsageLoading(false))
  }
  useEffect(() => {
    loadUsage(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length])

  // Aggregate next/last run timestamps across all jobs.
  const lastRun = jobs
    .map(j => j.last_run)
    .filter(Boolean)
    .sort()
    .at(-1)

  const nextRun = jobs
    .filter(j => j.enabled && j.next_run)
    .map(j => j.next_run)
    .sort()
    .at(0)

  const runningCount = jobs.filter(j => j.status === 'running').length
  const successCount = jobs.filter(j => j.status === 'success').length
  const failedCount = jobs.filter(j => j.status === 'failed').length

  return (
    <aside className="w-full lg:w-72 lg:flex-shrink-0 space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Backup Statistics</h2>

        <div className="space-y-4 text-sm">
          {/* Local jobs summary */}
          <div className="flex items-start gap-3">
            <HardDrive className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium">
                {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} configured
              </div>
              <ul className="mt-1 space-y-0.5 text-muted-foreground text-xs list-disc list-inside">
                {runningCount > 0 && <li>{runningCount} running</li>}
                {successCount > 0 && <li>{successCount} successful</li>}
                {failedCount > 0 && <li className="text-destructive">{failedCount} failed</li>}
              </ul>
            </div>
          </div>

          {/* Connections summary: aggregated online/offline counts across all
              configured remotes. Replaces the old Google-Drive-only pill. */}
          {(() => {
            const entries = Object.values(remoteStatuses || {})
            const total = entries.length
            const online = entries.filter(e => e.state === 'ok').length
            const offline = entries.filter(e => e.state === 'fail').length
            const allOnline = total > 0 && online === total
            return (
              <div className="flex items-start gap-3">
                <Cloud className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                  allOnline ? 'text-primary' : offline > 0 ? 'text-destructive' : 'text-muted-foreground'
                }`} />
                <div>
                  <div className="font-medium">
                    {total === 0
                      ? 'No connections configured'
                      : allOnline
                        ? `${total} ${total === 1 ? 'connection' : 'connections'} online`
                        : `${online}/${total} connections online`}
                  </div>
                  {offline > 0 && (
                    <div className="text-xs text-destructive mt-0.5">
                      {offline} offline — reconnect from Settings
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Timing */}
      <div className="pt-4 border-t border-border space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span>Last Backup {formatRelativeTime(lastRun)}</span>
        </div>
        <div className="flex items-center gap-3">
          <CalendarClock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span>
            {nextRun ? `Next Backup ${formatRelativeTime(nextRun)}` : 'No backup scheduled'}
          </span>
        </div>
      </div>

      {/* Storage usage — local /backups + per-remote MirrorCloneBackups size,
          and capacity (total/free) for providers that support rclone about. */}
      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Storage
          </h3>
          <button
            onClick={() => loadUsage(true)}
            disabled={usageLoading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Refresh usage"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${usageLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {!usage ? (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {usageLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {usageLoading ? 'Calculating…' : 'No data yet'}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {/* Total combined */}
            <div>
              <div className="text-xs text-muted-foreground">Total backups</div>
              <div className="font-semibold text-base">
                {formatBytes(usage.total_backup_bytes)}
              </div>
            </div>

            {/* Local /backups */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <HardDrive className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs truncate">
                  Local <span className="text-muted-foreground">({usage.local.count} ZIP{usage.local.count !== 1 ? 's' : ''})</span>
                </span>
              </div>
              <span className="text-xs font-mono">{formatBytes(usage.local.bytes)}</span>
            </div>

            {/* Per-remote */}
            {usage.remotes.map(r => {
              const hasAbout = r.total_bytes != null
              const pct = hasAbout && r.total_bytes > 0
                ? Math.min(100, Math.round(((r.used_bytes ?? 0) / r.total_bytes) * 100))
                : null
              return (
                <div key={r.name} className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Cloud className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs truncate" title={`${r.name} (${r.type})`}>
                        {r.name}
                      </span>
                    </div>
                    <span className="text-xs font-mono">
                      {r.error ? '—' : formatBytes(r.backup_bytes)}
                    </span>
                  </div>

                  {/* Capacity bar only if rclone about is supported for this
                      backend (Drive/Dropbox/OneDrive/local etc.). S3/B2/SFTP
                      typically return nothing, so we skip the bar. */}
                  {hasAbout && (
                    <>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden ml-5">
                        <div
                          className={`h-full transition-all ${
                            pct >= 90 ? 'bg-destructive'
                            : pct >= 75 ? 'bg-amber-500'
                            : 'bg-primary'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground ml-5">
                        <span>{formatBytes(r.used_bytes)} used</span>
                        <span>{formatBytes(r.free_bytes)} free</span>
                      </div>
                    </>
                  )}

                  {r.error && (
                    <div className="text-[10px] text-destructive ml-5 truncate" title={r.error}>
                      {r.error}
                    </div>
                  )}
                </div>
              )
            })}

            {usage.remotes.length === 0 && (
              <div className="text-xs text-muted-foreground">No remotes configured</div>
            )}
          </div>
        )}
      </div>

      {/* Engine status */}
      {status && (
        <div className="pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
          {status.rclone_version && (
            <div>Rclone {status.rclone_version.split(' ')[1] || ''}</div>
          )}
          {status.running_jobs > 0 && (
            <div className="flex items-center gap-1.5 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              {status.running_jobs} active transfer{status.running_jobs > 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

export default BackupStatistics
