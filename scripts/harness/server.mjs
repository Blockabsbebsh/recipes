// A stand-in for Supabase: enough GoTrue and PostgREST for the app to sign in,
// load, and mutate. Not a real database — just enough truth for the app to
// behave like the live one, so it can be driven and broken safely.
//
// Everything lives in memory and is thrown away when the process exits, so a
// probe can delete every recipe without consequence.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { HOUSEHOLD_ID, OTHER_USER_ID, USER_ID, makeData } from './fixtures.mjs'

const catalogue = JSON.parse(
  readFileSync(new URL('../../data/barbora-categories.json', import.meta.url), 'utf8'),
)
const db = makeData()
db.barbora_categories = catalogue.categories.map((c) => ({
  path: c.path, name: c.name, parent_path: c.parentPath, depth: c.depth,
  sort_order: c.sortOrder, active: true,
}))

const MONTH = 30 * 24 * 3600
const person = (id, email) => ({ id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })

// Two members of one household, told apart by the address they sign in with.
// Their tokens differ, so a request says which of them it belongs to.
const PEOPLE = {
  'testas@example.com': person(USER_ID, 'testas@example.com'),
  'kitas@example.com': person(OTHER_USER_ID, 'kitas@example.com'),
}
const USER = PEOPLE['testas@example.com']
const tokenFor = (user) => `fake-access-token-${user.id}`
const sessionFor = (user) => ({
  access_token: tokenFor(user), token_type: 'bearer', expires_in: MONTH,
  expires_at: Math.floor(Date.now() / 1000) + MONTH, refresh_token: `fake-refresh-${user.id}`, user,
})
const SESSION = sessionFor(USER)

/** Which member a request is from, by its bearer token. */
const callerOf = (req) => {
  const auth = String(req.headers.authorization || '')
  return Object.values(PEOPLE).find((user) => auth.includes(user.id)) ?? USER
}

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

/**
 * The Barbora lookup, answered from a fixture rather than from Barbora.
 *
 * The real Edge Function calls Constructor.io and `barbora.lt`. A harness that
 * reached either would make its scenarios depend on a shop's stock, its
 * prices, and the network — the same reason this stub exists for Supabase.
 * The shapes are copies of real responses, so the merge in
 * `src/lib/barboraProducts.js` is exercised for real.
 */
function barboraProducts(query) {
  const results = [
    {
      value: `${query} \u2014 pirmas variantas`,
      data: {
        id: '000000000000892000',
        url: 'uat-pienas-farm-milk-3-2-proc-rieb-1-l',
        brand: 'Farm milk',
        image_url: 'https://cdn.barbora.lt/products/3cfc2270.png',
        inStock_X500: true,
        isOnSale_X500: false,
        inAssortment_X500: true,
      },
    },
    {
      value: `${query} \u2014 antras variantas`,
      data: {
        id: '000000000000534864',
        url: 'rokiskio-namine-grietine-30-proc-rieb-400-g',
        brand: 'ROKI\u0160KIO NAMINIS',
        image_url: 'https://cdn.barbora.lt/products/f9d51510.png',
        inStock_X500: true,
        isOnSale_X500: true,
        inAssortment_X500: true,
      },
    },
    {
      // Marked in stock by the index and suspended by the shop, which is the
      // disagreement that used to render a buyable product as unavailable.
      value: `${query} \u2014 tre\u010dias variantas`,
      data: {
        id: '000000000001409411',
        url: 'nauja-bulviu-traskuciai-brets-su-pestu-ir-mocarela-125-g',
        brand: 'BRETS',
        image_url: 'https://cdn.barbora.lt/products/f9b4dd2e.png',
        inStock_X500: true,
        isOnSale_X500: false,
        inAssortment_X500: true,
      },
    },
  ]
  const inventories = [
    {
      id: '000000000000892000',
      title: `${query} \u2014 pirmas variantas`,
      shopcode: 'X500',
      price: 0.94,
      comparative_unit: 'l',
      comparative_unit_price: 0.94,
      promotion: null,
      status: 'active',
      Url: 'uat-pienas-farm-milk-3-2-proc-rieb-1-l',
    },
    {
      id: '000000000000534864',
      title: `${query} \u2014 antras variantas`,
      shopcode: 'X500',
      price: 1.79,
      retail_price: 2.69,
      comparative_unit: 'kg',
      comparative_unit_price: 4.48,
      promotion: { oldPrice: 2.69, percentage: 33, type: 'DISCOUNT_PRICE', loyaltyCardRequired: false },
      status: 'active',
      Url: 'rokiskio-namine-grietine-30-proc-rieb-400-g',
    },
    {
      id: '000000000001409411',
      title: `${query} \u2014 tre\u010dias variantas`,
      shopcode: 'X500',
      price: 2.39,
      comparative_unit: 'kg',
      comparative_unit_price: 19.12,
      promotion: null,
      status: 'suspended',
      Url: 'nauja-bulviu-traskuciai-brets-su-pestu-ir-mocarela-125-g',
    },
  ]
  return { query, store: 'X500', fetchedAt: new Date().toISOString(), results, inventories }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'OPTIONS') return send(res, 204)

  if (url.pathname.startsWith('/auth/v1')) {
    if (url.pathname.endsWith('/logout')) return send(res, 204)
    if (url.pathname.endsWith('/user')) return send(res, 200, callerOf(req))
    const asked = (await readBody(req))?.email
    return send(res, 200, sessionFor(PEOPLE[asked] ?? USER))   // token, signup, recover
  }

  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.split('/').pop()
    // Answers null for a code it does not know, exactly as the real function
    // does — a stub that always succeeded would hide the client's handling of
    // the one answer a wrong code gives.
    if (fn === 'join_household') {
      const sent = (await readBody(req))?.p_invite_code ?? ''
      const code = String(sent).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      const known = db.households?.[0]?.invite_code?.toUpperCase()
      if (!code || code !== known) return send(res, 200, null)
      // The real function adds the caller to the household; a stub that only
      // answered with an id would let a scenario "join" and change nothing.
      db.household_members ??= []
      if (!db.household_members.some((row) => row.user_id === USER_ID)) {
        db.household_members.push({ id: randomUUID(), household_id: HOUSEHOLD_ID, user_id: USER_ID, display_name: null })
      }
      return send(res, 200, HOUSEHOLD_ID)
    }
    if (fn === 'save_recipe' || fn === 'save_recipes_import') {
      const body = await readBody(req)
      const write = (recipeBody) => {
        const now = new Date().toISOString()
        const existing = recipeBody.p_recipe_id
          ? db.recipes.find((recipe) => recipe.id === recipeBody.p_recipe_id)
          : null
        const recipe = existing ?? {
          id: randomUUID(),
          household_id: recipeBody.p_household_id,
          created_by: callerOf(req).id,
          created_at: now,
          deleted_at: null,
          deleted_by: null,
          recipe_ingredients: [],
          recipe_tags: [],
        }
        Object.assign(recipe, {
          title: recipeBody.p_title,
          notes: recipeBody.p_notes,
          source_url: recipeBody.p_source_url,
          updated_at: now,
        })
        if (!existing) db.recipes.push(recipe)

        const names = [...new Map((recipeBody.p_ingredient_names ?? [])
          .map((name) => [String(name).trim().toLocaleLowerCase('lt'), String(name).trim()])).values()]
        recipe.recipe_ingredients = names.map((name, position) => {
          let ingredient = db.ingredients.find((row) => row.name.toLocaleLowerCase('lt') === name.toLocaleLowerCase('lt'))
          if (!ingredient) {
            ingredient = {
              id: randomUUID(), household_id: recipeBody.p_household_id, name,
              section: 'Other', food_type: 'Other', created_at: now, updated_at: now,
              barbora_category_path: null, barbora_mapping_reason: null,
              barbora_mapping_source: null, barbora_mapping_updated_at: null,
              barbora_direct_url: null,
            }
            db.ingredients.push(ingredient)
          }
          return {
            id: randomUUID(), household_id: recipeBody.p_household_id,
            recipe_id: recipe.id, ingredient_id: ingredient.id, item: ingredient.name, position,
          }
        })
        db.recipe_ingredients = db.recipe_ingredients.filter((row) => row.recipe_id !== recipe.id)
        db.recipe_ingredients.push(...recipe.recipe_ingredients)

        const tagNames = recipeBody.p_tag_names ?? []
        const tags = tagNames.map((name) => {
          let tag = db.tags.find((row) => row.name.toLocaleLowerCase('lt') === String(name).toLocaleLowerCase('lt'))
          if (!tag) {
            tag = { id: randomUUID(), household_id: recipeBody.p_household_id, name: String(name), created_at: now }
            db.tags.push(tag)
          }
          return { tag: { id: tag.id, name: tag.name } }
        })
        recipe.recipe_tags = [
          ...recipe.recipe_tags.filter(({ tag }) => !/^(Tipas|Virtuvė): /i.test(tag.name)),
          ...tags,
        ]

        if (recipeBody.p_add_to_queue && !db.shopping_queue.some((row) => row.recipe_id === recipe.id)) {
          db.shopping_queue.push({
            id: randomUUID(), household_id: recipeBody.p_household_id, recipe_id: recipe.id,
            added_by: callerOf(req).id, added_at: now,
          })
        }
        return recipe.id
      }

      if (fn === 'save_recipe') return send(res, 200, write(body))
      for (const recipe of body?.p_recipes ?? []) {
        write({
          p_household_id: body.p_household_id,
          p_recipe_id: null,
          p_title: recipe.title,
          p_notes: recipe.notes,
          p_source_url: recipe.source_url,
          p_ingredient_names: recipe.ingredients,
          p_tag_names: recipe.tags,
          p_add_to_queue: false,
        })
      }
      return send(res, 200, body?.p_recipes?.length ?? 0)
    }
    if (fn === 'delete_ingredient') {
      const body = await readBody(req)
      db.recipe_ingredients = db.recipe_ingredients.filter((row) => row.ingredient_id !== body.p_ingredient_id)
      for (const recipe of db.recipes) {
        recipe.recipe_ingredients = recipe.recipe_ingredients.filter((row) => row.ingredient_id !== body.p_ingredient_id)
      }
      db.ingredients = db.ingredients.filter((row) => row.id !== body.p_ingredient_id)
      return send(res, 204)
    }
    // The one procedure the app relies on doing real work: everything in the
    // basket becomes something to cook, and the basket is emptied. Stubbing it
    // as a no-op would let a scenario "complete a shop" and prove nothing.
    if (fn === 'complete_shopping') {
      db.shopping_queue ??= []
      db.roster_entries ??= []
      const moved = db.shopping_queue.length
      for (const entry of db.shopping_queue) {
        db.roster_entries.push({
          id: `roster-${db.roster_entries.length + 1}-${entry.recipe_id}`,
          household_id: entry.household_id,
          recipe_id: entry.recipe_id,
          added_by: entry.added_by,
          added_at: new Date().toISOString(),
          status: 'ready',
          resolved_at: null,
          resolved_by: null,
        })
      }
      db.shopping_queue = []
      return send(res, 200, moved)
    }
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

  if (url.pathname === '/functions/v1/barbora-products') {
    const query = String((await readBody(req))?.query ?? '').trim()
    if (!query) return send(res, 400, { error: 'query is required' })
    return send(res, 200, barboraProducts(query))
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
