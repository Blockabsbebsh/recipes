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

export async function signIn(page, base, email = 'testas@example.com') {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', email)
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
    const raw = Object.entries(localStorage).find(([k]) => k.startsWith('recipes:view:v1:'))
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
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view:v1:'))
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
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view:v1:'))
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
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view:v1:'))
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
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('recipes:view:v1:'))
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

/**
 * The week, run through: basket to menu to cooked, and back again.
 *
 * These are the writes the household actually makes, and until now nothing
 * touched them — the suite rendered the lists and never ticked anything off.
 * Every destructive step asks first, so the confirmations are accepted here
 * rather than dismissed, which is what Playwright does by default and would
 * make half of this silently pass.
 */
export async function planning(page, base) {
  const findings = []
  page.on('dialog', (dialog) => void dialog.accept())
  await signIn(page, base)

  const chips = () => page.locator('.queue-chip').count()
  const readyMeals = () => page.locator('.meal-card').count()
  // The library remembers which recipe was open, so tapping the summary again
  // closes it. Ask for it open rather than toggling and hoping.
  const openRecipe = async () => {
    await page.evaluate(() => {
      const summary = document.querySelector('.recipe-tile-summary')
      if (summary?.getAttribute('aria-expanded') !== 'true') summary?.click()
    })
    await page.waitForTimeout(400)
  }

  // Into the basket, from the library.
  await openTab(page, 2)
  const basketBefore = await chips()
  await openTab(page, 1)
  await openRecipe()
  await tap(page, '.recipe-tile button', 'Į krepšelį')
  await openTab(page, 2)
  if (await chips() !== basketBefore + 1) findings.push(`adding a recipe to the basket left ${await chips()} chips, not ${basketBefore + 1}`)

  // And out of it again.
  await tap(page, '.queue-chip button')
  await page.waitForTimeout(400)
  if (await chips() !== basketBefore) findings.push(`removing one left ${await chips()} chips, not ${basketBefore}`)

  // Shopping done: everything planned becomes something to cook.
  const planned = await chips()
  // Count the meals on the menu itself: a tab that is not rendered has none.
  await openTab(page, 0)
  const mealsBefore = await readyMeals()
  await openTab(page, 2)
  await tap(page, '.complete-button')
  await page.waitForTimeout(1200)
  if (await chips() !== 0) findings.push(`the basket still holds ${await chips()} chips after shopping`)
  const tabNow = await page.evaluate(() => document.querySelector('.bottom-nav button.active')?.textContent ?? '')
  if (!/Meniu/.test(tabNow)) findings.push(`finishing the shop left the app on "${tabNow}" rather than the menu`)
  // Carry on from the menu whether or not it took us there: a finding is worth
  // nothing if the step after it throws and takes the whole list with it.
  await openTab(page, 0)
  if (await readyMeals() !== mealsBefore + planned) {
    findings.push(`${planned} planned recipes became ${await readyMeals() - mealsBefore} meals`)
  }

  // Cooked, and then not.
  const beforeCooking = await readyMeals()
  await tap(page, '.resolve.cooked')
  await page.waitForTimeout(600)
  if (await readyMeals() !== beforeCooking - 1) findings.push(`marking one cooked left ${await readyMeals()} meals, not ${beforeCooking - 1}`)
  if (await page.locator('.undo-toast').count() === 0) findings.push('marking a meal cooked offered no way to undo it')
  await tap(page, '.undo-toast button')
  await page.waitForTimeout(900)
  if (await readyMeals() !== beforeCooking) findings.push(`undoing left ${await readyMeals()} meals, not ${beforeCooking}`)

  // Deleted, and then not.
  await openTab(page, 1)
  const inLibrary = await page.locator('.recipe-tile').count()
  await openRecipe()
  await tap(page, '.recipe-tile button', 'Ištrinti')
  await page.waitForTimeout(800)
  if (await page.locator('.recipe-tile').count() !== inLibrary - 1) findings.push('deleting a recipe did not take it out of the library')
  await openTab(page, 3)
  if (await page.locator('.library-card').count() === 0) findings.push('a deleted recipe did not appear under Ištrinti')
  await tap(page, '.library-card button', 'Atkurti')
  await page.waitForTimeout(800)
  await openTab(page, 1)
  if (await page.locator('.recipe-tile').count() !== inLibrary) findings.push('restoring a recipe did not put it back in the library')
  return findings
}

/**
 * The phone's back button, which on Android is how everything is closed.
 *
 * Pressed through the browser rather than simulated: `history.back()` is the
 * same event the hardware button produces, and the whole difficulty of this is
 * that the app's own closing has to share a history stack with it.
 */
export async function back(page, base) {
  const findings = []
  const open = () => page.locator('.modal-backdrop').count()
  const press = async () => {
    await page.goBack().catch(() => {})
    await page.waitForTimeout(500)
  }
  await signIn(page, base)

  // One dialog: back closes it rather than the app.
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  if (await open() !== 1) findings.push('settings did not open')
  await press()
  if (await open() !== 0) findings.push('back did not close the dialog')
  if (await page.locator('.bottom-nav').count() === 0) findings.push('back left the app instead of closing the dialog')

  // A page inside a dialog is a place you can come back from too. Settings
  // keeps its pages in one dialog rather than a dialog each, so back used to
  // close the whole thing from Ingredients rather than returning to the menu.
  const heading = () => page.locator('.modal h2').first().innerText()
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await tap(page, 'button', 'Ingredientai')
  if (!/Ingredientai/.test(await heading())) findings.push('the ingredients page did not open')
  await press()
  if (await open() !== 1) {
    // Do not press again: with nothing of ours left, the next one leaves the
    // app and takes every finding after it along.
    findings.push('back from a settings page closed the whole dialog')
  } else {
    if (!/Nustatymai/.test(await heading())) findings.push(`back from the ingredients page showed "${await heading()}" rather than the settings menu`)
    await press()
    if (await open() !== 0) findings.push('back did not then close settings')
  }

  // Three deep: one press each, innermost first.
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await tap(page, 'button', 'Ingredientai')
  await tap(page, '.manager-row button', 'Keisti')
  await tap(page, '.category-field-button, button', 'Barbora kategorija')
  if (await open() !== 3) findings.push(`three dialogs deep reported ${await open()} open`)
  // Four presses, not three: the ingredients page inside settings is a place
  // of its own, so the third press returns to the settings menu rather than
  // closing it.
  for (const expected of [2, 1, 1, 0]) {
    if (await open() === 0) {
      // Everything shut in fewer presses than there are layers. Pressing on
      // would leave the app and take the rest of the scenario with it.
      findings.push('the dialogs closed in fewer presses than there are things to close')
      break
    }
    await press()
    if (await open() !== expected) findings.push(`back left ${await open()} dialog(s) open, not ${expected}`)
  }

  // Taking a dialog's entry off must not read as a back press of its own, or
  // closing the inner dialog closes the one underneath with it.
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await tap(page, 'button', 'Ingredientai')
  await tap(page, '.manager-row button', 'Keisti')
  if (await open() !== 2) findings.push(`expected two dialogs before closing the inner one, saw ${await open()}`)
  await tap(page, '.modal-backdrop:last-of-type .icon-button')
  await page.waitForTimeout(600)
  if (await open() !== 1) findings.push(`closing the inner dialog by hand left ${await open()} open, not 1`)
  await tap(page, '.modal .icon-button')
  await page.waitForTimeout(400)
  await openTab(page, 2)
  await press()
  const tabNow = await page.evaluate(() => document.querySelector('.bottom-nav button.active')?.textContent ?? '')
  if (!/Meniu/.test(tabNow)) findings.push(`after closing a dialog by hand, back left the app on "${tabNow}" rather than the menu`)

  // From another tab, back comes home.
  await openTab(page, 1)
  await press()
  const home = await page.evaluate(() => document.querySelector('.bottom-nav button.active')?.textContent ?? '')
  if (!/Meniu/.test(home)) findings.push(`back from the library landed on "${home}" rather than the menu`)

  // And from home, with nothing open, back leaves — which is the check that
  // catches a dialog closed by hand leaving its history entry behind, because
  // that stale entry would silently swallow this press. Last, because there is
  // no app left afterwards. (`history.length` cannot see it: going back keeps
  // the forward entry, so the count never drops.)
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await tap(page, '.modal .icon-button')
  await page.waitForTimeout(500)
  await press()
  if (await page.locator('.bottom-nav').count() !== 0) {
    findings.push('with nothing open, back stayed in the app instead of leaving it')
  }
  return findings
}

/**
 * Joining a household with an invite code.
 *
 * The only way a second person ever gets in, and the only flow where a wrong
 * answer is the expected one. A bad code answers null rather than raising,
 * because the attempt has to survive the call for the rate limit to see it —
 * so nothing but the client turns that null into a message, and if it stops
 * doing so the app reports nothing at all and stays where it is.
 */
export async function join(page, base) {
  const findings = []
  await signIn(page, base)

  // Leave the household through the stub's own API, then come back to the
  // setup screen the way a new account arrives at it.
  await page.evaluate(async (api) => {
    await fetch(`${api}/rest/v1/household_members?user_id=eq.00000000-0000-4000-8000-000000000002`, {
      method: 'DELETE',
      headers: { apikey: 'harness-key', authorization: 'Bearer fake-access-token' },
    })
    await fetch(`${api}/rest/v1/households?id=eq.00000000-0000-4000-8000-000000000001`, {
      method: 'PATCH',
      headers: { apikey: 'harness-key', authorization: 'Bearer fake-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ owner_id: '00000000-0000-4000-8000-000000000099' }),
    })
  }, process.env.HARNESS_STUB)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  // The setup screen opens on "create a kitchen"; joining is the other tab.
  // It reverts there whenever the component remounts, so ask for it each time
  // rather than assuming a failed attempt left us where we were.
  const openJoinForm = async () => {
    if (await page.locator('.code-input').count() === 0) await tap(page, 'button', 'Prisijungti')
  }
  await openJoinForm()
  if (await page.locator('.code-input').count() === 0) {
    const seen = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\s+/g, ' '))
    findings.push(`a member with no household did not reach the join form; saw "${seen}"`)
    return findings
  }

  // A code the household does not have.
  await page.fill('.code-input', 'FFFFFFFFFFFF')
  await page.locator('form button, button.primary').first().click()
  await page.waitForTimeout(1200)
  const complaint = await page.locator('.form-notice').allInnerTexts().catch(() => [])
  if (!complaint.join(' ').trim()) findings.push('a wrong invite code was accepted in silence')
  if (await page.locator('.code-input').count() === 0) findings.push('a wrong invite code let the app through anyway')

  // The real one, typed the way it would be read off another phone.
  await openJoinForm()
  await page.fill('.code-input', 'abcd 1234')
  await page.locator('form button, button.primary').first().click()
  await page.waitForTimeout(2500)
  if (await page.locator('.bottom-nav').count() === 0) findings.push('the correct invite code did not get in')
  return findings
}

/**
 * Two people, one household, at the same time.
 *
 * Two people is this app's entire premise and nothing tested it: the stub
 * served one session, so every scenario has been a single person alone. What
 * that hides is not the merge — Supabase delivers the refresh — but what each
 * app does while it is holding a picture of the household that has stopped
 * being true.
 *
 * The stub has no realtime, so the other side converges by reloading. That is
 * the honest model anyway: realtime is a refresh arriving sooner, not a
 * different outcome.
 */
export async function concurrent(page, base) {
  const findings = []
  const other = await (await page.context().browser().newContext(PHONE)).newPage()
  page.on('dialog', (dialog) => void dialog.accept())
  other.on('dialog', (dialog) => void dialog.accept())
  await signIn(page, base)
  await signIn(other, base, 'kitas@example.com')

  const chips = (who) => who.locator('.queue-chip').count()
  const chipNames = (who) => who.locator('.queue-chip span').allInnerTexts()
  const meals = (who) => who.locator('.meal-card').count()
  const titleAt = (who, index) => who.locator('.recipe-tile-summary strong').nth(index).innerText()
  /** Open one library tile without closing whichever is already open. */
  const openRecipe = async (who, index = 0) => {
    await who.evaluate((i) => {
      const summary = document.querySelectorAll('.recipe-tile-summary')[i]
      if (summary?.getAttribute('aria-expanded') !== 'true') summary?.click()
    }, index)
    await who.waitForTimeout(400)
  }
  /**
   * Act on the tile showing this title, wherever the library has put it.
   *
   * In two passes with a wait between: a tile's buttons do not exist until
   * React has re-rendered it open, so expanding and clicking in one evaluate
   * finds nothing however correct it looks.
   */
  const tapWithin = async (who, title, label) => {
    const tileOf = (wanted) => [...document.querySelectorAll('.recipe-tile')]
      .find((node) => node.querySelector('strong')?.textContent === wanted)
    const found = await who.evaluate(([wanted, source]) => {
      const tile = new Function(`return ${source}`)()(wanted)
      if (!tile) return false
      const summary = tile.querySelector('.recipe-tile-summary')
      if (summary?.getAttribute('aria-expanded') !== 'true') summary.click()
      return true
    }, [title, tileOf.toString()])
    if (!found) return false
    await who.waitForTimeout(600)
    const done = await who.evaluate(([wanted, action, source]) => {
      const tile = new Function(`return ${source}`)()(wanted)
      const button = [...(tile?.querySelectorAll('button') ?? [])]
        .find((node) => (node.textContent || '').includes(action))
      if (!button) return false
      button.click()
      return true
    }, [title, label, tileOf.toString()])
    await who.waitForTimeout(800)
    return done
  }

  // Scenarios share one database and run in order, so this makes what it needs
  // rather than trusting the fixture: an earlier scenario empties the basket.
  await openTab(page, 1)
  await openRecipe(page, 0)
  const doomed = await titleAt(page, 0)
  await tapWithin(page, doomed, 'Į krepšelį')
  const survivor = await titleAt(page, 1)
  await tapWithin(page, survivor, 'Į krepšelį')
  await openTab(page, 2)
  if (await chips(page) < 2) findings.push(`planning two recipes left ${await chips(page)} in the basket`)

  // The other person bins one of them.
  await openTab(other, 1)
  if (!await tapWithin(other, doomed, 'Ištrinti')) findings.push(`the other person could not find "${doomed}" to delete`)

  // The one holding the basket catches up.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  await openTab(page, 2)
  if ((await chipNames(page)).includes(doomed)) {
    findings.push(`a recipe deleted by the other person is still in the basket as "${doomed}"`)
  }
  // The list itself, not just the chip: each ingredient names the recipes that
  // want it, so a binned recipe still shopping for groceries shows up there.
  const attributions = await page.locator('.ingredient-recipe-tags span').allInnerTexts()
  if (attributions.includes(doomed)) {
    findings.push(`the shopping list is still buying ingredients for "${doomed}", which is in the bin`)
  }

  // Hiding it is not the same as removing it. A queue row for a deleted recipe
  // is invisible to both people, cannot be taken out, and is dropped without a
  // word at the checkout — so deleting has to clear it, not just stop drawing
  // it. Checked before the stale case below deliberately creates one.
  const orphaned = await page.evaluate(async (api) => {
    const ask = (path) => fetch(`${api}/rest/v1/${path}`, {
      headers: { apikey: 'harness-key', authorization: 'Bearer fake-access-token' },
    }).then((response) => response.json())
    const [queue, recipes] = await Promise.all([ask('shopping_queue?select=*'), ask('recipes?select=*')])
    const binned = new Set(recipes.filter((recipe) => recipe.deleted_at).map((recipe) => recipe.id))
    return queue.filter((entry) => binned.has(entry.recipe_id)).length
  }, process.env.HARNESS_STUB)
  if (orphaned > 0) findings.push(`${orphaned} basket row(s) point at a recipe in the bin, where nobody can reach them`)

  // Whatever the basket shows must be what the shop produces. A chip that
  // cannot become a meal is a promise the app does not keep.
  const planned = await chips(page)
  await openTab(page, 0)
  const mealsBefore = await meals(page)
  await openTab(page, 2)
  if (planned > 0) {
    await tap(page, '.complete-button')
    await page.waitForTimeout(1500)
    await openTab(page, 0)
    const gained = (await meals(page)) - mealsBefore
    if (gained !== planned) findings.push(`the basket showed ${planned} recipe(s) and the shop produced ${gained} meal(s)`)
  } else {
    findings.push('the basket was empty by the time the shop was finished, so nothing was checked')
  }

  // A stale app acting on a recipe that has already gone.
  await openTab(other, 1)
  const next = await titleAt(other, 0)
  await openTab(page, 1)
  await openRecipe(page, 0)                       // `page` sees it and still believes in it
  await tapWithin(other, next, 'Ištrinti')
  await tapWithin(page, next, 'Į krepšelį')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  await openTab(page, 2)
  if ((await chipNames(page)).includes(next)) {
    findings.push(`a recipe deleted moments earlier was added to the basket anyway as "${next}"`)
  }
  // Here the queue row genuinely exists — a stale app put it there — so this is
  // the case where refusing to draw a binned recipe is the only thing standing
  // between the household and a shopping list for a dinner they cannot cook.
  const staleAttributions = await page.locator('.ingredient-recipe-tags span').allInnerTexts()
  if (staleAttributions.includes(next)) {
    findings.push(`the shopping list is buying ingredients for "${next}", which the other person had already binned`)
  }

  // Both remove the same thing from the basket.
  await openTab(page, 1)
  const shared = await titleAt(page, 0)
  await tapWithin(page, shared, 'Į krepšelį')
  await other.reload({ waitUntil: 'networkidle' })
  await other.waitForTimeout(3000)
  await openTab(other, 2)
  await openTab(page, 2)
  if (await chips(page) > 0 && await chips(other) > 0) {
    await tap(page, '.queue-chip button')
    await page.waitForTimeout(600)
    await tap(other, '.queue-chip button')
    await other.waitForTimeout(600)
    for (const who of [page, other]) {
      await who.reload({ waitUntil: 'networkidle' })
      await who.waitForTimeout(3000)
      await openTab(who, 2)
    }
    if (await chips(other) !== await chips(page)) {
      findings.push(`after both removed from the basket they disagree: ${await chips(other)} against ${await chips(page)}`)
    }
  } else {
    findings.push(`the shared-removal case had ${await chips(page)} and ${await chips(other)} chips, so it checked nothing`)
  }

  await other.context().close()
  return findings
}

/**
 * A cold start opens on the tab you were last using.
 *
 * The remembered tab used to arrive with the data, several hundred milliseconds
 * after the app had already drawn and filled the menu — so every cold start
 * showed the wrong tab, populated it, and then jumped. Catching that needs the
 * *first* painted frame rather than the settled one, so the page records every
 * active tab it ever shows and the check reads the first.
 */
export async function coldstart(page, base) {
  const findings = []
  await signIn(page, base)

  // Be somewhere other than the menu, and let it be written down.
  await openTab(page, 2)
  await page.waitForTimeout(800)

  await page.addInitScript(() => {
    window.__tabsSeen = []
    const watch = () => {
      // Without the badge: the basket's count appears when the data lands, and
      // "Krepšelis" becoming "6Krepšelis" is not the app changing tabs.
      const active = document.querySelector('.bottom-nav button.active')?.textContent?.replace(/\d+/g, '').trim()
      if (active && window.__tabsSeen.at(-1) !== active) window.__tabsSeen.push(active)
      requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)

  const seen = await page.evaluate(() => window.__tabsSeen ?? [])
  if (seen.length === 0) {
    findings.push('the navigation never appeared after a cold start')
    return findings
  }
  if (!/Krepšelis/.test(seen[0])) {
    findings.push(`a cold start first drew "${seen[0]}" when the basket was where they left off`)
  }
  if (seen.length > 1) {
    findings.push(`a cold start moved through ${seen.length} tabs before settling: ${seen.join(' → ')}`)
  }
  return findings
}

/**
 * Shapes other than the one phone every other scenario runs on.
 *
 * Everything here has been checked at 390×844 in portrait. A landscape phone is
 * barely 390px tall, and a small one is 320px wide — the first squeezes what a
 * modal has to fit in, the second squeezes what a row has to fit across.
 */
export async function shapes(page, base) {
  const findings = []
  await signIn(page, base)

  const faults = (width) => page.evaluate((edge) => {
    const out = []
    if (document.documentElement.scrollWidth > edge + 1) {
      out.push(`${document.documentElement.scrollWidth}px of content in ${edge}px`)
    }
    const past = [...document.querySelectorAll('body *')].filter((el) => {
      const box = el.getBoundingClientRect()
      return box.width && box.height && getComputedStyle(el).position !== 'fixed' && (box.right > edge + 1 || box.left < -1)
    })
    if (past.length) out.push(`${past.length} element(s) past the edge`)
    return out
  }, width)

  // A narrow phone, which is where a row runs out of room across.
  const narrow = { width: 320, height: 568 }
  await page.setViewportSize(narrow)
  await page.waitForTimeout(500)
  for (const [index, label] of ['Meniu', 'Receptai', 'Krepšelis', 'Ištrinti'].entries()) {
    await openTab(page, index)
    for (const fault of await faults(narrow.width)) findings.push(`${narrow.width}px wide, ${label}: ${fault}`)
  }

  // Landscape, which is where a modal runs out of room down. The bottom of the
  // card carries the buttons, so a card taller than the screen strands them.
  const landscape = { width: 844, height: 390 }
  await page.setViewportSize(landscape)
  await page.waitForTimeout(500)
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await tap(page, 'button', 'Ingredientai')
  await tap(page, '.manager-row button', 'Keisti')
  await page.waitForTimeout(400)
  const stranded = await page.evaluate((height) => {
    const backdrop = [...document.querySelectorAll('.modal-backdrop')].pop()
    if (!backdrop) return ['the ingredient editor did not open']
    const out = []
    const card = backdrop.querySelector('.modal').getBoundingClientRect()
    if (card.bottom > height + 1) out.push(`the card runs ${Math.round(card.bottom - height)}px past the bottom of the screen`)
    if (card.top < -1) out.push(`the card starts ${Math.round(-card.top)}px above the screen`)
    const close = backdrop.querySelector('.icon-button')?.getBoundingClientRect()
    if (close && (close.bottom > height + 1 || close.top < -1)) out.push('the close button is off screen')
    return out
  }, landscape.height)
  for (const fault of stranded) findings.push(`landscape: ${fault}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: 390, height: 844 })
  return findings
}

/**
 * What the app does when the backend cannot be reached.
 *
 * Not a fault the household can fix, so the only question is whether the app
 * says so. The answer used to be that it offered to create a household: the
 * membership read failed, the check finished holding nothing, and "no
 * household" and "could not find out" look identical from there. Two people
 * who have been cooking from this app for months were shown `Sukurkite savo
 * virtuvę`, and taking it would have given them a second, empty one.
 */
export async function offline(page, base) {
  const findings = []
  await signIn(page, base)
  await page.waitForTimeout(500)

  // Every read fails from here. The session is already in storage, so the app
  // gets as far as trying to load the household's data and no further.
  await page.context().route('**/rest/v1/**', (route) => route.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })

  // supabase-js retries a failed GET three times, a second apart and doubling,
  // so nothing has gone wrong for the first seven seconds. Waiting less than
  // that would report the client's own patience as a hang.
  const settled = await page
    .waitForFunction(() => document.querySelectorAll('.splash').length === 0, null, { timeout: 20000 })
    .then(() => true, () => false)
  if (!settled) findings.push('the app never left its loading screen with the network down')

  const state = await page.evaluate(() => ({
    offersHousehold: [...document.querySelectorAll('h1')].some((h) => /Sukurkite savo virtuvę/.test(h.textContent ?? '')),
    nav: document.querySelectorAll('.bottom-nav').length,
    said: [...document.querySelectorAll('.banner, .form-notice, .lead')].map((node) => node.textContent?.trim()).filter(Boolean),
  }))
  if (state.offersHousehold) {
    findings.push('with the network down the app offered to create a household to someone who already has one')
  }
  if (settled && state.said.length === 0) {
    findings.push('the app gave up on loading and said nothing about why')
  }
  if (state.nav > 0) findings.push('the app showed its tabs as though the data had loaded')

  // And it recovers where it stopped: the button it offers has to do something.
  // Reloading instead when there is no button keeps a stuck app from throwing
  // here and taking the findings above down with it.
  await page.context().unroute('**/rest/v1/**')
  const offersRetry = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((node) => /Bandyti dar kartą/.test(node.textContent ?? '')))
  if (offersRetry) await tap(page, 'button', 'Bandyti dar kartą')
  else {
    findings.push('the app gave the household no way to try again')
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
  const recovered = await page
    .waitForFunction(() => document.querySelectorAll('.bottom-nav').length > 0, null, { timeout: 15000 })
    .then(() => true, () => false)
  if (!recovered) findings.push('the app did not come back once the network did')
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

export const SCENARIOS = { layout, keyboard, appswitch, modals, scrolltrace, planning, back, join, concurrent, coldstart, shapes, offline }
