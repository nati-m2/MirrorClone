import React, { useState, useEffect } from 'react'
import { X, Clock, Folder, Cloud, AlertTriangle, Bell } from 'lucide-react'
import Button from './ui/Button'
import Input from './ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import FileBrowser from './FileBrowser'
import { getRemotesDetailed, listNotificationProviders } from '../lib/api'

// Default subfolder appended after the remote name. Kept for backwards compat
// with snapshots already created under "<remote>:MirrorCloneBackups/...".
const DEFAULT_PREFIX = 'MirrorCloneBackups'

// Split a destination string like "gdrive:MirrorCloneBackups/My Backup" into
// { remote: "gdrive", folder: "My Backup" }. Tolerates legacy values.
const parseDestination = (dest) => {
  if (!dest) return { remote: '', folder: '' }
  const idx = dest.indexOf(':')
  if (idx === -1) return { remote: '', folder: dest }
  const remote = dest.slice(0, idx)
  let path = dest.slice(idx + 1).replace(/^\/+/, '')
  if (path.startsWith(`${DEFAULT_PREFIX}/`)) path = path.slice(DEFAULT_PREFIX.length + 1)
  else if (path === DEFAULT_PREFIX) path = ''
  return { remote, folder: path }
}

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 2 AM', value: '0 2 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
  { label: 'Monthly (1st)', value: '0 0 1 * *' },
]

const COMMON_PATHS = [
  '/data',
  '/var/lib/docker/volumes',
  '/home',
  '/opt',
]

const JobDialog = ({ job, onSave, onClose, onManageConnections }) => {
  const [formData, setFormData] = useState({
    name: '',
    source_path: '',
    remote: '',
    destination: '',
    cron_expression: '0 2 * * *',
    enabled: true,
    preserve_metadata: true,
    preserve_links: true,
    compress_before_upload: true,
    zip_password: '',
    retention_count: 0,
    local_retention_count: 0,
    exclude_patterns: [],
    notification_ids: [],
    notify_on_success: false,
    notify_on_failure: true,
  })
  const [showCronPresets, setShowCronPresets] = useState(false)
  const [showPathSuggestions, setShowPathSuggestions] = useState(false)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [remotes, setRemotes] = useState([])
  const [remotesLoading, setRemotesLoading] = useState(true)
  const [notifProviders, setNotifProviders] = useState([])

  // Load the available notification providers so the user can tick them on.
  useEffect(() => {
    let active = true
    listNotificationProviders()
      .then(res => { if (active) setNotifProviders(res.data || []) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // Load configured connections so the user can pick one for this job.
  useEffect(() => {
    let active = true
    getRemotesDetailed()
      .then(res => {
        if (!active) return
        const list = res.data || []
        setRemotes(list)
        // Auto-pick first connection on new jobs when there's only one.
        setFormData(prev => {
          if (prev.remote || !list.length) return prev
          if (!job) return { ...prev, remote: list[0].name }
          return prev
        })
      })
      .catch(() => {})
      .finally(() => { if (active) setRemotesLoading(false) })
    return () => { active = false }
  }, [job])

  useEffect(() => {
    if (job) {
      const { remote, folder } = parseDestination(job.destination)
      setFormData({
        name: job.name || '',
        source_path: job.source_path || '',
        remote,
        destination: folder,
        cron_expression: job.cron_expression || '0 2 * * *',
        enabled: job.enabled !== undefined ? job.enabled : true,
        preserve_metadata: job.preserve_metadata !== undefined ? job.preserve_metadata : true,
        preserve_links: job.preserve_links !== undefined ? job.preserve_links : true,
        compress_before_upload: job.compress_before_upload !== undefined ? job.compress_before_upload : true,
        zip_password: job.zip_password || '',
        retention_count: job.retention_count !== undefined ? job.retention_count : 0,
        local_retention_count: job.local_retention_count !== undefined ? job.local_retention_count : 0,
        exclude_patterns: Array.isArray(job.exclude_patterns) ? job.exclude_patterns : [],
        notification_ids: Array.isArray(job.notification_ids) ? job.notification_ids : [],
        notify_on_success: job.notify_on_success ?? false,
        notify_on_failure: job.notify_on_failure ?? true,
      })
    }
  }, [job])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!formData.remote) return
    // Build full destination: <remote>:MirrorCloneBackups/<folder>
    const folder = formData.destination.replace(/^\/+/, '')
    const fullDestination = `${formData.remote}:${DEFAULT_PREFIX}/${folder}`
    // Drop UI-only field before posting.
    const { remote, ...rest } = formData
    onSave({ ...rest, destination: fullDestination })
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    let newValue = value
    
    if (type === 'checkbox') {
      newValue = checked
    } else if (name === 'retention_count' || name === 'local_retention_count') {
      newValue = parseInt(value, 10) || 0
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: newValue
    }))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{job ? 'Edit Job' : 'Create New Job'}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Job Name</label>
              <Input
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="My Backup Job"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Source Path</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    name="source_path"
                    value={formData.source_path}
                    onChange={handleChange}
                    onFocus={() => setShowPathSuggestions(true)}
                    // Hide suggestions on blur with a small delay so a click on
                    // a suggestion still registers before the popup unmounts.
                    onBlur={() => setTimeout(() => setShowPathSuggestions(false), 150)}
                    placeholder="/data/my-folder"
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFileBrowser(true)}
                  className="flex items-center gap-2"
                >
                  <Folder className="h-4 w-4" />
                  Select Files/Folders
                </Button>
              </div>
              {showPathSuggestions && (
                <div className="mt-1 border rounded-md bg-background shadow-lg">
                  <div className="p-2 text-xs font-medium text-muted-foreground border-b flex items-center justify-between">
                    <span>Common paths:</span>
                    <button
                      type="button"
                      className="hover:text-foreground"
                      // Use mousedown so the click fires before the input's
                      // onBlur timeout removes the popup from the DOM.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setShowPathSuggestions(false)
                      }}
                      aria-label="Close suggestions"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {COMMON_PATHS.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setFormData(prev => ({ ...prev, source_path: path }))
                        setShowPathSuggestions(false)
                      }}
                    >
                      {path}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Click <Folder className="h-3 w-3 inline" /> for common paths
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5" />
                Connection
              </label>
              {remotesLoading ? (
                <div className="text-xs text-muted-foreground">Loading connections…</div>
              ) : remotes.length === 0 ? (
                <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium text-amber-300">No connections configured</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Add a cloud or storage connection before creating a job.
                    </div>
                    {onManageConnections && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={onManageConnections}
                        className="mt-2 h-7 px-2 text-xs"
                      >
                        Manage connections
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <select
                  name="remote"
                  value={formData.remote}
                  onChange={handleChange}
                  required
                  className="w-full h-10 px-3 bg-background border border-input rounded-md text-sm
                    focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="" disabled>Select a connection…</option>
                  {remotes.map(r => (
                    <option key={r.name} value={r.name}>
                      {r.name} ({r.type || 'unknown'})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Backup Folder Name</label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground font-mono truncate max-w-[60%]" title={`${formData.remote || '<connection>'}:${DEFAULT_PREFIX}/`}>
                  {(formData.remote || '<connection>') + ':' + DEFAULT_PREFIX + '/'}
                </span>
                <Input
                  name="destination"
                  value={formData.destination}
                  onChange={handleChange}
                  placeholder="My Backup"
                  className="flex-1"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Folder name on the selected connection.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Schedule</label>
              <div className="relative">
                <Input
                  name="cron_expression"
                  value={formData.cron_expression}
                  onChange={handleChange}
                  onFocus={() => setShowCronPresets(true)}
                  placeholder="0 2 * * *"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-8 w-8"
                  onClick={() => setShowCronPresets(!showCronPresets)}
                >
                  <Clock className="h-4 w-4" />
                </Button>
              </div>
              {showCronPresets && (
                <div className="mt-1 border rounded-md bg-background shadow-lg">
                  <div className="p-2 text-xs font-medium text-muted-foreground border-b">
                    Quick presets:
                  </div>
                  {CRON_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, cron_expression: preset.value }))
                        setShowCronPresets(false)
                      }}
                    >
                      <span>{preset.label}</span>
                      <code className="text-xs text-muted-foreground">{preset.value}</code>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Click <Clock className="h-3 w-3 inline" /> for quick presets
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="enabled"
                  checked={formData.enabled}
                  onChange={handleChange}
                  className="rounded border-input"
                />
                <span className="text-sm font-medium">Enabled</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="preserve_metadata"
                  checked={formData.preserve_metadata}
                  onChange={handleChange}
                  className="rounded border-input"
                />
                <span className="text-sm font-medium">Preserve Metadata & Permissions</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="preserve_links"
                  checked={formData.preserve_links}
                  onChange={handleChange}
                  className="rounded border-input"
                />
                <span className="text-sm font-medium">Preserve Symbolic Links</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="compress_before_upload"
                  checked={formData.compress_before_upload}
                  onChange={handleChange}
                  className="rounded border-input"
                />
                <span className="text-sm font-medium">Create ZIP before upload</span>
              </label>
              
              {formData.compress_before_upload && (
                <div className="ml-6">
                  <label className="text-sm font-medium mb-1 block">ZIP Password (optional)</label>
                  <Input
                    type="password"
                    name="zip_password"
                    value={formData.zip_password}
                    onChange={handleChange}
                    placeholder="Leave empty for no encryption"
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    AES-256 encryption
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Keep remote backups</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  name="retention_count"
                  value={formData.retention_count}
                  onChange={handleChange}
                  min={0}
                  placeholder="0"
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {formData.retention_count === 0 ? 'Keep all' : `Keep last ${formData.retention_count}`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Retention for cloud snapshots (0 = keep all)
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Keep local ZIP backups</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  name="local_retention_count"
                  value={formData.local_retention_count}
                  onChange={handleChange}
                  min={0}
                  placeholder="0"
                  className="w-24"
                  disabled={!formData.compress_before_upload}
                />
                <span className="text-sm text-muted-foreground">
                  {formData.local_retention_count === 0 ? 'Keep all' : `Keep last ${formData.local_retention_count}`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formData.compress_before_upload
                  ? 'Retention for local ZIP files in /backups volume (0 = keep all)'
                  : 'Local ZIPs are only created when compression is enabled'}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Exclude patterns</label>
              <textarea
                name="exclude_patterns"
                value={(formData.exclude_patterns || []).join('\n')}
                onChange={(e) => {
                  // Split by newlines/commas, drop empties; keep order.
                  const lines = e.target.value
                    .split(/[\r\n,]+/)
                    .map(s => s.trim())
                    .filter(Boolean)
                  setFormData(prev => ({ ...prev, exclude_patterns: lines }))
                }}
                placeholder={'.env\nmedia/**\n*.log'}
                rows={4}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm font-mono
                  focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
              />
              <p className="text-xs text-muted-foreground mt-1">
                One glob per line. Examples: <code>.env</code>, <code>media/**</code>, <code>*.log</code>, <code>node_modules</code>.
              </p>
            </div>

            {/* ── Notifications ──────────────────────────────────────── */}
            <div className="pt-2 border-t border-border">
              <label className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5" />
                Notifications
              </label>

              <div className="flex flex-wrap gap-4 mb-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.notify_on_failure}
                    onChange={(e) => setFormData(prev => ({ ...prev, notify_on_failure: e.target.checked }))}
                    className="rounded border-input"
                  />
                  <span className="text-sm">Notify on failure</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.notify_on_success}
                    onChange={(e) => setFormData(prev => ({ ...prev, notify_on_success: e.target.checked }))}
                    className="rounded border-input"
                  />
                  <span className="text-sm">Notify on success</span>
                </label>
              </div>

              {notifProviders.length === 0 ? (
                <div className="flex items-start gap-2 p-3 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    No notification providers configured yet. Add one under{' '}
                    <span className="font-medium">Settings → Notifications</span>.
                  </div>
                </div>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto border border-border rounded-md p-2">
                  {notifProviders.map(p => {
                    const checked = formData.notification_ids.includes(p.id)
                    return (
                      <label key={p.id} className="flex items-center gap-2 px-1 py-1 hover:bg-accent/50 rounded">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!p.enabled}
                          onChange={(e) => {
                            setFormData(prev => ({
                              ...prev,
                              notification_ids: e.target.checked
                                ? [...prev.notification_ids, p.id]
                                : prev.notification_ids.filter(x => x !== p.id),
                            }))
                          }}
                          className="rounded border-input"
                        />
                        <span className="text-sm flex-1 truncate">
                          {p.name}
                          {!p.enabled && <span className="text-xs text-muted-foreground ml-2">(disabled)</span>}
                        </span>
                        <code className="text-[10px] font-mono text-muted-foreground truncate max-w-[50%]" title={p.url}>
                          {p.url.split('://')[0]}://…
                        </code>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="submit" className="flex-1">
                {job ? 'Update Job' : 'Create Job'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {showFileBrowser && (
        <FileBrowser
          multiSelect={true}
          // Seed with the paths currently in the form so re-opening the browser
          // preserves earlier selections instead of starting fresh.
          initialSelected={
            formData.source_path
              ? formData.source_path.split(',').map(s => s.trim()).filter(Boolean)
              : []
          }
          onSelect={(paths) => {
            // If multiple paths selected, join them with commas
            const pathString = Array.isArray(paths) ? paths.join(',') : paths
            setFormData(prev => ({ ...prev, source_path: pathString }))
            setShowFileBrowser(false)
          }}
          onClose={() => setShowFileBrowser(false)}
        />
      )}
    </div>
  )
}

export default JobDialog
