// A stand-in for Supabase: enough GoTrue and PostgREST for the app to sign in,
// load, and mutate. Not a real database — just enough truth for the app to
// behave like the live one, so it can be driven and broken safely.
//
// Everything lives in memory and is thrown away when the process exits, so a
// probe can delete every recipe without consequence.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { HOUSEHOLD_ID, USER_ID, makeData } from './fixtures.mjs'

const catalogue = JSON.parse(
  readFileSync(new URL('../../data/barbora-categories.json', import.meta.url), 'utf8'),
)
const db = makeData()
db.barbora_categories = catalogue.categories.map((c) => ({
  path: c.path, name: c.name, parent_path: c.parentPath, depth: c.depth,
  sort_order: c.sortOrder, active: true,
}))

const USER = { id: USER_ID, email: 'testas@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const MONTH = 30 * 24 * 3600
const SESSION = { access_token: 'fake-access-token', token_type: 'bearer', expires_in: MONTH, expires_at: Math.floor(Date.now() / 1000) + MONTH, refresh_token: 'fake-refresh-token', user: USER }

/** `household_id=eq.<uuid>` and friends; anything unrecognised is ignored. */
function applyFilters(rows, params) {
  let out = rows
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const value = rest.join('.')
    if (op === 'eq') out = out.filter((r) => String(r[key]) === value)
    else if (op === 'is') out = out.filter((r) => (value === 'null' ? r[key] == null : r[key] != null))
    else if (op === 'in') {
      const set = new Set(value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')))
      out = out.filter((r) => set.has(String(r[key])))
    }
  }
  return out
}

function applyOrder(rows, params) {
  const order = params.get('order')
  if (!order) return rows
  const [column, ...opts] = order.split('.')
  const dir = opts.includes('desc') ? -1 : 1
  return [...rows].sort((a, b) => {
    const l = a[column], r = b[column]
    if (l === r) return 0
    if (l == null) return 1
    if (r == null) return -1
    return (typeof l === 'string' ? l.localeCompare(r, 'lt') : l < r ? -1 : 1) * dir
  })
}

/**
 * `.single()` and `.maybeSingle()` ask for an object rather than an array via
 * the Accept header. Returning an array to those silently yields a row with
 * undefined fields, which is exactly how this stub first lied to the app.
 */
function shape(req, rows) {
  const accept = req.headers.accept ?? ''
  if (!accept.includes('pgrst.object')) return { status: 200, body: rows }
  if (rows.length === 1) return { status: 200, body: rows[0] }
  if (rows.length === 0) return { status: 200, body: null }
  return { status: 406, body: { message: 'more than one row returned' } }
}

const send = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range',
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const readBody = (req) => new Promise((resolve) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : null) } catch { resolve(null) } })
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'OPTIONS') return send(res, 204)

  if (url.pathname.startsWith('/auth/v1')) {
    if (url.pathname.endsWith('/logout')) return send(res, 204)
    if (url.pathname.endsWith('/user')) return send(res, 200, USER)
    return send(res, 200, SESSION)          // token, signup, recover
  }

  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.split('/').pop()
    if (fn === 'join_household') return send(res, 200, HOUSEHOLD_ID)
    return send(res, 200, null)
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.replace('/rest/v1/', '')
    db[table] ??= []
    const params = [...url.searchParams.entries()]

    if (req.method === 'GET') {
      const rows = applyOrder(applyFilters(db[table], params), url.searchParams)
      const { status, body } = shape(req, rows)
      return send(res, status, body)
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      const rows = (Array.isArray(body) ? body : [body]).map((row) => ({
        id: randomUUID(), created_at: new Date().toISOString(), added_at: new Date().toISOString(),
        household_id: HOUSEHOLD_ID, ...row,
      }))
      db[table].push(...rows)
      const shaped = shape(req, rows)
      return send(res, 201, shaped.body)
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const targets = applyFilters(db[table], params)
      targets.forEach((row) => Object.assign(row, body))
      const shaped = shape(req, targets)
      return send(res, shaped.status, shaped.body)
    }
    if (req.method === 'DELETE') {
      const targets = new Set(applyFilters(db[table], params))
      db[table] = db[table].filter((row) => !targets.has(row))
      return send(res, 200, [...targets])
    }
  }

  send(res, 404, { message: `no stub for ${req.method} ${url.pathname}` })
})

/** Start the stub on a free port. Import this from a runner, or run this file. */
export function createBackend() {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => server.close() })
    })
  })
}

// `node scripts/harness/server.mjs` prints the port and stays up.
if (import.meta.url === `file://${process.argv[1]}`) {
  createBackend().then(({ port }) => process.stdout.write(`${port}\n`))
}
