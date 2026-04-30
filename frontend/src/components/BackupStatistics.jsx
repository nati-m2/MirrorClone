import React, { useEffect, useState } from 'react'
import { HardDrive, Cloud, Clock, CalendarClock, Loader2 } from 'lucide-react'
import { getStatus } from '../lib/api'
import { formatRelativeTime } from '../lib/utils'

/**
 * Left sidebar that mirrors the "Backup Statistics" panel from
 * sabeechen/hassio-google-drive-backup. Aggregates info from the loaded jobs
 * (count + last/next run) and the global /api/status endpoint.
 */
const BackupStatistics = ({ jobs, remoteStatuses = {} }) => {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let active = true
    getStatus()
      .then(r => { if (active) setStatus(r.data) })
      .catch(() => {})
    return () => { active = false }
  }, [jobs])

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
