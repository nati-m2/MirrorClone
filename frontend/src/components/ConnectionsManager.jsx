import React, { useEffect, useState } from 'react'
import {
  Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Loader2, Link2,
  Cloud, HardDrive, Server, Database, AlertTriangle, Upload, Download,
  Bell, KeyRound,
} from 'lucide-react'
import Button from './ui/Button'
import AddConnectionDialog from './AddConnectionDialog'
import ReconnectDialog from './ReconnectDialog'
import NotificationsManager from './NotificationsManager'
import EncryptionKeysManager from './EncryptionKeysManager'
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
    <div className="flex items-start gap-3 py-3 px-2 -mx-2 rounded-md hover:bg-accent/20 transition-colors">
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5 h-9 w-9 rounded-md bg-muted/60 flex items-center justify-center">
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

// Settings navigation. A section is a destination, not a drawer: the rail
// says where you are and the panel shows one section at a time, so nothing
// has to be framed inside anything else.
const SectionLink = ({ icon: Icon, title, count, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 md:flex-none md:w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left whitespace-nowrap border-b-2 md:border-b-0 md:border-l-2 transition-colors ${
      active
        ? 'border-primary text-foreground bg-accent/40'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/20'
    }`}
  >
    {Icon && <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-primary' : ''}`} />}
    <span className="flex-1 truncate">{title}</span>
    {count != null && <span className="text-xs text-muted-foreground">{count}</span>}
  </button>
)

// The one rule the panel follows: a title, a line of orientation, and the
// action that belongs to this section — then the content, undecorated.
const SectionHeader = ({ title, description, children }) => (
  <div className="flex items-start justify-between gap-4 pb-4 border-b border-border">
    <div className="min-w-0">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5 max-w-prose">{description}</p>
    </div>
    {children}
  </div>
)

const ConnectionsManager = ({ onClose }) => {
  const [remotes, setRemotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [tests, setTests] = useState({}) // { name: { state, message } }
  const [busy, setBusy] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState(null) // remote object
  // Which section the rail is pointing at. Connections first: it is what
  // people come here for, and nothing else works without one.
  const [activeSection, setActiveSection] = useState('connections') // 'connections' | 'notifications' | 'keys'

  const runTest = async (name) => {
    setTests(prev => ({ ...prev, [name]: { state: 'testing', message: 'Testing…' } }))
    try {
      const res = await testRemote(name, { restore: true })
      const restored = res.data.jobs_restored || 0
      // When the backend auto-restored jobs.json from this remote, surface it
      // in the status pill so the user understands why jobs suddenly appeared.
      const baseMsg = res.data.message || (res.data.success ? 'Connected' : 'Failed')
      const message = restored > 0
        ? `${baseMsg} — restored ${restored} job${restored === 1 ? '' : 's'} from cloud`
        : baseMsg
      setTests(prev => ({
        ...prev,
        [name]: {
          state: res.data.success ? 'ok' : 'fail',
          message,
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
            <h1 className="text-lg font-medium">Settings</h1>
            <p className="text-xs text-muted-foreground">
              Connections, alerts and encryption keys for this instance.
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

      <div className="container mx-auto px-6 py-6 max-w-5xl flex flex-col md:flex-row gap-5 md:gap-10">
        <nav className="md:w-48 flex-shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
          <SectionLink
            icon={Cloud}
            title="Connections"
            count={remotes.length}
            active={activeSection === 'connections'}
            onClick={() => setActiveSection('connections')}
          />
          <SectionLink
            icon={Bell}
            title="Notifications"
            active={activeSection === 'notifications'}
            onClick={() => setActiveSection('notifications')}
          />
          <SectionLink
            icon={KeyRound}
            title="Encryption keys"
            active={activeSection === 'keys'}
            onClick={() => setActiveSection('keys')}
          />
        </nav>

        <div className="flex-1 min-w-0">
        {activeSection === 'connections' && (
          <div>
            <SectionHeader
              title="Connections"
              description="Cloud and storage remotes your backup jobs write to."
            >
              <Button onClick={() => setShowAdd(true)} className="gap-2 flex-shrink-0">
                <Plus className="h-4 w-4" />
                Add connection
              </Button>
            </SectionHeader>

            {loading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 py-6 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>{error}</div>
              </div>
            ) : remotes.length === 0 ? (
              <div className="py-14 text-center">
                <Cloud className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground mb-4">
                  No connections yet. Add one to start creating backup jobs.
                </p>
                <Button onClick={() => setShowAdd(true)} className="gap-2 mx-auto">
                  <Plus className="h-4 w-4" />
                  Add your first connection
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
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

            {/* Power-user controls: raw rclone.conf import/export */}
            <div className="mt-10 pt-5 border-t border-border space-y-2">
              <h3 className="text-sm font-medium">Advanced</h3>
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
              <p className="text-xs text-muted-foreground max-w-prose">
                Replace the entire config by uploading a file generated with <code className="font-mono">rclone config</code>,
                or download a backup of the current configuration.
              </p>
            </div>
          </div>
        )}

        {activeSection === 'notifications' && (
          <div>
            <SectionHeader
              title="Notifications"
              description="Where MirrorClone tells you a backup finished or failed — Telegram, Slack, email and anything else Apprise speaks."
            />
            <NotificationsManager embedded />
          </div>
        )}

        {activeSection === 'keys' && (
          <div>
            <SectionHeader
              title="Encryption keys"
              description="Passphrases for AES-256 archives. They stay on this server and never travel with a backup."
            />
            <EncryptionKeysManager embedded />
          </div>
        )}
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
