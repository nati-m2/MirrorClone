import React, { useState, useEffect } from 'react'
import { KeyRound, Plus, Trash2, Eye, EyeOff, Copy, Check, Pencil, AlertTriangle } from 'lucide-react'
import Button from './ui/Button'
import Input from './ui/Input'
import {
  listEncryptionKeys,
  createEncryptionKey,
  updateEncryptionKey,
  revealEncryptionKey,
  deleteEncryptionKey,
} from '../lib/api'

// Keys live only on this server — they are never written into jobs.json and
// never uploaded with a backup, so an archive and the passphrase that opens
// it are never stored in the same place. Rotating a key applies to future
// runs only; archives already written keep the key they were made with, which
// is what the fingerprint shown here identifies.
export default function EncryptionKeysManager({ embedded = false }) {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', secret: '' })
  const [saving, setSaving] = useState(false)
  const [revealed, setRevealed] = useState({})   // id -> secret
  const [copied, setCopied] = useState(null)

  const refresh = async () => {
    try {
      const { data } = await listEncryptionKeys()
      setKeys(data)
      setError('')
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.secret.trim()) return
    setSaving(true)
    try {
      await createEncryptionKey({ name: form.name.trim(), secret: form.secret })
      setForm({ name: '', secret: '' })
      setShowAdd(false)
      await refresh()
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to create key')
    } finally {
      setSaving(false)
    }
  }

  const handleReveal = async (key) => {
    if (revealed[key.id]) {
      setRevealed(prev => {
        const next = { ...prev }
        delete next[key.id]
        return next
      })
      return
    }
    try {
      const { data } = await revealEncryptionKey(key.id)
      setRevealed(prev => ({ ...prev, [key.id]: data.secret }))
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to reveal key')
    }
  }

  const handleCopy = async (key) => {
    const secret = revealed[key.id]
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(key.id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard unavailable (no secure context) — the value is on screen.
    }
  }

  const handleRename = async (key) => {
    const name = window.prompt('Key name', key.name)
    if (!name || name === key.name) return
    try {
      await updateEncryptionKey(key.id, { name })
      await refresh()
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to rename key')
    }
  }

  const handleDelete = async (key) => {
    const ok = window.confirm(
      'Delete "' + key.name + '"?\n\n' +
      'Archives already encrypted with it stay encrypted. Without this ' +
      'passphrase in your own records they cannot be opened again.'
    )
    if (!ok) return
    try {
      await deleteEncryptionKey(key.id)
      await refresh()
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to delete key')
    }
  }

  return (
    <div className={embedded ? '' : 'container mx-auto px-6 py-6'}>
      {!embedded && (
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> Encryption Keys
        </h2>
      )}

      {!embedded && (
        <p className="text-xs text-muted-foreground mb-4 max-w-prose">
          Passphrases for AES-256 archives. They stay on this server and are never
          uploaded with a backup. Rotating a key applies to future runs only —
          older archives keep the key they were written with.
        </p>
      )}

      {!loading && (keys.length > 0 || showAdd) && (
        <div className="flex items-center justify-between py-4">
          <span className="text-sm text-muted-foreground">
            {keys.length} {keys.length === 1 ? 'key' : 'keys'}
          </span>
          {!showAdd && (
            <Button onClick={() => setShowAdd(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add key
            </Button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : keys.length === 0 && !showAdd ? (
        <div className="py-14 text-center">
          <KeyRound className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground mb-4">
            No keys yet. Archives are written unencrypted until a job points at one.
          </p>
          <Button onClick={() => setShowAdd(true)} className="gap-2 mx-auto">
            <Plus className="h-4 w-4" /> Add your first key
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {keys.map(key => (
            <div key={key.id} className="px-2 -mx-2 py-3 rounded-md hover:bg-accent/20 transition-colors">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{key.name}</span>
                    <code
                      className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      title="Key fingerprint — recorded beside each archive so you can tell which key it needs"
                    >
                      {key.fingerprint}
                    </code>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {key.in_use_by.length > 0
                      ? 'Used by ' + key.in_use_by.join(', ')
                      : 'Not used by any job'}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReveal(key)}
                  title={revealed[key.id] ? 'Hide passphrase' : 'Show passphrase'}
                >
                  {revealed[key.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleRename(key)} title="Rename">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(key)}
                  disabled={key.in_use_by.length > 0}
                  title={key.in_use_by.length > 0 ? 'Detach it from every job first' : 'Delete'}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {revealed[key.id] && (
                <div className="mt-2 flex items-center gap-2 rounded bg-muted/60 px-2 py-1.5">
                  <code className="text-xs break-all flex-1">{revealed[key.id]}</code>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(key)} title="Copy">
                    {copied === key.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          ))}

        </div>
      )}

      {showAdd && (
        <form onSubmit={handleCreate} className="mt-6 pt-5 border-t border-border space-y-3 max-w-md">
          <div>
            <label className="text-sm font-medium mb-1 block">Name</label>
            <Input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. apps archive key"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Passphrase</label>
            <Input
              type="password"
              value={form.secret}
              onChange={e => setForm({ ...form, secret: e.target.value })}
              placeholder="Stored on this server only"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Keep your own copy somewhere outside this server and outside the
              backup destination — it is the only way to open these archives.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save key'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setShowAdd(false); setForm({ name: '', secret: '' }) }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
