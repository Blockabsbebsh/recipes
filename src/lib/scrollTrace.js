/**
 * A short record of what happened to the scroll position, kept on the device.
 *
 * Scroll restoration breaks in the one place we cannot watch it: while the
 * phone is backgrounding the app. There is no console to read afterwards, and
 * on iOS the web view is often reloaded before you can attach one, so the
 * evidence has to survive the reload. This keeps the last few dozen events in
 * localStorage — every capture, every write, every lifecycle transition — and
 * Settings prints them back. It is a diagnostic, not a feature: it must never
 * throw, and it must never cost anything the household would notice.
 */

const KEY = 'recipes:scroll-trace:v1'
// Enough for a few minutes of trying to break the app on a phone, which is
// how these are read: the household does a sequence, then copies the tail.
const LIMIT = 150

// Consecutive entries of these kinds collapse into the last one. Scrolling a
// long list would otherwise flush the lifecycle events we are looking for.
const COLLAPSING = new Set(['capture', 'capture-skipped', 'scroll-ignored'])

function now() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function readTrace() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.kind === 'string') : []
  } catch {
    return []
  }
}

export function clearTrace() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to do: the trace is optional by construction.
  }
}

/**
 * Append one event. `detail` is a flat object of small values; anything the
 * reader has to unfold on a phone screen is not worth recording.
 */
export function trace(kind, detail = {}) {
  try {
    const entries = readTrace()
    const entry = { at: now(), kind, ...detail }
    const last = entries[entries.length - 1]
    const collapses = last && COLLAPSING.has(kind) && last.kind === kind && last.from === entry.from && last.why === entry.why
    if (collapses) entries[entries.length - 1] = entry
    else entries.push(entry)
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(-LIMIT)))
  } catch {
    // A full or unavailable localStorage must never make the app unusable.
  }
}

/** One line per event, oldest first, short enough to read on a phone. */
export function formatTrace(entries = readTrace()) {
  if (!entries.length) return 'Įrašų nėra.'
  return entries
    .map(({ at, kind, ...detail }) => {
      const rest = Object.entries(detail)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
      return `${at} ${kind}${rest ? ` ${rest}` : ''}`
    })
    .join('\n')
}

/**
 * Where the page *looks* to be, which on iOS is not always where it says it
 * is: the visual viewport can sit at the top of the document while
 * `window.scrollY` still reports the position we restored. A trace where
 * `y` and `vp` disagree is the whole answer.
 */
export function visualTop() {
  try {
    const viewport = window.visualViewport
    return viewport ? Math.round(viewport.pageTop) : -1
  } catch {
    return -1
  }
}

/**
 * Which phone, and whether this is the installed app or a browser tab.
 *
 * The same log means different things in each: what a resuming web app paints
 * over itself is the platform's business, and a browser tab does not do it at
 * all.
 */
export function environment() {
  try {
    const ua = String(window.navigator.userAgent)
    const os = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'other'
    const standalone =
      window.navigator.standalone === true ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    return { os, mode: standalone ? 'installed' : 'browser' }
  } catch {
    return { os: 'unknown', mode: 'unknown' }
  }
}

/** How this page came to exist: `navigate`, `reload`, `back_forward`. */
export function navigationKind() {
  try {
    const [entry] = window.performance.getEntriesByType('navigation')
    return entry?.type ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
