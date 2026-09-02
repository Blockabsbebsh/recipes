// The scenarios. Each one drives the real app against the fake backend and
// returns a list of findings; an empty list means it found nothing wrong.
//
// A finding beginning with `note:` is advisory — it is reported but does not
// fail the run. Use it for things that are a judgement call rather than a
// regression, so the suite stays honest about the difference.
//
// Read the pitfalls in README.md before adding one. The short version: never
// use Playwright's own click for anything scroll-sensitive — use `tap`.

import { devices } from 'playwright'

export const PHONE = { ...devices['iPhone 13'], locale: 'lt-LT' }
/** Roughly the height an iOS keyboard takes from a 6.1" screen. */
export const KEYBOARD = 336

/**
 * Click the way a finger does: dispatched by the page, on whatever is under
 * it. Playwright's `locator.click()` scrolls the element into view first,
 * which silently moves the page and has produced three convincing bug reports
 * that were nothing but the automation.
 */
export async function tap(page, selector, text) {
  const clicked = await page.evaluate(([sel, label]) => {
    const nodes = [...document.querySelectorAll(sel)]
    const target = label ? nodes.find((n) => (n.textContent || '').includes(label)) : nodes[0]
    if (!target) return false
    target.click()
    return true
  }, [selector, text ?? null])
  if (!clicked) throw new Error(`nothing matched ${selector}${text ? ` containing "${text}"` : ''}`)
  await page.waitForTimeout(500)
}

export async function signIn(page, base) {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'testas@example.com')
  await page.fill('input[type="password"]', 'labas1234')
  await page.locator('form button').first().click()
  await page.waitForSelector('.bottom-nav button', { timeout: 15000 })
  await page.waitForTimeout(1500)
}

export const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY))

// A scroll event does not dispatch until the next frame. On a real device it
// therefore arrives while the finger is still down, and the app relies on
// that: a touch that moved nothing is a tap, and a tap is not a position.
// Dispatching touchend in the same task as the scroll models a gesture no
// phone produces, so every synthetic gesture here waits a frame first.

/**
 * Scroll the way a finger does. The app only remembers a scroll a gesture
 * started, so a bare `window.scrollTo` stands for the system moving the web
 * view — which is exactly the thing that must NOT be remembered. Use this
 * whenever the scroll is meant to be the household's own.
 */
export async function userScroll(page, y) {
  await gesture(page, y)
  // Long enough for the app to take the resting position after the lift.
  await page.waitForTimeout(700)
  const landed = await scrollY(page)
  if (Math.abs(landed - y) > 8) throw new Error(`userScroll(${y}) left the page at ${landed}px`)
}

/**
 * One drag: contact, two moves, release.
 *
 * The two moves are not decoration. Scrolling to where the page already is
 * fires no scroll event, so the app sees a touch that moved nothing — a tap —
 * and correctly records nothing. A case written that way asserts its target,
 * passes, and tests something that never happened; one sat green in this suite
 * for exactly that reason. Going by way of another offset means every gesture
 * moves the page whatever it was doing beforehand.
 */
async function gesture(page, y) {
  await page.evaluate(async (top) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const waypoint = top > 300 ? top - 200 : top + 200
    window.dispatchEvent(new Event('touchstart', { bubbles: true }))
    window.dispatchEvent(new Event('touchmove', { bubbles: true }))
    window.scrollTo(0, waypoint)
    await frame()
    window.scrollTo(0, top)
    await frame()
    window.dispatchEvent(new Event('touchend', { bubbles: true }))
  }, y)
}

/**
 * A flick: the finger leaves and the page keeps going, in decelerating steps,
 * for about a second. Where it stops is where the household meant to be.
 */
export async function fling(page, from) {
  const rest = await page.evaluate(async (start) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.dispatchEvent(new Event('touchstart', { bubbles: true }))
    window.dispatchEvent(new Event('touchmove', { bubbles: true }))
    window.scrollTo(0, start - 120)
    await frame()
    window.scrollTo(0, start)
    await frame()
    window.dispatchEvent(new Event('touchend', { bubbles: true }))
    // Momentum carries on at the speed of the flick and decays to a stop. It
    // never teleports at the end — a synthetic one that does is a jump, which
    // the app is right to refuse, and the case would be testing the harness.
    let at = start
    for (let stepSize = 120; stepSize > 1; stepSize *= 0.85) {
      at += stepSize
      window.scrollTo(0, at)
      await frame()
    }
    return Math.round(window.scrollY)
  }, from)
  await page.waitForTimeout(700)
  return rest
}

/**
 * Scroll and leave immediately, with the gesture still settling.
 *
 * Android holds the pending timer while the app is backgrounded and runs it on
 * the way back — after the system has moved the page to the top — so the
 * position it settles on is a zero written over the one we mean to restore.
 * Timings here are the ones from the phone: the app is away for less than the
 * settle delay, so the timer lands after it returns.
 */
export async function scrollAndLeave(page, y, awayMs = 150, shortMs = 600) {
  await gesture(page, y)
  await page.waitForTimeout(60)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(awayMs)
  await setVisibility(page, 'visible')
  // The system moves the page as it hands the app back, and the page comes
  // back shorter than it was for a moment — Android's toolbar animation, which
  // is why the restore on the phone took 17 frames rather than landing at
  // once. The restore is therefore still waiting when the settling gesture
  // from before the switch runs, with the page sitting at the top.
  await page.evaluate(() => {
    const shrink = document.createElement('style')
    shrink.id = 'harness-shrink'
    shrink.textContent = 'main { max-height: 300px; overflow: hidden }'
    document.head.append(shrink)
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(shortMs)
  await page.evaluate(() => document.getElementById('harness-shrink')?.remove())
  await page.waitForTimeout(1200)
}

/** Switch tabs the way a thumb does. */
export const openTab = async (page, index) => {
  await page.evaluate((i) => document.querySelectorAll('.bottom-nav button')[i].click(), index)
  await page.waitForTimeout(600)
}

/** Tell the page it went to the background, or came back, as iOS does. */
export const setVisibility = (page, state) => page.evaluate((value) => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}, state)

/**
 * The iOS keyboard shrinks `visualViewport` and leaves `innerHeight` alone.
 * Resizing the Playwright viewport instead changes both and tests nothing real.
 */
export const showKeyboard = (page, height = KEYBOARD) => page.evaluate((kb) => {
  const vv = window.visualViewport
  Object.defineProperty(vv, 'height', { value: window.innerHeight - kb, configurable: true })
  Object.defineProperty(vv, 'offsetTop', { value: 0, configurable: true })
  vv.dispatchEvent(new Event('resize'))
}, height)

// --- scenarios -------------------------------------------------------------

/** Layout faults visible on every tab: sideways scroll, overflow, tap targets. */
export async function layout(page, base) {
  const findings = []
  await signIn(page, base)
  const tabs = await page.locator('.bottom-nav button').allTextContents()
  for (const [index, label] of tabs.entries()) {
    await openTab(page, index)
    for (const pass of ['top', 'bottom']) {
      if (pass === 'bottom') {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(300)
      }
      findings.push(...(await page.evaluate((screen) => {
        const out = []
        // Measure against the screen, never against `window.innerWidth`.
        // With `width=device-width` a page too wide for the screen makes the
        // browser zoom out to fit, and innerWidth grows with it — so
        // `scrollWidth > innerWidth` compares a number against itself and can
        // never be true. Both of this scenario's real checks were written that
        // way and had never once been able to fire.
        const vw = screen
        if (window.innerWidth > screen + 1) {
          out.push(`the browser zoomed out to fit: ${window.innerWidth}px of layout squeezed into a ${screen}px screen`)
        }
        if (document.documentElement.scrollWidth > vw + 1) {
          out.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px of content in ${vw}px`)
        }
        const past = [...document.querySelectorAll('body *')].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width && r.height && getComputedStyle(el).position !== 'fixed' && (r.right > vw + 1 || r.left < -1)
        })
        if (past.length) out.push(`${past.length} element(s) past the viewport edge`)
        // Advisory: Apple asks for 44px, but plenty of these are text links
        // inside lists and the household reports no trouble hitting them.
        const small = [...document.querySelectorAll('button, a, input, select')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 24 })
          .map((el) => `"${(el.textContent || '').trim().slice(0, 18)}" ${Math.round(el.getBoundingClientRect().height)}px tall`)
        if (small.length) out.push(`note: ${small.length} tap target(s) under 24px: ${[...new Set(small)].slice(0, 3).join(', ')}`)
        return out
      }, PHONE.viewport.width)).map((f) => `${label.trim()} (${pass}): ${f}`))
    }
  }
  return findings
}

/** A modal must cover the screen and stay reachable when the keyboard opens. */
export async function keyboard(page, base) {
  await signIn(page, base)
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await tap(page, '.settings-list button, button', 'Ingredientai')
  await tap(page, '.manager-row button', 'Keisti')
  await showKeyboard(page)
  await page.waitForTimeout(400)
  return page.evaluate((kb) => {
    const out = []
    const vh = window.innerHeight
    const visible = vh - kb
    const backdrop = [...document.querySelectorAll('.modal-backdrop')].pop()
    if (!backdrop) return ['the ingredient editor did not open']
    const rect = backdrop.getBoundingClientRect()
    if (Math.round(rect.height) < vh - 1) {
      out.push(`backdrop covers ${Math.round(rect.height)}px of a ${vh}px screen — ${Math.round(vh - rect.bottom)}px of live page shows below it`)
    }
    const card = backdrop.querySelector('.modal').getBoundingClientRect()
    if (card.bottom > visible + 1) out.push(`the card runs ${Math.round(card.bottom - visible)}px under the keyboard`)
    const body = backdrop.querySelector('.modal-body')
    if (body) body.scrollTop = body.scrollHeight
    const save = [...backdrop.querySelectorAll('button')].find((b) => /Išsaugoti/.test(b.textContent))
    if (save && save.getBoundingClientRect().bottom > visible + 1) out.push('Išsaugoti cannot be reached with the keyboard open')
    return out
  }, KEYBOARD)
}

/** Your place in the app has to survive leaving it and coming back. */
export async function appswitch(page, base) {
  const findings = []
  const target = 1500
  const traceCount = (kind, extra = {}) => page.evaluate(([k, e]) => {
    const entries = JSON.parse(localStorage.getItem('recipes:scroll-trace:v1') ?? '[]')
    return entries.filter((entry) => entry.kind === k && Object.entries(e).every(([f, v]) => entry[f] === v)).length
  }, [kind, extra])
  await signIn(page, base)
  await openTab(page, 1)
  await userScroll(page, target)
  await page.waitForTimeout(300)

  // iOS may move the web view before it reports the page as hidden. This is
  // deliberately the opposite order from the next case: a guard that only
  // ignores scroll events after visibilityState changes would otherwise pass
  // the harness while still recording the system's transient zero.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(200)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(800)
  let now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`switching away when the web view moved first left the library at ${now}px instead of ${target}px`)

  // The inverse event order must work too: hidden first, then moved by the
  // system, then reopened.
  await userScroll(page, target)
  await page.waitForTimeout(100)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(200)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(800)
  now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`switching away after the page was hidden left the library at ${now}px instead of ${target}px`)

  // The phone is not finished when it hands the app back: iOS moves the web
  // view again a moment later, after the restore has already reported success.
  await userScroll(page, target)
  await page.waitForTimeout(100)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(200)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(400)
  // And it has to be put back before anyone sees it move: correcting on a
  // timer is a jump you can watch happen, which is what the household saw.
  const settled = await page.evaluate((want) => new Promise((resolve) => {
    const started = performance.now()
    window.scrollTo(0, 0)
    const tick = () => {
      if (Math.abs(window.scrollY - want) <= 8) resolve(Math.round(performance.now() - started))
      else if (performance.now() - started > 2500) resolve(-1)
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), target)
  await page.waitForTimeout(400)
  now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`the web view moving after the app came back left the library at ${now}px instead of ${target}px`)
  else if (settled < 0 || settled > 150) findings.push(`the page sat at the top for ${settled < 0 ? 'over 2500' : settled}ms before jumping back`)

  // Which must not turn into the app fighting the household: scrolling
  // somewhere else on the way back in has to stick.
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(200)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(200)
  await userScroll(page, 300)
  await page.waitForTimeout(2600)
  now = await scrollY(page)
  if (Math.abs(now - 300) > 40) findings.push(`scrolling to 300px on the way back in was undone, landing at ${now}px`)

  // Backgrounded with a modal open, which parks the body at the top.
  await userScroll(page, target)
  await page.waitForTimeout(100)
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  const saved = await page.evaluate(() => {
    const raw = Object.entries(localStorage).find(([k]) => k.startsWith('recipes:view'))
    return raw ? JSON.parse(raw[1]).scrollByTab?.library : null
  })
  if (saved === null) findings.push('backgrounding with a modal open saved no view state at all')
  else if (Math.abs(saved - target) > 40) findings.push(`backgrounding with a modal open saved ${saved}px instead of ${target}px`)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(400)
  await tap(page, '.modal .icon-button')

  // Evicted and reloaded from scratch.
  await userScroll(page, target)
  await page.waitForTimeout(100)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
  now = await scrollY(page)
  if (Math.abs(now - target) > 60) findings.push(`reopening after eviction landed at ${now}px instead of ${target}px`)

  // The same again, with the backend answering as slowly as a phone on mobile
  // data. The stub is otherwise instant, which hides every race between the
  // restore and the render — the reason this suite once passed while the real
  // app still came back at the top.
  await page.context().route('**/rest/v1/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await route.continue()
  })
  await userScroll(page, target)
  await page.waitForTimeout(100)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(12000)
  now = await scrollY(page)
  if (Math.abs(now - target) > 60) findings.push(`reopening on a slow connection landed at ${now}px instead of ${target}px`)
  await page.context().unroute('**/rest/v1/**')

  // Leaving mid-gesture, which is what switching apps with a swipe looks
  // like. The position has to survive it, and — the part that actually broke
  // on Android — has to still be there for the switch after that one.
  // From somewhere else, so the gesture genuinely moves the page: scrolling
  // to where the page already is fires no scroll event and tests nothing.
  await userScroll(page, 600)
  await page.waitForTimeout(300)
  await scrollAndLeave(page, target)
  now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`leaving mid-gesture came back to ${now}px instead of ${target}px`)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  const kept = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view'))
    return entry ? JSON.parse(entry[1]).scrollByTab?.library : null
  })
  if (kept === null) findings.push('the switch after a mid-gesture one saved no view state at all')
  else if (Math.abs(kept - target) > 40) findings.push(`the switch after a mid-gesture one saved ${kept}px instead of ${target}px`)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(1200)
  now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`the switch after a mid-gesture one came back to ${now}px instead of ${target}px`)

  // A page can come back short for longer than the position is held. Every
  // correction then clamps to what it can reach, and only waiting for the
  // height gets the household back to where they were.
  await userScroll(page, 600)
  await page.waitForTimeout(300)
  // Three seconds, because that is what the phone did: iOS showed the app's
  // own loading screen for 1454ms on resume, during which the page was 62px
  // tall, and the restore ran out of frames while it waited.
  await scrollAndLeave(page, target, 150, 3000)
  now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`a page that came back short for three seconds landed at ${now}px instead of ${target}px`)

  // The phone's own ordering: the position is restored while the page is
  // still tall, and only then does the page go short underneath it — on iOS
  // because the app dropped to its loading screen, which leaves 62px of page.
  // Every correction after that clamps, and the clamp reads as another drift.
  await userScroll(page, target)
  await page.waitForTimeout(300)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(200)
  const stormBefore = await traceCount('restore-again')
  await setVisibility(page, 'visible')
  await page.waitForTimeout(250)
  await page.evaluate(() => {
    const shrink = document.createElement('style')
    shrink.id = 'harness-shrink'
    shrink.textContent = 'main { max-height: 900px; overflow: hidden }'
    document.head.append(shrink)
    // And the page keeps coming back to the top while it is short, which is
    // what the phone did: every correction was answered by another 62px.
    window.__pin = () => { if (window.scrollY > 62) window.scrollTo(0, 62) }
    window.addEventListener('scroll', window.__pin)
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    document.getElementById('harness-shrink')?.remove()
    window.removeEventListener('scroll', window.__pin)
  })
  await page.waitForTimeout(1500)
  const storm = (await traceCount('restore-again')) - stormBefore
  if (storm > 4) findings.push(`the page going short set off ${storm} corrections, which is the app arguing with it`)
  // Chromium clamps a scroll honestly and stops; iOS reports the scroll it was
  // asked for and then bounces back, which is how forty corrections fitted
  // into one second there. The loop itself cannot be reproduced here, so what
  // is checked is the thing that prevents it: the app must notice the page
  // cannot reach the position and wait for the height rather than scroll at it.
  if ((await traceCount('restore-waiting')) === 0) {
    findings.push('the app kept scrolling at a page too short to hold the position instead of waiting for it to grow')
  }
  now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`the page going short after the restore landed left it at ${now}px instead of ${target}px`)

  // A flick coasts on after the finger has gone, and it is where it stops
  // that has to come back — not wherever it happened to be a moment after the
  // lift. The phone recorded 572px on a page that coasted to 907px and stayed.
  await userScroll(page, 400)
  await page.waitForTimeout(300)
  const rest = await fling(page, 500)
  await page.waitForTimeout(600)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  const afterFling = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view'))
    return entry ? JSON.parse(entry[1]).scrollByTab?.library : null
  })
  if (afterFling === null) findings.push('a flick saved no view state at all')
  else if (Math.abs(afterFling - rest) > 40) findings.push(`a flick that came to rest at ${rest}px saved ${afterFling}px`)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(1200)

  // But the page going to the top as the app is put away is not momentum, and
  // arrives in the same window: a jump far bigger than the flick that started
  // it, with no finger behind either.
  await userScroll(page, target)
  await page.waitForTimeout(300)
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.dispatchEvent(new Event('touchstart', { bubbles: true }))
    window.dispatchEvent(new Event('touchmove', { bubbles: true }))
    window.scrollTo(0, window.scrollY - 60)
    await frame()
    window.dispatchEvent(new Event('touchend', { bubbles: true }))
    await frame()
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(900)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  const afterJump = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view'))
    return entry ? JSON.parse(entry[1]).scrollByTab?.library : null
  })
  if (afterJump !== null && afterJump < target - 100) findings.push(`the page jumping to the top just after a flick saved ${afterJump}px instead of about ${target}px`)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(1200)

  // A tap is not a scroll. Touching the screen on the way back in — which is
  // how you dismiss anything — must not record wherever the system has left
  // the page while the restore is still waiting for the height.
  await userScroll(page, target)
  await page.waitForTimeout(300)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(200)
  await setVisibility(page, 'visible')
  await page.evaluate(async () => {
    const shrink = document.createElement('style')
    shrink.id = 'harness-shrink'
    shrink.textContent = 'main { max-height: 300px; overflow: hidden }'
    document.head.append(shrink)
    window.scrollTo(0, 0)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    // A tap: down and up, having moved nothing.
    window.dispatchEvent(new Event('touchstart', { bubbles: true }))
    window.dispatchEvent(new Event('touchend', { bubbles: true }))
  })
  await page.waitForTimeout(700)
  await page.evaluate(() => document.getElementById('harness-shrink')?.remove())
  await page.waitForTimeout(1200)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  const afterTap = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view'))
    return entry ? JSON.parse(entry[1]).scrollByTab?.library : null
  })
  if (afterTap === null) findings.push('a tap on the way back in saved no view state at all')
  else if (Math.abs(afterTap - target) > 40) findings.push(`a tap on the way back in saved ${afterTap}px instead of ${target}px`)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(1200)

  // The app's own scroll trace, for when a scenario disagrees with a phone.
  if (process.env.DUMP_TRACE) {
    const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('recipes:scroll-trace:v1') ?? '[]'))
    for (const entry of entries) {
      const { at, kind, ...rest } = entry
      console.log(`      ${at} ${kind} ${Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    }
  }

  // Coming back is not a cold start. Dropping to the loading screen blanks
  // the page, and a page with nothing on it is 62px tall — too short to hold
  // the position, so the restore runs out of frames and gives up. Counting
  // corrections too: a page that cannot reach the target must not be scrolled
  // at over and over.
  const splashesBefore = await traceCount('splash', { shown: 'yes' })
  const correctionsBefore = await traceCount('restore-again')
  await userScroll(page, target)
  await page.waitForTimeout(300)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(400)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(2500)
  const splashes = (await traceCount('splash', { shown: 'yes' })) - splashesBefore
  if (splashes > 0) findings.push(`coming back to the app rendered the loading screen ${splashes} time(s)`)
  const corrections = (await traceCount('restore-again')) - correctionsBefore
  if (corrections > 4) findings.push(`coming back set off ${corrections} corrections, which is the app fighting the page`)
  now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`coming back through the loading screen landed at ${now}px instead of ${target}px`)

  // A position is worth coming back to for an hour, not overnight: the tab
  // survives the night, the scroll does not.
  await userScroll(page, target)
  await page.waitForTimeout(300)
  // Let tomorrow arrive, rather than backdating what was saved: the app
  // rewrites the timestamp as it goes away, exactly as it would tonight.
  await page.addInitScript(() => {
    const realNow = Date.now
    Date.now = () => realNow() + 26 * 60 * 60 * 1000
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
  now = await scrollY(page)
  if (now > 40) findings.push(`opening the app the next day landed at ${now}px instead of the top`)
  const tabLabel = await page.evaluate(() => document.querySelector('.bottom-nav button.active')?.textContent ?? '')
  if (!/Receptai/.test(tabLabel)) findings.push(`opening the app the next day forgot the tab, landing on "${tabLabel}"`)
  return findings
}

/**
 * The scroll trace: a diagnostic is worthless if it dies in the event it
 * exists to explain. It has to survive the reload, record which side of it
 * lost the position, and be readable without a cable.
 */
export async function scrolltrace(page, base) {
  const findings = []
  const key = 'recipes:scroll-trace:v1'
  const entries = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), key)
  const kinds = async () => (await entries()).map((entry) => entry.kind)

  await signIn(page, base)
  await openTab(page, 1)
  await userScroll(page, 1500)
  await page.waitForTimeout(600)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(600)

  const beforeReload = await kinds()
  for (const expected of ['boot', 'load', 'capture', 'visibility', 'write']) {
    if (!beforeReload.includes(expected)) findings.push(`the trace never recorded a "${expected}" event`)
  }
  const written = (await entries()).filter((entry) => entry.kind === 'write').pop()
  if (written && Math.abs(Number(written.y) - 1500) > 40) {
    findings.push(`the trace says ${written.y}px was written where the finger left 1500px`)
  }

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
  const afterReload = await entries()
  if (afterReload.length <= beforeReload.length - 5) findings.push('the trace did not survive the reload')
  if (afterReload.length > 60) findings.push(`the trace grew to ${afterReload.length} entries, past its 60-entry cap`)
  const reboot = afterReload.filter((entry) => entry.kind === 'boot').pop()
  if (reboot?.nav !== 'reload') findings.push(`the reload was recorded as nav=${reboot?.nav ?? 'nothing'}`)
  if (!reboot?.os || !reboot?.mode) findings.push('the trace does not say which phone or whether the app is installed')

  // The loading screen has to witness itself: the household reports seeing it
  // on a page the trace shows was never reloaded, and only the app can settle
  // whether it rendered or the platform painted a stored image of it.
  const splash = afterReload.filter((entry) => entry.kind === 'splash')
  if (!splash.some((entry) => entry.shown === 'yes')) findings.push('the loading screen did not record that it appeared')
  const gone = splash.find((entry) => entry.shown === 'gone')
  if (!gone) findings.push('the loading screen did not record that it went away')
  else if (!Number.isFinite(Number(gone.ms))) findings.push(`the loading screen recorded no duration, saying ms=${gone.ms}`)
  const tail = afterReload.slice(afterReload.indexOf(reboot)).map((entry) => entry.kind)
  if (!tail.some((kind) => kind.startsWith('restore'))) findings.push('the trace says nothing about what the restore did after the reload')

  // And it has to be legible from the phone, which is the only place it runs.
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await tap(page, 'button', 'Slinkties žurnalas')
  await page.waitForTimeout(300)
  const printed = await page.locator('.scroll-trace').first().innerText().catch(() => '')
  if (!/^\d\d:\d\d:\d\d \w/m.test(printed)) findings.push('the settings readout printed no events')
  if (printed.split('\n').length < 5) findings.push(`the settings readout printed only ${printed.split('\n').length} line(s)`)
  await page.keyboard.press('Escape')
  return findings
}

/** Modals stack, close topmost-first, and never strand the one underneath. */
export async function modals(page, base) {
  const findings = []
  const count = () => page.evaluate(() => document.querySelectorAll('.modal-backdrop').length)
  await signIn(page, base)
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  if (await count() !== 1) findings.push('settings did not open')
  await tap(page, 'button', 'Ingredientai')
  await tap(page, '.manager-row button', 'Keisti')
  if (await count() !== 2) findings.push('the ingredient editor did not open over the manager')
  await tap(page, '.category-field-button, button', 'Barbora kategorija')
  if (await count() !== 3) findings.push('the category picker did not open over the editor')
  if (await page.locator('.category-row').count() < 11) findings.push('the picker did not list the top-level aisles')
  for (const expected of [2, 1, 0]) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    if (await count() !== expected) findings.push(`Escape did not leave ${expected} modal(s) open`)
  }
  // The list underneath must not have been dragged around by the modals above.
  return findings
}

export const SCENARIOS = { layout, keyboard, appswitch, modals, scrolltrace }
