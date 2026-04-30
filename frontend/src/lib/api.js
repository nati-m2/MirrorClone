import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export const getStatus = () => api.get('/status')
export const getRemotes = () => api.get('/config/remotes')
export const getRemotesDetailed = () => api.get('/config/remotes/detailed')
export const getProviders = () => api.get('/providers')
export const createRemote = (payload) => api.post('/config/remotes', payload)
export const deleteRemote = (name) => api.delete(`/config/remotes/${encodeURIComponent(name)}`)
export const uploadConfig = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post('/config/upload', formData)
}
export const downloadConfig = () => api.get('/config/download')
export const testRemote = (remoteName) => api.post(`/config/test/${remoteName}`)

export const getJobs = () => api.get('/jobs')
export const getJob = (jobId) => api.get(`/jobs/${jobId}`)
export const createJob = (job) => api.post('/jobs', job)
export const updateJob = (jobId, job) => api.put(`/jobs/${jobId}`, job)
export const deleteJob = (jobId) => api.delete(`/jobs/${jobId}`)
export const runJobNow = (jobId) => api.post(`/jobs/${jobId}/run`)
export const stopJob = (jobId) => api.post(`/jobs/${jobId}/stop`)
export const resetJobStatus = (jobId) => api.post(`/jobs/${jobId}/reset`)

export const getLogs = (jobId, limit = 100) => 
  api.get('/logs', { params: { job_id: jobId, limit } })

export const backupConfig = () => api.post('/backup/config')
export const listBackups = () => api.get('/backup/list')
export const restoreBackup = (timestamp) => api.post(`/backup/restore/${timestamp}`)

export const testNotifications = () => api.post('/test/notifications')

export const startGoogleDriveAuth = (remoteName = 'gdrive') => 
  api.post('/auth/google-drive/start', null, { params: { remote_name: remoteName } })

export const exchangeGoogleDriveCode = (remoteName, code) => 
  api.post('/auth/google-drive/exchange-code', null, { params: { remote_name: remoteName, code } })

export const completeGoogleDriveAuth = (remoteName, token) => 
  api.post('/auth/google-drive/complete', null, { params: { remote_name: remoteName, token } })

export const quickSetupGoogleDrive = (remoteName) => {
  return api.post('/auth/google-drive/quick-setup', null, {
    params: { remote_name: remoteName }
  })
}

export const browseFiles = (path = '/data') => {
  return api.get('/browse', { params: { path } })
}

export const getGdriveStatus = () => api.get('/gdrive/status')
export const disconnectGdrive = () => api.delete('/gdrive/disconnect')

export const listRestoreBackups = (refresh = false) =>
  api.get('/restore/backups', { params: refresh ? { refresh: true } : {} })
export const browseBackup = (backupPath, subPath = '') =>
  api.get('/restore/browse', { params: { backup_path: backupPath, sub_path: subPath } })
export const executeRestore = (payload) => api.post('/restore/execute', payload)
export const listRestoreDestinations = () => api.get('/restore/destinations')

export default api
