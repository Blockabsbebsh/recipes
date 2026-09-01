// URL and path rules for the Barbora category catalogue.
//
// Every catalogue path is stored in one canonical shape: an absolute path that
// begins with `/`, carries no query, fragment, or trailing slash, and contains
// only lowercase slug segments. `https://barbora.lt${path}` is always a valid
// shopping link, which is the only reason this module exists.

export const BARBORA_ORIGIN = 'https://barbora.lt'

/** Hosts that are the same shop. Anything else is rejected outright. */
export const BARBORA_HOSTS = new Set(['barbora.lt', 'www.barbora.lt'])

/**
 * The hosts to accept when the crawler is pointed somewhere other than
 * production, which is how the browser layer is exercised in tests.
 */
export function hostsFor(origin) {
  if (origin === BARBORA_ORIGIN) return BARBORA_HOSTS
  return new Set([new URL(origin).hostname.toLowerCase()])
}

/**
 * Barbora renders three levels today. A deeper path is not automatically wrong,
 * but it is unexpected enough that the crawl should stop rather than invent a
 * hierarchy nobody has reviewed.
 */
export const MAX_DEPTH = 4

/**
 * First path segments that are never categories. The crawler additionally
 * accepts only links that stay inside the top-level category it is reading, so
 * this list is a second belt used while discovering the roots themselves.
 */
const RESERVED_ROOT_SEGMENTS = new Set([
  'produktai',
  'paieska',
  'krepselis',
  'uzsakymas',
  'prisijungti',
  'atsijungti',
  'registracija',
  'mano-paskyra',
  'pristatymas',
  'akcijos',
  'pasiulymai',
  'naujienos',
  'receptai',
  'kontaktai',
  'pagalba',
  'apie-mus',
  'taisykles',
  'privatumo-politika',
  'slapukai',
  'dovanu-kuponai',
  'lojalumas',
  'en',
  'ru',
  'lt',
])

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Turn an href found on a Barbora page into a canonical category path.
 *
 * Returns `null` for everything that is not a plain category page: other hosts,
 * product and search routes, anything carrying a query string or fragment,
 * paths with unexpected characters, and paths deeper than {@link MAX_DEPTH}.
 *
 * @param {string} href raw href, absolute or relative
 * @param {string} [base] page the href was found on, for relative resolution
 * @param {Set<string>} [hosts] hosts to treat as the shop
 * @returns {string|null}
 */
export function normalizeCategoryPath(href, base = BARBORA_ORIGIN, hosts = BARBORA_HOSTS) {
  if (typeof href !== 'string' || href.trim() === '') return null

  let url
  try {
    url = new URL(href.trim(), base)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!hosts.has(url.hostname.toLowerCase())) return null

  // A category link that needs a query string or a fragment is a filtered,
  // paginated, or in-page link, not the category itself.
  if (url.search !== '' || url.hash !== '') return null

  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }

  const segments = pathname.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) return null
  if (segments.length > MAX_DEPTH) return null
  if (RESERVED_ROOT_SEGMENTS.has(segments[0].toLowerCase())) return null

  const normalized = segments.map((segment) => segment.toLowerCase())
  if (!normalized.every((segment) => SEGMENT.test(segment))) return null

  return `/${normalized.join('/')}`
}

/** Depth of a canonical path: `/bakaleja` is 1, `/bakaleja/kruopos` is 2. */
export function pathDepth(path) {
  return path.split('/').filter((segment) => segment !== '').length
}

/** Canonical parent of a path, or `null` for a top-level category. */
export function parentOf(path) {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? null : path.slice(0, cut)
}

/** True when `path` is `root` itself or lives underneath it. */
export function isInsideRoot(path, root) {
  return path === root || path.startsWith(`${root}/`)
}

/** The shopping URL for a stored category path. */
export function categoryUrl(path) {
  return `${BARBORA_ORIGIN}${path}`
}
