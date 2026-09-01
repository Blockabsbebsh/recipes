// Safety net between a crawl and the published catalogue.
//
// A crawl that Cloudflare truncated, or that ran against changed markup, looks
// like a small catalogue rather than an error. Nothing is published unless the
// result passes every check here, and a failed run must leave the previous
// catalogue in place.

import { MAX_DEPTH, parentOf, pathDepth } from './paths.js'

/**
 * Top-level categories the shopping links depend on. Losing one of these means
 * the crawl or the shop changed in a way a person has to look at.
 */
export const REQUIRED_ROOTS = [
  '/darzoves-ir-vaisiai',
  '/pieno-gaminiai-kiausiniai-ir-majonezas',
  '/duonos-gaminiai-ir-konditerija',
  '/mesa-zuvis-ir-kulinarija',
  '/bakaleja',
  '/saldytas-maistas',
  '/gerimai',
]

/** Non-food roots that are crawled but are not worth failing a run over. */
export const OPTIONAL_ROOTS = [
  '/kudikiu-ir-vaiku-prekes',
  '/kosmetika-ir-higiena',
  '/svaros-ir-gyvunu-prekes',
  '/namai-ir-laisvalaikis',
]

/**
 * Reviewed floor. The catalogue held 636 categories on 2026-09-01; anything
 * near half of that is a broken crawl, not a smaller shop.
 */
export const MIN_CATEGORIES = 450

/** A run may not grow or shrink past these multiples of the previous run. */
export const MAX_GROWTH_RATIO = 1.5
export const MAX_SHRINK_RATIO = 0.9

/**
 * @param {{categories: object[]}} catalogue
 * @param {{previous?: {categories: object[]}|null}} [options]
 * @returns {{ok: boolean, errors: string[], warnings: string[], diff: object|null}}
 */
export function validateCatalogue(catalogue, { previous = null } = {}) {
  const errors = []
  const warnings = []
  const categories = catalogue?.categories ?? []

  if (categories.length < MIN_CATEGORIES) {
    errors.push(`Only ${categories.length} categories; the reviewed minimum is ${MIN_CATEGORIES}`)
  }

  const byPath = new Map()
  for (const category of categories) {
    if (byPath.has(category.path)) {
      errors.push(`Duplicate path ${category.path}`)
      continue
    }
    byPath.set(category.path, category)
  }

  for (const category of categories) {
    if (typeof category.name !== 'string' || category.name.trim() === '') {
      errors.push(`Category ${category.path} has no name`)
    }
    if (category.depth !== pathDepth(category.path)) {
      errors.push(`Category ${category.path} claims depth ${category.depth}`)
    }
    if (category.depth > MAX_DEPTH) {
      errors.push(`Category ${category.path} is deeper than ${MAX_DEPTH} levels`)
    }
    const expectedParent = parentOf(category.path)
    if (category.parentPath !== expectedParent) {
      errors.push(`Category ${category.path} claims parent ${category.parentPath}`)
    }
    if (expectedParent !== null && !byPath.has(expectedParent)) {
      errors.push(`Category ${category.path} has no parent row ${expectedParent}`)
    }
    if (!Number.isInteger(category.sortOrder) || category.sortOrder < 0) {
      errors.push(`Category ${category.path} has an invalid sort order`)
    }
  }

  // Parents are strict path prefixes, so a cycle can only come from hand-edited
  // data. Check anyway: this is the file that authorizes a database write.
  for (const category of categories) {
    if (hasCycle(category, byPath)) errors.push(`Category ${category.path} is part of a parent cycle`)
  }

  for (const root of REQUIRED_ROOTS) {
    if (!byPath.has(root)) errors.push(`Required top-level category ${root} is missing`)
  }
  for (const root of OPTIONAL_ROOTS) {
    if (!byPath.has(root)) warnings.push(`Top-level category ${root} is missing`)
  }

  for (const [parentPath, siblings] of groupBySortGroup(categories)) {
    const orders = siblings.map((category) => category.sortOrder).sort((a, b) => a - b)
    const contiguous = orders.every((order, index) => order === index)
    if (!contiguous) errors.push(`Children of ${parentPath ?? 'the root'} are not ordered 0..n`)
  }

  const diff = previous ? diffCatalogues(previous, catalogue) : null
  if (diff) {
    const previousCount = previous.categories.length
    const ratio = categories.length / previousCount
    if (ratio > MAX_GROWTH_RATIO) {
      errors.push(`Catalogue grew from ${previousCount} to ${categories.length} categories`)
    }
    if (ratio < MAX_SHRINK_RATIO) {
      errors.push(`Catalogue shrank from ${previousCount} to ${categories.length} categories`)
    }
    if (diff.removed.length > 0) {
      warnings.push(`${diff.removed.length} categories disappeared and would be deactivated`)
    }
    if (diff.renamed.length > 0) warnings.push(`${diff.renamed.length} categories were renamed`)
  }

  return { ok: errors.length === 0, errors, warnings, diff }
}

/** What publishing this catalogue would change, for the run's artifact. */
export function diffCatalogues(previous, next) {
  const before = new Map((previous?.categories ?? []).map((category) => [category.path, category]))
  const after = new Map((next?.categories ?? []).map((category) => [category.path, category]))

  const added = []
  const renamed = []
  const reordered = []
  for (const [path, category] of after) {
    const old = before.get(path)
    if (!old) {
      added.push({ path, name: category.name })
      continue
    }
    if (old.name !== category.name) renamed.push({ path, from: old.name, to: category.name })
    if (old.sortOrder !== category.sortOrder) reordered.push({ path })
  }

  const removed = []
  for (const [path, category] of before) {
    if (!after.has(path)) removed.push({ path, name: category.name })
  }

  return { added, removed, renamed, reordered }
}

/** One-line summary for logs and the workflow summary. */
export function describeDiff(diff) {
  if (!diff) return 'no previous catalogue to compare against'
  return `${diff.added.length} added, ${diff.removed.length} removed, ` +
    `${diff.renamed.length} renamed, ${diff.reordered.length} reordered`
}

function hasCycle(category, byPath) {
  const seen = new Set([category.path])
  let current = category
  while (current?.parentPath != null) {
    if (seen.has(current.parentPath)) return true
    seen.add(current.parentPath)
    current = byPath.get(current.parentPath)
  }
  return false
}

function groupBySortGroup(categories) {
  const groups = new Map()
  for (const category of categories) {
    const key = category.parentPath ?? null
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(category)
  }
  return groups
}
