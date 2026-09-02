import assert from 'node:assert/strict'
import test from 'node:test'
import { EMPTY_SCROLL, SCROLL_MEMORY_MS, lastTab, parseViewState, positionsFrom, readViewState, rememberLastTab, viewStateKey, writeViewState } from './viewState.js'

const record = (over = {}) => ({
  version: 1,
  tab: 'shop',
  scrollByTab: { current: 0, library: 1500, shop: 605, deleted: 0 },
  expandedRecipeId: null,
  savedAt: 1_000_000,
  ...over,
})

const store = () => {
  const held = new Map()
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => { held.set(key, String(value)) },
  }
}

test('two people on one device do not inherit each other’s place', () => {
  assert.notEqual(viewStateKey('user-a', 'house'), viewStateKey('user-b', 'house'))
  assert.notEqual(viewStateKey('user-a', 'house-1'), viewStateKey('user-a', 'house-2'))
})

test('reads back what it wrote', () => {
  const storage = store()
  const state = record()
  assert.equal(writeViewState('k', state, storage), true)
  assert.deepEqual(readViewState('k', storage), state)
})

test('refuses anything that is not one of its own records', () => {
  for (const raw of [null, '', '{not json', 'null', '[]', '{"version":2,"tab":"shop"}', '{"version":1,"tab":"elsewhere"}']) {
    assert.equal(parseViewState(raw), null, `refused ${JSON.stringify(raw)}`)
  }
})

test('repairs a record with nonsense in its numbers', () => {
  const parsed = parseViewState(JSON.stringify(record({
    scrollByTab: { current: -40, library: 'far', shop: Number.NaN, deleted: 12 },
    expandedRecipeId: 7,
    savedAt: 'yesterday',
  })))
  assert.deepEqual(parsed.scrollByTab, { current: 0, library: 0, shop: 0, deleted: 12 })
  assert.equal(parsed.expandedRecipeId, null)
  assert.equal(parsed.savedAt, 0, 'a record from before the timestamp existed is old by definition')
})

test('a storage that refuses to write does not take the app down with it', () => {
  const angry = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
  assert.equal(writeViewState('k', record(), angry), false)
  assert.equal(readViewState('k', angry), null)
})

test('positions from this sitting come back', () => {
  const state = record()
  assert.deepEqual(positionsFrom(state, state.savedAt + 60_000), state.scrollByTab)
})

test('positions from yesterday do not', () => {
  const state = record()
  assert.deepEqual(positionsFrom(state, state.savedAt + SCROLL_MEMORY_MS + 1), EMPTY_SCROLL)
  assert.deepEqual(positionsFrom(null), EMPTY_SCROLL)
})

test('a clock that has gone backwards is not treated as the future', () => {
  const state = record()
  assert.deepEqual(positionsFrom(state, state.savedAt - 60_000), EMPTY_SCROLL)
})

test('positions are a copy, so the caller cannot edit the record', () => {
  const state = record()
  const positions = positionsFrom(state, state.savedAt)
  positions.shop = 0
  assert.equal(state.scrollByTab.shop, 605)
})

test('the tab is left where the next cold start can read it', () => {
  const storage = store()
  writeViewState('k', record({ tab: 'library' }), storage)
  assert.equal(lastTab(storage), 'library', 'readable without knowing the user or household')
})

test('a cold start with nothing stored begins at the menu', () => {
  assert.equal(lastTab(store()), null)
})

test('a tab this app does not have is not painted', () => {
  const storage = store()
  storage.setItem('recipes:view:last-tab', 'elsewhere')
  assert.equal(lastTab(storage), null)
})

test('a storage that refuses does not take the write down with it', () => {
  const angry = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
  assert.doesNotThrow(() => rememberLastTab('shop', angry))
  assert.equal(lastTab(angry), null)
})
