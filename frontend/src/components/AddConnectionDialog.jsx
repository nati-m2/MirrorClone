import React, { useEffect, useMemo, useState } from 'react'
import {
  X, Cloud, HardDrive, Server, Database, Loader2, Search,
  Eye, EyeOff, AlertTriangle, CheckCircle2, Chrome, ChevronRight, ChevronLeft
} from 'lucide-react'
import Button from './ui/Button'
import { getProviders, createRemote, startGoogleDriveAuth, exchangeGoogleDriveCode } from '../lib/api'

/**
 * Dialog for creating a new connection (rclone remote).
 *
 * Step 1 — pick a provider (rendered from `rclone config providers --json`).
 * Step 2 — fill a dynamic form built from the provider's option schema, OR
 *           run the dedicated Google Drive OAuth flow when the user picks
 *           "drive".
 *
 * On success, calls `onCreated(name)` so the parent can refresh its list.
 */

// Curated highlight list — these surface at the top of the picker so common
// providers are easy to find. All other rclone providers still appear below.
const FEATURED_TYPES = ['drive', 's3', 'b2', 'dropbox', 'onedrive', 'sftp', 'webdav', 'local']

const ProviderIcon = ({ type, className = 'h-5 w-5' }) => {
  // Crude type → icon mapping. rclone has dozens of providers and we don't
  // ship per-provider art, so we group them by category.
  if (type === 'local') return <HardDrive className={className} />
  if (['sftp', 'ftp', 'webdav', 'http'].includes(type)) return <Server className={className} />
  if (['drive', 'dropbox', 'onedrive', 'box', 'pcloud', 'mega', 'yandex'].includes(type)) return <Cloud className={className} />
  if (['s3', 'b2', 'azureblob', 'gcs', 'swift'].includes(type)) return <Database className={className} />
  return <Cloud className={className} />
}

// Step 1: provider picker
const ProviderPicker = ({ providers, onPick, search, setSearch }) => {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return providers
    return providers.filter(p =>
      (p.Name || '').toLowerCase().includes(q) ||
      (p.Description || '').toLowerCase().includes(q)
    )
  }, [providers, search])

  // Split into featured + the rest while preserving rclone order.
  const featured = filtered.filter(p => FEATURED_TYPES.includes(p.Name))
  const others   = filtered.filter(p => !FEATURED_TYPES.includes(p.Name))

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="h-4 w-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search providers (S3, SFTP, Drive…)"
          autoFocus
          className="w-full pl-8 pr-3 py-2 bg-background border border-input rounded-md text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Featured */}
      {featured.length > 0 && (
        <div>
          <h4 className="text-xs uppercase text-muted-foreground tracking-wider mb-2">Popular</h4>
          <div className="grid grid-cols-2 gap-2">
            {featured.map(p => (
              <ProviderTile key={p.Name} provider={p} onPick={onPick} />
            ))}
          </div>
        </div>
      )}

      {/* Others */}
      {others.length > 0 && (
        <div>
          <h4 className="text-xs uppercase text-muted-foreground tracking-wider mb-2">All providers</h4>
          <div className="grid grid-cols-2 gap-2">
            {others.map(p => (
              <ProviderTile key={p.Name} provider={p} onPick={onPick} />
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No providers match "{search}"
        </div>
      )}
    </div>
  )
}

const ProviderTile = ({ provider, onPick }) => (
  <button
    onClick={() => onPick(provider)}
    className="text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/40
      transition-colors flex items-start gap-2.5"
  >
    <ProviderIcon type={provider.Name} className="h-5 w-5 mt-0.5 text-primary flex-shrink-0" />
    <div className="min-w-0">
      <div className="font-medium text-sm truncate">{provider.Description || provider.Name}</div>
      <div className="text-xs text-muted-foreground truncate">{provider.Name}</div>
    </div>
  </button>
)

// Step 2a: Google Drive OAuth flow (special case — keep "Quick setup" UX)
const GoogleDriveStep = ({ onCreated, onCancel }) => {
  const [name, setName] = useState('gdrive')
  const [stage, setStage] = useState('idle') // idle | connecting | code | submitting | done | error
  const [authUrl, setAuthUrl] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [message, setMessage] = useState('')

  const start = async () => {
    setStage('connecting'); setMessage('')
    try {
      const res = await startGoogleDriveAuth(name)
      setAuthUrl(res.data.auth_url || '')
      window.open(res.data.auth_url, '_blank', 'width=600,height=700')
      setStage('code')
    } catch (e) {
      setStage('error')
      setMessage(e.response?.data?.detail || e.message)
    }
  }

  const submit = async () => {
    if (!authCode.trim()) return
    setStage('submitting'); setMessage('')
    try {
      await exchangeGoogleDriveCode(name, authCode.trim())
      setStage('done')
      setTimeout(() => onCreated(name), 800)
    } catch (e) {
      setStage('error')
      setMessage(e.response?.data?.detail || e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 flex items-start gap-3">
        <Chrome className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-medium">Google Drive</div>
          <div className="text-muted-foreground text-xs mt-0.5">
            Quick setup — authorize with your Google account.
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">Connection name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value.replace(/[^A-Za-z0-9_\- ]/g, ''))}
          placeholder="gdrive-personal"
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <p className="text-xs text-muted-foreground mt-1">
          A short identifier — letters, digits, dashes and spaces only.
        </p>
      </div>

      {stage === 'idle' && (
        <Button onClick={start} disabled={!name.trim()} className="w-full gap-2">
          <Chrome className="h-4 w-4" /> Connect with Google
        </Button>
      )}

      {stage === 'connecting' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Starting authorization…
        </div>
      )}

      {stage === 'code' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            After authorizing, the page will try to redirect to localhost (and may show an error).
            Copy the full URL from your browser's address bar and paste it here:
          </p>
          <input
            type="text"
            value={authCode}
            onChange={e => setAuthCode(e.target.value)}
            placeholder="http://127.0.0.1:53682/?code=…"
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm font-mono
              focus:outline-none focus:ring-2 focus:ring-primary/50"
            autoFocus
          />
          <div className="flex gap-2">
            <Button onClick={submit} disabled={!authCode.trim()} className="flex-1 gap-2">
              <CheckCircle2 className="h-4 w-4" /> Complete connection
            </Button>
            {authUrl && (
              <Button variant="outline" onClick={() => window.open(authUrl, '_blank')}>
                Re-open auth page
              </Button>
            )}
          </div>
        </div>
      )}

      {stage === 'submitting' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Exchanging code for token…
        </div>
      )}

      {stage === 'done' && (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Connected!
        </div>
      )}

      {stage === 'error' && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <div>
            <div>Connection failed</div>
            <pre className="text-xs mt-1 whitespace-pre-wrap font-mono">{message}</pre>
            <Button size="sm" variant="outline" onClick={() => { setStage('idle'); setMessage('') }} className="mt-2">
              Try again
            </Button>
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Button variant="ghost" onClick={onCancel} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Pick another provider
        </Button>
      </div>
    </div>
  )
}

// Step 2b: Generic dynamic form for non-OAuth providers
const DynamicProviderForm = ({ provider, onCreated, onCancel }) => {
  const [name, setName] = useState(provider.Name)
  const [values, setValues] = useState({})
  const [revealed, setRevealed] = useState({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // rclone's Hide is a bitmask (1=config, 2=cmdline, 4=always). Skip anything
  // marked hidden from the config UI (bit 0 set).
  const visibleOptions = (provider.Options || []).filter(o => !(o.Hide & 1))
  const basicOpts = visibleOptions.filter(o => !o.Advanced)
  const advancedOpts = visibleOptions.filter(o => o.Advanced)

  const handleChange = (key, value) => setValues(prev => ({ ...prev, [key]: value }))

  const submit = async () => {
    setSubmitting(true); setError('')
    // Drop empty values so rclone uses defaults.
    const params = {}
    for (const [k, v] of Object.entries(values)) {
      if (v !== '' && v !== null && v !== undefined) params[k] = v
    }
    try {
      await createRemote({ name: name.trim(), type: provider.Name, params })
      onCreated(name.trim())
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const renderField = (opt) => {
    const key = opt.Name
    const val = values[key] ?? ''
    const isPassword = opt.IsPassword
    const isBool = opt.Type === 'bool'
    const examples = (opt.Examples || []).filter(e => !e.Provider || e.Provider === '')

    if (isBool) {
      return (
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={val === true || val === 'true'}
            onChange={e => handleChange(key, e.target.checked)}
            className="accent-primary mt-0.5"
          />
          <div>
            <div className="text-sm font-medium">{opt.Help?.split('\n')[0] || key}</div>
            <div className="text-xs text-muted-foreground font-mono">{key}</div>
          </div>
        </label>
      )
    }

    if (examples.length > 0 && examples.length <= 12) {
      return (
        <div>
          <label className="text-sm font-medium mb-1 block">
            {opt.Help?.split('\n')[0] || key}
            {opt.Required && <span className="text-destructive ml-1">*</span>}
          </label>
          <select
            value={val}
            onChange={e => handleChange(key, e.target.value)}
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">— default —</option>
            {examples.map(ex => (
              <option key={ex.Value} value={ex.Value}>
                {ex.Value}{ex.Help ? ` — ${ex.Help.split('\n')[0]}` : ''}
              </option>
            ))}
          </select>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">{key}</div>
        </div>
      )
    }

    return (
      <div>
        <label className="text-sm font-medium mb-1 flex items-center justify-between">
          <span>
            {opt.Help?.split('\n')[0] || key}
            {opt.Required && <span className="text-destructive ml-1">*</span>}
          </span>
          {isPassword && (
            <button
              type="button"
              onClick={() => setRevealed(p => ({ ...p, [key]: !p[key] }))}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {revealed[key] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {revealed[key] ? 'Hide' : 'Show'}
            </button>
          )}
        </label>
        <input
          type={isPassword && !revealed[key] ? 'password' : 'text'}
          value={val}
          onChange={e => handleChange(key, e.target.value)}
          placeholder={opt.Default ? `default: ${opt.Default}` : ''}
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm font-mono
            focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">{key}</div>
      </div>
    )
  }

  // Collect required fields and disable submit until all are filled.
  const missingRequired = basicOpts.some(o => o.Required && !values[o.Name])
  const canSubmit = name.trim().length > 0 && !missingRequired && !submitting

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg border border-border bg-muted/30 flex items-start gap-3">
        <ProviderIcon type={provider.Name} className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-sm min-w-0">
          <div className="font-medium">{provider.Description || provider.Name}</div>
          <div className="text-xs text-muted-foreground">type: {provider.Name}</div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">Connection name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value.replace(/[^A-Za-z0-9_\- ]/g, ''))}
          placeholder={provider.Name}
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {basicOpts.map(opt => (
        <div key={opt.Name}>{renderField(opt)}</div>
      ))}

      {advancedOpts.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(s => !s)}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            {showAdvanced ? '▾' : '▸'} Advanced options ({advancedOpts.length})
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-4 pl-2 border-l-2 border-border">
              {advancedOpts.map(opt => (
                <div key={opt.Name}>{renderField(opt)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive p-2 rounded bg-destructive/10">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <pre className="text-xs whitespace-pre-wrap font-mono">{error}</pre>
        </div>
      )}

      <div className="flex justify-between pt-2 border-t border-border">
        <Button variant="ghost" onClick={onCancel} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={submit} disabled={!canSubmit} className="gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Create connection
        </Button>
      </div>
    </div>
  )
}

const AddConnectionDialog = ({ onClose, onCreated }) => {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true
    getProviders()
      .then(res => { if (active) setProviders(res.data.providers || []) })
      .catch(e => { if (active) setError(e.response?.data?.detail || e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const handleCreated = (name) => {
    onCreated?.(name)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-border rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-semibold">
            {!picked ? 'Add Connection' : `Configure ${picked.Description || picked.Name}`}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading providers…
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive text-sm">{error}</div>
          ) : !picked ? (
            <ProviderPicker providers={providers} onPick={setPicked} search={search} setSearch={setSearch} />
          ) : picked.Name === 'drive' ? (
            <GoogleDriveStep onCreated={handleCreated} onCancel={() => setPicked(null)} />
          ) : (
            <DynamicProviderForm
              provider={picked}
              onCreated={handleCreated}
              onCancel={() => setPicked(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default AddConnectionDialog
