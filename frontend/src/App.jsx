import React, { useState, useEffect } from 'react'
import { Plus, RefreshCw, Settings, Database, Cloud, CloudOff } from 'lucide-react'
import StatusBar from './components/StatusBar'
import JobCard from './components/JobCard'
import JobDialog from './components/JobDialog'
import ConfigSetup from './components/ConfigSetup'
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

  useEffect(() => {
    checkConfig()
  }, [])
  
  // Check Google Drive status in background (non-blocking)
  useEffect(() => {
    if (configExists && !loading) {
      checkGdriveStatus()
    }
  }, [configExists, loading])

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

  useEffect(() => {
    if (configExists) {
      fetchJobs()
      
      // Connect to SSE for real-time updates
      const eventSource = new EventSource('/api/events')
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.event === 'job_updated') {
          fetchJobs()
          // Clear progress when job completes
          if (data.data?.job_id) {
            setJobProgress(prev => {
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
        // Fallback to polling if SSE fails
        eventSource.close()
      }
      
      return () => eventSource.close()
    }
  }, [configExists])

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

  const [fetching, setFetching] = React.useState(false)
  
  const fetchJobs = async () => {
    if (fetching) return // Prevent concurrent requests
    setFetching(true)
    try {
      const response = await getJobs()
      setJobs(response.data)
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setFetching(false)
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

  if (!configExists) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center gap-3">
            <Database className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">MirrorClone</h1>
              <p className="text-sm text-muted-foreground">
                Reliable Rclone Mirror Wrapper
              </p>
            </div>
          </div>
        </div>
        <ConfigSetup onConfigured={checkConfig} />
      </div>
    )
  }

  if (showConfig) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center gap-3">
            <Database className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">MirrorClone</h1>
              <p className="text-sm text-muted-foreground">
                Reliable Rclone Mirror Wrapper
              </p>
            </div>
          </div>
        </div>
        <ConfigSetup onConfigured={() => {
          checkConfig()
          checkGdriveStatus()
          setShowConfig(false)
        }} />
        <div className="text-center mt-4">
          <Button variant="outline" onClick={() => setShowConfig(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">MirrorClone</h1>
              <p className="text-sm text-muted-foreground">
                Reliable Rclone Mirror Wrapper
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Google Drive Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted">
              {gdriveStatus.checking ? (
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : gdriveStatus.connected ? (
                <>
                  <Cloud className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-500">Connected</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDisconnect}
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <>
                  <CloudOff className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">Disconnected</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReconnect}
                    className="h-6 px-2 text-xs text-primary"
                  >
                    Connect
                  </Button>
                </>
              )}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={fetchJobs}
              className="flex items-center gap-1"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={handleCreateJob}
              className="flex items-center gap-1"
            >
              <Plus className="h-4 w-4" />
              New Job
            </Button>
          </div>
        </div>
      </div>

      <StatusBar />

      <div className="container mx-auto px-6 py-8">
        {jobs.length === 0 ? (
          <div className="text-center py-12">
            <Database className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
        )}
      </div>

      {showJobDialog && (
        <JobDialog
          job={editingJob}
          onSave={handleSaveJob}
          onClose={() => {
            setShowJobDialog(false)
            setEditingJob(null)
          }}
        />
      )}
    </div>
  )
}

export default App
