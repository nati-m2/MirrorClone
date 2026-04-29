import React, { useState, useEffect } from 'react'
import { X, Clock, Folder } from 'lucide-react'
import Button from './ui/Button'
import Input from './ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import FileBrowser from './FileBrowser'

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

const JobDialog = ({ job, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    source_path: '',
    destination: '',
    cron_expression: '0 2 * * *',
    enabled: true,
    preserve_metadata: true,
    preserve_links: true,
    compress_before_upload: false,
    zip_password: '',
    retention_count: 0,
    local_retention_count: 0,
  })
  const [showCronPresets, setShowCronPresets] = useState(false)
  const [showPathSuggestions, setShowPathSuggestions] = useState(false)
  const [showFileBrowser, setShowFileBrowser] = useState(false)

  useEffect(() => {
    if (job) {
      // Extract folder name from full destination path
      let destFolder = job.destination || ''
      if (destFolder.startsWith('gdrive:MirrorCloneBackups/')) {
        destFolder = destFolder.replace('gdrive:MirrorCloneBackups/', '')
      }
      setFormData({
        name: job.name || '',
        source_path: job.source_path || '',
        destination: destFolder,
        cron_expression: job.cron_expression || '0 2 * * *',
        enabled: job.enabled !== undefined ? job.enabled : true,
        preserve_metadata: job.preserve_metadata !== undefined ? job.preserve_metadata : true,
        preserve_links: job.preserve_links !== undefined ? job.preserve_links : true,
        compress_before_upload: job.compress_before_upload !== undefined ? job.compress_before_upload : false,
        zip_password: job.zip_password || '',
        retention_count: job.retention_count !== undefined ? job.retention_count : 0,
        local_retention_count: job.local_retention_count !== undefined ? job.local_retention_count : 0,
      })
    }
  }, [job])

  const handleSubmit = (e) => {
    e.preventDefault()
    // Build full destination path
    const fullDestination = `gdrive:MirrorCloneBackups/${formData.destination.replace(/^\/+/, '')}`
    onSave({ ...formData, destination: fullDestination })
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
                  <div className="p-2 text-xs font-medium text-muted-foreground border-b">
                    Common paths:
                  </div>
                  {COMMON_PATHS.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                      onClick={() => {
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
              <label className="text-sm font-medium mb-1 block">Backup Folder Name</label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">gdrive:MirrorCloneBackups/</span>
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
                Folder name in Google Drive (under backups/)
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

            {formData.compress_before_upload && (
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
                  />
                  <span className="text-sm text-muted-foreground">
                    {formData.local_retention_count === 0 ? 'Keep all' : `Keep last ${formData.local_retention_count}`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Retention for local ZIP files in /backups volume (0 = keep all)
                </p>
              </div>
            )}

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
