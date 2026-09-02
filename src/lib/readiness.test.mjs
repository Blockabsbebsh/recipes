import assert from 'node:assert/strict'
import test from 'node:test'
import { showsSetupSplash } from './readiness.js'

test('shows the loading screen while the first household check runs', () => {
  assert.equal(showsSetupSplash({ setupChecked: false, hasHousehold: false }), true)
})

test('stops showing it once there is a household', () => {
  assert.equal(showsSetupSplash({ setupChecked: true, hasHousehold: true }), false)
})

test('a re-check of a household we already have never blanks the app', () => {
  // What every app switch does: the token is revalidated, the household is
  // checked again, and it is the same household as a moment ago.
  assert.equal(showsSetupSplash({ setupChecked: false, hasHousehold: true }), false)
})

test('a household that turned out not to exist gets the setup screen, not the splash', () => {
  assert.equal(showsSetupSplash({ setupChecked: true, hasHousehold: false }), false)
})
