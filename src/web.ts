/**
 * @dsh-ext/dsh-updater/web — web-only route carrier. This loader row injects
 * `dshUpdater` and `webServer`, so it only mounts where a Web server exists;
 * headless profiles keep the core service without any HTTP surface.
 * @module @dsh-ext/dsh-updater/web
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { DshUpdaterService } from './index.ts'

export const name = 'dsh-updater-web'

export const inject = ['dshUpdater', 'webServer']

const CSRF_HEADER = 'x-dsh-updater'
const MAX_BODY_BYTES = 64 * 1024

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export function apply(ctx: Context): void {
  const service = ctx.dshUpdater
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: service.apiPrefix, handler: handle(service) }),
    'dsh-updater-web: /dsh-updater route',
  )
}

/**
 * Strip the registered prefix from a pathname the webserver routed here.
 * Prefix routes receive the full pathname, so `/dsh-updater/status` becomes
 * `/status` and a bare `/dsh-updater` becomes `/`.
 */
function subpath(pathname: string, prefix: string): string {
  if (pathname === prefix) return '/'
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length).replace(/\/+$/, '') || '/'
  return pathname
}

function handle(service: DshUpdaterService): Handler {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = subpath(url.pathname, service.apiPrefix)
    try {
      if (req.method === 'GET' && path === '/status') {
        return send(res, 200, { ok: true, value: service.status() })
      }
      if (req.method === 'POST' && path === '/check') {
        return dispatch(res, req, async () => ({ ok: true, value: await service.check() }))
      }
      if (req.method === 'POST' && path === '/update') {
        return dispatch(res, req, async () => ({ ok: true, value: await service.update() }))
      }
      send(res, 404, { ok: false, error: { code: 'not_found', message: `no dsh-updater route for ${req.method ?? '?'} ${path}` } })
    } catch (error) {
      send(res, 400, { ok: false, error: { code: 'bad_request', message: messageOf(error) } })
    }
  }
}

async function dispatch(
  res: ServerResponse,
  req: IncomingMessage,
  run: () => Promise<unknown>,
): Promise<void> {
  assertCsrf(req)
  await readBody(req)
  const result = await run()
  send(res, 200, result)
}

function assertCsrf(req: IncomingMessage): void {
  if (req.headers[CSRF_HEADER] !== '1') {
    throw new Error(`missing ${CSRF_HEADER}: 1 header — same-origin client calls only`)
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        if (text.trim() === '') {
          resolve({})
          return
        }
        const parsed = JSON.parse(text) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('request body must be a JSON object')
        }
        resolve(parsed as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
