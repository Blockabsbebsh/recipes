import assert from 'node:assert/strict'
import test from 'node:test'

// The trace is browser code, but everything interesting about it — the cap,
// the collapsing, the refusal to throw — is plain logic worth pinning down.
const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
  },
  performance: { getEntriesByType: () => [{ type: 'reload' }] },
}

const { clearTrace, formatTrace, navigationKind, readTrace, trace, visualTop } = await import('./scrollTrace.js')

test.beforeEach(() => { store.clear() })

test('records events oldest first', () => {
  trace('boot', { nav: 'navigate' })
  trace('write', { tab: 'library', y: 1500 })
  assert.deepEqual(readTrace().map((entry) => entry.kind), ['boot', 'write'])
  assert.equal(readTrace()[1].y, 1500)
})

test('collapses a run of captures so lifecycle events survive it', () => {
  trace('pagehide', { y: 0 })
  for (let y = 0; y < 200; y += 1) trace('capture', { from: 'scroll', y })
  const entries = readTrace()
  assert.deepEqual(entries.map((entry) => entry.kind), ['pagehide', 'capture'])
  assert.equal(entries[1].y, 199, 'the surviving capture is the most recent one')
})

test('keeps captures apart when they came from different places or reasons', () => {
  trace('capture', { from: 'scroll', y: 10 })
  trace('capture', { from: 'settle', y: 20 })
  trace('capture-skipped', { from: 'settle', y: 0, why: 'hidden' })
  trace('capture-skipped', { from: 'settle', y: 0, why: 'modal' })
  assert.equal(readTrace().length, 4)
})

test('keeps only the most recent 60 events', () => {
  for (let i = 0; i < 90; i += 1) trace('write', { i })
  const entries = readTrace()
  assert.equal(entries.length, 60)
  assert.equal(entries[0].i, 30)
})

test('survives a storage that refuses to write', () => {
  window.localStorage.setItem = () => { throw new Error('QuotaExceededError') }
  assert.doesNotThrow(() => trace('write', { y: 1 }))
  window.localStorage.setItem = (key, value) => { store.set(key, String(value)) }
})

test('survives a corrupted trace', () => {
  store.set('recipes:scroll-trace:v1', '{not json')
  assert.deepEqual(readTrace(), [])
  trace('boot', {})
  assert.deepEqual(readTrace().map((entry) => entry.kind), ['boot'])
})

test('prints one readable line per event', () => {
  trace('load', { nav: 'reload', tab: 'library', y: 1500 })
  const [line] = formatTrace().split('\n')
  assert.match(line, /^\d\d:\d\d:\d\d load nav=reload tab=library y=1500$/)
  clearTrace()
  assert.equal(formatTrace(), 'Įrašų nėra.')
})

test('reports how the page was loaded', () => {
  assert.equal(navigationKind(), 'reload')
})

test('reports where the page looks to be, and says so when it cannot tell', () => {
  assert.equal(visualTop(), -1, 'no visual viewport to ask')
  window.visualViewport = { pageTop: 1116.4 }
  assert.equal(visualTop(), 1116)
  delete window.visualViewport
})
