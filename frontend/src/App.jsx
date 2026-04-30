import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, RefreshCw, Database, Cloud, CloudOff, RotateCcw, HardDrive, Settings as SettingsIcon } from 'lucide-react'
import JobCard from './components/JobCard'
import BackupStatistics from './components/BackupStatistics'
import JobDialog from './components/JobDialog'
import ConnectionsManager from './components/ConnectionsManager'
import RestoreWizard from './components/RestoreWizard'
import RestoreSnapshots from './components/RestoreSnapshots'
import Button from './components/ui/Button'
import { 
  getStatus, 
  getJobs, 
  createJob, 
  updateJob, 
  deleteJob, 
  runJobNow, 
  stopJob,
  getGdriveStatus,
  disconnectGdrive
} from './lib/api'

function App() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [configExists, setConfigExists] = useState(false)
  const [showJobDialog, setShowJobDialog] = useState(false)
  const [editingJob, setEditingJob] = useState(null)
  const [gdriveStatus, setGdriveStatus] = useState({ connected: false, checking: true })
  const [showConfig, setShowConfig] = useState(false)
  const [jobProgress, setJobProgress] = useState({}) // { jobId: { stage, message, percent } }
  const [activeTab, setActiveTab] = useState('backup') // 'backup' | 'restore'
  const [showRestoreWizard, setShowRestoreWizard] = useState(false)
  // When a snapshot card is clicked we open the wizard pre-populated with it.
  const [restoreSnapshot, setRestoreSnapshot] = useState(null)

  // On mount: fire status + jobs + gdrive checks in PARALLEL for fastest paint.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const statusPromise = getStatus()
        const jobsPromise = getJobs().catch(() => null)        // may 401 before config
        const gdrivePromise = getGdriveStatus().catch(() => null)

        const statusRes = await statusPromise
        if (cancelled) return
        const cfg = !!statusRes?.data?.config_exists
        setConfigExists(cfg)
        setLoading(false)

        const [jobsRes, gdriveRes] = await Promise.all([jobsPromise, gdrivePromise])
        if (cancelled) return
        if (cfg && jobsRes?.data) setJobs(jobsRes.data)
        if (gdriveRes?.data) setGdriveStatus({ ...gdriveRes.data, checking: false })
        else setGdriveStatus({ connected: false, checking: false })
      } catch (e) {
        console.error('Initial load failed:', e)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const checkGdriveStatus = async () => {
    try {
      const response = await getGdriveStatus()
      setGdriveStatus({ ...response.data, checking: false })
    } catch (error) {
      setGdriveStatus({ connected: false, checking: false, error: 'Failed to check' })
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect Google Drive? You will need to reconnect to run backups.')) return
    try {
      await disconnectGdrive()
      setGdriveStatus({ connected: false, checking: false })
      // Refresh config status
      await checkConfig()
    } catch (error) {
      alert('Failed to disconnect: ' + error.message)
    }
  }

  const handleReconnect = () => {
    setShowConfig(true)
  }

  // Refs avoid stale closures inside the SSE handler.
  const fetchingRef = useRef(false)
  const debounceTimerRef = useRef(null)

  const fetchJobs = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const response = await getJobs()
      setJobs(response.data)
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      fetchingRef.current = false
    }
  }, [])

  // Debounced refetch: collapses bursts of job_updated SSE events into a single call.
  const scheduleFetchJobs = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      fetchJobs()
    }, 200)
  }, [fetchJobs])

  useEffect(() => {
    if (!configExists) return

    // Initial paint already loaded jobs in the mount effect; SSE keeps them fresh.
    const eventSource = new EventSource('/api/events')

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.event === 'job_updated') {
        scheduleFetchJobs()
        // Clear progress when job completes
        if (data.data?.job_id) {
          setJobProgress(prev => {
            if (!(data.data.job_id in prev)) return prev
            const newProgress = { ...prev }
            delete newProgress[data.data.job_id]
            return newProgress
          })
        }
      } else if (data.event === 'job_progress') {
        setJobProgress(prev => ({
          ...prev,
          [data.data.job_id]: {
            stage: data.data.stage,
            message: data.data.message,
            percent: data.data.percent
          }
        }))
      }
    }

    eventSource.onerror = () => {
      eventSource.close()
    }

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      eventSource.close()
    }
  }, [configExists, scheduleFetchJobs])

  const checkConfig = async () => {
    try {
      const response = await getStatus()
      setConfigExists(response.data.config_exists)
    } catch (error) {
      console.error('Failed to check config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateJob = () => {
    setEditingJob(null)
    setShowJobDialog(true)
  }

  const handleEditJob = (job) => {
    setEditingJob(job)
    setShowJobDialog(true)
  }

  const handleSaveJob = async (jobData) => {
    try {
      if (editingJob) {
        await updateJob(editingJob.id, jobData)
      } else {
        await createJob(jobData)
      }
      setShowJobDialog(false)
      setEditingJob(null)
      fetchJobs()
    } catch (error) {
      console.error('Failed to save job:', error)
      alert('Failed to save job: ' + error.message)
    }
  }

  const handleDeleteJob = async (jobId) => {
    if (!window.confirm('Are you sure you want to delete this job?')) return

    try {
      const response = await deleteJob(jobId)
      if (response.status === 200) {
        // Remove from local state immediately
        setJobs(prev => prev.filter(j => j.id !== jobId))
      }
    } catch (error) {
      console.error('Failed to delete job:', error)
      alert('Failed to delete job: ' + (error.response?.data?.detail || error.message))
      fetchJobs()
    }
  }

  const handleRunJob = async (jobId) => {
    try {
      // Update local state immediately
      setJobs(prev => prev.map(j => 
        j.id === jobId ? {...j, status: 'running'} : j
      ))
      await runJobNow(jobId)
    } catch (error) {
      console.error('Failed to run job:', error)
      alert('Failed to run job: ' + (error.response?.data?.detail || error.message))
      fetchJobs()
    }
  }

  const handleStopJob = async (jobId) => {
    try {
      await stopJob(jobId)
      fetchJobs()
    } catch (error) {
      console.error('Failed to stop job:', error)
      alert('Failed to stop job: ' + error.message)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Initial setup: no rclone config yet → jump straight into Connections.
  if (!configExists) {
    return (
      <ConnectionsManager
        onClose={() => {
          checkConfig()
          checkGdriveStatus()
        }}
      />
    )
  }

  // Settings button → open Connections as a full-page view.
  if (showConfig) {
    return (
      <ConnectionsManager
        onClose={() => {
          checkConfig()
          checkGdriveStatus()
          setShowConfig(false)
        }}
      />
    )
  }

  // Open the wizard with a specific snapshot pre-selected.
  const openRestoreFor = (snap) => {
    setRestoreSnapshot(snap)
    setShowRestoreWizard(true)
  }
  const closeRestoreWizard = () => {
    setShowRestoreWizard(false)
    setRestoreSnapshot(null)
  }

  // Floating-action handler depends on the active tab.
  const fabAction = activeTab === 'backup' ? handleCreateJob : () => openRestoreFor(null)
  const fabLabel  = activeTab === 'backup' ? 'New Backup Job' : 'Open Restore Wizard'

  return (
    <div className="min-h-screen bg-background">
      {/* Slim top bar (HA-style): title left, actions right. */}
      <header className="px-6 py-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className="h-7 w-7 flex-shrink-0">
            <rect width="64" height="64" rx="14" fill="hsl(var(--primary))"/>
            <path d="M14 24 C14 20 18 17 22 17 L36 17 L36 13 L50 22 L36 31 L36 27 L22 27 C20 27 19 26 19 24 Z" fill="white"/>
            <path d="M50 40 C50 44 46 47 42 47 L28 47 L28 51 L14 42 L28 33 L28 37 L42 37 C44 37 45 38 45 40 Z" fill="white" opacity="0.85"/>
          </svg>
          <h1 className="text-lg font-medium">Backups</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Google Drive pill (compact) */}
          <button
            onClick={gdriveStatus.connected ? handleDisconnect : handleReconnect}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs hover:bg-muted transition-colors"
            title={gdriveStatus.connected ? 'Disconnect Google Drive' : 'Connect Google Drive'}
          >
            {gdriveStatus.checking ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : gdriveStatus.connected ? (
              <Cloud className="h-3.5 w-3.5 text-primary" />
            ) : (
              <CloudOff className="h-3.5 w-3.5 text-destructive" />
            )}
            <span className={gdriveStatus.connected ? 'text-foreground' : 'text-destructive'}>
              {gdriveStatus.checking ? 'Checking…' : gdriveStatus.connected ? 'Drive' : 'Drive offline'}
            </span>
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchJobs}
            className="h-8 px-2 flex items-center gap-1.5"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConfig(true)}
            className="h-8 px-2 flex items-center gap-1.5"
            title="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="container mx-auto px-6">
          <div className="flex gap-0">
            <button
              onClick={() => setActiveTab('backup')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                ${activeTab === 'backup'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <HardDrive className="h-4 w-4" />
              Backup
              {jobs.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-normal
                  ${activeTab === 'backup' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {jobs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('restore')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                ${activeTab === 'restore'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </button>
          </div>
        </div>
      </div>

      {/* Body: sidebar + content (HA "Backup Statistics" layout). */}
      <div className="container mx-auto px-6 py-8 flex flex-col lg:flex-row gap-8">
        {activeTab === 'backup' && (
          <BackupStatistics jobs={jobs} gdriveStatus={gdriveStatus} />
        )}

        <main className="flex-1 min-w-0">
          {/* ── Backup tab ── */}
          {activeTab === 'backup' && (
            jobs.length === 0 ? (
              <div className="text-center py-16 rounded-lg border border-dashed border-border">
                <Database className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No backup jobs yet</h3>
                <p className="text-muted-foreground mb-6">
                  Create your first backup job to get started
                </p>
                <Button onClick={handleCreateJob} className="flex items-center gap-2 mx-auto">
                  <Plus className="h-4 w-4" />
                  Create First Job
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    progress={jobProgress[job.id]}
                    onRun={handleRunJob}
                    onStop={handleStopJob}
                    onEdit={handleEditJob}
                    onDelete={handleDeleteJob}
                  />
                ))}
              </div>
            )
          )}

          {/* ── Restore tab ── */}
          {activeTab === 'restore' && (
            <RestoreSnapshots onRestore={openRestoreFor} />
          )}
        </main>
      </div>

      {/* Floating Action Button — mirrors the blue "+" in the HA add-on. */}
      <button
        onClick={fabAction}
        title={fabLabel}
        aria-label={fabLabel}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:brightness-110 active:scale-95 transition flex items-center justify-center z-40"
      >
        <Plus className="h-6 w-6" />
      </button>

      {showJobDialog && (
        <JobDialog
          job={editingJob}
          onSave={handleSaveJob}
          onClose={() => {
            setShowJobDialog(false)
            setEditingJob(null)
          }}
          onManageConnections={() => {
            // Allow jumping into Connections from inside the job form.
            setShowJobDialog(false)
            setEditingJob(null)
            setShowConfig(true)
          }}
        />
      )}

      {showRestoreWizard && (
        <RestoreWizard
          initialSnapshot={restoreSnapshot}
          onClose={closeRestoreWizard}
        />
      )}
    </div>
  )
}

export default App
