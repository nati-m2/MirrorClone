import React, { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Cloud, HardDrive,
  Loader2, RefreshCw, TrendingUp,
} from 'lucide-react'
import Button from './ui/Button'
import { getStatsOverview, getStatsGrowth, getUsageStats } from '../lib/api'

// Charts are hand-drawn SVG on purpose: a charting library would be the
// heaviest dependency in the bundle for four small plots. Colours come from
// the theme through `currentColor`, so light and dark both work without us
// knowing how the CSS variables are expressed.

const formatBytes = (n) => {
  if (n == null) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

const formatDuration = (seconds) => {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

const shortDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()}.${d.getMonth() + 1}`
}

const Tile = ({ icon: Icon, label, value, hint, tone = 'default' }) => (
  <div className="rounded-lg border border-border bg-card px-4 py-3">
    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
      <Icon className={`h-3.5 w-3.5 ${tone === 'bad' ? 'text-destructive' : 'text-primary'}`} />
      {label}
    </div>
    <div className={`text-xl font-semibold ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</div>
    {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
  </div>
)

// ── Outcomes per day ────────────────────────────────────────────────────────
// One column per day, failures stacked on top of successes. Days with no runs
// stay as empty slots so the time axis is honest about gaps.
const OutcomesChart = ({ daily }) => {
  const W = 720
  const H = 150
  const pad = { top: 8, bottom: 18 }
  const max = Math.max(1, ...daily.map(d => d.success + d.failed))
  const slot = W / Math.max(daily.length, 1)
  const barW = Math.max(3, Math.min(18, slot - 3))
  const plotH = H - pad.top - pad.bottom

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Backup outcomes per day">
      <line x1="0" y1={H - pad.bottom} x2={W} y2={H - pad.bottom}
            className="text-border" stroke="currentColor" strokeWidth="1" />
      {daily.map((d, i) => {
        const total = d.success + d.failed
        const x = i * slot + (slot - barW) / 2
        const hSuccess = (d.success / max) * plotH
        const hFailed = (d.failed / max) * plotH
        const yFailed = H - pad.bottom - hFailed
        const ySuccess = yFailed - hSuccess
        return (
          <g key={d.date}>
            {total === 0 && (
              <rect x={x} y={H - pad.bottom - 2} width={barW} height="2" rx="1"
                    className="text-muted" fill="currentColor" opacity="0.6" />
            )}
            {d.success > 0 && (
              <rect x={x} y={ySuccess} width={barW} height={hSuccess} rx="2"
                    className="text-primary" fill="currentColor">
                <title>{`${d.date}: ${d.success} succeeded`}</title>
              </rect>
            )}
            {d.failed > 0 && (
              <rect x={x} y={yFailed} width={barW} height={hFailed} rx="2"
                    className="text-destructive" fill="currentColor">
                <title>{`${d.date}: ${d.failed} failed`}</title>
              </rect>
            )}
            {i % Math.ceil(daily.length / 10) === 0 && (
              <text x={x + barW / 2} y={H - 5} textAnchor="middle"
                    className="text-muted-foreground" fill="currentColor" fontSize="9">
                {shortDate(d.date)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── Archive size over time ──────────────────────────────────────────────────
// A flagged point is a run whose archive is at least 1.5× the median of the
// five before it — the shape a container dumping assets into a backed-up
// folder makes.
const GrowthChart = ({ job }) => {
  const W = 720
  const H = 120
  const pad = { top: 10, bottom: 16, left: 0, right: 0 }
  const points = job.points
  if (points.length < 2) {
    return (
      <div className="text-xs text-muted-foreground py-4">
        Not enough runs yet to plot a trend.
      </div>
    )
  }

  const max = Math.max(...points.map(p => p.archive_bytes))
  const plotH = H - pad.top - pad.bottom
  const step = W / (points.length - 1)
  const xy = points.map((p, i) => [
    i * step,
    H - pad.bottom - (p.archive_bytes / max) * plotH,
  ])
  const path = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${path} L${W},${H - pad.bottom} L0,${H - pad.bottom} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
         aria-label={`Archive size per run for ${job.job_name}`}>
      <path d={area} className="text-primary" fill="currentColor" opacity="0.12" />
      <path d={path} className="text-primary" fill="none" stroke="currentColor" strokeWidth="2" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xy[i][0]}
          cy={xy[i][1]}
          r={p.spike ? 4.5 : 2.5}
          className={p.spike ? 'text-destructive' : 'text-primary'}
          fill="currentColor"
        >
          <title>
            {`${shortDate(p.ts)} · ${formatBytes(p.archive_bytes)}`}
            {p.file_count ? ` · ${p.file_count.toLocaleString()} files` : ''}
            {p.spike ? ` · ${p.factor}× the usual` : ''}
          </title>
        </circle>
      ))}
    </svg>
  )
}

export default function StatisticsPage() {
  const [overview, setOverview] = useState(null)
  const [growth, setGrowth] = useState([])
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (refreshUsage = false) => {
    try {
      const [o, g, u] = await Promise.all([
        getStatsOverview(30),
        getStatsGrowth(90),
        getUsageStats(refreshUsage),
      ])
      setOverview(o.data)
      setGrowth(g.data.jobs || [])
      setUsage(u.data)
    } catch {
      // Endpoints are read-only; a transient failure just leaves the last view.
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load(false) }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading statistics…
      </div>
    )
  }

  const summary = overview?.summary || {}
  const spikes = growth.flatMap(j => j.spikes.map(s => ({ ...s, job_name: j.job_name })))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 5)
  const localBytes = usage?.local?.bytes
  const remotes = usage?.remotes || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Backup Statistics</h2>
          <p className="text-xs text-muted-foreground">
            Last {summary.days || 30} days. Rebuilt from the run history on this server;
            the archives at the destination remain the record of truth.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setRefreshing(true); load(true) }}
          disabled={refreshing}
          title="Recount storage"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile icon={Activity} label="Runs" value={summary.runs ?? 0} />
        <Tile
          icon={CheckCircle2}
          label="Success rate"
          value={summary.success_rate != null ? `${summary.success_rate}%` : '—'}
        />
        <Tile
          icon={AlertTriangle}
          label="Failures"
          value={summary.failed ?? 0}
          tone={summary.failed > 0 ? 'bad' : 'default'}
        />
        <Tile icon={Clock} label="Avg duration" value={formatDuration(summary.avg_duration)} />
        <Tile icon={Cloud} label="Uploaded" value={formatBytes(summary.bytes_uploaded)} />
      </div>

      {/* Outcomes */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Outcomes per day</h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-primary" /> success
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-destructive" /> failed
            </span>
          </div>
        </div>
        <OutcomesChart daily={overview?.daily || []} />
      </section>

      {/* Storage */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Storage</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <HardDrive className="h-3.5 w-3.5 text-primary" /> Local ({usage?.local?.path || '/backups'})
            </div>
            <div className="text-lg font-semibold">{formatBytes(localBytes)}</div>
            <div className="text-xs text-muted-foreground">
              {usage?.local?.count ?? 0} archives on disk
            </div>
            <div className="mt-3 space-y-1.5">
              {(overview?.jobs || []).filter(j => j.local_archives > 0).map(j => (
                <div key={j.job_id} className="text-xs">
                  <div className="flex justify-between">
                    <span className="truncate">{j.job_name}</span>
                    <span className="text-muted-foreground">{formatBytes(j.local_bytes)}</span>
                  </div>
                  <div className="h-1.5 rounded bg-muted overflow-hidden mt-0.5">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${localBytes ? Math.max(2, (j.local_bytes / localBytes) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Cloud className="h-3.5 w-3.5 text-primary" /> Remote
            </div>
            {remotes.length === 0 ? (
              <div className="text-xs text-muted-foreground">No connections configured.</div>
            ) : (
              <div className="space-y-2">
                {remotes.map(r => (
                  <div key={r.name} className="text-xs">
                    <div className="flex justify-between">
                      <span className="truncate">{r.name}</span>
                      <span className="text-muted-foreground">
                        {r.error ? 'unavailable' : formatBytes(r.backup_bytes)}
                      </span>
                    </div>
                    {r.used_bytes != null && r.total_bytes ? (
                      <>
                        <div className="h-1.5 rounded bg-muted overflow-hidden mt-0.5">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.min(100, (r.used_bytes / r.total_bytes) * 100)}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {formatBytes(r.used_bytes)} of {formatBytes(r.total_bytes)} used
                          {r.free_bytes != null && ` · ${formatBytes(r.free_bytes)} free`}
                        </div>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Growth + spikes */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Archive size per run</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          A red point is a run at least 1.5× the median of the five before it —
          usually something new writing into a backed-up folder.
        </p>

        {spikes.length > 0 && (
          <div className="mb-4 space-y-1">
            {spikes.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                <span className="font-medium">{s.job_name}</span>
                <span className="text-muted-foreground">
                  grew {s.factor}× on {shortDate(s.ts)} → {formatBytes(s.archive_bytes)}
                  {s.file_count ? ` (${s.file_count.toLocaleString()} files)` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {growth.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No completed runs recorded yet. The first backup after this update starts the history.
          </div>
        ) : (
          <div className="space-y-5">
            {growth.map(job => (
              <div key={job.job_id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium">{job.job_name}</span>
                  <span className="text-muted-foreground">
                    latest {formatBytes(job.latest_bytes)} · {job.points.length} runs
                  </span>
                </div>
                <GrowthChart job={job} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Per-job rollup */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Per job</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="py-1.5 pr-3 font-medium">Job</th>
                <th className="py-1.5 pr-3 font-medium">Runs</th>
                <th className="py-1.5 pr-3 font-medium">Failures</th>
                <th className="py-1.5 pr-3 font-medium">Last archive</th>
                <th className="py-1.5 pr-3 font-medium">Files</th>
                <th className="py-1.5 font-medium">On disk</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.jobs || []).map(j => (
                <tr key={j.job_id} className="border-t border-border">
                  <td className="py-1.5 pr-3 truncate max-w-[14rem]">{j.job_name}</td>
                  <td className="py-1.5 pr-3">{j.runs}</td>
                  <td className={`py-1.5 pr-3 ${j.failures > 0 ? 'text-destructive' : ''}`}>{j.failures}</td>
                  <td className="py-1.5 pr-3">{formatBytes(j.last_bytes)}</td>
                  <td className="py-1.5 pr-3">{j.last_file_count?.toLocaleString() ?? '—'}</td>
                  <td className="py-1.5">
                    {formatBytes(j.local_bytes)}
                    {j.local_archives > 0 && (
                      <span className="text-muted-foreground"> · {j.local_archives}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
