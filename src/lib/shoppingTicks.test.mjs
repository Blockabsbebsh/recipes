import assert from 'node:assert/strict'
import test from 'node:test'
import { clearTicks, readTicks, shoppingProgress, ticksKey, toggleTick, writeTicks } from './shoppingTicks.js'

const store = () => {
  const held = new Map()
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => { held.set(key, String(value)) },
    removeItem: (key) => { held.delete(key) },
    held,
  }
}

test('two households do not share a trolley', () => {
  assert.notEqual(ticksKey('house-a'), ticksKey('house-b'))
})

test('reads back what it wrote', () => {
  const storage = store()
  writeTicks('k', new Set(['Morkos', 'Grybai']), storage)
  assert.deepEqual([...readTicks('k', ['Morkos', 'Grybai'], storage)].sort(), ['Grybai', 'Morkos'])
})

test('a tick for something no longer on the list is dropped', () => {
  const storage = store()
  writeTicks('k', new Set(['Morkos', 'Grybai']), storage)
  assert.deepEqual([...readTicks('k', ['Morkos'], storage)], ['Morkos'])
})

test('and it is dropped for good, not just hidden while it is away', () => {
  // The whole basket emptied and refilled with the same meals. Filtering only
  // on the way out let every tick come back, because the names had never left
  // storage — they had only been off the list for a while.
  const storage = store()
  writeTicks('k', new Set(['Morkos', 'Grybai']), storage)
  readTicks('k', [], storage)
  assert.deepEqual([...readTicks('k', ['Morkos', 'Grybai'], storage)], [],
    'a tick survived its row leaving the list')
})

test('reading an unchanged list does not rewrite storage', () => {
  // This runs on every render of the shopping tab.
  const storage = store()
  writeTicks('k', new Set(['Morkos']), storage)
  let writes = 0
  const counting = { ...storage, setItem: (key, value) => { writes += 1; storage.setItem(key, value) } }
  readTicks('k', ['Morkos', 'Grybai'], counting)
  assert.equal(writes, 0)
})

test('nothing stored, nothing ticked', () => {
  assert.equal(readTicks('k', ['Morkos'], store()).size, 0)
})

test('rubbish in storage is not a crash', () => {
  const storage = store()
  storage.setItem('k', '{not json')
  assert.equal(readTicks('k', ['Morkos'], storage).size, 0)
  storage.setItem('k', '{"Morkos":true}')
  assert.equal(readTicks('k', ['Morkos'], storage).size, 0)
})

test('a storage that refuses does not stop the shop', () => {
  const refuses = { getItem: () => null, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('nope') } }
  assert.equal(writeTicks('k', new Set(['Morkos']), refuses), false)
  assert.doesNotThrow(() => clearTicks('k', refuses))
})

test('finishing the shop empties the trolley', () => {
  const storage = store()
  writeTicks('k', new Set(['Morkos']), storage)
  clearTicks('k', storage)
  assert.equal(storage.getItem('k'), null)
})

test('toggling adds and removes without touching the set it was given', () => {
  const before = new Set(['Morkos'])
  const on = toggleTick(before, 'Grybai')
  assert.deepEqual([...before], ['Morkos'], 'the original set is left alone')
  assert.equal(on.has('Grybai'), true)
  assert.equal(toggleTick(on, 'Grybai').has('Grybai'), false)
})

test('the count is information, never a gate', () => {
  const part = shoppingProgress(38, 12)
  assert.equal(part.left, 26)
  assert.equal(part.ticked, 12)
  assert.equal(Math.round(part.fraction * 100), 32)
})

test('a finished list fills the bar', () => {
  assert.equal(shoppingProgress(6, 6).fraction, 1)
  assert.equal(shoppingProgress(6, 6).left, 0)
})

test('an empty list does not divide by zero', () => {
  assert.equal(shoppingProgress(0, 0).fraction, 0)
})

test('more ticks than items cannot happen, and does not break the bar', () => {
  const odd = shoppingProgress(3, 9)
  assert.equal(odd.left, 0)
  assert.equal(odd.ticked, 3)
  assert.equal(odd.fraction, 1)
})
