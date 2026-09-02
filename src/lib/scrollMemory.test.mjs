import assert from 'node:assert/strict'
import test from 'node:test'
import { createGesture, hasDrifted, keepable, reaches } from './scrollMemory.js'

// A drag, in the order a phone produces it: the scroll event arrives while the
// finger is still down.
const drag = (gesture, from, to, at = 0) => {
  gesture.start(from)
  gesture.scroll(to, at)
}

test('a drag is the household scrolling', () => {
  const gesture = createGesture()
  gesture.start(0)
  assert.equal(gesture.scroll(200, 0), 'gesture')
  assert.equal(gesture.scroll(400, 16), 'gesture')
})

test('a flick is followed while it decelerates, and its rest is the position', () => {
  const gesture = createGesture()
  drag(gesture, 500, 620, 0)
  assert.equal(gesture.end(0), true, 'a gesture that scrolled earns the wait')
  let at = 620
  for (const [step, now] of [[110, 16], [90, 32], [70, 48], [40, 64], [12, 80]]) {
    at += step
    assert.equal(gesture.scroll(at, now), 'coast', `a ${step}px step is still momentum`)
  }
  assert.equal(gesture.rest(), true, 'the page stopping ends a coast worth keeping')
  assert.equal(gesture.rest(), false, 'and only once')
})

test('a tap earns nothing, because it says nothing', () => {
  const gesture = createGesture()
  gesture.start(900)
  assert.equal(gesture.end(0), false)
  assert.equal(gesture.scroll(0, 16), 'system', 'and the page moving afterwards is not the tap')
})

test('the page thrown to the top just after a flick is not momentum', () => {
  const gesture = createGesture()
  drag(gesture, 800, 860, 0)
  gesture.end(0)
  assert.equal(gesture.scroll(920, 16), 'coast')
  // 920 to 0 is far bigger than the 60px step that started it.
  assert.equal(gesture.scroll(0, 32), 'system')
  assert.equal(gesture.isCoasting, false, 'and the coast is over')
})

test('momentum is not followed forever', () => {
  const gesture = createGesture({ momentumMs: 100 })
  drag(gesture, 0, 120, 0)
  gesture.end(0)
  assert.equal(gesture.scroll(220, 50), 'coast')
  assert.equal(gesture.scroll(320, 150), 'system', 'past the window it is the phone, however plausible the step')
})

test('a wheel counts as the household for a moment afterwards', () => {
  const gesture = createGesture()
  gesture.pointer(1_000)
  assert.equal(gesture.scroll(300, 1_100), 'gesture')
  assert.equal(gesture.scroll(600, 1_200), 'system', 'but not indefinitely')
})

test('leaving the app cancels whatever was in flight', () => {
  const gesture = createGesture()
  drag(gesture, 0, 120, 0)
  gesture.end(0)
  gesture.cancel()
  assert.equal(gesture.rest(), false, 'nothing to settle on the way back')
  assert.equal(gesture.scroll(0, 16), 'system')
})

test('drift is either measure saying so', () => {
  assert.equal(hasDrifted({ target: 579, y: 579, vp: 579 }), false)
  assert.equal(hasDrifted({ target: 579, y: 62, vp: 62 }), true)
  // iOS reporting a position it is not showing.
  assert.equal(hasDrifted({ target: 579, y: 579, vp: 0 }), true)
  assert.equal(hasDrifted({ target: 579, y: 0, vp: 579 }), true)
  assert.equal(hasDrifted({ target: 579, y: 579, vp: -1 }), false, 'a browser that will not say is not evidence')
})

test('a page with a loading screen on it cannot hold a position', () => {
  assert.equal(reaches({ scrollHeight: 726, innerHeight: 664, target: 572 }), false)
  assert.equal(reaches({ scrollHeight: 4000, innerHeight: 664, target: 572 }), true)
})

test('rubber-banding past the top is not a place to come back to', () => {
  assert.equal(keepable(-44), 0)
  assert.equal(keepable(604.95), 605)
})
