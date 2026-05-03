import React, { useEffect, useState } from 'react'
import {
  Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Loader2, Link2,
  Cloud, HardDrive, Server, Database, AlertTriangle, Upload, Download
} from 'lucide-react'
import Button from './ui/Button'
import AddConnectionDialog from './AddConnectionDialog'
import ReconnectDialog from './ReconnectDialog'
import {
  getRemotesDetailed, deleteRemote, testRemote, uploadConfig, downloadConfig
} from '../lib/api'

/**
 * Connections (rclone remotes) management screen.
 *
 * Shows every configured remote with its provider type, lets the user test
 * the connection, delete it, or add a new one (any rclone backend).
 * Also exposes upload / download of `rclone.conf` for power users.
 */

const TYPE_ICON = {
  drive: Cloud, dropbox: Cloud, onedrive: Cloud, box: Cloud, pcloud: Cloud, mega: Cloud,
  s3: Database, b2: Database, azureblob: Database, gcs: Database, swift: Database,
  sftp: Server, ftp: Server, webdav: Server, http: Server,
  local: HardDrive,
}

const ProviderIcon = ({ type, className = 'h-5 w-5' }) => {
  const Icon = TYPE_ICON[type] || Cloud
  return <Icon className={className} />
}

// Status dot + label shown inline on each card.
const StatusPill = ({ state, message }) => {
  const palette = state === 'ok' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
    : state === 'fail' ? 'text-destructive bg-destructive/10 border-destructive/40'
    : 'text-muted-foreground bg-muted border-border'
  const label = state === 'ok' ? 'Connected'
    : state === 'fail' ? 'Disconnected'
    : state === 'testing' ? 'Testing…'
    : 'Unknown'
  return (
    <span
      title={message}
      className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${palette}`}
    >
      {state === 'testing'
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <span className={`h-1.5 w-1.5 rounded-full ${
            state === 'ok' ? 'bg-emerald-400'
            : state === 'fail' ? 'bg-destructive'
            : 'bg-muted-foreground'
          }`} />}
      {label}
    </span>
  )
}

const ConnectionCard = ({ remote, onDelete, onTest, onReconnect, testStatus }) => {
  // OAuth-backed remotes (currently Google Drive) can be re-authorized in-app.
  // For other providers "Reconnect" is really a re-test; an offline S3/SFTP
  // needs its credentials fixed manually, so the button is still useful.
  const canReauth = remote.type === 'drive'
  const offline = testStatus?.state === 'fail'

  return (
    <div className="rounded-lg bg-card border border-border p-4 flex items-start gap-3">
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5 h-10 w-10 rounded bg-background/60 border border-border flex items-center justify-center">
        <ProviderIcon type={remote.type} className="h-5 w-5 text-primary" />
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium truncate">{remote.name}</h3>
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {remote.type || 'unknown'}
          </span>
          <StatusPill state={testStatus?.state || 'unknown'} message={testStatus?.message} />
        </div>

        {testStatus?.message && (
          <div className={`text-xs mt-1.5 truncate ${
            testStatus.state === 'fail' ? 'text-destructive' : 'text-muted-foreground'
          }`} title={testStatus.message}>
            {testStatus.message}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {offline && canReauth && (
          <Button
            size="sm"
            onClick={() => onReconnect(remote)}
            className="h-8 px-2 flex items-center gap-1.5 text-xs"
            title="Re-authorize this connection"
          >
            <Link2 className="h-3.5 w-3.5" />
            Reconnect
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onTest(remote.name)}
          className="h-8 px-2 flex items-center gap-1.5"
          title="Test connection"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(remote.name)}
          className="h-8 px-2 flex items-center gap-1.5 text-destructive hover:text-destructive"
          title="Delete connection"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

const ConnectionsManager = ({ onClose }) => {
  const [remotes, setRemotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [tests, setTests] = useState({}) // { name: { state, message } }
  const [busy, setBusy] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState(null) // remote object

  const runTest = async (name) => {
    setTests(prev => ({ ...prev, [name]: { state: 'testing', message: 'Testing…' } }))
    try {
      const res = await testRemote(name)
      setTests(prev => ({
        ...prev,
        [name]: {
          state: res.data.success ? 'ok' : 'fail',
          message: res.data.message || (res.data.success ? 'Connected' : 'Failed'),
        },
      }))
    } catch (e) {
      setTests(prev => ({
        ...prev,
        [name]: { state: 'fail', message: e.response?.data?.detail || e.message },
      }))
    }
  }

  const refresh = async () => {
    setLoading(true); setError('')
    try {
      const res = await getRemotesDetailed()
      const list = res.data || []
      setRemotes(list)
      // Auto-test every remote in parallel so users see status without a click.
      list.forEach(r => runTest(r.name))
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handleTest = (name) => runTest(name)

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete connection "${name}"? Jobs using it will stop working.`)) return
    setBusy(true)
    try {
      await deleteRemote(name)
      setTests(prev => { const cp = { ...prev }; delete cp[name]; return cp })
      await refresh()
    } catch (e) {
      alert(`Delete failed: ${e.response?.data?.detail || e.message}`)
    } finally {
      setBusy(false)
    }
  }

  // Power-user: upload an existing rclone.conf
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      await uploadConfig(file)
      await refresh()
    } catch (err) {
      alert(`Upload failed: ${err.response?.data?.detail || err.message}`)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  const handleDownload = async () => {
    try {
      const res = await downloadConfig()
      const blob = new Blob([res.data.config], { type: 'text/plain' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'rclone.conf'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Download failed: ${err.response?.data?.detail || err.message}`)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="px-6 py-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className="h-7 w-7 flex-shrink-0">
            <rect width="64" height="64" rx="14" fill="hsl(var(--primary))"/>
            <path d="M14 24 C14 20 18 17 22 17 L36 17 L36 13 L50 22 L36 31 L36 27 L22 27 C20 27 19 26 19 24 Z" fill="white"/>
            <path d="M50 40 C50 44 46 47 42 47 L28 47 L28 51 L14 42 L28 33 L28 37 L42 37 C44 37 45 38 45 40 Z" fill="white" opacity="0.85"/>
          </svg>
          <div>
            <h1 className="text-lg font-medium">MirrorClone</h1>
            <p className="text-xs text-muted-foreground">
              Manage cloud and storage connections used by your backup jobs.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refresh} className="h-8 px-2 gap-1.5" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </header>

      <div className="container mx-auto px-6 py-6 max-w-3xl space-y-4">
        {/* Add button row */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            {remotes.length} {remotes.length === 1 ? 'connection' : 'connections'}
          </h2>
          <Button onClick={() => setShowAdd(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Connection
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>{error}</div>
          </div>
        ) : remotes.length === 0 ? (
          <div className="text-center py-12 rounded-lg border border-dashed border-border">
            <Cloud className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">No connections yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add your first cloud or storage connection to start creating backup jobs.
            </p>
            <Button onClick={() => setShowAdd(true)} className="gap-2 mx-auto">
              <Plus className="h-4 w-4" />
              Add your first connection
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {remotes.map(r => (
              <ConnectionCard
                key={r.name}
                remote={r}
                onTest={handleTest}
                onDelete={handleDelete}
                onReconnect={setReconnectTarget}
                testStatus={tests[r.name]}
              />
            ))}
          </div>
        )}

        {/* Power-user controls */}
        <div className="pt-6 border-t border-border space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Advanced</h3>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer">
              <input type="file" accept=".conf" onChange={handleUpload} className="hidden" />
              <span className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors">
                <Upload className="h-4 w-4" />
                Upload rclone.conf
              </span>
            </label>
            <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2 h-9">
              <Download className="h-4 w-4" />
              Download rclone.conf
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Replace the entire config by uploading a file generated with <code className="font-mono">rclone config</code>,
            or download a backup of the current configuration.
          </p>
        </div>
      </div>

      {showAdd && (
        <AddConnectionDialog
          onClose={() => setShowAdd(false)}
          onCreated={() => refresh()}
        />
      )}

      {reconnectTarget && (
        <ReconnectDialog
          remoteName={reconnectTarget.name}
          remoteType={reconnectTarget.type}
          onClose={() => setReconnectTarget(null)}
          onDone={() => { setReconnectTarget(null); refresh() }}
        />
      )}
    </div>
  )
}

export default ConnectionsManager
