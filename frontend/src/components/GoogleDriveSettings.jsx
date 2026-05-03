import React, { useEffect, useState } from 'react'
import { Key, Loader2, Save, AlertTriangle, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import Button from './ui/Button'
import Input from './ui/Input'
import {
  getGoogleDriveCredentials,
  updateGoogleDriveCredentials,
} from '../lib/api'

// rclone's shared default client id — we don't show the secret for this one
// since it's public and hardcoded in rclone anyway.
const RCLONE_DEFAULT_CLIENT_ID = '202264815644.apps.googleusercontent.com'

/**
 * UI for overriding Google Drive OAuth client credentials.
 * Persists to /config/app_settings.json through /api/settings/google-drive.
 */
const GoogleDriveSettings = () => {
  const [form, setForm] = useState({ client_id: '', client_secret: '' })
  const [original, setOriginal] = useState({ client_id: '', client_secret: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'ok'|'err', text }

  const load = async () => {
    setLoading(true)
    try {
      const res = await getGoogleDriveCredentials()
      const data = res.data || { client_id: '', client_secret: '' }
      setForm(data)
      setOriginal(data)
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const isDefault = form.client_id === RCLONE_DEFAULT_CLIENT_ID || !form.client_id
  const dirty = form.client_id !== original.client_id || form.client_secret !== original.client_secret

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await updateGoogleDriveCredentials({
        client_id: form.client_id,
        client_secret: form.client_secret,
      })
      setForm(res.data)
      setOriginal(res.data)
      setMessage({ type: 'ok', text: 'Credentials saved' })
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm('Reset to rclone\'s shared default credentials? This may hit global rate limits.')) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await updateGoogleDriveCredentials({ client_id: '', client_secret: '' })
      setForm(res.data)
      setOriginal(res.data)
      setMessage({ type: 'ok', text: 'Reset to rclone defaults' })
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Key className="h-4 w-4 text-primary" />
        <span className="font-medium">Google Drive OAuth Client</span>
        {isDefault ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded border border-amber-400/40 bg-amber-400/10 text-amber-300">
            Using rclone shared default
          </span>
        ) : (
          <span className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-400/30 bg-emerald-400/10 text-emerald-400 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Custom client configured
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Set your own Client ID / Secret from{' '}
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank" rel="noreferrer"
          className="underline text-primary"
        >
          Google Cloud Console
        </a>
        {' '}to avoid rclone's shared rate limits. Leave empty to use the default.
      </p>

      <div>
        <label className="text-xs font-medium mb-1 block">Client ID</label>
        <Input
          value={form.client_id}
          onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
        />
      </div>

      <div>
        <label className="text-xs font-medium mb-1 block">Client Secret</label>
        <div className="relative">
          <Input
            type={showSecret ? 'text' : 'password'}
            value={form.client_secret}
            onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
            placeholder="GOCSPX-••••••••••••"
          />
          <button
            type="button"
            onClick={() => setShowSecret(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title={showSecret ? 'Hide' : 'Show'}
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-md border p-2 text-xs flex items-start gap-2 ${
            message.type === 'ok'
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
        >
          {message.type === 'ok'
            ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <div>{message.text}</div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !dirty} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
        {!isDefault && (
          <Button type="button" variant="outline" onClick={handleReset} disabled={saving}>
            Reset to defaults
          </Button>
        )}
      </div>
    </form>
  )
}

export default GoogleDriveSettings
