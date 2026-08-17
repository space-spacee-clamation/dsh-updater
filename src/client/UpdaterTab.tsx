/**
 * Harness update tab rendered inside the Plugins settings section. The tab has
 * one job: show the host updater snapshot, offer "check now" and "update now",
 * and keep a restart banner visible after a successful update until the user
 * restarts the harness.
 */

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import type { UpdaterSnapshot, UpdateResult } from '../types.ts'
import type { LocaleKey } from './locales.ts'

export interface UpdaterTabProps {
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
  root: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 },
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  desc: { margin: 0, opacity: 0.72, fontSize: 13, lineHeight: 1.6 },
  card: {
    display: 'flex', flexDirection: 'column', gap: 10, padding: 14,
    border: '1px solid var(--dsw-alias-border, #334155)', borderRadius: 12,
    background: 'var(--dsw-alias-surface, transparent)',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  statusText: { fontSize: 14, fontWeight: 600 },
  field: { display: 'grid', gridTemplateColumns: 'minmax(96px, 120px) 1fr', gap: 6, fontSize: 12 },
  label: { opacity: 0.62 },
  value: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', overflowWrap: 'anywhere' },
  error: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-danger, #dc2626)', whiteSpace: 'pre-wrap' },
  banner: {
    padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 1.6,
    border: '1px solid var(--dsw-alias-accent, #3b82f6)',
    background: 'var(--dsw-alias-accent-soft, rgba(59, 130, 246, 0.12))',
  },
  actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  button: {
    height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #334155)',
    background: 'var(--dsw-alias-surface, transparent)', color: 'inherit', fontSize: 13, cursor: 'pointer',
  },
  buttonPrimary: {
    border: '1px solid var(--dsw-alias-accent, #3b82f6)',
    background: 'var(--dsw-alias-accent, #3b82f6)',
    color: 'var(--dsw-alias-accent-contrast, white)',
  },
  disabled: { opacity: 0.55, cursor: 'not-allowed' },
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

export function UpdaterTab({ t }: UpdaterTabProps): ReactElement {
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
  const actionLabel = snapshot?.phase === 'updating'
    ? t('updatingAction')
    : snapshot?.phase === 'checking'
      ? t('checkingAction')
      : t('update')

  return (
    <div style={styles.root}>
      <h2 style={styles.title}>{t('title')}</h2>
      <p style={styles.desc}>{t('desc')}</p>

      <div style={styles.card}>
        <div style={styles.statusRow}>
          <span style={{ ...styles.dot, background: statusDotColor(status) }} />
          <span style={styles.statusText}>{statusText(status, t)}</span>
        </div>

        {snapshot?.restartRequired === true && (
          <div style={styles.banner}>{t('restartBanner')}</div>
        )}

        <div style={styles.field}>
          <span style={styles.label}>{t('repo')}</span>
          <span style={styles.value}>{snapshot?.repoUrl ?? '—'}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>{t('branch')}</span>
          <span style={styles.value}>{snapshot?.branch || '—'}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>{t('target')}</span>
          <span style={styles.value}>{snapshot?.targetDir || '—'}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>{t('local')}</span>
          <span style={styles.value}>{snapshot?.localShort || snapshot?.localCommit || '—'}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>{t('remote')}</span>
          <span style={styles.value}>{snapshot?.remoteShort || snapshot?.remoteCommit || '—'}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>{t('lastChecked')}</span>
          <span style={styles.value}>{formatTime(snapshot?.lastCheckedAt ?? '')}</span>
        </div>
        {snapshot?.updatedAt !== '' && (
          <div style={styles.field}>
            <span style={styles.label}>{t('updatedAt')}</span>
            <span style={styles.value}>{formatTime(snapshot?.updatedAt ?? '')}</span>
          </div>
        )}

        {error !== '' && <pre style={styles.error}>{error}</pre>}
        {message !== '' && <p style={styles.desc}>{message}</p>}

        <div style={styles.actions}>
          <button
            type="button"
            style={{ ...styles.button, ...(busy ? styles.disabled : {}) }}
            disabled={busy}
            onClick={check}
          >
            {snapshot?.phase === 'checking' ? t('checkingAction') : t('check')}
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
    </div>
  )
}
