import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { findChallengeMarker } from './challenge.js'
import { categoryUrl, normalizeCategoryPath, parentOf, pathDepth } from './paths.js'
import { isAllowed, parseRobots } from './robots.js'
import { buildCatalogue, collectLinks, serializeCatalogue, sortCategories } from './tree.js'
import { MIN_CATEGORIES, diffCatalogues, validateCatalogue } from './validate.js'

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

const anchorFixture = JSON.parse(fixture('bakaleja-anchors.json'))
const snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/barbora-categories.json', import.meta.url)), 'utf8'),
)

test('normalizes category links to one canonical shape', () => {
  assert.equal(normalizeCategoryPath('/bakaleja/kruopos/'), '/bakaleja/kruopos')
  assert.equal(normalizeCategoryPath('https://barbora.lt/bakaleja'), '/bakaleja')
  assert.equal(normalizeCategoryPath('https://www.barbora.lt/BAKALEJA/Kruopos'), '/bakaleja/kruopos')
  assert.equal(normalizeCategoryPath('kruopos', 'https://barbora.lt/bakaleja/'), '/bakaleja/kruopos')
})

test('rejects everything that is not a plain category page', () => {
  assert.equal(normalizeCategoryPath('/produktai/lietuviski-pomidorai-1-kg'), null)
  assert.equal(normalizeCategoryPath('/paieska?q=druska'), null)
  assert.equal(normalizeCategoryPath('/bakaleja?page=2'), null)
  assert.equal(normalizeCategoryPath('/bakaleja#turinys'), null)
  assert.equal(normalizeCategoryPath('https://www.facebook.com/barbora.lt'), null)
  assert.equal(normalizeCategoryPath('javascript:void(0)'), null)
  assert.equal(normalizeCategoryPath('/a/b/c/d/e'), null)
  assert.equal(normalizeCategoryPath(''), null)
  assert.equal(normalizeCategoryPath(null), null)
})

test('derives depth and parent from the path itself', () => {
  assert.equal(pathDepth('/bakaleja'), 1)
  assert.equal(pathDepth('/bakaleja/makaronai/ilgi-makaronai'), 3)
  assert.equal(parentOf('/bakaleja'), null)
  assert.equal(parentOf('/bakaleja/makaronai/ilgi-makaronai'), '/bakaleja/makaronai')
  assert.equal(categoryUrl('/bakaleja/kruopos'), 'https://barbora.lt/bakaleja/kruopos')
})

test('collects a page in display order and drops everything foreign to it', () => {
  const links = collectLinks(anchorFixture.anchors, {
    root: anchorFixture.root,
    base: anchorFixture.base,
  })

  assert.deepEqual(links.map((link) => link.path), [
    '/bakaleja',
    '/bakaleja/konservuotas-maistas',
    '/bakaleja/konservuotas-maistas/konservuotos-darzoves',
    '/bakaleja/konservuotas-maistas/konservuotos-zuvys',
    '/bakaleja/makaronai',
    '/bakaleja/makaronai/ilgi-makaronai',
    '/bakaleja/makaronai/trumpi-makaronai',
    '/bakaleja/padazai-ir-konservuotos-uztepeles',
    '/bakaleja/padazai-ir-konservuotos-uztepeles/kecupai',
    '/bakaleja/padazai-ir-konservuotos-uztepeles/soju-terijakio-ir-vorcesterio-padazai',
  ])

  // A repeated anchor keeps its first position, names are collapsed, and a
  // category linked only by an empty anchor is left for another page.
  assert.equal(links.filter((link) => link.path === '/bakaleja/makaronai').length, 1)
  assert.equal(links[3].name, 'Konservuotos žuvys')
})

test('builds a tree that keeps parents and Barbora order', () => {
  const links = collectLinks(anchorFixture.anchors, {
    root: anchorFixture.root,
    base: anchorFixture.base,
  })
  const { categories, problems } = buildCatalogue([{ root: anchorFixture.root, links }])

  assert.deepEqual(problems, [])
  const makaronai = categories.find((category) => category.path === '/bakaleja/makaronai')
  assert.deepEqual(makaronai, {
    path: '/bakaleja/makaronai',
    name: 'Makaronai',
    sortOrder: 1,
    parentPath: '/bakaleja',
    depth: 2,
  })
  const kecupai = categories.find((category) => category.path.endsWith('/kecupai'))
  assert.equal(kecupai.parentPath, '/bakaleja/padazai-ir-konservuotos-uztepeles')
  assert.equal(kecupai.sortOrder, 0)
})

test('reports a child whose parent was never seen', () => {
  const { problems } = buildCatalogue([
    { root: '/bakaleja', links: [{ path: '/bakaleja/makaronai/ilgi-makaronai', name: 'Ilgi' }] },
  ])
  assert.match(problems.join('\n'), /no parent \/bakaleja\/makaronai/)
})

test('reports a category named differently on two pages', () => {
  const { problems } = buildCatalogue([
    { root: '/bakaleja', links: [{ path: '/bakaleja', name: 'Bakalėja' }] },
    { root: '/gerimai', links: [{ path: '/bakaleja', name: 'Bakaleja' }] },
  ])
  assert.match(problems.join('\n'), /named "Bakalėja".+and "Bakaleja"/)
})

test('serializes deterministically regardless of input order', () => {
  const forwards = serializeCatalogue(snapshot.categories, { generatedAt: 'x' })
  const backwards = serializeCatalogue([...snapshot.categories].reverse(), { generatedAt: 'x' })
  assert.deepEqual(forwards, backwards)
  assert.equal(forwards.categoryCount, snapshot.categories.length)
})

test('rebuilds the reviewed catalogue from the pages it came from', () => {
  // Every top-level page renders its whole subtree, so replaying the snapshot
  // as eleven depth-first page reads must reproduce the snapshot exactly.
  const children = new Map()
  for (const category of snapshot.categories) {
    const key = category.parentPath
    if (!children.has(key)) children.set(key, [])
    children.get(key).push(category)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder)

  const anchorsFor = (category) => {
    const anchors = [{ href: categoryUrl(category.path), text: category.name }]
    for (const child of children.get(category.path) ?? []) anchors.push(...anchorsFor(child))
    return anchors
  }

  const pages = (children.get(null) ?? []).map((root) => ({
    root: root.path,
    links: collectLinks(anchorsFor(root), { root: root.path }),
  }))

  const { categories, problems } = buildCatalogue(pages)
  assert.deepEqual(problems, [])
  assert.deepEqual(categories, sortCategories(snapshot.categories))
})

test('accepts the reviewed catalogue', () => {
  const result = validateCatalogue(snapshot, { previous: snapshot })
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
  assert.deepEqual(result.diff, { added: [], removed: [], renamed: [], reordered: [] })
})

test('refuses an incomplete crawl', () => {
  const truncated = { categories: snapshot.categories.slice(0, 40) }
  const result = validateCatalogue(truncated, { previous: snapshot })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), new RegExp(`reviewed minimum is ${MIN_CATEGORIES}`))
  assert.match(result.errors.join('\n'), /shrank from 636 to 40/)
})

test('refuses a catalogue missing a root the shopping links need', () => {
  const withoutPantry = {
    categories: snapshot.categories.filter((category) => !category.path.startsWith('/bakaleja')),
  }
  const result = validateCatalogue(withoutPantry)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /Required top-level category \/bakaleja is missing/)
})

test('refuses structurally impossible catalogues', () => {
  const orphan = snapshot.categories.filter((category) => category.path !== '/bakaleja/makaronai')
  assert.match(
    validateCatalogue({ categories: orphan }).errors.join('\n'),
    /has no parent row \/bakaleja\/makaronai/,
  )

  const cyclic = [
    { path: '/a', name: 'A', sortOrder: 0, parentPath: '/a/b', depth: 1 },
    { path: '/a/b', name: 'B', sortOrder: 0, parentPath: '/a', depth: 2 },
  ]
  const errors = validateCatalogue({ categories: cyclic }).errors.join('\n')
  assert.match(errors, /claims parent \/a\/b/)
})

test('describes what publishing would change', () => {
  const next = {
    categories: [
      { path: '/bakaleja', name: 'Bakalėja', sortOrder: 0, parentPath: null, depth: 1 },
      { path: '/bakaleja/kruopos', name: 'Kruopos ir dribsniai', sortOrder: 0, parentPath: '/bakaleja', depth: 2 },
      { path: '/bakaleja/druska', name: 'Druska', sortOrder: 1, parentPath: '/bakaleja', depth: 2 },
    ],
  }
  const previous = {
    categories: [
      { path: '/bakaleja', name: 'Bakalėja', sortOrder: 0, parentPath: null, depth: 1 },
      { path: '/bakaleja/kruopos', name: 'Kruopos', sortOrder: 0, parentPath: '/bakaleja', depth: 2 },
      { path: '/bakaleja/arbata', name: 'Arbata', sortOrder: 1, parentPath: '/bakaleja', depth: 2 },
    ],
  }

  assert.deepEqual(diffCatalogues(previous, next), {
    added: [{ path: '/bakaleja/druska', name: 'Druska' }],
    removed: [{ path: '/bakaleja/arbata', name: 'Arbata' }],
    renamed: [{ path: '/bakaleja/kruopos', from: 'Kruopos', to: 'Kruopos ir dribsniai' }],
    reordered: [],
  })
})

test('names the interstitial Barbora serves instead of a category', () => {
  assert.equal(findChallengeMarker('Just a moment...\nEnable JavaScript and cookies to continue'), 'just a moment')
  assert.equal(findChallengeMarker('Attention Required! | Cloudflare'), 'attention required')
  assert.equal(findChallengeMarker('Bakalėja | Barbora\nKonservuotas maistas'), null)
})

test('reads robots.txt the way the crawler has to obey it', () => {
  const robots = parseRobots(fixture('robots.txt'))

  assert.equal(isAllowed(robots, '/bakaleja', 'barbora-category-crawler'), true)
  assert.equal(isAllowed(robots, '/bakaleja/kruopos', 'barbora-category-crawler'), true)
  assert.equal(isAllowed(robots, '/paieska', 'barbora-category-crawler'), false)
  assert.equal(isAllowed(robots, '/krepselis', 'barbora-category-crawler'), false)
  assert.equal(isAllowed(robots, '/bakaleja', 'semrushbot'), false)
})

test('treats an unparsable or empty robots.txt as permission, not as a block', () => {
  assert.equal(isAllowed(parseRobots(''), '/bakaleja'), true)
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:'), '/bakaleja'), true)
  assert.equal(isAllowed(parseRobots('nonsense'), '/bakaleja'), true)
})
