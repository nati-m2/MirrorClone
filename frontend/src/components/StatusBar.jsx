import React, { useEffect, useState } from 'react'
import { Server, Database, Activity, CheckCircle, XCircle } from 'lucide-react'
import { getStatus } from '../lib/api'
import Badge from './ui/Badge'

const StatusBar = () => {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchStatus = async () => {
    try {
      const response = await getStatus()
      setStatus(response.data)
    } catch (error) {
      console.error('Failed to fetch status:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-card border-b border-border px-6 py-3">
        <div className="flex items-center gap-4">
          <Activity className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border-b border-border px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            {status?.rclone_installed ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm font-medium">Rclone</span>
            {status?.rclone_version && (
              <span className="text-xs text-muted-foreground">
                {status.rclone_version.split(' ')[1]}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {status?.config_exists ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-yellow-500" />
            )}
            <span className="text-sm font-medium">Configuration</span>
          </div>

          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {status?.total_jobs || 0} Jobs
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {status?.running_jobs || 0} Running
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={status?.config_exists ? 'success' : 'warning'}>
            {status?.config_exists ? 'Ready' : 'Setup Required'}
          </Badge>
        </div>
      </div>
    </div>
  )
}

export default StatusBar
