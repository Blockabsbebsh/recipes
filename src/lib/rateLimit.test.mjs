import assert from 'node:assert/strict'
import test from 'node:test'
import { admit } from './rateLimit.js'

const MINUTE = 60_000

test('requests under the limit are admitted and recorded', () => {
  const first = admit([], 1000, 3, MINUTE)
  assert.equal(first.allowed, true)
  assert.deepEqual(first.hits, [1000])
  const second = admit(first.hits, 1100, 3, MINUTE)
  assert.deepEqual(second.hits, [1000, 1100])
})

test('the request that would exceed the limit is refused', () => {
  const hits = [1000, 1100, 1200]
  const verdict = admit(hits, 1300, 3, MINUTE)
  assert.equal(verdict.allowed, false)
})

test('a refused request is not recorded, so being over does not extend the wait', () => {
  // Otherwise a client retrying in a loop could never get back in.
  const hits = [1000, 1100, 1200]
  const verdict = admit(hits, 1300, 3, MINUTE)
  assert.deepEqual(verdict.hits, hits)
})

test('the window slides: old hits stop counting', () => {
  const hits = [1000, 1100, 1200]
  const later = 1200 + MINUTE + 1
  const verdict = admit(hits, later, 3, MINUTE)
  assert.equal(verdict.allowed, true)
  assert.deepEqual(verdict.hits, [later])
})

test('room appears exactly when the oldest hit leaves the window', () => {
  const hits = [1000, 5000, 9000]
  const verdict = admit(hits, 1000 + MINUTE - 2500, 3, MINUTE)
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.retryAfterSeconds, 3)
})

test('the wait is never reported as zero seconds', () => {
  const hits = [1000]
  const verdict = admit(hits, 1000 + MINUTE - 1, 1, MINUTE)
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.retryAfterSeconds, 1)
})

test('the oldest hit decides the wait even if the list is out of order', () => {
  const verdict = admit([9000, 1000, 5000], 10_000, 3, MINUTE)
  assert.equal(verdict.retryAfterSeconds, Math.ceil((1000 + MINUTE - 10_000) / 1000))
})

test('a limit of zero admits nothing', () => {
  // A misconfigured limiter must fail closed, not open.
  const verdict = admit([], 1000, 0, MINUTE)
  assert.equal(verdict.allowed, false)
})

test('junk in the stored hits is ignored rather than crashing', () => {
  const verdict = admit([null, 'x', undefined, 1000], 1100, 2, MINUTE)
  assert.equal(verdict.allowed, true)
  assert.deepEqual(verdict.hits, [1000, 1100])
})

test('a missing hit list is treated as no history', () => {
  assert.equal(admit(undefined, 1000, 1, MINUTE).allowed, true)
})
