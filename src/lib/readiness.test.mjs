import assert from 'node:assert/strict'
import test from 'node:test'
import { showsSetupSplash, showsUnreachable } from './readiness.js'

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

test('a household check that failed says so instead of offering a new household', () => {
  assert.equal(showsUnreachable({ setupChecked: true, hasHousehold: false, setupFailed: true }), true)
})

test('a check that completed and genuinely found nothing still gets the setup screen', () => {
  assert.equal(showsUnreachable({ setupChecked: true, hasHousehold: false, setupFailed: false }), false)
})

test('a failure never displaces a household we already have', () => {
  // The re-check on every app switch can fail on a flaky train connection.
  // Nothing about that means the recipes are gone.
  assert.equal(showsUnreachable({ setupChecked: true, hasHousehold: true, setupFailed: true }), false)
})

test('nothing is said while the check is still running', () => {
  assert.equal(showsUnreachable({ setupChecked: false, hasHousehold: false, setupFailed: true }), false)
})
