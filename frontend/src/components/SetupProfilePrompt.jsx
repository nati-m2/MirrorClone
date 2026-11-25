import React, { useState } from 'react'
import { ShieldCheck, Loader2, KeyRound } from 'lucide-react'
import Button from './ui/Button'
import api from '../lib/api'

const MIN_LENGTH = 8

/**
 * Shown once after the first connection is established on a fresh install
 * when no admin password was found in the cloud backup. Prompts the admin to
 * choose a password, which the backend stores as a PBKDF2 hash.
 */
const SetupProfilePrompt = ({ onCreated, onSkip }) => {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/setup', { password })
      onCreated()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <ShieldCheck className="h-9 w-9 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Secure your instance</h1>
          <p className="text-muted-foreground text-sm mt-1 text-center">
            Choose an admin password to lock the panel.
            <br />It's stored hashed — keep a copy, it can't be recovered.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Admin password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={`At least ${MIN_LENGTH} characters`}
              autoFocus
              autoComplete="new-password"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive text-center">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full gap-2">
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <KeyRound className="h-4 w-4" />}
            Set password
          </Button>

          <button
            type="button"
            onClick={onSkip}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Skip for now (UI stays open)
          </button>
        </form>
      </div>
    </div>
  )
}

export default SetupProfilePrompt
