import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
//#region src/git.ts
/**
* Git operations for the harness updater. Everything goes through a
* `GitRunner` seam so the update planner and tests never shell out directly.
* @module @dsh-ext/dsh-updater/git
*/
function detailOf(error) {
	if (typeof error === "object" && error !== null) {
		const record = error;
		for (const field of [
			record.stderr,
			record.stdout,
			record.message
		]) if (typeof field === "string" && field.trim() !== "") return field.trim();
	}
	return "";
}
/** Real runner used by the plugin at runtime. */
const defaultGitRunner = async (args, cwd) => {
	try {
		return (await new Promise((resolve, reject) => {
			execFile("git", args, {
				cwd,
				encoding: "utf8",
				windowsHide: true,
				maxBuffer: 33554432
			}, (error, stdout, stderr) => {
				if (error !== null) {
					reject(Object.assign(error, {
						stdout: String(stdout ?? ""),
						stderr: String(stderr ?? "")
					}));
					return;
				}
				resolve({
					stdout: String(stdout ?? ""),
					stderr: String(stderr ?? "")
				});
			});
		})).stdout;
	} catch (error) {
		if (error.code === "ENOENT") throw new Error("git not found on PATH; install git and restart the harness");
		throw new Error(`git ${args[0] ?? ""} failed${detailOf(error) ? `: ${detailOf(error)}` : ""}`);
	}
};
/** Normalize a repository URL so "same repo" comparisons survive `.git` and slash spelling. */
function normalizeRepoUrl(url) {
	return url.trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
}
/** Parse the default-branch name from `git ls-remote --symref <url> HEAD`. */
function parseSymrefHead(output) {
	return /^ref:\s+refs\/heads\/([^\s]+)\s+HEAD\s*$/m.exec(output)?.[1];
}
/** Parse the object id from one `git ls-remote <url> <ref>` line. */
function parseRemoteObjectId(output) {
	return /^([0-9a-f]{40})\s+/m.exec(output)?.[1];
}
/** True when the directory is a git worktree. */
async function isGitRepo(dir, run = defaultGitRunner) {
	try {
		await run(["rev-parse", "--git-dir"], dir);
		return true;
	} catch {
		return false;
	}
}
/** The full local HEAD commit, or `undefined` when the directory is not a repo. */
async function localHead(dir, run = defaultGitRunner) {
	try {
		return (await run(["rev-parse", "HEAD"], dir)).trim();
	} catch {
		return;
	}
}
/** Resolve the remote default branch when `branch` is empty. */
async function resolveRemoteBranch(url, branch, run = defaultGitRunner) {
	if (branch.trim() !== "") return branch.trim();
	const detected = parseSymrefHead(await run([
		"ls-remote",
		"--symref",
		url,
		"HEAD"
	]));
	if (detected === void 0) throw new Error(`cannot resolve the default branch of ${url} from git ls-remote`);
	return detected;
}
/** The remote commit for `refs/heads/<branch>`. */
async function remoteHead(url, branch, run = defaultGitRunner) {
	const objectId = parseRemoteObjectId(await run([
		"ls-remote",
		url,
		`refs/heads/${branch}`
	]));
	if (objectId === void 0) throw new Error(`remote branch "${branch}" not found on ${url}`);
	return objectId;
}
/** True when the worktree has tracked changes. Untracked files are ignored:
* they normally do not block `git checkout --detach FETCH_HEAD`, and a real
* path collision still fails the checkout loudly. */
async function isDirty(dir, run = defaultGitRunner) {
	return (await run([
		"status",
		"--porcelain",
		"--untracked-files=no"
	], dir)).trim() !== "";
}
/** The origin URL of a checkout, normalized for comparison. */
async function originUrl(dir, run) {
	return normalizeRepoUrl((await run([
		"config",
		"--get",
		"remote.origin.url"
	], dir)).trim());
}
/** True when a checkout's origin URL matches the configured repository. */
async function checkoutMatchesRepo(dir, url, run) {
	if (!await isGitRepo(dir, run)) return false;
	try {
		return await originUrl(dir, run) === normalizeRepoUrl(url);
	} catch {
		return false;
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
async function findHarnessCheckout(repoUrl, cwd, run = defaultGitRunner) {
	let current = resolve(cwd);
	for (;;) {
		if (await checkoutMatchesRepo(current, repoUrl, run)) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const vendored = resolve(cwd, "vendor", "deepseek-harness");
	if (await checkoutMatchesRepo(vendored, repoUrl, run)) return vendored;
	throw new Error("cannot locate a local deepseek-harness checkout automatically. Set targetDir in the plugin config or $DSH_UPDATER_TARGET_DIR to the repository directory.");
}
/**
* Resolve the checkout directory the updater owns. Explicit targets are
* resolved against `cwd` and do not need to exist yet (the update action
* clones them); an empty target triggers auto-discovery.
*/
async function resolveTargetDir(repoUrl, configuredTargetDir, environmentTargetDir, cwd, run = defaultGitRunner) {
	const explicit = (environmentTargetDir.trim() || configuredTargetDir.trim()).trim();
	if (explicit !== "") return resolve(cwd, explicit);
	return findHarnessCheckout(repoUrl, cwd, run);
}
/** True when a path is an existing directory. */
async function isDirectory(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
/** True when a path is an existing empty directory. */
async function isEmptyDirectory(path) {
	return (await readdir(path)).length === 0;
}
/**
* Clone the remote repository into `targetDir`. The target must be missing or
* an empty directory; a non-empty non-git target is a loud refusal.
*/
async function cloneRemote(url, branch, targetDir, run = defaultGitRunner) {
	if (await isDirectory(targetDir)) {
		if (await isGitRepo(targetDir, run)) return;
		if (!await isEmptyDirectory(targetDir)) throw new Error(`target directory exists and is not an empty git checkout: ${targetDir}`);
	} else await mkdir(dirname(targetDir), { recursive: true });
	await run([
		"clone",
		"--quiet",
		"--no-tags",
		"--depth",
		"1",
		"--branch",
		branch,
		url,
		targetDir
	]);
}
/**
* Fetch and check out the remote branch inside an existing checkout.
* A dirty worktree is refused unless `force` is set; the final detached
* `FETCH_HEAD` checkout is exactly what the launcher's pinned vendor layout
* already uses.
*/
async function fetchExisting(url, branch, targetDir, force, run = defaultGitRunner) {
	if (!await isGitRepo(targetDir, run)) throw new Error(`target directory is not a git repository: ${targetDir}`);
	if (!force && await isDirty(targetDir, run)) throw new Error(`target checkout has uncommitted tracked changes: ${targetDir}; commit/stash them or enable force`);
	await run([
		"fetch",
		"--quiet",
		"--no-tags",
		"--depth",
		"1",
		url,
		branch
	], targetDir);
	await run([
		"checkout",
		"--quiet",
		"--detach",
		"--force",
		"FETCH_HEAD"
	], targetDir);
}
//#endregion
//#region src/index.ts
/** DeepSeek Harness upstream repository. */
const DEFAULT_REPO_URL = "https://github.com/deepseek-ai/deepseek-harness.git";
/** Default web API prefix; the browser half calls the same prefix. */
const DEFAULT_API_PREFIX = "/dsh-updater";
/** Default periodic re-check interval (10 minutes). */
const DEFAULT_CHECK_INTERVAL_MS = 6e5;
const name = "dsh-updater";
const Config = z.object({
	repoUrl: z.string().default(DEFAULT_REPO_URL),
	branch: z.string().default(""),
	targetDir: z.string().default(""),
	checkOnLoad: z.boolean().default(true),
	checkIntervalMs: z.number().min(0).default(DEFAULT_CHECK_INTERVAL_MS),
	force: z.boolean().default(false),
	apiPrefix: z.string().default(DEFAULT_API_PREFIX)
});
function shortCommit(commit) {
	return commit === "" ? "" : commit.slice(0, 8);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Cordis service wrapping the updater core. */
var DshUpdaterService = class extends Service {
	apiPrefix;
	repoUrl;
	branch;
	targetDir;
	checkIntervalMs;
	force;
	runGit;
	snapshot;
	busy = Promise.resolve();
	constructor(ctx, config, runGit = defaultGitRunner) {
		super(ctx, "dshUpdater");
		this.apiPrefix = config.apiPrefix;
		this.repoUrl = config.repoUrl;
		this.branch = config.branch.trim();
		this.targetDir = config.targetDir.trim();
		this.checkIntervalMs = config.checkIntervalMs;
		this.force = config.force;
		this.runGit = runGit;
		this.snapshot = {
			phase: "idle",
			status: "unknown",
			updateAvailable: false,
			restartRequired: false,
			repoUrl: this.repoUrl,
			branch: this.branch,
			targetDir: this.targetDir,
			localCommit: "",
			remoteCommit: "",
			localShort: "",
			remoteShort: "",
			lastCheckedAt: "",
			updatedAt: "",
			error: ""
		};
		ctx.effect(() => {
			if (this.checkIntervalMs <= 0) return () => {};
			const timer = setInterval(() => {
				this.check().catch((error) => {
					ctx.logger("dsh-updater").warn("periodic update check failed: %s", messageOf(error));
				});
			}, this.checkIntervalMs);
			return () => clearInterval(timer);
		}, "dsh-updater: periodic remote check");
		if (config.checkOnLoad) Promise.resolve().then(() => this.check()).catch((error) => {
			ctx.logger("dsh-updater").warn("initial update check failed: %s", messageOf(error));
		});
	}
	/** Current JSON snapshot (safe to serve over the web route). */
	status() {
		return { ...this.snapshot };
	}
	/** Check the upstream remote and refresh the snapshot. */
	check() {
		return this.runExclusive(async () => {
			this.patch({
				phase: "checking",
				status: "unknown",
				error: ""
			});
			try {
				const branch = await resolveRemoteBranch(this.repoUrl, this.branch, this.runGit);
				const targetDir = await resolveTargetDir(this.repoUrl, this.targetDir, process.env.DSH_UPDATER_TARGET_DIR ?? "", process.cwd(), this.runGit);
				const remoteCommit = await remoteHead(this.repoUrl, branch, this.runGit);
				const localCommit = await localHead(targetDir, this.runGit);
				const updateAvailable = !(localCommit !== void 0 && localCommit !== "") || localCommit !== remoteCommit;
				this.patch({
					phase: "idle",
					status: updateAvailable ? "update-available" : "up-to-date",
					updateAvailable,
					repoUrl: this.repoUrl,
					branch,
					targetDir,
					localCommit: localCommit ?? "",
					remoteCommit,
					localShort: shortCommit(localCommit ?? ""),
					remoteShort: shortCommit(remoteCommit),
					lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString(),
					error: ""
				});
			} catch (error) {
				this.patch({
					phase: "idle",
					status: "error",
					error: messageOf(error)
				});
			}
			return this.status();
		});
	}
	/** Clone or fetch-and-checkout the upstream content into the local checkout. */
	update() {
		return this.runExclusive(async () => {
			this.patch({
				phase: "updating",
				status: "unknown",
				error: ""
			});
			try {
				const branch = await resolveRemoteBranch(this.repoUrl, this.branch, this.runGit);
				const targetDir = await resolveTargetDir(this.repoUrl, this.targetDir, process.env.DSH_UPDATER_TARGET_DIR ?? "", process.cwd(), this.runGit);
				const remoteCommit = await remoteHead(this.repoUrl, branch, this.runGit);
				const existing = await isGitRepo(targetDir, this.runGit);
				const before = existing ? await localHead(targetDir, this.runGit) : void 0;
				if (!existing) await cloneRemote(this.repoUrl, branch, targetDir, this.runGit);
				else await fetchExisting(this.repoUrl, branch, targetDir, this.force, this.runGit);
				const after = await localHead(targetDir, this.runGit) ?? remoteCommit;
				const commitChanged = before !== after;
				const updatedAt = commitChanged ? (/* @__PURE__ */ new Date()).toISOString() : this.snapshot.updatedAt;
				this.patch({
					phase: "idle",
					status: commitChanged ? "updated" : "up-to-date",
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
					lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString(),
					error: ""
				});
				return {
					message: commitChanged ? existing ? `updated ${shortCommit(before ?? "")} -> ${shortCommit(after)}; restart the harness to load it` : `cloned ${shortCommit(after)}; restart the harness to load it` : "already up to date",
					commitChanged,
					snapshot: this.status()
				};
			} catch (error) {
				const message = messageOf(error);
				this.patch({
					phase: "idle",
					status: "error",
					error: message
				});
				throw new Error(message);
			}
		});
	}
	/** Serialize check/update operations: no overlapping git mutations. */
	runExclusive(task) {
		const next = this.busy.then(task, task);
		this.busy = next.then(() => void 0, () => void 0);
		return next;
	}
	patch(partial) {
		this.snapshot = {
			...this.snapshot,
			...partial
		};
	}
};
/** Mount the service. */
function apply(ctx, config) {
	ctx.plugin(DshUpdaterService, config);
}
//#endregion
export { Config, DEFAULT_API_PREFIX, DEFAULT_CHECK_INTERVAL_MS, DEFAULT_REPO_URL, DshUpdaterService, apply, name, normalizeRepoUrl, parseRemoteObjectId, parseSymrefHead };
