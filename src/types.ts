/**
 * Wire types shared by the host service, the /dsh-updater web route, and the
 * browser tab. Keep this file dependency-free: the client bundle imports it as
 * plain type-only surface.
 * @module @dsh-ext/dsh-updater/types
 */

/** What the service is doing right now. */
export type UpdaterPhase = 'idle' | 'checking' | 'updating'

/** The latest check outcome. */
export type UpdaterStatus = 'unknown' | 'up-to-date' | 'update-available' | 'updated' | 'error'

/** A stable, JSON-friendly snapshot of the updater. */
export interface UpdaterSnapshot {
  phase: UpdaterPhase
  status: UpdaterStatus
  /** True when the remote commit differs from the local one (or no local checkout exists). */
  updateAvailable: boolean
  /** True after an update has changed the checkout: the running harness must restart. */
  restartRequired: boolean
  repoUrl: string
  branch: string
  targetDir: string
  localCommit: string
  remoteCommit: string
  localShort: string
  remoteShort: string
  lastCheckedAt: string
  updatedAt: string
  error: string
}

/** Result returned by POST /dsh-updater/check and /update. */
export interface UpdateResult {
  message: string
  commitChanged: boolean
  snapshot: UpdaterSnapshot
}
