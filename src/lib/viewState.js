/**
 * Where the household was, kept between visits.
 *
 * A small, versioned, non-sensitive record: the tab they were on, how far down
 * each tab they had scrolled, and which library recipe was open. No modal, no
 * confirmation, no draft, nothing from the database. It is keyed by user and
 * household, so two people on one device never inherit each other's place.
 */

export const TABS = ['current', 'library', 'shop', 'deleted']

export const EMPTY_SCROLL = { current: 0, library: 0, shop: 0, deleted: 0 }

/**
 * How long a scroll position is worth coming back to.
 *
 * Stepping out to the shop's app and back should return you to the row you
 * were reading. Opening the app the next morning should not: the list has
 * changed underneath, and landing halfway down it reads as a fault rather than
 * a kindness. The tab survives either way — that is cheap to recognise and
 * easy to correct. A position halfway down a changed list is neither.
 */
export const SCROLL_MEMORY_MS = 60 * 60 * 1_000

export function viewStateKey(userId, householdId) {
  return `recipes:view:v1:${userId}:${householdId}`
}

/**
 * Read a stored record, refusing anything that is not one. Storage is shared
 * with every other page on the origin and survives upgrades of this app, so
 * what comes back is treated as a stranger's until it proves otherwise.
 */
export function parseViewState(raw) {
  try {
    const parsed = JSON.parse(raw ?? 'null')
    if (!parsed || parsed.version !== 1 || !TABS.includes(parsed.tab)) return null
    const saved = parsed.scrollByTab
    const scroll = (tab) => {
      const value = saved?.[tab]
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
    }
    return {
      version: 1,
      tab: parsed.tab,
      scrollByTab: {
        current: scroll('current'),
        library: scroll('library'),
        shop: scroll('shop'),
        deleted: scroll('deleted'),
      },
      expandedRecipeId: typeof parsed.expandedRecipeId === 'string' ? parsed.expandedRecipeId : null,
      // Anything written before this field existed is old by definition.
      savedAt: typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
    }
  } catch {
    return null
  }
}

export function readViewState(key, storage = window.localStorage) {
  try {
    return parseViewState(storage.getItem(key))
  } catch {
    return null
  }
}

export function writeViewState(key, state, storage = window.localStorage) {
  try {
    storage.setItem(key, JSON.stringify(state))
    return true
  } catch {
    // A full or unavailable storage must never make the app unusable.
    return false
  }
}

/**
 * The positions worth restoring from a stored record: the ones from this
 * sitting. An older record still gives back its tab; every tab starts at the
 * top.
 */
export function positionsFrom(state, now = Date.now()) {
  if (!state) return { ...EMPTY_SCROLL }
  const age = now - state.savedAt
  if (age < 0 || age >= SCROLL_MEMORY_MS) return { ...EMPTY_SCROLL }
  return { ...EMPTY_SCROLL, ...state.scrollByTab }
}
