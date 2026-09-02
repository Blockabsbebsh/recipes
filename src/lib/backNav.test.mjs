import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackNav } from './backNav.js'

// A browser stands in for history: entries counted, and a back press replayed
// the way the real one arrives — as an event, after the fact.
const browser = () => {
  const state = { entries: 0, pops: [] }
  const nav = createBackNav({
    pushEntry: () => { state.entries += 1 },
    goBack: () => { state.entries -= 1; state.pops.push('programmatic') },
  })
  return { nav, state }
}

test('back undoes the most recent thing, innermost first', () => {
  const { nav } = browser()
  const closed = []
  nav.add('settings', () => closed.push('settings'))
  nav.add('ingredient', () => closed.push('ingredient'))
  nav.add('picker', () => closed.push('picker'))
  nav.onPop()
  nav.onPop()
  nav.onPop()
  assert.deepEqual(closed, ['picker', 'ingredient', 'settings'])
})

test('with nothing of ours open, back belongs to the phone', () => {
  const { nav } = browser()
  assert.equal(nav.onPop(), false, 'leaving the app is the right answer')
  nav.add('settings', () => {})
  assert.equal(nav.onPop(), true)
  assert.equal(nav.onPop(), false, 'and once it is closed, the next press leaves')
})

test('closing by tap takes its history entry with it', () => {
  const { nav, state } = browser()
  nav.add('settings', () => { throw new Error('undo must not run for a tap') })
  assert.equal(state.entries, 1)
  nav.drop('settings')
  assert.equal(state.entries, 0, 'the entry is gone, so the next back press leaves the app')
  assert.equal(nav.depth, 0)
})

test('the pop our own going-back causes is not a second back press', () => {
  const { nav } = browser()
  const closed = []
  nav.add('settings', () => closed.push('settings'))
  nav.add('ingredient', () => closed.push('ingredient'))
  nav.drop('ingredient')            // tapped × on the inner one
  assert.equal(nav.onPop(), true, 'the event our goBack() caused is swallowed')
  assert.deepEqual(closed, [], 'and nothing else is closed by it')
  assert.equal(nav.onPop(), true)
  assert.deepEqual(closed, ['settings'], 'the next real press closes what is left')
})

test('a layer already taken by back is not dropped again', () => {
  const { nav, state } = browser()
  const remove = nav.add('settings', () => {})
  nav.onPop()
  assert.equal(remove(), false, 'unmounting after back must not go back again')
  assert.equal(state.entries, 1, 'and must not touch history a second time')
})

test('layers closed out of order still leave the stack coherent', () => {
  const { nav } = browser()
  const closed = []
  nav.add('a', () => closed.push('a'))
  nav.add('b', () => closed.push('b'))
  nav.add('c', () => closed.push('c'))
  nav.drop('b')                     // the middle one closed itself
  nav.onPop()                       // swallowed
  nav.onPop()
  nav.onPop()
  assert.deepEqual(closed, ['c', 'a'])
  assert.equal(nav.depth, 0)
})
