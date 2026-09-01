#!/usr/bin/env node
// Category-only Barbora crawler.
//
// Each Barbora top-level page renders its entire child and grandchild tree, so
// the whole catalogue is eleven page loads rather than hundreds. Nothing here
// touches products, prices, stock, or pagination.
//
//   npm i --no-save playwright@1.62.1 && npx playwright install chromium
//   node scripts/barbora/crawl.js --out data/barbora-categories.json \
//     --previous data/barbora-categories.json
//
// If Barbora answers with a consent wall or a 403, borrow a real browser and
// keep its profile, answering the cookie banner once by hand:
//
//   node scripts/barbora/crawl.js --pause --channel chrome \
//     --profile tmp/barbora-profile --delay 5000
//
// The run fails, and writes no output, unless the result passes validation.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { findChallengeMarker } from './challenge.js'
import { BARBORA_ORIGIN, hostsFor, normalizeCategoryPath, pathDepth } from './paths.js'
import { isAllowed, parseRobots } from './robots.js'
import { buildCatalogue, collectLinks, serializeCatalogue } from './tree.js'
import { REQUIRED_ROOTS, describeDiff, validateCatalogue } from './validate.js'

// This really is a current Chromium, and announcing anything else gets the
// request answered by a Cloudflare interstitial rather than a category page.
// Politeness is kept where it counts instead: robots.txt is obeyed, the crawl
// is 11 sequential page loads with a delay, and no product data is read.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36'

/**
 * Barbora's category tree block, most specific first. The crawler falls back to
 * the whole document if none matches, because parentage comes from the URL and
 * not from the nesting; the container only keeps the display order clean.
 */
const TREE_SELECTORS = [
  '.category-page-tree',
  '[class*="category-page-tree"]',
  '[data-testid*="category-tree"]',
  'nav[class*="categor"]',
  'main',
]

/** Hold the crawl open until the operator has dealt with the browser window. */
function waitForEnter(message) {
  log(message)
  return new Promise((resolve) => {
    process.stdin.resume()
    process.stdin.once('data', () => {
      process.stdin.pause()
      resolve()
    })
  })
}

/** Record a warning and say it out loud: a failed run still owes its reasons. */
function warn(warnings, message) {
  warnings.push(message)
  log(`warning: ${message}`)
}

async function main(options, warnings) {
  const previous = await readJson(options.previous)

  const { chromium } = await importPlaywright()

  // Runners that ship their own Chromium (and Playwright installs on a
  // different build number) are handled by pointing at the binary directly.
  // `--channel chrome` uses the browser already on the machine instead, which
  // a shop's bot protection treats far more kindly.
  const launch = {
    headless: !options.headed,
    channel: options.channel ?? undefined,
    executablePath: options.channel ? undefined : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  }
  const contextOptions = {
    userAgent: options.channel ? undefined : USER_AGENT,
    locale: 'lt-LT',
    viewport: { width: 1366, height: 900 },
  }

  // A persistent profile keeps the cookie banner answered between runs, so the
  // second crawl sees the catalogue rather than the consent wall.
  const browser = options.profile
    ? null
    : await chromium.launch(launch)
  const context = browser
    ? await browser.newContext(contextOptions)
    : await chromium.launchPersistentContext(options.profile, { ...launch, ...contextOptions })

  try {
    const robots = await readRobots(context, options.origin, warnings)

    const page = await context.newPage()
    page.setDefaultTimeout(options.timeout)

    // With --profile, answering the cookie banner once is what makes every
    // later run see the shop instead of the consent wall.
    if (options.pause) {
      await page.goto(options.origin, { waitUntil: 'domcontentloaded' })
      await waitForEnter('Answer any cookie banner in the browser window, then press Enter here.')
    }

    const roots = options.roots ?? (await discoverRoots(page, options, warnings))
    log(`Crawling ${roots.length} top-level categories`)

    const pages = []
    for (const root of roots) {
      if (robots && !isAllowed(robots, root, USER_AGENT.toLowerCase())) {
        warn(warnings, `robots.txt disallows ${root}; it was not crawled`)
        continue
      }

      const links = await crawlRoot(page, root, options, warnings)
      if (links.length <= 1) {
        warn(warnings, `${root} exposed no child categories and was skipped`)
        continue
      }
      log(`  ${root} → ${links.length} categories`)
      pages.push({ root, links })
      await sleep(options.delay)
    }

    const { categories, problems } = buildCatalogue(pages)
    warnings.push(...problems)

    const catalogue = serializeCatalogue(categories)
    const result = validateCatalogue(catalogue, { previous })

    for (const warning of result.warnings) log(`warning: ${warning}`)

    await writeReport(options, { catalogue, result, warnings, roots })

    if (!result.ok) {
      for (const error of result.errors) log(`error: ${error}`)
      throw new Error(
        `Validation failed with ${result.errors.length} error(s); the published catalogue is unchanged`,
      )
    }

    await writeJson(options.out, catalogue)
    log(`Wrote ${catalogue.categoryCount} categories to ${options.out}`)
    log(`Diff against the previous catalogue: ${describeDiff(result.diff)}`)
  } finally {
    await context.close()
    await browser?.close()
  }
}

/** Read one category page and return its ordered categories. */
async function crawlRoot(page, root, options, warnings) {
  const url = `${options.origin}${root}`

  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
      const status = response?.status() ?? 0
      if (status >= 400) throw new Error(`${url} returned HTTP ${status}`)

      await assertNotChallenged(page, url)
      if (options.dumpHtml) await dumpHtml(options.dumpHtml, root, page)

      const { selector, anchors } = await extractAnchors(page)
      if (selector === null) {
        warn(warnings, `No category tree container matched on ${root}; read the whole document`)
      }
      return collectLinks(anchors, { root, base: url, hosts: hostsFor(options.origin) })
    } catch (error) {
      if (attempt > options.retries) throw error
      warn(warnings, `Retrying ${root} after: ${error.message}`)
      await sleep(options.delay * attempt * 2)
    }
  }

  return []
}

/**
 * Read the top-level categories from Barbora's navigation, then add the roots
 * the shopping links depend on so a navigation markup change cannot silently
 * shrink the catalogue.
 */
async function discoverRoots(page, options, warnings) {
  const response = await page.goto(options.origin, { waitUntil: 'domcontentloaded' })
  const status = response?.status() ?? 0
  if (status >= 400) throw new Error(`${options.origin} returned HTTP ${status}`)
  await assertNotChallenged(page, options.origin)
  if (options.dumpHtml) await dumpHtml(options.dumpHtml, '/index', page)

  const { anchors } = await extractAnchors(page)
  const discovered = []
  for (const anchor of anchors) {
    const path = normalizeCategoryPath(anchor.href, options.origin, hostsFor(options.origin))
    if (path === null || pathDepth(path) !== 1) continue
    if (!discovered.includes(path)) discovered.push(path)
  }

  const missing = REQUIRED_ROOTS.filter((root) => !discovered.includes(root))
  if (missing.length > 0) {
    warn(warnings, `Navigation did not list ${missing.join(', ')}; crawling them anyway`)
  }

  return [...discovered, ...missing]
}

/** Collect anchors in document order from the tightest container that matches. */
function extractAnchors(page) {
  return page.evaluate((selectors) => {
    const read = (element) =>
      [...element.querySelectorAll('a[href]')].map((anchor) => ({
        href: anchor.href,
        text: anchor.textContent ?? '',
      }))

    for (const selector of selectors) {
      const container = document.querySelector(selector)
      if (!container) continue
      const anchors = read(container)
      if (anchors.length > 0) return { selector, anchors }
    }

    return { selector: null, anchors: read(document) }
  }, TREE_SELECTORS)
}

async function assertNotChallenged(page, url) {
  const [title, body] = await Promise.all([
    page.title(),
    page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? ''),
  ])
  const marker = findChallengeMarker(`${title}\n${body}`)
  if (marker) throw new Error(`${url} served a bot challenge ("${marker}")`)
}

/**
 * Read robots.txt once, and refuse to start if it disallows a category the
 * shopping links depend on. An unreachable robots.txt is not treated as a
 * block: the crawl is 11 ordinary page loads of public category pages.
 */
async function readRobots(context, origin, warnings) {
  let text
  try {
    const response = await context.request.get(`${origin}/robots.txt`)
    if (!response.ok()) {
      warn(warnings, `robots.txt returned HTTP ${response.status()}; continuing`)
      return null
    }
    text = await response.text()
  } catch (error) {
    warn(warnings, `Could not read robots.txt (${error.message}); continuing`)
    return null
  }

  const robots = parseRobots(text)
  const blocked = REQUIRED_ROOTS.filter((root) => !isAllowed(robots, root, USER_AGENT.toLowerCase()))
  if (blocked.length > 0) throw new Error(`robots.txt disallows ${blocked.join(', ')}`)
  return robots
}

async function dumpHtml(directory, root, page) {
  const name = `${root.replaceAll('/', '_') || 'root'}.html`
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, name), await page.content(), 'utf8')
}

async function writeReport(options, { catalogue, result, warnings, roots }) {
  if (!options.report) return
  await writeJson(options.report, {
    generatedAt: catalogue.generatedAt,
    roots,
    categoryCount: catalogue.categoryCount,
    ok: result.ok,
    errors: result.errors,
    warnings: [...warnings, ...result.warnings],
    diff: result.diff,
  })
}

/**
 * A crawl that never reached validation still owes the run an explanation:
 * a Cloudflare interstitial and a changed markup look identical in the log.
 */
async function writeFailureReport(options, error, warnings) {
  if (!options.report) return
  try {
    await writeJson(options.report, {
      generatedAt: new Date().toISOString(),
      roots: [],
      categoryCount: 0,
      ok: false,
      errors: [error.message],
      warnings,
      diff: null,
    })
  } catch {
    // The original failure is the one worth reporting.
  }
}

async function importPlaywright() {
  try {
    return await import('playwright')
  } catch {
    throw new Error(
      'Playwright is not installed. Run: npm i --no-save playwright@1.62.1 && ' +
        'npx playwright install chromium',
    )
  }
}

function parseArgs(argv) {
  const options = {
    origin: BARBORA_ORIGIN,
    channel: null,
    profile: null,
    pause: false,
    out: 'data/barbora-categories.json',
    previous: null,
    report: null,
    dumpHtml: null,
    roots: null,
    headed: false,
    delay: 2500,
    timeout: 45000,
    retries: 2,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`${flag} needs a value`)
      index += 1
      return next
    }

    switch (flag) {
      case '--origin': options.origin = value().replace(/\/$/, ''); break
      case '--out': options.out = value(); break
      case '--previous': options.previous = value(); break
      case '--report': options.report = value(); break
      case '--dump-html': options.dumpHtml = value(); break
      case '--roots': options.roots = value().split(',').map((root) => root.trim()).filter(Boolean); break
      case '--channel': options.channel = value(); break
      case '--profile': options.profile = value(); break
      case '--headed': options.headed = true; break
      case '--pause': options.pause = true; options.headed = true; break
      case '--delay': options.delay = Number(value()); break
      case '--timeout': options.timeout = Number(value()); break
      case '--retries': options.retries = Number(value()); break
      default: throw new Error(`Unknown option ${flag}`)
    }
  }

  return options
}

async function readJson(path) {
  if (!path) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(message) {
  process.stdout.write(`${message}\n`)
}

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(2)
}

const reportedWarnings = []

main(options, reportedWarnings).catch(async (error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  await writeFailureReport(options, error, reportedWarnings)
  process.exitCode = 1
})
