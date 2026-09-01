// Recognising the pages Barbora serves instead of a category.
//
// Unattended HTTP requests are met with a Cloudflare interstitial, and a
// rendered browser is occasionally challenged too. An interstitial parses
// perfectly well and simply yields no categories, so it has to be named
// explicitly rather than left to look like an empty aisle.

/** Lowercase fragments that only appear on a challenge or error interstitial. */
export const CHALLENGE_MARKERS = [
  'just a moment',
  'attention required',
  'checking your browser',
  'cf-browser-verification',
  'cf_chl_opt',
  'enable javascript and cookies to continue',
  'access denied',
  'error 1015',
]

/**
 * @param {string} text page title and visible text
 * @returns {string|null} the marker that matched, or null for a normal page
 */
export function findChallengeMarker(text) {
  const haystack = String(text ?? '').toLowerCase()
  return CHALLENGE_MARKERS.find((marker) => haystack.includes(marker)) ?? null
}
