// Prices and product alternatives for one shopping-list ingredient.
//
// Deliberately a dumb proxy. It exists for exactly one reason: `barbora.lt`
// sends no `Access-Control-Allow-Origin`, so a browser cannot read its JSON,
// while a server can — CORS is a browser policy, not a server one. Everything
// that could be called judgement lives in `src/lib/barboraProducts.js`, which
// runs in the app and has unit tests. This file fetches and forwards, so it
// almost never needs redeploying.
//
// Two upstream calls, joined by product id in the client:
//
//   1. GET  ac.cnstrc.com/search/{query}      — names, brands, images, stock
//   2. POST barbora.lt/api/eshop/v1/product/GetInventories
//                                             — prices, was-prices, promotions
//
// Neither is authenticated and neither is scraped: both are the JSON Barbora's
// own front end and mobile app use. Requests identify themselves honestly and
// only fire when someone taps an ingredient.
//
// See docs/barbora-product-pricing.md.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
// The one piece of logic in this file that is not plumbing, kept in src/lib so
// it has unit tests, and shipped alongside this file. Both copies must match.
import { admit } from './rateLimit.js'

/** Barbora's public Constructor.io client key, as served on every page. */
const CONSTRUCTOR_KEY = 'key_ptvOPViaQiWJxzdL'
const CONSTRUCTOR_SEARCH = 'https://ac.cnstrc.com/search'
const INVENTORIES = 'https://barbora.lt/api/eshop/v1/product/GetInventories'

/** Must match BARBORA_STORE in src/lib/barboraProducts.js. */
const STORE = 'X500'

const USER_AGENT =
  'recipes-app/1.0 (+https://github.com/Blockabsbebsh/recipes; personal household shopping list)'

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 10

/** Long enough that browsing a list is one round trip per ingredient, short
 *  enough that a promotion starting today is not missed by much. */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

/** A ceiling under a runaway client, not a policy for people. Two people
 *  tapping a shopping list cannot reach this; a render loop reaches it in
 *  seconds, and would look like abuse from Barbora's side. */
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX_CALLERS = 100

type Payload = {
  query: string
  store: string
  fetchedAt: string
  results: unknown[]
  inventories: unknown[]
  /** Set when prices could not be fetched but matches could. */
  degraded?: string
}

const cache = new Map<string, { at: number; payload: Payload }>()
const hitsByCaller = new Map<string, number[]>()

/**
 * Who is asking, for rate-limiting purposes only.
 *
 * `verify_jwt` is on, so the platform has already verified this token before
 * the request reaches us — reading it here without verifying decides which
 * bucket to count against, never what anyone is allowed to do. A token we
 * cannot read shares one bucket, which is the conservative direction.
 */
function callerOf(req: Request): string {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const [, payload] = token.split('.')
  if (!payload) return 'anonymous'
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded))
    return typeof claims?.sub === 'string' && claims.sub ? claims.sub : 'anonymous'
  } catch {
    return 'anonymous'
  }
}

function cached(key: string): Payload | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.payload
}

function remember(key: string, payload: Payload) {
  // Instances are short-lived and this is a convenience, not a store, so the
  // eviction only has to stop one instance growing without bound.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { at: Date.now(), payload })
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', ...extra },
  })
}

async function searchConstructor(query: string, limit: number): Promise<unknown[]> {
  const url = new URL(`${CONSTRUCTOR_SEARCH}/${encodeURIComponent(query)}`)
  url.searchParams.set('key', CONSTRUCTOR_KEY)
  url.searchParams.set('section', 'Products')
  url.searchParams.set('num_results_per_page', String(limit))
  // Scopes stock and assortment to our store, and narrows the result set to
  // what this shop actually carries.
  url.searchParams.set('us', STORE)

  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  })
  if (!response.ok) throw new Error(`constructor ${response.status}`)
  const body = await response.json()
  const results = body?.response?.results
  return Array.isArray(results) ? results : []
}

async function fetchInventories(ids: string[]): Promise<unknown[]> {
  if (ids.length === 0) return []
  const response = await fetch(INVENTORIES, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'accept-language': 'lt-LT,lt;q=0.9',
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify(ids),
  })
  if (!response.ok) throw new Error(`inventories ${response.status}`)
  const body = await response.json()
  return Array.isArray(body) ? body : []
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let query = ''
  let limit = DEFAULT_LIMIT
  try {
    const body = await req.json()
    query = String(body?.query ?? '').trim()
    if (body?.limit !== undefined) {
      const asked = Number(body.limit)
      if (Number.isFinite(asked)) limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(asked)))
    }
  } catch {
    return json({ error: 'expected a JSON body' }, 400)
  }

  // A blank or absurd query is a bug in the caller, not something to ask
  // Barbora about.
  if (!query) return json({ error: 'query is required' }, 400)
  if (query.length > 80) return json({ error: 'query is too long' }, 400)

  const key = `${query.toLowerCase()}|${limit}`
  const hit = cached(key)
  if (hit) return json(hit, 200, { 'x-cache': 'hit' })

  // Counted only past the cache: a repeat of something we already hold costs
  // Barbora nothing, so a loop over one ingredient is absorbed, not refused.
  const caller = callerOf(req)
  const verdict = admit(hitsByCaller.get(caller) ?? [], Date.now(), RATE_LIMIT, RATE_WINDOW_MS)
  if (hitsByCaller.size >= RATE_MAX_CALLERS && !hitsByCaller.has(caller)) {
    const oldest = hitsByCaller.keys().next()
    if (!oldest.done) hitsByCaller.delete(oldest.value)
  }
  hitsByCaller.set(caller, verdict.hits)
  if (!verdict.allowed) {
    return json(
      { error: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds },
      429,
      { 'retry-after': String(verdict.retryAfterSeconds) },
    )
  }

  let results: unknown[]
  try {
    results = await searchConstructor(query, limit)
  } catch (error) {
    return json({ error: `search failed: ${error}` }, 502)
  }

  const ids = results
    .map((result) => (result as { data?: { id?: unknown } })?.data?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  // Matches without prices are still worth showing: real products, working
  // links, and the client renders them priced "nothing" rather than guessing.
  let inventories: unknown[] = []
  let degraded: string | undefined
  try {
    inventories = await fetchInventories(ids)
  } catch (error) {
    degraded = String(error)
  }

  const payload: Payload = {
    query,
    store: STORE,
    fetchedAt: new Date().toISOString(),
    results,
    inventories,
    ...(degraded ? { degraded } : {}),
  }
  // Only a complete answer is worth keeping; a degraded one should be retried.
  if (!degraded) remember(key, payload)

  return json(payload, 200, { 'x-cache': 'miss' })
})
