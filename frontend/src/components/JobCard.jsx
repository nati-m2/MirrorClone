import React from 'react'
import { Play, Square, Trash2, Edit, Clock, CheckCircle, XCircle, Loader } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import Button from './ui/Button'
import Badge from './ui/Badge'
import { formatRelativeTime } from '../lib/utils'
import cronstrue from 'cronstrue'

const JobCard = ({ job, progress, onRun, onStop, onEdit, onDelete }) => {
  const getStatusBadge = () => {
    switch (job.status) {
      case 'running':
        return <Badge variant="default" className="flex items-center gap-1">
          <Loader className="h-3 w-3 animate-spin" />
          Running
        </Badge>
      case 'success':
        return <Badge variant="success" className="flex items-center gap-1">
          <CheckCircle className="h-3 w-3" />
          Success
        </Badge>
      case 'failed':
        return <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      default:
        return <Badge variant="secondary">Idle</Badge>
    }
  }

  const getCronDescription = () => {
    try {
      return cronstrue.toString(job.cron_expression)
    } catch {
      return job.cron_expression
    }
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg flex items-center gap-2">
              {job.name}
              {!job.enabled && <Badge variant="outline">Disabled</Badge>}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1 break-all">
              {job.source_path} → {job.destination}
            </p>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Progress indicator */}
          {progress && (
            <div className="bg-primary/10 rounded-lg p-3 border border-primary/20">
              <div className="flex items-center gap-2 text-sm">
                {progress.stage === 'completed' ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : progress.stage === 'failed' ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <Loader className="h-4 w-4 animate-spin text-primary" />
                )}
                <span className={`font-medium ${
                  progress.stage === 'completed' ? 'text-green-500' : 
                  progress.stage === 'failed' ? 'text-red-500' : 'text-primary'
                }`}>
                  {progress.message}
                </span>
              </div>
              {progress.percent != null && progress.stage === 'uploading' && (
                <div className="mt-2">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{getCronDescription()}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Last Run:</span>
              <p className="font-medium">
                {formatRelativeTime(job.last_run)}
                {job.last_duration != null && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({job.last_duration < 60 ? `${job.last_duration}s` : `${Math.floor(job.last_duration / 60)}m ${job.last_duration % 60}s`})
                  </span>
                )}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Success:</span>
              <p className="font-medium">{formatRelativeTime(job.last_success)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Next Run:</span>
              <p className="font-medium">{formatRelativeTime(job.next_run)}</p>
            </div>
            {job.last_error && (
              <div className="col-span-2">
                <span className="text-destructive text-xs">Error:</span>
                <p className="text-xs text-destructive font-mono mt-1 truncate">
                  {job.last_error}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t">
            {job.status === 'running' ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onStop(job.id)}
                className="flex items-center gap-1"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onRun(job.id)}
                disabled={!job.enabled}
                className="flex items-center gap-1"
              >
                <Play className="h-4 w-4" />
                Run Now
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(job)}
              className="flex items-center gap-1"
            >
              <Edit className="h-4 w-4" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(job.id)}
              className="flex items-center gap-1 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default JobCard
