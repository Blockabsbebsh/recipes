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
