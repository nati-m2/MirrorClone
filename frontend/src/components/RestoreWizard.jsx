import React, { useState, useEffect } from 'react'
import {
  ChevronRight, ChevronLeft, ChevronDown, FolderOpen, Folder,
  File, Check, X, Lock, Eye, EyeOff, RefreshCw, RotateCcw,
  Shield, HardDrive, AlertTriangle, CheckCircle2, Loader2
} from 'lucide-react'
import Button from './ui/Button'
import { Card, CardContent } from './ui/Card'
import { listRestoreBackups, browseBackup, executeRestore, listRestoreDestinations } from '../lib/api'

// ─── Step indicator ────────────────────────────────────────────────────────────
const STEPS = ['Select Backup', 'Select Files', 'Restore Settings', 'Execute']

const StepBar = ({ current }) => (
  <div className="flex items-center justify-center gap-0 mb-8">
    {STEPS.map((label, i) => (
      <React.Fragment key={i}>
        <div className="flex flex-col items-center">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all
            ${i < current ? 'bg-primary border-primary text-primary-foreground'
              : i === current ? 'bg-primary/20 border-primary text-primary'
              : 'bg-muted border-border text-muted-foreground'}`}>
            {i < current ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          <span className={`mt-1 text-xs whitespace-nowrap ${i === current ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
            {label}
          </span>
        </div>
        {i < STEPS.length - 1 && (
          <div className={`h-0.5 w-14 mb-5 mx-1 ${i < current ? 'bg-primary' : 'bg-border'}`} />
        )}
      </React.Fragment>
    ))}
  </div>
)

// ─── Step 1: Select backup snapshot ───────────────────────────────────────────
const StepSelectBackup = ({ onSelect }) => {
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState([])
  const [expanded, setExpanded] = useState({})
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchBackups()
  }, [])

  const fetchBackups = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listRestoreBackups()
      setJobs(res.data.jobs || [])
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }

  const toggleJob = (jobId) => setExpanded(prev => ({ ...prev, [jobId]: !prev[jobId] }))

  const formatDate = (ts) => {
    if (!ts) return ''
    return ts.replace('T', ' ')
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>Loading backups...</span>
    </div>
  )

  if (error) return (
    <div className="text-center py-12">
      <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
      <p className="text-destructive mb-4">{error}</p>
      <Button onClick={fetchBackups} variant="outline" className="gap-2">
        <RefreshCw className="h-4 w-4" /> Retry
      </Button>
    </div>
  )

  if (jobs.length === 0) return (
    <div className="text-center py-12 text-muted-foreground">
      <HardDrive className="h-12 w-12 mx-auto mb-3 opacity-40" />
      <p>No backups available</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {jobs.map(job => (
        <div key={job.job_id} className="border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors"
            onClick={() => toggleJob(job.job_id)}
          >
            <div className="flex items-center gap-2 font-medium">
              <HardDrive className="h-4 w-4 text-primary" />
              {job.job_name}
              <span className="text-xs text-muted-foreground font-normal ml-1">
                ({job.snapshots.length} snapshot{job.snapshots.length !== 1 ? 's' : ''})
              </span>
            </div>
            {expanded[job.job_id]
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>

          {expanded[job.job_id] && (
            <div className="divide-y divide-border">
              {job.snapshots.map(snap => (
                <button
                  key={snap.folder}
                  onClick={() => setSelected(snap)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-accent transition-colors
                    ${selected?.folder === snap.folder ? 'bg-primary/10 border-l-2 border-primary' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${selected?.folder === snap.folder ? 'bg-primary' : 'bg-border'}`} />
                    <div>
                      <div className="font-mono text-sm">{formatDate(snap.timestamp)}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {snap.compressed && (
                          <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">ZIP</span>
                        )}
                        {snap.encrypted && (
                          <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Lock className="h-2.5 w-2.5" /> Encrypted
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {selected?.folder === snap.folder && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="pt-4 flex justify-end">
        <Button onClick={() => onSelect(selected)} disabled={!selected} className="gap-2">
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Step 2: Browse backup & select files ─────────────────────────────────────
const BackupTreeItem = ({ item, depth, selected, onToggle, onExpand, expanded, children }) => {
  const isDir = item.type === 'directory'
  const isSelected = selected.includes(item.path)

  return (
    <>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent cursor-pointer transition-colors
          ${isSelected ? 'bg-primary/10 border border-primary/40' : ''}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <div
          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 cursor-pointer
            ${isSelected ? 'bg-primary border-primary' : 'border-input'}`}
          onClick={(e) => { e.stopPropagation(); onToggle(item.path) }}
        >
          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
        </div>

        <div className="flex items-center gap-2 flex-1" onClick={() => isDir ? onExpand(item.path) : onToggle(item.path)}>
          {isDir ? (
            <>
              {expanded.has(item.path)
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
              <Folder className="h-4 w-4 text-blue-400 flex-shrink-0" />
            </>
          ) : (
            <File className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-4" />
          )}
          <span className="text-sm truncate">{item.name}</span>
          {!isDir && item.size > 0 && (
            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
              {item.size < 1024 ? `${item.size}B`
                : item.size < 1048576 ? `${(item.size / 1024).toFixed(1)}KB`
                : `${(item.size / 1048576).toFixed(1)}MB`}
            </span>
          )}
        </div>
      </div>
      {isDir && expanded.has(item.path) && children}
    </>
  )
}

const StepBrowseFiles = ({ snapshot, selectedItems, onSelectionChange, onNext, onBack }) => {
  const [subPath, setSubPath] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [childCache, setChildCache] = useState({})
  const [error, setError] = useState('')
  const [restoreAll, setRestoreAll] = useState(true)

  useEffect(() => {
    loadItems('')
  }, [snapshot])

  const loadItems = async (path) => {
    setLoading(true)
    setError('')
    try {
      const res = await browseBackup(snapshot.path, path)
      setItems(res.data.items || [])
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to browse backup')
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = async (dirPath) => {
    const next = new Set(expandedDirs)
    if (next.has(dirPath)) {
      next.delete(dirPath)
    } else {
      next.add(dirPath)
      if (!childCache[dirPath]) {
        try {
          const res = await browseBackup(snapshot.path, dirPath)
          setChildCache(prev => ({ ...prev, [dirPath]: res.data.items || [] }))
        } catch {}
      }
    }
    setExpandedDirs(next)
  }

  const toggleItem = (path) => {
    onSelectionChange(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    )
  }

  const renderTree = (treeItems, depth = 0) =>
    treeItems.map(item => (
      <BackupTreeItem
        key={item.path}
        item={item}
        depth={depth}
        selected={selectedItems}
        onToggle={toggleItem}
        onExpand={toggleExpand}
        expanded={expandedDirs}
      >
        {childCache[item.path] && renderTree(childCache[item.path], depth + 1)}
      </BackupTreeItem>
    ))

  const handleRestoreAllToggle = (val) => {
    setRestoreAll(val)
    if (val) onSelectionChange([])
  }

  const canProceed = restoreAll || selectedItems.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg text-sm">
        <HardDrive className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="font-mono truncate text-muted-foreground">{snapshot.folder}</span>
      </div>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={restoreAll} onChange={() => handleRestoreAllToggle(true)}
            className="accent-primary" />
          <span>Restore all</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={!restoreAll} onChange={() => handleRestoreAllToggle(false)}
            className="accent-primary" />
          <span>Select specific files</span>
        </label>
      </div>

      {!restoreAll && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-muted/30 border-b text-xs text-muted-foreground flex items-center justify-between">
            <span>Backup contents</span>
            {selectedItems.length > 0 && (
              <span className="text-primary font-medium">{selectedItems.length} selected</span>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {loading ? (
              <div className="text-center py-6 text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : error ? (
              <div className="text-center py-6 text-destructive text-sm">{error}</div>
            ) : items.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">Backup is empty</div>
            ) : (
              <div className="space-y-0.5">
                {renderTree(items)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={() => onNext({ restoreAll })} disabled={!canProceed} className="gap-2">
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Step 3: Restore settings ─────────────────────────────────────────────────
const StepRestoreSettings = ({ snapshot, onNext, onBack }) => {
  const [destMode, setDestMode] = useState('original')  // 'original' | 'custom'
  const [customDest, setCustomDest] = useState('/data/restored')
  const [destinations, setDestinations] = useState([])
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [restorePerms, setRestorePerms] = useState(false)

  useEffect(() => {
    listRestoreDestinations()
      .then(res => setDestinations(res.data.destinations || []))
      .catch(() => {})
  }, [])

  const finalDest = destMode === 'original' ? snapshot.path.split(':').slice(-1)[0] || '/data' : customDest

  const canProceed = finalDest.trim().length > 0 && (!snapshot.encrypted || password.length > 0)

  return (
    <div className="space-y-5">
      {/* Destination */}
      <div>
        <label className="text-sm font-medium mb-2 block">Restore destination</label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
            <input type="radio" checked={destMode === 'original'} onChange={() => setDestMode('original')}
              className="accent-primary mt-0.5" />
            <div>
              <div className="font-medium text-sm">Original location</div>
              <div className="text-xs text-muted-foreground mt-0.5">Restore into the original backup directory</div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
            <input type="radio" checked={destMode === 'custom'} onChange={() => setDestMode('custom')}
              className="accent-primary mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-sm">Custom location</div>
              <div className="text-xs text-muted-foreground mt-0.5">Choose a different folder to restore into</div>
            </div>
          </label>
        </div>

        {destMode === 'custom' && (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={customDest}
              onChange={e => setCustomDest(e.target.value)}
              placeholder="/data/restored"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm font-mono
                focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {destinations.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Existing folders in /data:</p>
                <div className="flex flex-wrap gap-1.5">
                  {destinations.map(d => (
                    <button
                      key={d.path}
                      onClick={() => setCustomDest(d.path)}
                      className={`text-xs px-2 py-1 rounded border transition-colors
                        ${customDest === d.path
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:bg-accent'}`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Password (shown if snapshot is encrypted) */}
      {snapshot.encrypted && (
        <div>
          <label className="text-sm font-medium mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-400" />
            Decryption password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password to decrypt the backup"
              className="w-full px-3 py-2 pr-10 bg-background border border-input rounded-md text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-amber-400/80 mt-1.5 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> This backup is encrypted — password required to decrypt
          </p>
        </div>
      )}

      {/* Restore permissions */}
      <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
        <input type="checkbox" checked={restorePerms} onChange={e => setRestorePerms(e.target.checked)}
          className="accent-primary mt-0.5" />
        <div>
          <div className="font-medium text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Restore file permissions
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Apply default permissions (644 for files, 755 for dirs) — Linux only
          </div>
        </div>
      </label>

      {/* Summary */}
      <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Source:</span>
          <span className="font-mono text-xs truncate max-w-[60%]">{snapshot.path}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Destination:</span>
          <span className="font-mono text-xs truncate max-w-[60%]">{finalDest}</span>
        </div>
      </div>

      <div className="flex justify-between pt-1">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <Button
          onClick={() => onNext({ destination: finalDest, password, restorePermissions: restorePerms })}
          disabled={!canProceed}
          className="gap-2"
        >
          Restore <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Step 4: Execute & result ─────────────────────────────────────────────────
const StepExecute = ({ snapshot, selectedItems, restoreAll, destination, password, restorePermissions, onDone }) => {
  const [status, setStatus] = useState('running')  // 'running' | 'success' | 'error'
  const [message, setMessage] = useState('')

  useEffect(() => {
    runRestore()
  }, [])

  const runRestore = async () => {
    try {
      const payload = {
        backup_path: snapshot.path,
        selected_items: restoreAll ? [] : selectedItems,
        destination,
        password: password || '',
        restore_permissions: restorePermissions
      }
      const res = await executeRestore(payload)
      setStatus('success')
      setMessage(res.data.message || 'Restore completed successfully')
    } catch (e) {
      setStatus('error')
      setMessage(e.response?.data?.detail || 'Restore failed')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-6 text-center">
      {status === 'running' && (
        <>
          <Loader2 className="h-14 w-14 animate-spin text-primary" />
          <div>
            <p className="font-semibold text-lg">Restoring files...</p>
            <p className="text-muted-foreground text-sm mt-1">Please wait, this may take several minutes</p>
          </div>
        </>
      )}
      {status === 'success' && (
        <>
          <CheckCircle2 className="h-14 w-14 text-green-500" />
          <div>
            <p className="font-semibold text-lg text-green-500">Restore completed successfully!</p>
            <p className="text-muted-foreground text-sm mt-1">{message}</p>
          </div>
          <Button onClick={onDone} className="gap-2">
            <Check className="h-4 w-4" /> Done
          </Button>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertTriangle className="h-14 w-14 text-destructive" />
          <div>
            <p className="font-semibold text-lg text-destructive">Restore failed</p>
            <p className="text-muted-foreground text-sm mt-1 font-mono max-w-md">{message}</p>
          </div>
          <Button variant="outline" onClick={onDone} className="gap-2">
            <X className="h-4 w-4" /> Close
          </Button>
        </>
      )}
    </div>
  )
}

// ─── Main Wizard ───────────────────────────────────────────────────────────────
const RestoreWizard = ({ onClose }) => {
  const [step, setStep] = useState(0)
  const [snapshot, setSnapshot] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])
  const [restoreAll, setRestoreAll] = useState(true)
  const [restoreSettings, setRestoreSettings] = useState(null)

  const handleSelectBackup = (snap) => {
    setSnapshot(snap)
    setStep(1)
  }

  const handleFilesNext = ({ restoreAll: ra }) => {
    setRestoreAll(ra)
    setStep(2)
  }

  const handleSettingsNext = (settings) => {
    setRestoreSettings(settings)
    setStep(3)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <RotateCcw className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Restore Wizard</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <StepBar current={step} />

          {step === 0 && (
            <StepSelectBackup onSelect={handleSelectBackup} />
          )}

          {step === 1 && snapshot && (
            <StepBrowseFiles
              snapshot={snapshot}
              selectedItems={selectedItems}
              onSelectionChange={setSelectedItems}
              onNext={handleFilesNext}
              onBack={() => setStep(0)}
            />
          )}

          {step === 2 && snapshot && (
            <StepRestoreSettings
              snapshot={snapshot}
              onNext={handleSettingsNext}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && snapshot && restoreSettings && (
            <StepExecute
              snapshot={snapshot}
              selectedItems={selectedItems}
              restoreAll={restoreAll}
              destination={restoreSettings.destination}
              password={restoreSettings.password}
              restorePermissions={restoreSettings.restorePermissions}
              onDone={onClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default RestoreWizard
