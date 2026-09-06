/**
 * What is already in the trolley.
 *
 * The shopping list had no per-item state at all: thirty-eight things in
 * seven aisles, and the only record of what you had picked up was your own
 * memory of it. Ticking one off is the smallest thing the screen could do
 * for someone holding a phone in one hand and a basket in the other.
 *
 * Three decisions worth writing down:
 *
 * - **A tick is not a plan.** It never blocks finishing. `complete_shopping`
 *   moves the planned meals whether or not a single box is ticked, because
 *   buying without ticking is the normal way to use a list, and a screen that
 *   refuses to believe you is worse than one that cannot count.
 * - **It lives on the phone, not in the database.** The list is rebuilt from
 *   the basket every render, and a tick is worth nothing an hour after the
 *   shop. Putting it in Postgres would mean a table, a policy, a migration
 *   and a realtime subscription for a value with a half-life of twenty
 *   minutes. The cost of the choice is real and is the next paragraph.
 * - **So two people shopping together do not see each other's ticks.** If we
 *   ever split a shop between two trolleys, this is the thing to move into
 *   the database — and the shape here (a set of ingredient names under one
 *   household) is what that table would hold.
 *
 * Names are the key rather than ids because the shopping list is built from
 * ingredient names: the same item from two recipes is one row, and it is that
 * row being ticked.
 */

const PREFIX = 'recipes:ticks:v1:'

export function ticksKey(householdId) {
  return `${PREFIX}${householdId}`
}

/**
 * Read the ticks back, keeping only the ones still on the list — and forget
 * the rest, permanently.
 *
 * The forgetting is the point, and the first version got it wrong: it
 * filtered on the way out but left the stored set alone. Empty the basket and
 * fill it again with the same meals, and every tick came back — because the
 * names had never gone anywhere, they had only been hidden while they were
 * off the list. A tick has to die with the row it was made on.
 */
export function readTicks(key, present, storage = window.localStorage) {
  const wanted = new Set(present)
  let stored
  try {
    stored = JSON.parse(storage.getItem(key) ?? 'null')
  } catch {
    stored = null
  }
  if (!Array.isArray(stored)) return new Set()
  const kept = new Set(stored.filter((item) => typeof item === 'string' && wanted.has(item)))
  // Only write when something was actually dropped, so an ordinary read of an
  // unchanged list does not touch storage on every render.
  if (kept.size !== stored.length) writeTicks(key, kept, storage)
  return kept
}

export function writeTicks(key, ticks, storage = window.localStorage) {
  try {
    storage.setItem(key, JSON.stringify([...ticks]))
    return true
  } catch {
    // A full or unavailable storage must never stop someone shopping.
    return false
  }
}

export function clearTicks(key, storage = window.localStorage) {
  try {
    storage.removeItem(key)
  } catch {
    // Nothing to do about it, and nothing that depends on it.
  }
}

export function toggleTick(ticks, item) {
  const next = new Set(ticks)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  return next
}

/**
 * How far through the list you are.
 *
 * The count and the bar live at the top, next to the list they describe.
 * There is deliberately nothing beside the Apsipirkta button: it is never
 * disabled, so a line explaining that it is not disabled was answering a
 * question the screen had stopped asking.
 */
export function shoppingProgress(total, ticked) {
  return {
    total,
    ticked: Math.min(ticked, total),
    left: Math.max(0, total - ticked),
    // 0..1, and 0 rather than NaN for an empty list.
    fraction: total > 0 ? Math.min(1, ticked / total) : 0,
  }
}
