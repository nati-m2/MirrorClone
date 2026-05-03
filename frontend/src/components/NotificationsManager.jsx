import React, { useEffect, useMemo, useState } from 'react'
import {
  Bell, Plus, Trash2, RefreshCw, Loader2, AlertTriangle, Send, Pencil, X,
  MessageCircle, Mail, Webhook, Smartphone, Globe, Eye, EyeOff, Code2, Home,
} from 'lucide-react'
import Button from './ui/Button'
import Input from './ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import {
  listNotificationProviders,
  createNotificationProvider,
  updateNotificationProvider,
  deleteNotificationProvider,
  testNotificationProvider,
} from '../lib/api'

// ── Provider schemas ────────────────────────────────────────────────────────
// Each schema describes an Apprise-compatible notification endpoint with
// user-friendly fields. `build` constructs the Apprise URL from the fields
// and `parse` tries to recover fields from an existing URL (best-effort).
// URI components are encoded so tokens containing :/@? still produce valid URLs.
const enc = (s) => encodeURIComponent(String(s ?? '').trim())
const trim = (s) => String(s ?? '').trim()

const PROVIDER_SCHEMAS = [
  {
    id: 'telegram',
    label: 'Telegram',
    icon: Send,
    description: 'Telegram bot messages',
    fields: [
      { key: 'bot_token', label: 'Bot Token', required: true, secret: true, placeholder: '123456789:ABC-DEF...' },
      { key: 'chat_id', label: 'Chat ID', required: true, placeholder: '-100123456789 or 123456789' },
    ],
    build: ({ bot_token, chat_id }) => `tgram://${trim(bot_token)}/${enc(chat_id)}`,
    parse: (url) => {
      const m = url.match(/^tgrams?:\/\/([^/]+)\/(.+?)(?:\/)?$/i)
      if (!m) return null
      try { return { bot_token: m[1], chat_id: decodeURIComponent(m[2].split('/')[0]) } } catch { return null }
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_telegram',
  },
  {
    id: 'discord',
    label: 'Discord',
    icon: MessageCircle,
    description: 'Discord webhook',
    fields: [
      { key: 'webhook_id', label: 'Webhook ID', required: true, placeholder: '1234567890' },
      { key: 'webhook_token', label: 'Webhook Token', required: true, secret: true, placeholder: 'abc...' },
    ],
    build: ({ webhook_id, webhook_token }) => `discord://${trim(webhook_id)}/${trim(webhook_token)}`,
    parse: (url) => {
      const m = url.match(/^discord:\/\/([^/]+)\/([^/?]+)/i)
      return m ? { webhook_id: m[1], webhook_token: m[2] } : null
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_discord',
  },
  {
    id: 'slack',
    label: 'Slack',
    icon: MessageCircle,
    description: 'Slack incoming webhook',
    fields: [
      { key: 'token_a', label: 'Token A', required: true, placeholder: 'Txxxxxxxx' },
      { key: 'token_b', label: 'Token B', required: true, placeholder: 'Bxxxxxxxx' },
      { key: 'token_c', label: 'Token C', required: true, secret: true, placeholder: 'xxxxxxxxxxxxxxxxx' },
      { key: 'channel', label: 'Channel (optional)', required: false, placeholder: '#general' },
    ],
    build: ({ token_a, token_b, token_c, channel }) => {
      const base = `slack://${trim(token_a)}/${trim(token_b)}/${trim(token_c)}`
      return channel ? `${base}/${enc(channel)}` : base
    },
    parse: (url) => {
      const m = url.match(/^slack:\/\/([^/]+)\/([^/]+)\/([^/?]+)(?:\/([^?]+))?/i)
      if (!m) return null
      return { token_a: m[1], token_b: m[2], token_c: m[3], channel: m[4] ? decodeURIComponent(m[4]) : '' }
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_slack',
  },
  {
    id: 'pushover',
    label: 'Pushover',
    icon: Smartphone,
    description: 'Pushover push notifications',
    fields: [
      { key: 'user_key', label: 'User Key', required: true, placeholder: 'uXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' },
      { key: 'app_token', label: 'App Token', required: true, secret: true, placeholder: 'aXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' },
    ],
    build: ({ user_key, app_token }) => `pover://${trim(user_key)}@${trim(app_token)}`,
    parse: (url) => {
      const m = url.match(/^pover:\/\/([^@]+)@([^/?]+)/i)
      return m ? { user_key: m[1], app_token: m[2] } : null
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_pushover',
  },
  {
    id: 'pushbullet',
    label: 'Pushbullet',
    icon: Smartphone,
    description: 'Pushbullet push notifications',
    fields: [
      { key: 'access_token', label: 'Access Token', required: true, secret: true, placeholder: 'o.XXXXXXXXXXXXXXX' },
    ],
    build: ({ access_token }) => `pbul://${trim(access_token)}`,
    parse: (url) => {
      const m = url.match(/^pbul:\/\/([^/?]+)/i)
      return m ? { access_token: m[1] } : null
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_pushbullet',
  },
  {
    id: 'gotify',
    label: 'Gotify',
    icon: Bell,
    description: 'Self-hosted Gotify server',
    fields: [
      { key: 'host', label: 'Host', required: true, placeholder: 'gotify.example.com' },
      { key: 'token', label: 'App Token', required: true, secret: true, placeholder: 'Axxxxxxxxxxxxxx' },
      { key: 'secure', label: 'HTTPS', type: 'bool', default: true },
    ],
    build: ({ host, token, secure }) => `${secure ? 'gotifys' : 'gotify'}://${trim(host)}/${trim(token)}`,
    parse: (url) => {
      const m = url.match(/^(gotifys?):\/\/([^/]+)\/([^/?]+)/i)
      return m ? { host: m[2], token: m[3], secure: m[1].toLowerCase() === 'gotifys' } : null
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_gotify',
  },
  {
    id: 'ntfy',
    label: 'Ntfy',
    icon: Bell,
    description: 'ntfy.sh or self-hosted',
    fields: [
      { key: 'host', label: 'Host (empty = ntfy.sh)', required: false, placeholder: 'ntfy.example.com' },
      { key: 'topic', label: 'Topic', required: true, placeholder: 'my-topic' },
      { key: 'username', label: 'Username (optional)', required: false },
      { key: 'password', label: 'Password (optional)', required: false, secret: true },
    ],
    build: ({ host, topic, username, password }) => {
      const auth = username && password ? `${enc(username)}:${enc(password)}@` : ''
      const h = trim(host) ? `${trim(host)}/` : ''
      return `ntfy://${auth}${h}${enc(topic)}`
    },
    parse: (url) => {
      const m = url.match(/^ntfy:\/\/(?:([^:@/]+):([^@]+)@)?([^/?]*)(?:\/([^?]+))?/i)
      if (!m) return null
      // When no host, rclone stores topic as the "host" component
      const hasHost = !!m[4]
      return {
        username: m[1] ? decodeURIComponent(m[1]) : '',
        password: m[2] ? decodeURIComponent(m[2]) : '',
        host: hasHost ? m[3] : '',
        topic: hasHost ? decodeURIComponent(m[4]) : (m[3] || ''),
      }
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_ntfy',
  },
  {
    id: 'homeassistant',
    label: 'Home Assistant',
    icon: Home,
    description: 'Home Assistant persistent_notification',
    // Apprise Home Assistant URL format:
    //   hassio://{host}[:{port}]/{accesstoken}[/{nid}]
    //   hassios://... for HTTPS
    // See: https://github.com/caronc/apprise/wiki/Notify_homeassistant
    fields: [
      { key: 'host', label: 'Host', required: true, placeholder: 'homeassistant.local' },
      { key: 'port', label: 'Port (optional)', required: false, placeholder: '8123' },
      { key: 'access_token', label: 'Long-Lived Access Token', required: true, secret: true,
        placeholder: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9…' },
      { key: 'nid', label: 'Notification ID (optional)', required: false,
        placeholder: 'mirrorclone' },
      { key: 'secure', label: 'HTTPS', type: 'bool', default: false },
    ],
    build: ({ host, port, access_token, nid, secure }) => {
      const scheme = secure ? 'hassios' : 'hassio'
      const hostPort = trim(port) ? `${trim(host)}:${trim(port)}` : trim(host)
      const tail = trim(nid) ? `${trim(access_token)}/${enc(nid)}` : trim(access_token)
      return `${scheme}://${hostPort}/${tail}`
    },
    parse: (url) => {
      const m = url.match(/^(hassios?):\/\/([^/?]+)\/([^/?]+)(?:\/([^?]+))?/i)
      if (!m) return null
      const [host, portStr] = m[2].split(':')
      return {
        host,
        port: portStr || '',
        access_token: m[3],
        nid: m[4] ? decodeURIComponent(m[4]) : '',
        secure: m[1].toLowerCase() === 'hassios',
      }
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_homeassistant',
  },
  {
    id: 'email',
    label: 'Email (SMTP)',
    icon: Mail,
    description: 'Send via any SMTP server',
    fields: [
      { key: 'username', label: 'Username', required: true, placeholder: 'alerts@example.com' },
      { key: 'password', label: 'Password', required: true, secret: true },
      { key: 'host', label: 'SMTP Host', required: true, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', required: false, placeholder: '587' },
      { key: 'to', label: 'Recipients (comma-separated)', required: false, placeholder: 'someone@example.com' },
      { key: 'from', label: 'From address (optional)', required: false },
    ],
    build: ({ username, password, host, port, to, from }) => {
      const auth = `${enc(username)}:${enc(password)}`
      const hostPort = trim(port) ? `${trim(host)}:${trim(port)}` : trim(host)
      const params = []
      if (trim(to)) params.push(`to=${enc(to)}`)
      if (trim(from)) params.push(`from=${enc(from)}`)
      const q = params.length ? `?${params.join('&')}` : ''
      return `mailto://${auth}@${hostPort}${q}`
    },
    parse: (url) => {
      const m = url.match(/^mailtos?:\/\/([^:]+):([^@]+)@([^/?]+)(?:\?(.*))?$/i)
      if (!m) return null
      const [host, portStr] = m[3].split(':')
      const query = Object.fromEntries(new URLSearchParams(m[4] || ''))
      return {
        username: decodeURIComponent(m[1]),
        password: decodeURIComponent(m[2]),
        host,
        port: portStr || '',
        to: query.to || '',
        from: query.from || '',
      }
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_email',
  },
  {
    id: 'webhook',
    label: 'Generic Webhook',
    icon: Webhook,
    description: 'POST a JSON payload to any URL',
    fields: [
      { key: 'url', label: 'Webhook URL (without scheme)', required: true, placeholder: 'example.com/hook' },
      { key: 'secure', label: 'HTTPS', type: 'bool', default: true },
    ],
    build: ({ url, secure }) => `${secure ? 'jsons' : 'json'}://${trim(url).replace(/^https?:\/\//i, '')}`,
    parse: (url) => {
      const m = url.match(/^(jsons?|forms?|xmls?):\/\/(.+)$/i)
      return m ? { url: m[2], secure: m[1].toLowerCase().endsWith('s') } : null
    },
    helpUrl: 'https://github.com/caronc/apprise/wiki/Notify_Custom_JSON',
  },
  {
    id: 'custom',
    label: 'Custom / Raw URL',
    icon: Code2,
    description: 'Paste any Apprise URL directly',
    fields: [
      { key: 'url', label: 'Apprise URL', required: true, placeholder: 'scheme://params...', mono: true },
    ],
    build: ({ url }) => trim(url),
    parse: (url) => ({ url }), // matches anything
    helpUrl: 'https://github.com/caronc/apprise/wiki',
  },
]

// Find the best schema for an existing URL: first non-custom schema whose
// parse() succeeds, else Custom.
const detectSchema = (url) => {
  if (!url) return PROVIDER_SCHEMAS[0]
  for (const schema of PROVIDER_SCHEMAS) {
    if (schema.id === 'custom') continue
    const parsed = schema.parse(url)
    if (parsed) return schema
  }
  return PROVIDER_SCHEMAS.find(s => s.id === 'custom')
}

// ── Dialog ──────────────────────────────────────────────────────────────────
const ProviderDialog = ({ provider, onSave, onClose }) => {
  // Pick initial schema by inspecting the existing URL (if editing).
  const initialSchema = useMemo(
    () => provider?.url ? detectSchema(provider.url) : PROVIDER_SCHEMAS[0],
    [] // intentionally only on mount
  )
  const initialFields = useMemo(() => {
    if (provider?.url) {
      const parsed = initialSchema.parse(provider.url)
      if (parsed) return parsed
    }
    // Seed defaults from schema.
    const out = {}
    for (const f of initialSchema.fields) {
      if (f.default !== undefined) out[f.key] = f.default
    }
    return out
  }, [initialSchema, provider])

  const [schemaId, setSchemaId] = useState(initialSchema.id)
  const [name, setName] = useState(provider?.name || `My ${initialSchema.label}`)
  // Track whether the user typed a custom name. While false, we keep the
  // name in sync with the selected provider so switching Telegram → Slack
  // rewrites "My Telegram" to "My Slack" automatically.
  const [nameTouched, setNameTouched] = useState(!!provider?.name)
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [fields, setFields] = useState(initialFields)
  const [revealed, setRevealed] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const schema = PROVIDER_SCHEMAS.find(s => s.id === schemaId) || PROVIDER_SCHEMAS[0]

  // When switching provider type, reset fields to that schema's defaults
  // and refresh the suggested name if the user hasn't customised it yet.
  const handleSchemaChange = (id) => {
    const next = PROVIDER_SCHEMAS.find(s => s.id === id)
    setSchemaId(id)
    const seed = {}
    for (const f of next.fields) {
      if (f.default !== undefined) seed[f.key] = f.default
    }
    setFields(seed)
    if (!nameTouched) setName(`My ${next.label}`)
    setError('')
  }

  const handleNameChange = (value) => {
    setName(value)
    // Empty input returns control to the auto-suggest logic.
    setNameTouched(value.trim().length > 0)
  }

  // Build preview URL. Guard against empty required fields so the preview
  // doesn't show nonsense like "tgram:///".
  const previewUrl = useMemo(() => {
    try {
      return schema.build(fields) || ''
    } catch {
      return ''
    }
  }, [schema, fields])

  const missingRequired = schema.fields.some(f => f.required && !trim(fields[f.key]))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (missingRequired) {
      setError('Please fill all required fields')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave({ name: trim(name), url: previewUrl, enabled })
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{provider ? 'Edit Notification' : 'Add Notification'}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Provider type picker — tile grid makes the options obvious */}
            <div>
              <label className="text-sm font-medium mb-2 block">Provider</label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {PROVIDER_SCHEMAS.map(s => {
                  const Icon = s.icon
                  const active = s.id === schemaId
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSchemaChange(s.id)}
                      title={s.description}
                      className={`flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-card hover:bg-accent/40 text-muted-foreground'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${active ? 'text-primary' : ''}`} />
                      <span className="truncate">{s.label}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {schema.description}.{' '}
                <a
                  href={schema.helpUrl}
                  target="_blank" rel="noreferrer"
                  className="underline text-primary"
                >
                  Docs
                </a>
              </p>
            </div>

            {/* Name */}
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={`My ${schema.label}`}
                required
              />
            </div>

            {/* Dynamic fields per provider */}
            <div className="space-y-3">
              {schema.fields.map(f => {
                if (f.type === 'bool') {
                  return (
                    <label key={f.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!fields[f.key]}
                        onChange={(e) => setFields(prev => ({ ...prev, [f.key]: e.target.checked }))}
                        className="rounded border-input"
                      />
                      <span className="text-sm">{f.label}</span>
                    </label>
                  )
                }
                return (
                  <div key={f.key}>
                    <label className="text-sm font-medium mb-1 flex items-center justify-between">
                      <span>
                        {f.label}
                        {f.required && <span className="text-destructive ml-1">*</span>}
                      </span>
                      {f.secret && (
                        <button
                          type="button"
                          onClick={() => setRevealed(p => ({ ...p, [f.key]: !p[f.key] }))}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          {revealed[f.key] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {revealed[f.key] ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </label>
                    <Input
                      type={f.secret && !revealed[f.key] ? 'password' : 'text'}
                      value={fields[f.key] ?? ''}
                      onChange={(e) => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder || ''}
                      className={f.mono ? 'font-mono text-xs' : ''}
                    />
                  </div>
                )
              })}
            </div>

            {/* URL preview */}
            <div className="rounded-md border border-border bg-muted/40 p-2.5">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                <Globe className="h-3 w-3" />
                Generated Apprise URL
              </div>
              <code className="text-xs font-mono break-all text-foreground/90">
                {previewUrl || <span className="text-muted-foreground italic">fill fields above…</span>}
              </code>
            </div>

            {/* Enabled */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm font-medium">Enabled</span>
            </label>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>{error}</div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1" disabled={busy || missingRequired || !previewUrl}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (provider ? 'Save' : 'Create')}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

const NotificationsManager = ({ embedded = false, onClose }) => {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState(null)
  const [testing, setTesting] = useState({}) // { id: { state, message } }

  const refresh = async () => {
    setLoading(true); setError('')
    try {
      const res = await listNotificationProviders()
      setProviders(res.data || [])
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handleSave = async (form) => {
    if (editing) {
      await updateNotificationProvider(editing.id, form)
    } else {
      await createNotificationProvider(form)
    }
    setShowDialog(false)
    setEditing(null)
    refresh()
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete notification "${name}"? Jobs using it will lose this alert target.`)) return
    try {
      await deleteNotificationProvider(id)
      refresh()
    } catch (e) {
      alert(`Delete failed: ${e.response?.data?.detail || e.message}`)
    }
  }

  const handleTest = async (id) => {
    setTesting(prev => ({ ...prev, [id]: { state: 'testing', message: 'Sending…' } }))
    try {
      const res = await testNotificationProvider(id)
      setTesting(prev => ({
        ...prev,
        [id]: {
          state: res.data.success ? 'ok' : 'fail',
          message: res.data.message,
        },
      }))
    } catch (e) {
      setTesting(prev => ({
        ...prev,
        [id]: { state: 'fail', message: e.response?.data?.detail || e.message },
      }))
    }
  }

  const body = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {providers.length} {providers.length === 1 ? 'provider' : 'providers'}
        </h2>
        <Button onClick={() => { setEditing(null); setShowDialog(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Notification
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-2 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>{error}</div>
        </div>
      ) : providers.length === 0 ? (
        <div className="text-center py-10 rounded-lg border border-dashed border-border">
          <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No notifications yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add a notification endpoint (Telegram, Slack, Email, ...) to get alerts on backup events.
          </p>
          <Button onClick={() => { setEditing(null); setShowDialog(true) }} className="gap-2 mx-auto">
            <Plus className="h-4 w-4" />
            Add your first notification
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map(p => {
            const t = testing[p.id]
            return (
              <div key={p.id} className="rounded-lg bg-card border border-border p-4 flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5 h-10 w-10 rounded bg-background/60 border border-border flex items-center justify-center">
                  <Bell className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium truncate">{p.name}</h3>
                    {!p.enabled && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        disabled
                      </span>
                    )}
                    {t && (
                      <span
                        title={t.message}
                        className={`text-[11px] px-1.5 py-0.5 rounded border ${
                          t.state === 'ok'
                            ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
                            : t.state === 'fail'
                            ? 'text-destructive bg-destructive/10 border-destructive/40'
                            : 'text-muted-foreground bg-muted border-border'
                        }`}
                      >
                        {t.state === 'testing' ? 'Sending…' : t.state === 'ok' ? 'Sent' : 'Failed'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono truncate" title={p.url}>
                    {p.url}
                  </div>
                  {t?.message && t.state === 'fail' && (
                    <div className="text-xs text-destructive mt-1 truncate" title={t.message}>
                      {t.message}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => handleTest(p.id)}
                    className="h-8 px-2 flex items-center gap-1.5"
                    title="Send test notification"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => { setEditing(p); setShowDialog(true) }}
                    className="h-8 px-2 flex items-center gap-1.5"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => handleDelete(p.id, p.name)}
                    className="h-8 px-2 flex items-center gap-1.5 text-destructive hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showDialog && (
        <ProviderDialog
          provider={editing}
          onSave={handleSave}
          onClose={() => { setShowDialog(false); setEditing(null) }}
        />
      )}
    </div>
  )

  if (embedded) return body

  // Standalone (full-page) mode — currently unused; ConnectionsManager embeds it.
  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-3 flex items-center justify-between border-b border-border">
        <h1 className="text-lg font-medium">Notifications</h1>
        {onClose && (
          <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
        )}
      </header>
      <div className="container mx-auto px-6 py-6 max-w-3xl">{body}</div>
    </div>
  )
}

export default NotificationsManager
