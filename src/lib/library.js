/**
 * What the library shows, and in what order.
 *
 * Sixty-five recipes is more than fits in a head, and until now the only
 * question the screen could answer was "where is the one I am thinking of".
 * The more common question in a planner is the other one — "what have we not
 * had in a while" — and the app already knows the answer: every cooked meal
 * leaves a dated row behind, for ever, and `roster_entries` is never pruned.
 *
 * Everything here is pure and works on plain objects, so the rules can be read
 * and tested without a browser. The shape it takes is one entry per recipe:
 *
 *     { id, title, dishType, cuisine, lastCooked }
 *
 * where `lastCooked` is an ISO date string or `null`.
 */

/** The two orders the library offers. `type` is the default. */
export const SORTS = ['type', 'stale']

/**
 * Order the entries.
 *
 * - `type` groups by dish type, in the household's own order, then by name.
 *   The tints arrive in bands rather than scattered, and the chips at the top
 *   become places on the page rather than only filters.
 * - `stale` is longest-since-cooked first, and a recipe never cooked counts as
 *   longest of all — it has been waiting since the day it was written down.
 *   That is the whole point of the order: the things at the top are the things
 *   you have been meaning to make.
 *
 * Ties break on the title in both, so the order never depends on which row the
 * database happened to return first. Two people on two phones see the same
 * list.
 */
export function orderLibrary(entries, sort, typeOrder = []) {
  const rank = new Map(typeOrder.map((name, index) => [name, index]))
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'lt')
  const sorted = entries.slice()
  if (sort === 'stale') {
    sorted.sort((a, b) => {
      if (a.lastCooked === b.lastCooked) return byTitle(a, b)
      if (!a.lastCooked) return -1
      if (!b.lastCooked) return 1
      return a.lastCooked < b.lastCooked ? -1 : 1
    })
  } else {
    sorted.sort((a, b) => {
      const byType = (rank.get(a.dishType) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.dishType) ?? Number.MAX_SAFE_INTEGER)
      return byType !== 0 ? byType : byTitle(a, b)
    })
  }
  return sorted
}

/**
 * Count the values of one axis against everything filtered *except that axis*.
 *
 * A dish-type chip has to count what choosing it would actually show, so it is
 * counted after the cuisine filter and before its own. Counting it after its
 * own filter would make every chip but the chosen one read zero, which is both
 * useless and alarming.
 */
export function facetCounts(entries, key, order = []) {
  const counts = new Map()
  for (const entry of entries) {
    const value = entry[key]
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const known = order.filter((name) => counts.has(name))
  const extra = [...counts.keys()]
    .filter((name) => !order.includes(name))
    .sort((a, b) => a.localeCompare(b, 'lt'))
  return [...known, ...extra].map((name) => ({ name, count: counts.get(name) }))
}

/**
 * A chosen value that nothing can satisfy any more stops being a filter.
 *
 * Type "šaltibarščiai" with the Desertai chip on and every chip empties. The
 * alternative to dropping the filter is an empty library and no visible reason
 * for it, which is the same fault as a filter you cannot see the top of.
 */
export function liveChoice(choice, options) {
  return choice && options.some((option) => option.name === choice) ? choice : null
}
