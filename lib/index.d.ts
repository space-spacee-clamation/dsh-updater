import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
//#region src/git.d.ts
/**
 * Git operations for the harness updater. Everything goes through a
 * `GitRunner` seam so the update planner and tests never shell out directly.
 * @module @dsh-ext/dsh-updater/git
 */
/**
 * Run one git command and return stdout. A non-zero exit rejects with the
 * command's stderr (or stdout when stderr is empty).
 */
type GitRunner = (args: string[], cwd?: string) => Promise<string>;
/** Normalize a repository URL so "same repo" comparisons survive `.git` and slash spelling. */
declare function normalizeRepoUrl(url: string): string;
/** Parse the default-branch name from `git ls-remote --symref <url> HEAD`. */
declare function parseSymrefHead(output: string): string | undefined;
/** Parse the object id from one `git ls-remote <url> <ref>` line. */
declare function parseRemoteObjectId(output: string): string | undefined;
//#endregion
//#region src/types.d.ts
/**
 * Wire types shared by the host service, the /dsh-updater web route, and the
 * browser tab. Keep this file dependency-free: the client bundle imports it as
 * plain type-only surface.
 * @module @dsh-ext/dsh-updater/types
 */
/** What the service is doing right now. */
type UpdaterPhase = 'idle' | 'checking' | 'updating';
/** The latest check outcome. */
type UpdaterStatus = 'unknown' | 'up-to-date' | 'update-available' | 'updated' | 'error';
/** A stable, JSON-friendly snapshot of the updater. */
interface UpdaterSnapshot {
  phase: UpdaterPhase;
  status: UpdaterStatus;
  /** True when the remote commit differs from the local one (or no local checkout exists). */
  updateAvailable: boolean;
  /** True after an update has changed the checkout: the running harness must restart. */
  restartRequired: boolean;
  repoUrl: string;
  branch: string;
  targetDir: string;
  localCommit: string;
  remoteCommit: string;
  localShort: string;
  remoteShort: string;
  lastCheckedAt: string;
  updatedAt: string;
  error: string;
}
/** Result returned by POST /dsh-updater/check and /update. */
interface UpdateResult {
  message: string;
  commitChanged: boolean;
  snapshot: UpdaterSnapshot;
}
//#endregion
//#region src/index.d.ts
/** DeepSeek Harness upstream repository. */
declare const DEFAULT_REPO_URL = "https://github.com/deepseek-ai/deepseek-harness.git";
/** Default web API prefix; the browser half calls the same prefix. */
declare const DEFAULT_API_PREFIX = "/dsh-updater";
/** Default periodic re-check interval (10 minutes). */
declare const DEFAULT_CHECK_INTERVAL_MS: number;
declare const name = "dsh-updater";
/** Deployment configuration validated by the Loader. */
interface Config {
  /** Upstream git repository URL. */
  repoUrl: string;
  /** Branch to track; empty means "follow the remote default branch". */
  branch: string;
  /**
   * Local checkout directory. Empty means auto-discovery: process.cwd() or an
   * ancestor whose origin matches repoUrl, then <cwd>/vendor/deepseek-harness.
   * Relative values resolve against process.cwd().
   */
  targetDir: string;
  /** Run one check immediately after the plugin takes effect. */
  checkOnLoad: boolean;
  /** Periodic re-check interval in milliseconds; 0 disables the timer. */
  checkIntervalMs: number;
  /** Overwrite a dirty worktree during update. */
  force: boolean;
  /** Web API prefix shared with the web route carrier. */
  apiPrefix: string;
}
declare const Config: z<Config>;
declare module '@deepseek-ai/cordis' {
  interface Context {
    dshUpdater: DshUpdaterService;
  }
}
/** Cordis service wrapping the updater core. */
declare class DshUpdaterService extends Service {
  readonly apiPrefix: string;
  readonly repoUrl: string;
  readonly branch: string;
  readonly targetDir: string;
  readonly checkIntervalMs: number;
  readonly force: boolean;
  private readonly runGit;
  private snapshot;
  private busy;
  constructor(ctx: Context, config: Config, runGit?: GitRunner);
  /** Current JSON snapshot (safe to serve over the web route). */
  status(): UpdaterSnapshot;
  /** Check the upstream remote and refresh the snapshot. */
  check(): Promise<UpdaterSnapshot>;
  /** Clone or fetch-and-checkout the upstream content into the local checkout. */
  update(): Promise<UpdateResult>;
  /** Serialize check/update operations: no overlapping git mutations. */
  private runExclusive;
  private patch;
}
/** Mount the service. */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { Config, DEFAULT_API_PREFIX, DEFAULT_CHECK_INTERVAL_MS, DEFAULT_REPO_URL, DshUpdaterService, type GitRunner, type UpdateResult, type UpdaterPhase, type UpdaterSnapshot, type UpdaterStatus, apply, name, normalizeRepoUrl, parseRemoteObjectId, parseSymrefHead };