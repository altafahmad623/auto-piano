/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Connect, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'

/** One JSON file per device profile (plan 004 §2, option B). */
const PROFILES_DIR = fileURLToPath(new URL('./profiles', import.meta.url))
/** Same sanitization contract as `profileFileStem` in src/profileStore.ts. */
const PROFILE_FILE_RE = /^[a-z0-9-_]+\.json$/

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('error', reject)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  })
}

/**
 * GET /api/profiles — list stored files as { files: [{ name, text }] }.
 * POST /api/profiles — { file, text } body; writes (overwrites) profiles/<file>.
 * DELETE /api/profiles/<stem> — removes profiles/<stem>.json; idempotent.
 *
 * Deliberately dumb file backend: the client (src/profileStore.ts) owns the
 * versioned entry format and corruption handling.
 */
function profilesApi(): Plugin {
  const send = (res: ServerResponse, status: number, body?: unknown): void => {
    res.statusCode = status
    if (body !== undefined) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    } else {
      res.end()
    }
  }

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const { method } = req
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (!/^\/api\/profiles(\/|$)/.test(pathname)) return next()

    void (async () => {
      try {
        if (method === 'GET' && pathname === '/api/profiles') {
          fs.mkdirSync(PROFILES_DIR, { recursive: true })
          const files = fs
            .readdirSync(PROFILES_DIR)
            .filter((name) => PROFILE_FILE_RE.test(name))
            .map((name) => ({
              name,
              text: fs.readFileSync(path.join(PROFILES_DIR, name), 'utf-8'),
            }))
          send(res, 200, { files })
          return
        }
        if (method === 'POST' && pathname === '/api/profiles') {
          const body = JSON.parse(await readBody(req)) as { file?: unknown; text?: unknown }
          if (typeof body.file !== 'string' || !PROFILE_FILE_RE.test(body.file)) {
            send(res, 400, { error: `Invalid profile file name: ${String(body.file)}` })
            return
          }
          if (typeof body.text !== 'string') {
            send(res, 400, { error: 'Missing profile text' })
            return
          }
          fs.mkdirSync(PROFILES_DIR, { recursive: true })
          fs.writeFileSync(path.join(PROFILES_DIR, body.file), body.text)
          send(res, 204)
          return
        }
        const m = method === 'DELETE' ? /^\/api\/profiles\/([a-z0-9-_]+)$/.exec(pathname) : null
        if (m) {
          // force: deleting an unknown profile is a no-op, like the old
          // localStorage deleteProfile.
          fs.rmSync(path.join(PROFILES_DIR, `${m[1]}.json`), { force: true })
          send(res, 204)
          return
        }
        send(res, 404, { error: `No route for ${method} ${pathname}` })
      } catch (err) {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
    })()
  }

  return {
    name: 'profiles-api',
    // Block bodies so the hooks return nothing: `use()` returns the connect
    // app, which Vite would otherwise call as a post-hook.
    configureServer: (server: ViteDevServer) => {
      server.middlewares.use(handler)
    },
    configurePreviewServer: (server: PreviewServer) => {
      server.middlewares.use(handler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [profilesApi(), react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
