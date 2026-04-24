import React, { useState } from 'react'
import { Upload, Download, CheckCircle, Chrome, Loader, ExternalLink, Copy, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card'
import Button from './ui/Button'
import { uploadConfig, downloadConfig, startGoogleDriveAuth, exchangeGoogleDriveCode } from '../lib/api'

const ConfigSetup = ({ onConfigured }) => {
  const [uploading, setUploading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [submittingCode, setSubmittingCode] = useState(false)
  const [message, setMessage] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [remoteName, setRemoteName] = useState('gdrive')
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    setMessage('')

    try {
      await uploadConfig(file)
      setMessage('Configuration uploaded successfully!')
      setTimeout(() => {
        onConfigured()
      }, 1500)
    } catch (error) {
      setMessage('Failed to upload configuration: ' + error.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async () => {
    try {
      const response = await downloadConfig()
      const blob = new Blob([response.data.config], { type: 'text/plain' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'rclone.conf'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      setMessage('Failed to download configuration')
    }
  }

  const handleGoogleDriveConnect = async () => {
    setConnecting(true)
    setMessage('')
    setShowCodeInput(false)
    setAuthCode('')

    try {
      const response = await startGoogleDriveAuth('gdrive')
      
      if (response.data.auth_url) {
        setAuthUrl(response.data.auth_url)
        setRemoteName(response.data.remote_name || 'gdrive')
        setShowCodeInput(true)
        setConnecting(false)
        
        // Open the auth URL in a new tab
        window.open(response.data.auth_url, '_blank')
      } else {
        setMessage('Failed to start Google Drive authentication')
        setConnecting(false)
      }
    } catch (error) {
      setMessage('Failed to connect to Google Drive: ' + (error.response?.data?.detail || error.message))
      setConnecting(false)
    }
  }

  const handleSubmitCode = async () => {
    if (!authCode.trim()) {
      setMessage('Please enter the authorization code')
      return
    }

    setSubmittingCode(true)
    setMessage('')

    try {
      const response = await exchangeGoogleDriveCode(remoteName, authCode.trim())
      setMessage('Successfully connected to Google Drive!')
      setShowCodeInput(false)
      setAuthCode('')
      setAuthUrl('')
      
      setTimeout(() => {
        onConfigured()
      }, 1500)
    } catch (error) {
      setMessage('Failed to connect: ' + (error.response?.data?.detail || error.message))
    } finally {
      setSubmittingCode(false)
    }
  }

  const copyAuthUrl = () => {
    navigator.clipboard.writeText(authUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const cancelAuth = () => {
    setShowCodeInput(false)
    setAuthCode('')
    setAuthUrl('')
    setMessage('')
  }

  return (
    <div className="max-w-2xl mx-auto mt-12">
      <Card>
        <CardHeader>
          <CardTitle>Rclone Configuration</CardTitle>
          <CardDescription>
            Upload your rclone.conf file to get started with backups
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showCodeInput ? (
            <div className="border-2 border-dashed border-primary/20 rounded-lg p-8 text-center bg-primary/5">
              <Chrome className="h-12 w-12 mx-auto text-primary mb-4" />
              <p className="text-sm font-medium mb-2">
                Connect to Google Drive
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Quick setup - authorize with your Google account
              </p>
              <Button 
                onClick={handleGoogleDriveConnect} 
                disabled={connecting}
                className="flex items-center gap-2"
              >
                {connecting ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Chrome className="h-4 w-4" />
                    Connect Google Drive
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="border-2 border-primary/30 rounded-lg p-6 bg-primary/5">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Chrome className="h-5 w-5" />
                Complete Authorization
              </h3>
              
              <div className="space-y-4">
                <div className="text-sm">
                  <p className="font-medium mb-2">Step 1: Authorize in Google</p>
                  <p className="text-muted-foreground mb-3">
                    A new tab should have opened. If not, click the button below:
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(authUrl, '_blank')}
                      className="flex items-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open Authorization Page
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyAuthUrl}
                      className="flex items-center gap-2"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copied!' : 'Copy URL'}
                    </Button>
                  </div>
                </div>

                <div className="text-sm">
                  <p className="font-medium mb-2">Step 2: Copy the redirect URL</p>
                  <p className="text-muted-foreground mb-3">
                    After authorizing, the page will try to redirect to localhost and fail - that's OK!
                    <br />
                    <strong>Copy the full URL from the address bar</strong> (starts with http://127.0.0.1...)
                  </p>
                  <input
                    type="text"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="Paste the full URL here (http://127.0.0.1:53682/?code=...)"
                    className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitCode()}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSubmitCode}
                    disabled={submittingCode || !authCode.trim()}
                    className="flex-1 flex items-center justify-center gap-2"
                  >
                    {submittingCode ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Complete Connection
                      </>
                    )}
                  </Button>
                  <Button variant="ghost" onClick={cancelAuth}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or upload existing config
              </span>
            </div>
          </div>

          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              Upload your existing rclone.conf file
            </p>
            <label htmlFor="config-upload">
              <Button variant="outline" disabled={uploading} asChild>
                <span>
                  {uploading ? 'Uploading...' : 'Choose File'}
                </span>
              </Button>
              <input
                id="config-upload"
                type="file"
                accept=".conf"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {message && (
            <div className={`p-4 rounded-md ${
              message.includes('success') 
                ? 'bg-green-50 text-green-700 border border-green-200' 
                : message.includes('To connect')
                ? 'bg-blue-50 text-blue-900 border border-blue-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {message.includes('success') && (
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4" />
                  <span className="font-medium">Success!</span>
                </div>
              )}
              <pre className="text-xs whitespace-pre-wrap font-mono">{message}</pre>
            </div>
          )}

          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium mb-2">Need help?</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Configure rclone on your system first, then upload the config file here.
            </p>
            <code className="text-xs bg-muted p-2 rounded block">
              rclone config
            </code>
          </div>

          <Button
            variant="ghost"
            onClick={handleDownload}
            className="w-full flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Download Current Config
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default ConfigSetup
