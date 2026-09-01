// Choosing one Barbora category for an ingredient, deterministically.
//
// The crawler discovers the tree; this chooses within it. The rule is
// deliberately timid: descend only where the shop's own wording makes the
// answer obvious, and otherwise stop at a branch that is merely broad rather
// than wrong. A category that is too broad costs a household a few taps. A
// category that is confidently wrong sends someone to the wrong aisle.
//
// Nothing here writes anything. `mapIngredient` returns a proposal, and a
// manual choice always outranks it.

import { ingredientNameWithoutQuantity, normalizeTitle, titleSimilarity } from './parser.js'

export const BARBORA_ORIGIN = 'https://barbora.lt'

/**
 * The shopping URL for a stored category path.
 *
 * Barbora's app-link files claim top-level aisles as `/<aisle>/*`, and a bare
 * `/<aisle>` does not match that pattern — the trailing slash is the whole
 * difference between a link opening the Barbora app and opening a browser tab.
 * Deeper paths already match, so they are left exactly as stored.
 */
export function shoppingUrl(path) {
  const segments = path.split('/').filter(Boolean)
  return `${BARBORA_ORIGIN}${path}${segments.length === 1 ? '/' : ''}`
}

/**
 * Where to begin descending for each shop section. `Other` has no honest
 * starting point, so ingredients there are left unmapped rather than guessed
 * at from the top of the shop.
 */
export const SECTION_ROOTS = {
  Produce: '/darzoves-ir-vaisiai',
  Bakery: '/duonos-gaminiai-ir-konditerija',
  'Dairy & alternatives': '/pieno-gaminiai-kiausiniai-ir-majonezas',
  Frozen: '/saldytas-maistas',
  Pantry: '/bakaleja',
  Spices: '/bakaleja/prieskoniai-marinatai-ir-sultiniai',
  Other: null,
}

/**
 * Reviewed exceptions, for ingredients Barbora files somewhere the section
 * root cannot reach, or names its categories never spell out. Each one was
 * read against the live category name; none is a guess from a product listing.
 * Keyed by normalized ingredient name.
 */
export const CATEGORY_ALIASES = {
  // Baking staples live under sugar and salt, not under spices.
  druska: '/bakaleja/cukrus-druska-ir-kepimo-priedai/druska',
  cukrus: '/bakaleja/cukrus-druska-ir-kepimo-priedai/baltasis-cukrus',
  'rudasis cukrus': '/bakaleja/cukrus-druska-ir-kepimo-priedai/rudasis-cukrus',
  soda: '/bakaleja/cukrus-druska-ir-kepimo-priedai/soda-ir-krakmolas',
  'kukuruzu krakmolas': '/bakaleja/cukrus-druska-ir-kepimo-priedai/soda-ir-krakmolas',
  'kepimo milteliai': '/bakaleja/cukrus-druska-ir-kepimo-priedai/kepimo-milteliai-ir-vanilinis-cukrus',
  // "Sojų, terijakio ir vorčesterio padažai" names the sauce, not the bean.
  'soju padazas': '/bakaleja/padazai-ir-konservuotos-uztepeles/soju-terijakio-ir-vorcesterio-padazai',
  // The category is literally "Augalinis sūris, užtepai ir tofu".
  tofu: '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augalinis-suris-uztepai-ir-tofu',
  'rukytas tofu': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augalinis-suris-uztepai-ir-tofu',
  'augalinis pienas': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augaliniai-gerimai-ir-grietinele',
  miltai: '/bakaleja/miltai-ir-ju-misiniai/kvietiniai-ir-ruginiai-miltai',
}

/**
 * Barbora names a category after everything in it: "Bulvės, morkos ir
 * kopūstai" is three answers wearing one label. Splitting on commas and the
 * conjunction turns the label back into the terms a person would match.
 */
export function categoryTerms(name) {
  // Split the label first: normalizing strips punctuation, so a comma has to
  // be spent before it is erased.
  return String(name ?? '')
    .split(/\s*,\s*/)
    .flatMap((part) => part.split(/\s+ir\s+/iu))
    .map((term) => normalizeTitle(term))
    .filter(Boolean)
}

/** Index the catalogue by path, with children derived from the paths alone. */
export function buildCategoryIndex(categories) {
  const byPath = new Map()
  const children = new Map()

  for (const category of categories) {
    byPath.set(category.path, category)
    const parent = parentOf(category.path)
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(category)
  }

  return { byPath, children }
}

/** Every category below `path`, deepest last. */
export function descendantsOf(index, path) {
  const found = []
  const queue = [...(index.children.get(path) ?? [])]
  while (queue.length > 0) {
    const category = queue.shift()
    found.push(category)
    queue.push(...(index.children.get(category.path) ?? []))
  }
  return found
}

/**
 * Propose a category for an ingredient, or `null` when nothing narrower than
 * the section is known.
 *
 * @param {string} name ingredient name as the household typed it
 * @param {string} section the ingredient's shop section
 * @param {{byPath: Map, children: Map}} index from {@link buildCategoryIndex}
 * @returns {{path: string, reason: 'exact'|'alias'|'parent_fallback'}|null}
 */
export function mapIngredient(name, section, index) {
  const normalized = normalizeTitle(ingredientNameWithoutQuantity(name))
  if (normalized === '') return null

  const alias = CATEGORY_ALIASES[normalized]
  if (alias !== undefined && index.byPath.has(alias)) return { path: alias, reason: 'alias' }

  const root = SECTION_ROOTS[section] ?? null
  if (root === null || !index.byPath.has(root)) return null

  const matches = descendantsOf(index, root)
    .filter((category) => categoryTerms(category.name).includes(normalized))
  if (matches.length === 0) return null

  // Several matches on one branch are the same answer said twice: "Grietinė"
  // names both the shelf and the aisle above it, and the shelf is the answer.
  const deepest = matches.reduce((a, b) => (a.depth >= b.depth ? a : b))
  if (matches.every((category) => isAncestorOrSelf(category.path, deepest.path))) {
    return { path: deepest.path, reason: 'exact' }
  }

  // Genuinely different branches: "Pupelės" is sold tinned and dry. Retreat to
  // whatever contains them all, and only if that says more than the section.
  const shared = commonAncestor(matches.map((category) => category.path))
  if (shared === null || shared === root || !index.byPath.has(shared)) return null
  return { path: shared, reason: 'parent_fallback' }
}

/**
 * Rank categories by name similarity, for a person choosing in the picker.
 * Never used to write a mapping: a resemblance is not a relationship.
 */
export function suggestCategories(name, categories, limit = 8) {
  const normalized = ingredientNameWithoutQuantity(name)
  if (normalizeTitle(normalized) === '') return []
  return categories
    .map((category) => ({ category, score: titleSimilarity(normalized, category.name) }))
    .filter((entry) => entry.score > 0.3)
    .sort((a, b) => b.score - a.score || a.category.path.localeCompare(b.category.path))
    .slice(0, limit)
    .map((entry) => entry.category)
}

/** The breadcrumb from the top of the shop down to `path`. */
export function trailTo(index, path) {
  const trail = []
  let current = path
  while (current) {
    const category = index.byPath.get(current)
    if (category) trail.unshift(category)
    current = parentOf(current)
  }
  return trail
}

function parentOf(path) {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? null : path.slice(0, cut)
}

function isAncestorOrSelf(path, candidate) {
  return candidate === path || candidate.startsWith(`${path}/`)
}

function commonAncestor(paths) {
  return paths.reduce((shared, path) => {
    if (shared === null) return path
    const a = shared.split('/')
    const b = path.split('/')
    const kept = []
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      if (a[index] !== b[index]) break
      kept.push(a[index])
    }
    return kept.length > 1 ? kept.join('/') : null
  }, null)
}
