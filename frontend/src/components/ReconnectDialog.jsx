import React from 'react'
import { X, AlertTriangle, Settings as SettingsIcon } from 'lucide-react'
import Button from './ui/Button'
import { GoogleDriveStep } from './AddConnectionDialog'

/**
 * Modal shown when a connection is offline and the user clicks "Reconnect".
 *
 * For OAuth-based backends (currently Google Drive) we re-run the OAuth
 * exchange, which overwrites the stale token for the same remote name in
 * `rclone.conf`. `exchange_code_for_token` in auth_manager.py already
 * handles replacing an existing `[name]` section.
 *
 * For non-OAuth backends (S3, SFTP, ...) rclone caches plain credentials,
 * so there's nothing to "reconnect" to — the credentials are either correct
 * or not. We direct the user to the Connections page to update them.
 */
const ReconnectDialog = ({ remoteName, remoteType, onClose, onDone, onOpenConnections }) => {
  const isOAuth = remoteType === 'drive'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-border rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-semibold">
            Reconnect <span className="font-mono text-primary">{remoteName}</span>
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isOAuth ? (
            <GoogleDriveStep
              initialName={remoteName}
              lockName
              onCreated={() => { onDone?.(); onClose(); }}
              onCancel={onClose}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-amber-300">Manual reconfiguration required</div>
                  <p className="text-muted-foreground text-xs mt-1">
                    This connection uses <span className="font-mono">{remoteType || 'unknown'}</span> which stores
                    credentials rather than a refresh token. To fix it, update or re-enter
                    the credentials from the Connections screen.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                {onOpenConnections && (
                  <Button onClick={() => { onClose(); onOpenConnections(); }} className="gap-2">
                    <SettingsIcon className="h-4 w-4" />
                    Open Connections
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ReconnectDialog
