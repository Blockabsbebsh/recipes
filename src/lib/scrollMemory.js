/**
 * What a scroll event means.
 *
 * The app has to tell three things apart, and nothing in the browser
 * distinguishes them: the household dragging the page, the momentum of a
 * flick they have already let go of, and the phone moving the web view on its
 * own as it puts the app away or hands it back. Saving the wrong one loses the
 * place they were reading; refusing the right one loses it just as surely.
 *
 * Every rule here was learnt from a log off a real phone, and each is written
 * down where it is decided rather than spread through the listeners that use
 * it. The listeners belong to the page; the reasoning belongs here.
 */

/** How long a restored position is held against the phone moving the page. */
export const HOLD_MS = 2_000

/** How long a flick's momentum is followed after the finger has gone. */
export const MOMENTUM_MS = 2_500

/** How still the page must be before its position is taken as final. */
export const STILL_MS = 150

/**
 * How long to wait for the page to be tall enough to hold the position.
 *
 * A second was not enough. iOS came back showing a loading screen for 1454ms,
 * and a page with nothing on it is 62px tall — so the restore spent its whole
 * budget against a page that could not have held the position, and gave up.
 */
export const RESTORE_PATIENCE_MS = 8_000

/** A scroll this soon after a wheel or a key is still that input's doing. */
const POINTER_MS = 150

/**
 * How much bigger than the last one a coasting step may be.
 *
 * Momentum decelerates. A jump larger than the flick that started it is the
 * page being thrown somewhere — which is what happens as the app is put away,
 * and it arrives inside the same window as the momentum it has to be told
 * apart from. The slack covers a skipped frame.
 */
const DECAY = 1.6
const SLACK = 48

/**
 * Reading a gesture as it happens.
 *
 * Fed the scroll position and the time, it answers what each movement was:
 *
 *   `gesture` — the household, finger down or a wheel just turned.
 *   `coast`   — momentum from their flick, still theirs.
 *   `system`  — the phone. Never a position to come back to.
 *
 * It holds no reference to a page and reads no clock of its own, so the rules
 * can be exercised with plain numbers.
 */
export function createGesture({ momentumMs = MOMENTUM_MS } = {}) {
  let touching = false
  let scrolled = false
  let coasting = false
  let coastUntil = 0
  let pointerAt = -Infinity
  let lastY = 0
  let lastStep = 0

  const stepFrom = (y) => {
    const size = Math.abs(y - lastY)
    lastY = y
    return size
  }

  return {
    /** A finger has gone down. */
    start(y) {
      touching = true
      scrolled = false
      coasting = false
      lastY = y
      lastStep = 0
    },

    /**
     * The finger has lifted. Answers whether this gesture earned the wait for
     * its momentum: a touch that moved nothing is a tap, and a tap says
     * nothing about where the page should be.
     */
    end(now) {
      touching = false
      if (!scrolled) {
        coasting = false
        return false
      }
      coasting = true
      coastUntil = now + momentumMs
      return true
    },

    /** A wheel turned or a key was pressed. */
    pointer(now) {
      pointerAt = now
    },

    /** What this movement was. */
    scroll(y, now) {
      if (touching || now - pointerAt < POINTER_MS) {
        scrolled = true
        lastStep = stepFrom(y)
        return 'gesture'
      }
      if (coasting) {
        const size = stepFrom(y)
        if (now < coastUntil && size <= lastStep * DECAY + SLACK) {
          lastStep = size
          return 'coast'
        }
        coasting = false
      }
      return 'system'
    },

    /**
     * The page has stopped moving. Answers whether it stopped at the end of a
     * gesture — in which case this is the position to keep.
     */
    rest() {
      const wasCoasting = coasting
      coasting = false
      return wasCoasting
    },

    /**
     * Whatever was in flight belongs to the moment before this. Called when
     * the app goes away or comes back: Android holds a pending timer while the
     * app is backgrounded and runs it on the way back, by which time the page
     * has been moved to the top, and the position it settles on is a zero
     * written over the one about to be restored.
     */
    cancel() {
      touching = false
      coasting = false
    },

    get isCoasting() {
      return coasting
    },
  }
}

/**
 * Whether the page has moved off a position we restored.
 *
 * On iOS `window.scrollY` and `visualViewport.pageTop` can disagree — the page
 * reporting a position it is not showing — so either saying we have drifted is
 * enough. A viewport of `-1` means the browser would not say.
 */
export function hasDrifted({ target, y, vp, tolerance = 8 }) {
  if (Math.abs(y - target) > tolerance) return true
  return vp >= 0 && Math.abs(vp - target) > tolerance
}

/** Whether the page is currently tall enough to hold a position. */
export function reaches({ scrollHeight, innerHeight, target }) {
  return scrollHeight - innerHeight >= target
}

/** Rubber-banding past the top is a gesture in progress, not a place. */
export function keepable(y) {
  return Math.max(0, Math.round(y))
}
