// Builds the category catalogue from the links a crawl collected.
//
// Every Barbora top-level page renders its whole child and grandchild tree, so
// the crawler reads eleven pages rather than recursing into hundreds. The
// parent relationship never has to be inferred from the markup: it is encoded
// in the path itself, and `collectLinks` only has to preserve the order in
// which Barbora displayed each category.

import { isInsideRoot, normalizeCategoryPath, parentOf, pathDepth } from './paths.js'

export const SCHEMA_VERSION = 1

/**
 * Reduce the anchors of one category page to ordered, deduplicated categories.
 *
 * Anchors arrive in document order as `{ href, text }`. Links that leave the
 * page's own top-level category are dropped, which removes the header
 * navigation, product cards, promotions, and account routes without keeping a
 * list of every non-category route Barbora might add.
 *
 * @param {{href: string, text?: string}[]} anchors
 * @param {{root: string, base?: string, hosts?: Set<string>}} options
 * @returns {{path: string, name: string}[]} first appearance wins
 */
export function collectLinks(anchors, { root, base, hosts }) {
  const seen = new Map()

  for (const anchor of anchors ?? []) {
    const path = normalizeCategoryPath(anchor?.href, base, hosts)
    if (path === null) continue
    if (!isInsideRoot(path, root)) continue

    const name = collapseWhitespace(anchor?.text ?? '')
    if (name === '') continue

    // The same category can be linked twice on a page (a heading and a card).
    // The first appearance carries the display order, so later ones only fill
    // in a name if the first anchor had none.
    if (!seen.has(path)) seen.set(path, { path, name })
  }

  return [...seen.values()]
}

/**
 * Merge per-page link lists into one catalogue.
 *
 * @param {{root: string, links: {path: string, name: string}[]}[]} pages
 * @returns {{categories: object[], problems: string[]}}
 */
export function buildCatalogue(pages) {
  const problems = []
  const byPath = new Map()

  for (const page of pages) {
    for (const link of page.links) {
      const existing = byPath.get(link.path)
      if (existing === undefined) {
        byPath.set(link.path, { path: link.path, name: link.name, page: page.root, order: byPath.size })
        continue
      }
      if (existing.name !== link.name) {
        problems.push(
          `Category ${link.path} was named "${existing.name}" on ${existing.page} and "${link.name}" on ${page.root}`,
        )
      }
    }
  }

  // Barbora lists siblings in display order on the parent's page, so the order
  // in which a path first appeared is the order to preserve.
  const children = new Map()
  for (const entry of [...byPath.values()].sort((a, b) => a.order - b.order)) {
    const parentPath = parentOf(entry.path)
    if (!children.has(parentPath)) children.set(parentPath, [])
    children.get(parentPath).push(entry)
  }

  const categories = []
  for (const [parentPath, siblings] of children) {
    if (parentPath !== null && !byPath.has(parentPath)) {
      problems.push(`Category ${siblings[0].path} has no parent ${parentPath} in the crawl`)
    }
    siblings.forEach((entry, index) => {
      categories.push({
        path: entry.path,
        name: entry.name,
        sortOrder: index,
        parentPath,
        depth: pathDepth(entry.path),
      })
    })
  }

  return { categories: sortCategories(categories), problems }
}

/**
 * Deterministic catalogue order: shallowest first, then by parent, then in
 * Barbora's own display order. Two crawls of an unchanged shop produce
 * byte-identical JSON.
 */
export function sortCategories(categories) {
  return [...categories].sort((a, b) =>
    a.depth - b.depth ||
    compareParents(a.parentPath, b.parentPath) ||
    a.sortOrder - b.sortOrder ||
    compare(a.path, b.path))
}

function compareParents(a, b) {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return compare(a, b)
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Wrap a category list in the on-disk snapshot envelope. */
export function serializeCatalogue(categories, { generatedAt = new Date().toISOString() } = {}) {
  const sorted = sortCategories(categories)
  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'https://barbora.lt',
    generatedAt,
    categoryCount: sorted.length,
    categories: sorted,
  }
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim()
}
