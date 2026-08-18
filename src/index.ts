/**
 * @dsh-ext/dsh-updater — root plugin half.
 *
 * When the plugin takes effect (`apply` runs), it starts the auto-check
 * effect: resolve the upstream deepseek-harness remote head, compare it with
 * the local checkout, and keep the result in a small JSON snapshot. The web
 * half (`./web`) waits on this service plus `webServer` and owns the
 * /dsh-updater routes; the browser half contributes the "Harness 更新" tab to
 * the Plugins settings page. An update only changes the on-disk checkout —
 * the running harness process is never hot-swapped — so the UI asks the user
 * to restart after the new content is cloned/fetched.
 *
 * @module @dsh-ext/dsh-updater
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  cloneRemote,
  defaultGitRunner,
  fetchExisting,
  isGitRepo,
  localHead,
  remoteHead,
  resolveRemoteBranch,
  resolveTargetDir,
  type GitRunner,
} from './git.ts'
import type { UpdaterSnapshot, UpdateResult } from './types.ts'

export type * from './types.ts'
export type { GitRunner } from './git.ts'
export { normalizeRepoUrl, parseRemoteObjectId, parseSymrefHead } from './git.ts'

/** DeepSeek Harness upstream repository. */
export const DEFAULT_REPO_URL = 'https://github.com/deepseek-ai/deepseek-harness.git'
/** Default web API prefix; the browser half calls the same prefix. */
export const DEFAULT_API_PREFIX = '/dsh-updater'
/** Default periodic re-check interval (10 minutes). */
export const DEFAULT_CHECK_INTERVAL_MS = 10 * 60_000

export const name = 'dsh-updater'

/** Deployment configuration validated by the Loader. */
export interface Config {
  /** Upstream git repository URL. */
  repoUrl: string
  /** Branch to track; empty means "follow the remote default branch". */
  branch: string
  /**
   * Local checkout directory. Empty means auto-discovery: process.cwd() or an
   * ancestor whose origin matches repoUrl, then <cwd>/vendor/deepseek-harness.
   * Relative values resolve against process.cwd().
   */
  targetDir: string
  /** Run one check immediately after the plugin takes effect. */
  checkOnLoad: boolean
  /** Periodic re-check interval in milliseconds; 0 disables the timer. */
  checkIntervalMs: number
  /** Overwrite a dirty worktree during update. */
  force: boolean
  /** Web API prefix shared with the web route carrier. */
  apiPrefix: string
}

export const Config: z<Config> = z.object({
  repoUrl: z.string().default(DEFAULT_REPO_URL),
  branch: z.string().default(''),
  targetDir: z.string().default(''),
  checkOnLoad: z.boolean().default(true),
  checkIntervalMs: z.number().min(0).default(DEFAULT_CHECK_INTERVAL_MS),
  force: z.boolean().default(false),
  apiPrefix: z.string().default(DEFAULT_API_PREFIX),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshUpdater: DshUpdaterService
  }
}

function shortCommit(commit: string): string {
  return commit === '' ? '' : commit.slice(0, 8)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Cordis service wrapping the updater core. */
export class DshUpdaterService extends Service {
  readonly apiPrefix: string
  readonly repoUrl: string
  readonly branch: string
  readonly targetDir: string
  readonly checkIntervalMs: number
  readonly force: boolean

  private readonly runGit: GitRunner
  private snapshot: UpdaterSnapshot
  private busy: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config, runGit: GitRunner = defaultGitRunner) {
    super(ctx, 'dshUpdater')
    this.apiPrefix = config.apiPrefix
    this.repoUrl = config.repoUrl
    this.branch = config.branch.trim()
    this.targetDir = config.targetDir.trim()
    this.checkIntervalMs = config.checkIntervalMs
    this.force = config.force
    this.runGit = runGit
    this.snapshot = {
      phase: 'idle',
      status: 'unknown',
      updateAvailable: false,
      restartRequired: false,
      repoUrl: this.repoUrl,
      branch: this.branch,
      targetDir: this.targetDir,
      localCommit: '',
      remoteCommit: '',
      localShort: '',
      remoteShort: '',
      lastCheckedAt: '',
      updatedAt: '',
      error: '',
    }

    // The "effect-time auto check" requirement: Cordis owns this timer through
    // ctx.effect, so hot reload/disposal cleans it up with the plugin fiber.
    ctx.effect(() => {
      if (this.checkIntervalMs <= 0) return () => {}
      const timer = setInterval(() => {
        void this.check().catch((error: unknown) => {
          ctx.logger('dsh-updater').warn('periodic update check failed: %s', messageOf(error))
        })
      }, this.checkIntervalMs)
      return () => clearInterval(timer)
    }, 'dsh-updater: periodic remote check')

    if (config.checkOnLoad) {
      // Defer one microtask so the service is fully registered before the
      // first network check starts.
      void Promise.resolve().then(() => this.check()).catch((error: unknown) => {
        ctx.logger('dsh-updater').warn('initial update check failed: %s', messageOf(error))
      })
    }
  }

  /** Current JSON snapshot (safe to serve over the web route). */
  status(): UpdaterSnapshot {
    return { ...this.snapshot }
  }

  /** Check the upstream remote and refresh the snapshot. */
  check(): Promise<UpdaterSnapshot> {
    return this.runExclusive(async () => {
      this.patch({ phase: 'checking', status: 'unknown', error: '' })
      try {
        const branch = await resolveRemoteBranch(this.repoUrl, this.branch, this.runGit)
        const targetDir = await resolveTargetDir(
          this.repoUrl,
          this.targetDir,
          process.env.DSH_UPDATER_TARGET_DIR ?? '',
          process.cwd(),
          this.runGit,
        )
        const remoteCommit = await remoteHead(this.repoUrl, branch, this.runGit)
        const localCommit = await localHead(targetDir, this.runGit)
        const foundLocal = localCommit !== undefined && localCommit !== ''
        const updateAvailable = !foundLocal || localCommit !== remoteCommit
        this.patch({
          phase: 'idle',
          status: updateAvailable ? 'update-available' : 'up-to-date',
          updateAvailable,
          repoUrl: this.repoUrl,
          branch,
          targetDir,
          localCommit: localCommit ?? '',
          remoteCommit,
          localShort: shortCommit(localCommit ?? ''),
          remoteShort: shortCommit(remoteCommit),
          lastCheckedAt: new Date().toISOString(),
          error: '',
        })
      } catch (error) {
        this.patch({ phase: 'idle', status: 'error', error: messageOf(error) })
      }
      return this.status()
    })
  }

  /** Clone or fetch-and-checkout the upstream content into the local checkout. */
  update(): Promise<UpdateResult> {
    return this.runExclusive(async () => {
      this.patch({ phase: 'updating', status: 'unknown', error: '' })
      try {
        const branch = await resolveRemoteBranch(this.repoUrl, this.branch, this.runGit)
        const targetDir = await resolveTargetDir(
          this.repoUrl,
          this.targetDir,
          process.env.DSH_UPDATER_TARGET_DIR ?? '',
          process.cwd(),
          this.runGit,
        )
        const remoteCommit = await remoteHead(this.repoUrl, branch, this.runGit)
        const existing = await isGitRepo(targetDir, this.runGit)
        const before = existing ? await localHead(targetDir, this.runGit) : undefined

        if (!existing) {
          await cloneRemote(this.repoUrl, branch, targetDir, this.runGit)
        } else {
          await fetchExisting(this.repoUrl, branch, targetDir, this.force, this.runGit)
        }

        const after = await localHead(targetDir, this.runGit) ?? remoteCommit
        const commitChanged = before !== after
        const updatedAt = commitChanged ? new Date().toISOString() : this.snapshot.updatedAt
        this.patch({
          phase: 'idle',
          status: commitChanged ? 'updated' : 'up-to-date',
          updateAvailable: false,
          restartRequired: commitChanged ? true : this.snapshot.restartRequired,
          repoUrl: this.repoUrl,
          branch,
          targetDir,
          localCommit: after,
          remoteCommit,
          localShort: shortCommit(after),
          remoteShort: shortCommit(remoteCommit),
          updatedAt,
          lastCheckedAt: new Date().toISOString(),
          error: '',
        })
        return {
          message: commitChanged
            ? existing
              ? `updated ${shortCommit(before ?? '')} -> ${shortCommit(after)}; restart the harness to load it`
              : `cloned ${shortCommit(after)}; restart the harness to load it`
            : 'already up to date',
          commitChanged,
          snapshot: this.status(),
        }
      } catch (error) {
        const message = messageOf(error)
        this.patch({ phase: 'idle', status: 'error', error: message })
        throw new Error(message)
      }
    })
  }

  /** Serialize check/update operations: no overlapping git mutations. */
  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.busy.then(task, task)
    this.busy = next.then(() => undefined, () => undefined)
    return next
  }

  private patch(partial: Partial<UpdaterSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial }
  }
}

/** Mount the service. */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(DshUpdaterService, config)
}
