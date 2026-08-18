/**
 * Harness updater preference row rendered inside the General settings section
 * (the `settings.general.item` seat). The row shows the host updater snapshot
 * in one line, offers "check now" and "update now", and keeps a restart
 * banner visible after a successful update until the user restarts the
 * harness. Commit/path details live in a collapsible `<details>` block.
 */

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import type { UpdaterSnapshot, UpdateResult } from '../types.ts'
import type { LocaleKey } from './locales.ts'

export interface UpdaterGeneralItemProps {
  t: (key: LocaleKey) => string
}

const API_PREFIX = '/dsh-updater'
const CSRF_HEADER = 'x-dsh-updater'
const POLL_INTERVAL_MS = 15_000

async function api<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' }, body: JSON.stringify(body) }
  const response = await fetch(`${API_PREFIX}${path}`, init)
  const text = await response.text()
  if (text.trim() === '') {
    throw new Error(`HTTP ${response.status} returned an empty response`)
  }
  let payload: { ok: boolean; value?: T; error?: { code: string; message: string } }
  try {
    payload = JSON.parse(text) as typeof payload
  } catch {
    throw new Error(`HTTP ${response.status} returned non-JSON: ${text.slice(0, 120)}`)
  }
  if (!payload.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
  return payload.value as T
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatTime(iso: string): string {
  if (iso === '') return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

const styles: Record<string, CSSProperties> = {
  item: {
    display: 'flex', flexDirection: 'column', gap: 8, width: '100%', padding: '12px 0',
    borderBottom: '1px solid var(--dsw-alias-border, #334155)',
  },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  rowText: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 180, flex: '1 1 240px' },
  title: { margin: 0, fontSize: 14, fontWeight: 600 },
  desc: { margin: 0, fontSize: 12, opacity: 0.66, lineHeight: 1.5 },
  statusLine: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  button: {
    height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #334155)',
    background: 'var(--dsw-alias-surface, transparent)', color: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  buttonPrimary: {
    border: '1px solid var(--dsw-alias-accent, #3b82f6)',
    background: 'var(--dsw-alias-accent, #3b82f6)',
    color: 'var(--dsw-alias-accent-contrast, white)',
  },
  disabled: { opacity: 0.55, cursor: 'not-allowed' },
  error: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-danger, #dc2626)', whiteSpace: 'pre-wrap' },
  banner: {
    padding: 10, borderRadius: 8, fontSize: 12, lineHeight: 1.6,
    border: '1px solid var(--dsw-alias-accent, #3b82f6)',
    background: 'var(--dsw-alias-accent-soft, rgba(59, 130, 246, 0.12))',
  },
  details: { fontSize: 12, opacity: 0.8 },
  summary: { cursor: 'pointer', userSelect: 'none' },
  field: { display: 'grid', gridTemplateColumns: 'minmax(96px, 120px) 1fr', gap: 6, paddingTop: 6 },
  label: { opacity: 0.62 },
  value: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', overflowWrap: 'anywhere' },
}

function statusDotColor(status: UpdaterSnapshot['status']): string {
  switch (status) {
    case 'up-to-date':
    case 'updated':
      return 'var(--dsw-alias-success, #16a34a)'
    case 'update-available':
      return 'var(--dsw-alias-accent, #3b82f6)'
    case 'error':
      return 'var(--dsw-alias-danger, #dc2626)'
    default:
      return 'var(--dsw-alias-muted, #9ca3af)'
  }
}

function statusText(status: UpdaterSnapshot['status'], t: (key: LocaleKey) => string): string {
  switch (status) {
    case 'up-to-date': return t('statusUpToDate')
    case 'update-available': return t('statusUpdateAvailable')
    case 'updated': return t('statusUpdated')
    case 'error': return t('statusError')
    default: return t('statusUnknown')
  }
}

export function UpdaterGeneralItem({ t }: UpdaterGeneralItemProps): ReactElement {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const next = await api<UpdaterSnapshot>('/status')
      setSnapshot(next)
      setError('')
    } catch (reason) {
      setError(`${t('fetchFailed')}${messageOf(reason)}`)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const run = async (action: () => Promise<UpdaterSnapshot | UpdateResult>): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const value = await action()
      if ('snapshot' in value) {
        setSnapshot(value.snapshot)
        setMessage(value.message)
      } else {
        setSnapshot(value)
      }
    } catch (reason) {
      setError(messageOf(reason))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const check = (): void => {
    if (busy) return
    void run(() => api<UpdaterSnapshot>('/check', {}))
  }

  const update = (): void => {
    if (busy || snapshot === null || !snapshot.updateAvailable) return
    if (!window.confirm(t('updateConfirm'))) return
    void run(() => api<UpdateResult>('/update', {}))
  }

  const status = snapshot?.status ?? 'unknown'
  const checking = snapshot?.phase === 'checking'
  const updating = snapshot?.phase === 'updating'
  const actionLabel = updating ? t('updatingAction') : t('update')
  const remoteLabel = snapshot?.remoteShort || snapshot?.remoteCommit

  return (
    <div style={styles.item}>
      <div style={styles.row}>
        <div style={styles.rowText}>
          <h3 style={styles.title}>{t('title')}</h3>
          <p style={styles.desc}>{t('desc')}</p>
          <div style={styles.statusLine}>
            <span style={{ ...styles.dot, background: statusDotColor(status) }} />
            <span>{checking ? t('statusChecking') : updating ? t('statusUpdating') : statusText(status, t)}</span>
            {remoteLabel !== undefined && remoteLabel !== '' && <span>{`· ${remoteLabel}`}</span>}
          </div>
        </div>
        <div style={styles.actions}>
          <button
            type="button"
            style={{ ...styles.button, ...(busy ? styles.disabled : {}) }}
            disabled={busy}
            onClick={check}
          >
            {checking ? t('checkingAction') : t('check')}
          </button>
          <button
            type="button"
            style={{
              ...styles.button,
              ...styles.buttonPrimary,
              ...(busy || !snapshot?.updateAvailable ? styles.disabled : {}),
            }}
            disabled={busy || !snapshot?.updateAvailable}
            onClick={update}
          >
            {actionLabel}
          </button>
        </div>
      </div>

      {snapshot?.restartRequired === true && (
        <div style={styles.banner}>{t('restartBanner')}</div>
      )}

      {(error !== '' || (snapshot?.error ?? '') !== '') && (
        <pre style={styles.error}>{error !== '' ? error : snapshot?.error}</pre>
      )}
      {message !== '' && <p style={styles.desc}>{message}</p>}

      {snapshot !== null && (
        <details style={styles.details}>
          <summary style={styles.summary}>{t('details')}</summary>
          <div style={styles.field}>
            <span style={styles.label}>{t('repo')}</span>
            <span style={styles.value}>{snapshot.repoUrl || '—'}</span>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>{t('branch')}</span>
            <span style={styles.value}>{snapshot.branch || '—'}</span>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>{t('target')}</span>
            <span style={styles.value}>{snapshot.targetDir || '—'}</span>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>{t('local')}</span>
            <span style={styles.value}>{snapshot.localShort || snapshot.localCommit || '—'}</span>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>{t('remote')}</span>
            <span style={styles.value}>{snapshot.remoteShort || snapshot.remoteCommit || '—'}</span>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>{t('lastChecked')}</span>
            <span style={styles.value}>{formatTime(snapshot.lastCheckedAt)}</span>
          </div>
          {snapshot.updatedAt !== '' && (
            <div style={styles.field}>
              <span style={styles.label}>{t('updatedAt')}</span>
              <span style={styles.value}>{formatTime(snapshot.updatedAt)}</span>
            </div>
          )}
        </details>
      )}
    </div>
  )
}
