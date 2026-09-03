/**
 * A sliding window, as a pure function.
 *
 * Used by the `barbora-products` Edge Function to cap how often this household
 * can make it call Barbora. The point is not to police two people tapping a
 * shopping list — they could not reach the limit if they tried — but to put a
 * ceiling under a bug. A render loop or a bad effect dependency calling the
 * function a few hundred times a minute would look exactly like abuse from
 * Barbora's side, and we would find out by being blocked.
 *
 * Kept here rather than inside the function so it can be tested: a limiter
 * that silently admits everything, or silently refuses everything, is worse
 * than none, and neither failure is visible from the outside.
 *
 * See docs/barbora-product-pricing.md.
 */

/**
 * @param {number[]} hits when previous requests were admitted, oldest first
 * @param {number} now current time in ms
 * @param {number} limit how many requests are allowed in the window
 * @param {number} windowMs how long the window is
 * @returns {{ allowed: boolean, hits: number[], retryAfterSeconds: number }}
 *   `hits` is the list to keep for next time — pruned, and with `now` appended
 *   when the request was admitted. A refused request is deliberately not
 *   recorded: being over the limit should not extend the wait.
 */
export function admit(hits, now, limit, windowMs) {
  const since = now - windowMs
  const recent = (hits ?? []).filter((at) => typeof at === 'number' && at > since)

  if (recent.length < Math.max(0, limit)) {
    return { allowed: true, hits: [...recent, now], retryAfterSeconds: 0 }
  }

  // Room appears when the oldest request in the window falls out of it.
  // Rounded up, and never zero: "try again in 0 seconds" is not an answer.
  const oldest = Math.min(...recent)
  return {
    allowed: false,
    hits: recent,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
  }
}
