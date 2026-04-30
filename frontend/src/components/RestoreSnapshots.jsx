import React, { useEffect, useMemo, useState } from 'react'
import {
  FileArchive, Folder, Lock, Cloud, Server, RefreshCw, RotateCcw,
  AlertTriangle, Loader2, HardDrive, Search
} from 'lucide-react'
import Button from './ui/Button'
import { listRestoreBackups } from '../lib/api'

/**
 * Restore tab: flat grid of every available snapshot (remote + local),
 * styled like the HA Google Drive Backup add-on's card grid.
 * Each card shows:
 *   - file-archive / folder icon
 *   - job name + creation date
 *   - size, format (ZIP / Folder), encrypted lock, local/cloud badge
 *   - a "Restore" button that opens the wizard pre-populated with this snapshot.
 */

const formatSize = (sizeMb) => {
  if (sizeMb == null) return null
  if (sizeMb < 1) return `${Math.round(sizeMb * 1024)} KB`
  if (sizeMb < 1024) return `${sizeMb} MB`
  return `${(sizeMb / 1024).toFixed(2)} GB`
}

// Convert ISO-ish "YYYY-MM-DDTHH:MM:SS" to a human-readable string.
const formatTimestamp = (ts) => {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
  } catch { /* fallthrough */ }
  return ts.replace('T', ' ')
}

const SnapshotCard = ({ snap, onRestore }) => {
  const isLocal = snap.source === 'local'
  const formatLabel = snap.compressed ? 'ZIP' : 'Folder'
  const size = formatSize(snap.size_mb)

  return (
    <div className="group relative rounded-lg bg-card border border-border hover:border-primary/40 transition-colors p-4">
      <div className="flex items-start gap-3">
        {/* Left icon column */}
        <div className="flex-shrink-0 mt-0.5 h-10 w-10 rounded bg-background/60 border border-border flex items-center justify-center">
          {snap.compressed
            ? <FileArchive className="h-5 w-5 text-muted-foreground" />
            : <Folder className="h-5 w-5 text-muted-foreground" />}
        </div>

        {/* Main column */}
        <div className="flex-1 min-w-0">
          {/* Title: job name */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium truncate" title={snap.job_name}>
              {snap.job_name || 'Unknown job'}
            </h3>
            {snap.encrypted && (
              <Lock className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" title="Encrypted" />
            )}
          </div>

          {/* Creation date */}
          <div className="text-sm mt-1 text-foreground/90 font-mono">
            {snap.display || formatTimestamp(snap.timestamp)}
          </div>

          {/* Meta badges: size, format, location */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
            {/* Local / Cloud badge */}
            {isLocal ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                <Server className="h-3 w-3" /> Local
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">
                <Cloud className="h-3 w-3" /> Cloud
              </span>
            )}

            {/* Format badge */}
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded ${
              snap.compressed
                ? 'bg-blue-500/20 text-blue-300'
                : 'bg-muted text-muted-foreground'
            }`}>
              {formatLabel}
            </span>

            {/* Encrypted badge */}
            {snap.encrypted && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                <Lock className="h-3 w-3" /> Encrypted
              </span>
            )}

            {/* Size */}
            {size && (
              <span className="text-muted-foreground ml-auto">{size}</span>
            )}
          </div>

          {/* Path (small, muted) */}
          <div className="text-xs text-muted-foreground mt-2 truncate font-mono" title={snap.path}>
            {snap.path}
          </div>
        </div>
      </div>

      {/* Restore action */}
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={() => onRestore(snap)}
          className="flex items-center gap-1 h-7 px-3 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore
        </Button>
      </div>
    </div>
  )
}

const RestoreSnapshots = ({ onRestore }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | local | cloud | encrypted

  const fetchBackups = async (refresh = false) => {
    setLoading(true)
    setError('')
    try {
      const res = await listRestoreBackups(refresh)
      setGroups(res.data.jobs || [])
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBackups() }, [])

  // Flatten all snapshots across jobs, sorted by timestamp desc.
  const snapshots = useMemo(() => {
    const flat = []
    for (const grp of groups) {
      for (const s of grp.snapshots || []) {
        flat.push({ ...s, job_name: s.job_name || grp.job_name })
      }
    }
    flat.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    return flat
  }, [groups])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return snapshots.filter(s => {
      if (filter === 'local' && s.source !== 'local') return false
      if (filter === 'cloud' && s.source !== 'remote') return false
      if (filter === 'encrypted' && !s.encrypted) return false
      if (!q) return true
      return (
        (s.job_name || '').toLowerCase().includes(q) ||
        (s.folder || '').toLowerCase().includes(q) ||
        (s.display || '').toLowerCase().includes(q)
      )
    })
  }, [snapshots, query, filter])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading snapshots…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
        <p className="text-destructive mb-4">{error}</p>
        <Button onClick={() => fetchBackups(true)} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    )
  }

  if (snapshots.length === 0) {
    return (
      <div className="text-center py-16 rounded-lg border border-dashed border-border">
        <HardDrive className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No snapshots found</h3>
        <p className="text-muted-foreground">
          Run a backup job to create your first snapshot.
        </p>
      </div>
    )
  }

  // Counters for the filter chips.
  const counts = {
    all: snapshots.length,
    local: snapshots.filter(s => s.source === 'local').length,
    cloud: snapshots.filter(s => s.source === 'remote').length,
    encrypted: snapshots.filter(s => s.encrypted).length,
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: search + filters + refresh */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by job name or date…"
            className="w-full pl-8 pr-3 py-2 bg-background border border-input rounded-md text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {[
          { key: 'all', label: 'All' },
          { key: 'cloud', label: 'Cloud' },
          { key: 'local', label: 'Local' },
          { key: 'encrypted', label: 'Encrypted' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors flex items-center gap-1.5
              ${filter === f.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'}`}
          >
            {f.label}
            <span className={`text-[10px] px-1 rounded ${
              filter === f.key ? 'bg-primary-foreground/20' : 'bg-muted'
            }`}>
              {counts[f.key]}
            </span>
          </button>
        ))}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchBackups(true)}
          className="h-8 px-2 flex items-center gap-1.5"
          title="Refresh snapshots"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No snapshots match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map(snap => (
            <SnapshotCard
              key={`${snap.source}:${snap.path}`}
              snap={snap}
              onRestore={onRestore}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default RestoreSnapshots
