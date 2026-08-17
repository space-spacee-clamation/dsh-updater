window.__ModuleLoader__.load({
	id: "@dsh-ext/dsh-updater",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/**
		* Locale dictionaries owned by the dsh-updater browser tab.
		* Product copy is Chinese; `en` is a best-effort mirror.
		*/
		const zh = {
			tab: "Harness 更新",
			title: "DeepSeek Harness 更新",
			desc: "插件生效时自动检查 deepseek-harness 远端仓库；有新提交时点击更新即可克隆/拉取新内容，随后请重启 DSH。",
			repo: "远端仓库",
			branch: "跟踪分支",
			target: "本地目录",
			local: "本地提交",
			remote: "远端提交",
			lastChecked: "上次检查",
			updatedAt: "更新时间",
			statusUnknown: "尚未检查",
			statusChecking: "检查中…",
			statusUpdating: "更新中…",
			statusUpToDate: "已是最新",
			statusUpdateAvailable: "发现新版本",
			statusUpdated: "更新完成，等待重启",
			statusError: "检查/更新失败",
			check: "立即检查",
			update: "一键更新",
			checkingAction: "正在检查…",
			updatingAction: "正在更新…",
			updateConfirm: "将更新本地 deepseek-harness 工作区到远端最新提交。当前运行中的 DSH 不会被热替换，请确认更新后重启。继续？",
			restartBanner: "新的 harness 内容已写入本地目录。请重启 DSH 以加载新版本。",
			noError: "无",
			fetchFailed: "无法读取更新状态："
		};
		const en = {
			tab: "Harness update",
			title: "DeepSeek Harness update",
			desc: "The upstream deepseek-harness repository is checked automatically while the plugin is active. When a new commit exists, click update to clone/fetch the new content and then restart DSH.",
			repo: "Remote repository",
			branch: "Tracking branch",
			target: "Local directory",
			local: "Local commit",
			remote: "Remote commit",
			lastChecked: "Last checked",
			updatedAt: "Updated at",
			statusUnknown: "Not checked yet",
			statusChecking: "Checking…",
			statusUpdating: "Updating…",
			statusUpToDate: "Up to date",
			statusUpdateAvailable: "Update available",
			statusUpdated: "Updated; restart pending",
			statusError: "Check/update failed",
			check: "Check now",
			update: "Update now",
			checkingAction: "Checking…",
			updatingAction: "Updating…",
			updateConfirm: "The local deepseek-harness checkout will be moved to the latest remote commit. The running DSH is not hot-swapped; restart after the update. Continue?",
			restartBanner: "New harness content has been written to the local checkout. Restart DSH to load it.",
			noError: "None",
			fetchFailed: "Cannot read update status: "
		};
		//#endregion
		//#region src/client/UpdaterTab.tsx
		/**
		* Harness update tab rendered inside the Plugins settings section. The tab has
		* one job: show the host updater snapshot, offer "check now" and "update now",
		* and keep a restart banner visible after a successful update until the user
		* restarts the harness.
		*/
		const API_PREFIX = "/dsh-updater";
		const CSRF_HEADER = "x-dsh-updater";
		const POLL_INTERVAL_MS = 15e3;
		async function api(path, body) {
			const init = body === void 0 ? { method: "GET" } : {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[CSRF_HEADER]: "1"
				},
				body: JSON.stringify(body)
			};
			const response = await fetch(`${API_PREFIX}${path}`, init);
			const text = await response.text();
			if (text.trim() === "") throw new Error(`HTTP ${response.status} returned an empty response`);
			let payload;
			try {
				payload = JSON.parse(text);
			} catch {
				throw new Error(`HTTP ${response.status} returned non-JSON: ${text.slice(0, 120)}`);
			}
			if (!payload.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
			return payload.value;
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function formatTime(iso) {
			if (iso === "") return "—";
			const date = new Date(iso);
			return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
		}
		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				gap: 14,
				maxWidth: 760
			},
			title: {
				margin: 0,
				fontSize: 15,
				fontWeight: 600
			},
			desc: {
				margin: 0,
				opacity: .72,
				fontSize: 13,
				lineHeight: 1.6
			},
			card: {
				display: "flex",
				flexDirection: "column",
				gap: 10,
				padding: 14,
				border: "1px solid var(--dsw-alias-border, #334155)",
				borderRadius: 12,
				background: "var(--dsw-alias-surface, transparent)"
			},
			statusRow: {
				display: "flex",
				alignItems: "center",
				gap: 10,
				flexWrap: "wrap"
			},
			dot: {
				width: 8,
				height: 8,
				borderRadius: 4,
				flexShrink: 0
			},
			statusText: {
				fontSize: 14,
				fontWeight: 600
			},
			field: {
				display: "grid",
				gridTemplateColumns: "minmax(96px, 120px) 1fr",
				gap: 6,
				fontSize: 12
			},
			label: { opacity: .62 },
			value: {
				fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
				overflowWrap: "anywhere"
			},
			error: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-danger, #dc2626)",
				whiteSpace: "pre-wrap"
			},
			banner: {
				padding: 12,
				borderRadius: 10,
				fontSize: 13,
				lineHeight: 1.6,
				border: "1px solid var(--dsw-alias-accent, #3b82f6)",
				background: "var(--dsw-alias-accent-soft, rgba(59, 130, 246, 0.12))"
			},
			actions: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap",
				marginTop: 2
			},
			button: {
				height: 32,
				padding: "0 14px",
				borderRadius: 8,
				border: "1px solid var(--dsw-alias-border, #334155)",
				background: "var(--dsw-alias-surface, transparent)",
				color: "inherit",
				fontSize: 13,
				cursor: "pointer"
			},
			buttonPrimary: {
				border: "1px solid var(--dsw-alias-accent, #3b82f6)",
				background: "var(--dsw-alias-accent, #3b82f6)",
				color: "var(--dsw-alias-accent-contrast, white)"
			},
			disabled: {
				opacity: .55,
				cursor: "not-allowed"
			}
		};
		function statusDotColor(status) {
			switch (status) {
				case "up-to-date":
				case "updated": return "var(--dsw-alias-success, #16a34a)";
				case "update-available": return "var(--dsw-alias-accent, #3b82f6)";
				case "error": return "var(--dsw-alias-danger, #dc2626)";
				default: return "var(--dsw-alias-muted, #9ca3af)";
			}
		}
		function statusText(status, t) {
			switch (status) {
				case "up-to-date": return t("statusUpToDate");
				case "update-available": return t("statusUpdateAvailable");
				case "updated": return t("statusUpdated");
				case "error": return t("statusError");
				default: return t("statusUnknown");
			}
		}
		function UpdaterTab({ t }) {
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [message, setMessage] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const refresh = async () => {
				try {
					const next = await api("/status");
					setSnapshot(next);
					setError("");
				} catch (reason) {
					setError(`${t("fetchFailed")}${messageOf(reason)}`);
				}
			};
			(0, react.useEffect)(() => {
				refresh();
				const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
				return () => clearInterval(timer);
			}, []);
			const run = async (action) => {
				setBusy(true);
				setError("");
				setMessage("");
				try {
					const value = await action();
					if ("snapshot" in value) {
						setSnapshot(value.snapshot);
						setMessage(value.message);
					} else setSnapshot(value);
				} catch (reason) {
					setError(messageOf(reason));
					await refresh();
				} finally {
					setBusy(false);
				}
			};
			const check = () => {
				if (busy) return;
				run(() => api("/check", {}));
			};
			const update = () => {
				if (busy || snapshot === null || !snapshot.updateAvailable) return;
				if (!window.confirm(t("updateConfirm"))) return;
				run(() => api("/update", {}));
			};
			const status = snapshot?.status ?? "unknown";
			const actionLabel = snapshot?.phase === "updating" ? t("updatingAction") : snapshot?.phase === "checking" ? t("checkingAction") : t("update");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.root,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: styles.title,
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.desc,
						children: t("desc")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.statusRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
									...styles.dot,
									background: statusDotColor(status)
								} }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.statusText,
									children: statusText(status, t)
								})]
							}),
							snapshot?.restartRequired === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.banner,
								children: t("restartBanner")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("repo")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.value,
									children: snapshot?.repoUrl ?? "—"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("branch")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.value,
									children: snapshot?.branch || "—"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("target")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.value,
									children: snapshot?.targetDir || "—"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("local")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.value,
									children: snapshot?.localShort || snapshot?.localCommit || "—"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("remote")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.value,
									children: snapshot?.remoteShort || snapshot?.remoteCommit || "—"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("lastChecked")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.value,
									children: formatTime(snapshot?.lastCheckedAt ?? "")
								})]
							}),
							snapshot?.updatedAt !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("updatedAt")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.value,
									children: formatTime(snapshot?.updatedAt ?? "")
								})]
							}),
							error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								style: styles.error,
								children: error
							}),
							message !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.desc,
								children: message
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: {
										...styles.button,
										...busy ? styles.disabled : {}
									},
									disabled: busy,
									onClick: check,
									children: snapshot?.phase === "checking" ? t("checkingAction") : t("check")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: {
										...styles.button,
										...styles.buttonPrimary,
										...busy || !snapshot?.updateAvailable ? styles.disabled : {}
									},
									disabled: busy || !snapshot?.updateAvailable,
									onClick: update,
									children: actionLabel
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-updater";
		const inject = ["slots", "locale"];
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.dshUpdater";
		/**
		* Register the updater tab. Waiting on the slot declaration mirrors the
		* official registrants: a direct register racing the declaration fails.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-updater: copy dictionaries");
			const t = ctx.locale.bind(NS);
			const injectT = () => ({ t: ctx.locale.bind(NS) });
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "dsh-updater",
				order: 20,
				label: () => t("tab"),
				locale: NS,
				inject: injectT
			}, UpdaterTab));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
