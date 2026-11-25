import React, { useEffect, useState } from 'react'
import { Loader2, LogIn, ShieldCheck } from 'lucide-react'
import Button from './ui/Button'
import api from '../lib/api'

/**
 * Full-screen login page shown when an admin password is configured but the
 * current session has no valid JWT cookie.
 *
 * POST /api/auth/login verifies the password against the PBKDF2 hash in
 * /config/auth_profile.json and sets an httpOnly JWT cookie.
 */
const STATUS_POLL_MS = 5000

const LoginPage = ({ onLoggedIn, onSetupMode }) => {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Watch for the profile disappearing from the server — an admin resetting a
  // forgotten password deletes /config/auth_profile.json, and without this the
  // login form would sit here asking for a password that no longer exists
  // until someone reloads by hand.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await api.get('/auth/status')
        if (res.data?.setup_mode) onSetupMode?.()
      } catch { /* server down — keep showing the form */ }
    }, STATUS_POLL_MS)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password) {
      setError('Please enter your password')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/login', { password })
      onLoggedIn()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className="h-10 w-10">
              <path d="M14 24 C14 20 18 17 22 17 L36 17 L36 13 L50 22 L36 31 L36 27 L22 27 C20 27 19 26 19 24 Z" fill="white"/>
              <path d="M50 40 C50 44 46 47 42 47 L28 47 L28 51 L14 42 L28 33 L28 37 L42 37 C44 37 45 38 45 40 Z" fill="white" opacity="0.85"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold">MirrorClone</h1>
          <p className="text-muted-foreground text-sm mt-1">Sign in to manage your backups</p>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center">
            <ShieldCheck className="h-4 w-4" />
            Admin access required
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Admin password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              autoComplete="current-password"
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
              : <LogIn className="h-4 w-4" />}
            Sign in
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Lost the password? Delete <code className="font-mono">/config/auth_profile.json</code> on
          the server — this page switches to setup on its own.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
