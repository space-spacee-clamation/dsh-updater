//#region src/web.ts
const name = "dsh-updater-web";
const inject = ["dshUpdater", "webServer"];
const CSRF_HEADER = "x-dsh-updater";
const MAX_BODY_BYTES = 65536;
function apply(ctx) {
	const service = ctx.dshUpdater;
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: service.apiPrefix,
		handler: handle(service)
	}), "dsh-updater-web: /dsh-updater route");
}
/**
* Strip the registered prefix from a pathname the webserver routed here.
* Prefix routes receive the full pathname, so `/dsh-updater/status` becomes
* `/status` and a bare `/dsh-updater` becomes `/`.
*/
function subpath(pathname, prefix) {
	if (pathname === prefix) return "/";
	if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length).replace(/\/+$/, "") || "/";
	return pathname;
}
function handle(service) {
	return async (req, res) => {
		const path = subpath(new URL(req.url ?? "/", "http://localhost").pathname, service.apiPrefix);
		try {
			if (req.method === "GET" && path === "/status") return send(res, 200, {
				ok: true,
				value: service.status()
			});
			if (req.method === "POST" && path === "/check") return dispatch(res, req, async () => ({
				ok: true,
				value: await service.check()
			}));
			if (req.method === "POST" && path === "/update") return dispatch(res, req, async () => ({
				ok: true,
				value: await service.update()
			}));
			send(res, 404, {
				ok: false,
				error: {
					code: "not_found",
					message: `no dsh-updater route for ${req.method ?? "?"} ${path}`
				}
			});
		} catch (error) {
			send(res, 400, {
				ok: false,
				error: {
					code: "bad_request",
					message: messageOf(error)
				}
			});
		}
	};
}
async function dispatch(res, req, run) {
	assertCsrf(req);
	await readBody(req);
	send(res, 200, await run());
}
function assertCsrf(req) {
	if (req.headers[CSRF_HEADER] !== "1") throw new Error(`missing ${CSRF_HEADER}: 1 header — same-origin client calls only`);
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf8");
				if (text.trim() === "") {
					resolve({});
					return;
				}
				const parsed = JSON.parse(text);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
				resolve(parsed);
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}
function send(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body)),
		"cache-control": "no-store"
	});
	res.end(body);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export { apply, inject, name };
