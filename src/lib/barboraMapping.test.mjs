import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  BARBORA_ORIGIN,
  CATEGORY_ALIASES,
  SECTION_ROOTS,
  buildCategoryIndex,
  categoryTerms,
  descendantsOf,
  mapIngredient,
  shoppingUrl,
  suggestCategories,
  trailTo,
} from './barboraMapping.js'

const catalogue = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/barbora-categories.json', import.meta.url)), 'utf8'),
)
const index = buildCategoryIndex(catalogue.categories)
const map = (name, section) => mapIngredient(name, section, index)

test('gives a top-level aisle the trailing slash its app link needs', () => {
  // Barbora claims `/<aisle>/*` in its app-link files, and a bare `/<aisle>`
  // does not match that pattern: without the slash the link opens a browser.
  assert.equal(shoppingUrl('/bakaleja'), `${BARBORA_ORIGIN}/bakaleja/`)
  assert.equal(shoppingUrl('/darzoves-ir-vaisiai'), `${BARBORA_ORIGIN}/darzoves-ir-vaisiai/`)
  // Deeper paths already match the pattern and are left alone.
  assert.equal(shoppingUrl('/bakaleja/kruopos'), `${BARBORA_ORIGIN}/bakaleja/kruopos`)
  assert.equal(
    shoppingUrl('/bakaleja/kruopos/grikiai'),
    `${BARBORA_ORIGIN}/bakaleja/kruopos/grikiai`,
  )
})

test('every section aisle produces a link Barbora claims', () => {
  const claimed = /^https:\/\/barbora\.lt\/[a-z0-9-]+\/.*$/
  for (const root of Object.values(SECTION_ROOTS)) {
    if (root === null) continue
    assert.match(shoppingUrl(root), claimed, `${root} would not open the app`)
  }
})

test('reads a category label as the several answers it holds', () => {
  // Normalizing strips the comma, so the split has to happen first.
  assert.deepEqual(categoryTerms('Bulvės, morkos ir kopūstai'), ['bulves', 'morkos', 'kopustai'])
  assert.deepEqual(categoryTerms('Avokadai'), ['avokadai'])
  assert.deepEqual(categoryTerms('Salotos ir jų mišiniai'), ['salotos', 'ju misiniai'])
})

test('descends to the one category the shop plainly names', () => {
  assert.deepEqual(map('Pomidorai', 'Produce'), {
    path: '/darzoves-ir-vaisiai/darzoves-ir-grybai/pomidorai-ir-agurkai',
    reason: 'exact',
  })
  assert.deepEqual(map('Morkos', 'Produce'), {
    path: '/darzoves-ir-vaisiai/darzoves-ir-grybai/bulves-morkos-ir-kopustai',
    reason: 'exact',
  })
  assert.equal(map('Grikiai', 'Pantry').path, '/bakaleja/kruopos/grikiai')
})

test('ignores the quantity and the casing the household typed', () => {
  const expected = '/darzoves-ir-vaisiai/darzoves-ir-grybai/pomidorai-ir-agurkai'
  assert.equal(map('pomidorai', 'Produce').path, expected)
  assert.equal(map('POMIDORAI 2x', 'Produce').path, expected)
  assert.equal(map('  Pomidorai  ', 'Produce').path, expected)
})

test('takes the shelf, not the aisle, when both carry the name', () => {
  // "Grietinė" names the aisle above it too; the deeper one is the answer.
  assert.deepEqual(map('Grietinė', 'Dairy & alternatives'), {
    path: '/pieno-gaminiai-kiausiniai-ir-majonezas/grietine-ir-grietinele/grietine-ir-kastinys',
    reason: 'exact',
  })
})

test('retreats to the parent when the shop sells it in two places', () => {
  // Batonas appears on the fresh-bread shelf and the sandwich-bread shelf.
  assert.deepEqual(map('Batonas', 'Bakery'), {
    path: '/duonos-gaminiai-ir-konditerija/duona',
    reason: 'parent_fallback',
  })
})

test('refuses to choose when the branches share nothing but the section', () => {
  // Chickpeas are sold tinned and dry, in different aisles. Guessing either
  // sends someone to the wrong end of the shop.
  assert.equal(map('Avinžirniai', 'Pantry'), null)
})

test('leaves an ingredient alone when nothing matches', () => {
  assert.equal(map('Gochujang', 'Pantry'), null)
  assert.equal(map('Seitanas', 'Dairy & alternatives'), null)
  // "Ryžiai" names no category: every rice shelf is a specific rice.
  assert.equal(map('Ryžiai', 'Pantry'), null)
})

test('has no honest starting point for the Other section', () => {
  assert.equal(map('Pomidorai', 'Other'), null)
})

test('lets a reviewed alias reach where the section root cannot', () => {
  // Salt is filed under sugar and baking, not under spices.
  assert.deepEqual(map('Druska', 'Spices'), {
    path: '/bakaleja/cukrus-druska-ir-kepimo-priedai/druska',
    reason: 'alias',
  })
  assert.equal(map('Sojų padažas', 'Pantry').reason, 'alias')
})

test('every alias points at a category that exists', () => {
  for (const [name, path] of Object.entries(CATEGORY_ALIASES)) {
    assert.ok(index.byPath.has(path), `alias ${name} points at missing ${path}`)
  }
})

test('an alias outranks the tree walk', () => {
  // "Miltai" would otherwise stop at the flour aisle; the alias names a shelf.
  assert.equal(map('Miltai', 'Pantry').path, '/bakaleja/miltai-ir-ju-misiniai/kvietiniai-ir-ruginiai-miltai')
})

test('never proposes a category outside the ingredient section', () => {
  for (const [section, root] of Object.entries({
    Produce: '/darzoves-ir-vaisiai',
    Bakery: '/duonos-gaminiai-ir-konditerija',
    Frozen: '/saldytas-maistas',
  })) {
    for (const name of ['Pomidorai', 'Duona', 'Šaldytos uogos', 'Sūris', 'Makaronai']) {
      const result = map(name, section)
      if (result && !Object.values(CATEGORY_ALIASES).includes(result.path)) {
        assert.ok(result.path.startsWith(root), `${name} in ${section} escaped to ${result.path}`)
      }
    }
  }
})

test('resemblance alone never becomes a mapping', () => {
  // "Pomidorų padažas" reads like several tomato categories, so the walk
  // declines; only the human-facing suggestions may rank them.
  assert.equal(map('Pomidorų padažas', 'Pantry'), null)
  const suggestions = suggestCategories('Pomidorų padažas', catalogue.categories)
  assert.ok(suggestions.length > 0)
  assert.ok(suggestions.some((category) => category.name.includes('Pomidorų padažai')))
})

test('suggestions stay quiet for an empty query', () => {
  assert.deepEqual(suggestCategories('', catalogue.categories), [])
  assert.deepEqual(suggestCategories('   ', catalogue.categories), [])
})

test('walks the tree by path alone', () => {
  const children = index.children.get('/bakaleja/makaronai')
  assert.ok(children.length >= 3)
  assert.ok(children.every((category) => category.depth === 3))
  assert.equal(descendantsOf(index, '/bakaleja/makaronai').length, children.length)
  assert.ok(descendantsOf(index, '/bakaleja').length > children.length)
})

test('builds the breadcrumb a picker shows', () => {
  const trail = trailTo(index, '/bakaleja/padazai-ir-konservuotos-uztepeles/kecupai')
  assert.deepEqual(trail.map((category) => category.name), [
    'Bakalėja', 'Padažai ir konservuotos užtepėlės', 'Kečupai',
  ])
})

test('proposes something for a useful share of a real vocabulary', () => {
  // A guard against a refactor quietly turning the mapper into a no-op.
  const sample = [
    ['Pomidorai', 'Produce'], ['Bulvės', 'Produce'], ['Svogūnai', 'Produce'],
    ['Duona', 'Bakery'], ['Sūris', 'Dairy & alternatives'], ['Pienas', 'Dairy & alternatives'],
    ['Makaronai', 'Pantry'], ['Druska', 'Spices'], ['Cukrus', 'Pantry'],
  ]
  const mapped = sample.filter(([name, section]) => map(name, section) !== null)
  assert.equal(mapped.length, sample.length)
})
