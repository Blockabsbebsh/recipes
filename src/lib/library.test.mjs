import assert from 'node:assert/strict'
import test from 'node:test'
import { facetCounts, liveChoice, orderLibrary } from './library.js'

const entry = (title, dishType, cuisine, lastCooked = null) => ({ id: title, title, dishType, cuisine, lastCooked })

const SHELF = [
  entry('Šaltibarščiai', 'Sriubos', 'Lietuvių', '2026-08-01'),
  entry('Avinžirnių karis', 'Troškiniai ir kariai', 'Indų', null),
  entry('Pomidorų sriuba', 'Sriubos', 'Italų', '2026-01-14'),
  entry('Blynai', 'Pusryčiai', 'Lietuvių', '2026-09-02'),
  entry('Cukinijų blynai', 'Pusryčiai', 'Tarptautinė', null),
]
const TYPES = ['Pusryčiai', 'Sriubos', 'Troškiniai ir kariai']

test('by type: the household order, then the name inside it', () => {
  assert.deepEqual(orderLibrary(SHELF, 'type', TYPES).map((e) => e.title),
    ['Blynai', 'Cukinijų blynai', 'Pomidorų sriuba', 'Šaltibarščiai', 'Avinžirnių karis'])
})

test('a dish type the household order does not mention goes last, not first', () => {
  const odd = [...SHELF, entry('Pica', 'Kepiniai ir picos', 'Italų')]
  assert.equal(orderLibrary(odd, 'type', TYPES).at(-1).title, 'Pica')
})

test('by staleness: never cooked first, then longest ago', () => {
  // Never cooked is the longest of all — it has been waiting since the day it
  // was written down, and those are the ones you meant to make.
  assert.deepEqual(orderLibrary(SHELF, 'stale', TYPES).map((e) => e.title),
    ['Avinžirnių karis', 'Cukinijų blynai', 'Pomidorų sriuba', 'Šaltibarščiai', 'Blynai'])
})

test('neither order depends on the order the rows arrived in', () => {
  const shuffled = [...SHELF].reverse()
  for (const sort of ['type', 'stale']) {
    assert.deepEqual(orderLibrary(shuffled, sort, TYPES).map((e) => e.title),
      orderLibrary(SHELF, sort, TYPES).map((e) => e.title), sort)
  }
})

test('ordering leaves the array it was given alone', () => {
  const before = SHELF.map((e) => e.title)
  orderLibrary(SHELF, 'stale', TYPES)
  assert.deepEqual(SHELF.map((e) => e.title), before)
})

test('facets count what is there, in the household order then the rest', () => {
  assert.deepEqual(facetCounts(SHELF, 'dishType', TYPES),
    [{ name: 'Pusryčiai', count: 2 }, { name: 'Sriubos', count: 2 }, { name: 'Troškiniai ir kariai', count: 1 }])
})

test('a facet with nothing in it is not offered', () => {
  const soupsOnly = SHELF.filter((e) => e.dishType === 'Sriubos')
  assert.deepEqual(facetCounts(soupsOnly, 'dishType', TYPES), [{ name: 'Sriubos', count: 2 }])
})

test('cuisines nobody put in an order come back alphabetically', () => {
  assert.deepEqual(facetCounts(SHELF, 'cuisine').map((f) => f.name),
    ['Indų', 'Italų', 'Lietuvių', 'Tarptautinė'])
})

test('a choice nothing can satisfy stops being a filter', () => {
  // Type a word that only soups match while the Desertai chip is on, and every
  // chip empties. An empty library with no visible reason for it is worse than
  // dropping the filter.
  assert.equal(liveChoice('Desertai', facetCounts(SHELF, 'dishType', TYPES)), null)
  assert.equal(liveChoice('Sriubos', facetCounts(SHELF, 'dishType', TYPES)), 'Sriubos')
  assert.equal(liveChoice(null, facetCounts(SHELF, 'dishType', TYPES)), null)
})

import { daysSinceCooked, suggestRecipes } from './library.js'
const today = new Date(2026, 8, 7, 12)
const candidate = (id, title, lastCooked = null) => ({ id, title, lastCooked })
test('alphabetical default is Lithuanian and duplicate titles tie on ID', () => {
  const rows = [candidate('z', 'Žirniai'), candidate('b', 'Ąžuolas'), candidate('a', 'Ąžuolas'), candidate('c', 'Blynai')]
  assert.deepEqual(orderLibrary(rows, 'title').map(row => row.id), ['a', 'b', 'c', 'z'])
  assert.equal(rows[0].id, 'z')
})
test('many unrecorded recipes occupy only one discovery slot', () => {
  const rows = Array.from({ length: 106 }, (_, i) => candidate(String(i), `Receptas ${i}`))
  rows.push(candidate('old', 'Sriuba', new Date(2026, 7, 20).toISOString()))
  const result = suggestRecipes(rows, new Set(), today)
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(item => item.kind), ['familiar', 'discovery'])
  assert.equal(result[0].entry.id, 'old')
})
test('seven local calendar days qualify regardless of cooking hour', () => {
  assert.equal(daysSinceCooked(new Date(2026, 7, 31, 23, 59).toISOString(), today), 7)
  assert.equal(suggestRecipes([candidate('a', 'Sriuba', new Date(2026, 7, 31, 23, 59).toISOString())], new Set(), today).length, 1)
  assert.equal(suggestRecipes([candidate('b', 'Sriuba', new Date(2026, 8, 1).toISOString())], new Set(), today).length, 0)
})
test('ready, queued and deleted candidates are excluded without inspecting products', () => {
  const rows = [candidate('ready', 'A'), candidate('queued', 'B'), { ...candidate('deleted', 'C'), deleted_at: '2026-09-01' }, candidate('eligible', 'D')]
  Object.defineProperty(rows[3], 'products', { get() { throw Error('must not read basket or products') } })
  assert.deepEqual(suggestRecipes(rows, new Set(['ready', 'queued']), today).map(item => item.entry.id), ['eligible'])
})
test('equal instants with different offsets tie by title and ID', () => {
  const rows = [candidate('b', 'Sriuba', '2026-08-01T12:00:00Z'), candidate('a', 'Sriuba', '2026-08-01T15:00:00+03:00')]
  assert.equal(suggestRecipes(rows, new Set(), today)[0].entry.id, 'a')
  assert.deepEqual(orderLibrary(rows, 'stale').map(row => row.id), ['a', 'b'])
})
test('recent, future and invalid history cannot create a familiar suggestion', () => {
  const rows = [candidate('a', 'A', 'bad date'), candidate('b', 'B', new Date(2026, 8, 8).toISOString()), candidate('c', 'C', new Date(2026, 8, 6).toISOString())]
  assert.deepEqual(suggestRecipes(rows, new Set(), today), [])
  assert.deepEqual(suggestRecipes([], new Set(), today), [])
})
test('suggestions leave source records and order untouched', () => {
  const rows = Object.freeze([Object.freeze(candidate('b', 'B')), Object.freeze(candidate('a', 'A'))])
  assert.equal(suggestRecipes(rows, new Set(), today)[0].entry.id, 'a')
  assert.equal(rows[0].id, 'b')
})
