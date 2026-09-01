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
      findings.push(...(await page.evaluate(() => {
        const out = []
        const vw = window.innerWidth
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
      })).map((f) => `${label.trim()} (${pass}): ${f}`))
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
  await signIn(page, base)
  await openTab(page, 1)
  await page.evaluate((y) => window.scrollTo(0, y), target)
  await page.waitForTimeout(600)

  // Backgrounded, moved by the system while hidden, then reopened.
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(200)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(800)
  let now = await scrollY(page)
  if (Math.abs(now - target) > 40) findings.push(`switching away and back left the library at ${now}px instead of ${target}px`)

  // Backgrounded with a modal open, which parks the body at the top.
  await page.evaluate((y) => window.scrollTo(0, y), target)
  await page.waitForTimeout(400)
  await tap(page, 'button[aria-label="Namų ūkio nustatymai"]')
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  const saved = await page.evaluate(() => {
    const raw = Object.entries(localStorage).find(([k]) => k.startsWith('recipes:view'))
    return raw ? JSON.parse(raw[1]).scrollByTab?.library : null
  })
  if (saved !== null && Math.abs(saved - target) > 40) findings.push(`backgrounding with a modal open saved ${saved}px instead of ${target}px`)
  await setVisibility(page, 'visible')
  await page.waitForTimeout(400)
  await tap(page, '.modal .icon-button')

  // Evicted and reloaded from scratch.
  await page.evaluate((y) => window.scrollTo(0, y), target)
  await page.waitForTimeout(400)
  await setVisibility(page, 'hidden')
  await page.waitForTimeout(300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
  now = await scrollY(page)
  if (Math.abs(now - target) > 60) findings.push(`reopening after eviction landed at ${now}px instead of ${target}px`)
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

export const SCENARIOS = { layout, keyboard, appswitch, modals }
