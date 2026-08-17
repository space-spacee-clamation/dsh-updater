/**
 * Git operations for the harness updater. Everything goes through a
 * `GitRunner` seam so the update planner and tests never shell out directly.
 * @module @dsh-ext/dsh-updater/git
 */

import { execFile } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/**
 * Run one git command and return stdout. A non-zero exit rejects with the
 * command's stderr (or stdout when stderr is empty).
 */
export type GitRunner = (args: string[], cwd?: string) => Promise<string>

function detailOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown }
    for (const field of [record.stderr, record.stdout, record.message]) {
      if (typeof field === 'string' && field.trim() !== '') return field.trim()
    }
  }
  return ''
}

/** Real runner used by the plugin at runtime. */
export const defaultGitRunner: GitRunner = async (args, cwd) => {
  try {
    const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile('git', args, {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error !== null) {
          reject(Object.assign(error, {
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
          }))
          return
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      })
    })
    return output.stdout
  } catch (error) {
    const record = error as NodeJS.ErrnoException
    if (record.code === 'ENOENT') throw new Error('git not found on PATH; install git and restart the harness')
    throw new Error(`git ${args[0] ?? ''} failed${detailOf(error) ? `: ${detailOf(error)}` : ''}`)
  }
}

/** Normalize a repository URL so "same repo" comparisons survive `.git` and slash spelling. */
export function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase()
}

/** Parse the default-branch name from `git ls-remote --symref <url> HEAD`. */
export function parseSymrefHead(output: string): string | undefined {
  const match = /^ref:\s+refs\/heads\/([^\s]+)\s+HEAD\s*$/m.exec(output)
  return match?.[1]
}

/** Parse the object id from one `git ls-remote <url> <ref>` line. */
export function parseRemoteObjectId(output: string): string | undefined {
  const match = /^([0-9a-f]{40})\s+/m.exec(output)
  return match?.[1]
}

/** True when the directory is a git worktree. */
export async function isGitRepo(dir: string, run: GitRunner = defaultGitRunner): Promise<boolean> {
  try {
    await run(['rev-parse', '--git-dir'], dir)
    return true
  } catch {
    return false
  }
}

/** The full local HEAD commit, or `undefined` when the directory is not a repo. */
export async function localHead(dir: string, run: GitRunner = defaultGitRunner): Promise<string | undefined> {
  try {
    return (await run(['rev-parse', 'HEAD'], dir)).trim()
  } catch {
    return undefined
  }
}

/** Resolve the remote default branch when `branch` is empty. */
export async function resolveRemoteBranch(
  url: string,
  branch: string,
  run: GitRunner = defaultGitRunner,
): Promise<string> {
  if (branch.trim() !== '') return branch.trim()
  const output = await run(['ls-remote', '--symref', url, 'HEAD'])
  const detected = parseSymrefHead(output)
  if (detected === undefined) {
    throw new Error(`cannot resolve the default branch of ${url} from git ls-remote`)
  }
  return detected
}

/** The remote commit for `refs/heads/<branch>`. */
export async function remoteHead(
  url: string,
  branch: string,
  run: GitRunner = defaultGitRunner,
): Promise<string> {
  const output = await run(['ls-remote', url, `refs/heads/${branch}`])
  const objectId = parseRemoteObjectId(output)
  if (objectId === undefined) {
    throw new Error(`remote branch "${branch}" not found on ${url}`)
  }
  return objectId
}

/** True when the worktree has tracked or untracked changes. */
export async function isDirty(dir: string, run: GitRunner = defaultGitRunner): Promise<boolean> {
  return (await run(['status', '--porcelain'], dir)).trim() !== ''
}

/** The origin URL of a checkout, normalized for comparison. */
async function originUrl(dir: string, run: GitRunner): Promise<string> {
  return normalizeRepoUrl((await run(['config', '--get', 'remote.origin.url'], dir)).trim())
}

/** True when a checkout's origin URL matches the configured repository. */
async function checkoutMatchesRepo(dir: string, url: string, run: GitRunner): Promise<boolean> {
  if (!(await isGitRepo(dir, run))) return false
  try {
    return await originUrl(dir, run) === normalizeRepoUrl(url)
  } catch {
    return false
  }
}

/**
 * Find the local deepseek-harness checkout without hard-coding a machine path.
 *
 * Resolution order:
 * 1. `$DSH_UPDATER_TARGET_DIR` (handled by {@link resolveTargetDir}).
 * 2. The configured `targetDir`.
 * 3. `process.cwd()` or one of its ancestors when origin matches `repoUrl`
 *    (start.py launches dsh with cwd = vendor/deepseek-harness).
 * 4. `<cwd>/vendor/deepseek-harness` for the codemaker2deepseek-harness layout.
 */
export async function findHarnessCheckout(
  repoUrl: string,
  cwd: string,
  run: GitRunner = defaultGitRunner,
): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    if (await checkoutMatchesRepo(current, repoUrl, run)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const vendored = resolve(cwd, 'vendor', 'deepseek-harness')
  if (await checkoutMatchesRepo(vendored, repoUrl, run)) return vendored
  throw new Error(
    'cannot locate a local deepseek-harness checkout automatically. '
      + 'Set targetDir in the plugin config or $DSH_UPDATER_TARGET_DIR to the repository directory.',
  )
}

/**
 * Resolve the checkout directory the updater owns. Explicit targets are
 * resolved against `cwd` and do not need to exist yet (the update action
 * clones them); an empty target triggers auto-discovery.
 */
export async function resolveTargetDir(
  repoUrl: string,
  configuredTargetDir: string,
  environmentTargetDir: string,
  cwd: string,
  run: GitRunner = defaultGitRunner,
): Promise<string> {
  const explicit = (environmentTargetDir.trim() || configuredTargetDir.trim()).trim()
  if (explicit !== '') return resolve(cwd, explicit)
  return findHarnessCheckout(repoUrl, cwd, run)
}

/** True when a path is an existing directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** True when a path is an existing empty directory. */
async function isEmptyDirectory(path: string): Promise<boolean> {
  return (await readdir(path)).length === 0
}

/**
 * Clone the remote repository into `targetDir`. The target must be missing or
 * an empty directory; a non-empty non-git target is a loud refusal.
 */
export async function cloneRemote(
  url: string,
  branch: string,
  targetDir: string,
  run: GitRunner = defaultGitRunner,
): Promise<void> {
  if (await isDirectory(targetDir)) {
    if (await isGitRepo(targetDir, run)) return
    if (!(await isEmptyDirectory(targetDir))) {
      throw new Error(`target directory exists and is not an empty git checkout: ${targetDir}`)
    }
  } else {
    await mkdir(dirname(targetDir), { recursive: true })
  }
  await run(['clone', '--quiet', '--no-tags', '--depth', '1', '--branch', branch, url, targetDir])
}

/**
 * Fetch and check out the remote branch inside an existing checkout.
 * A dirty worktree is refused unless `force` is set; the final detached
 * `FETCH_HEAD` checkout is exactly what the launcher's pinned vendor layout
 * already uses.
 */
export async function fetchExisting(
  url: string,
  branch: string,
  targetDir: string,
  force: boolean,
  run: GitRunner = defaultGitRunner,
): Promise<void> {
  if (!(await isGitRepo(targetDir, run))) {
    throw new Error(`target directory is not a git repository: ${targetDir}`)
  }
  if (!force && await isDirty(targetDir, run)) {
    throw new Error(`target checkout has uncommitted changes: ${targetDir}; commit/stash them or enable force`)
  }
  await run(['fetch', '--quiet', '--no-tags', '--depth', '1', url, branch], targetDir)
  await run(['checkout', '--quiet', '--detach', '--force', 'FETCH_HEAD'], targetDir)
}
