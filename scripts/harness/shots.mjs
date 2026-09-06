#!/usr/bin/env node
// Walks the app through every screen it has and photographs each one.
//
//   node scripts/harness/shots.mjs tmp/shots        # light
//   DARK=1 node scripts/harness/shots.mjs tmp/dark  # what the phone does at night
//
// `run.mjs --shots` takes one picture per scenario, wherever that scenario
// happened to leave the page. This takes the tour instead: both list tabs,
// the shopping list, and every dialog, in a fixed order and under both
// themes. It is for looking at a change to the design, which is a thing a
// finding cannot describe — and for having a "before" to hold the "after"
// against.
//
// It asserts nothing and always exits 0. If a step cannot find what it is
// looking for it says so, photographs where it got to as `99-failure.png`,
// and stops; the app having moved a button is the usual reason.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { PHONE, tap, signIn } from './probe.mjs'

const { chromium } = await import('playwright')
const OUT = process.argv[2] || 'tmp/shots'
const PORT = 5199
const run = (c, a, env) => spawn(c, a, { stdio: 'pipe', detached: true, env: { ...process.env, ...env } })
const stop = (child) => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
const waitFor = async (url, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(url)).ok) return true } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} never came up`)
}

const { createBackend } = await import('./server.mjs')
const backend = await createBackend()
process.env.HARNESS_STUB = backend.url
console.log('building...')
const build = run('npx', ['vite', 'build'], { VITE_SUPABASE_URL: backend.url, VITE_SUPABASE_PUBLISHABLE_KEY: 'harness-key' })
const failed = await new Promise((res) => { let o = ''; build.stdout.on('data', d => o += d); build.stderr.on('data', d => o += d); build.on('close', c => res(c === 0 ? null : o)) })
if (failed) { console.error(failed); process.exit(1) }
const preview = run('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'])
const base = `http://localhost:${PORT}/`
await waitFor(base)

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
await mkdir(OUT, { recursive: true })
const context = await browser.newContext({ ...PHONE, colorScheme: process.env.DARK ? 'dark' : 'light' })
const page = await context.newPage()
page.on('dialog', d => d.accept())
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name) }

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot('01-auth')
  await signIn(page, base)
  await shot('02-current')
  await tap(page, '.bottom-nav button', 'Receptai')
  await page.waitForTimeout(800)
  await shot('03-library')
  await tap(page, '.recipe-tile-summary')
  await page.waitForTimeout(600)
  await shot('04-library-expanded')
  await page.evaluate(() => window.scrollTo(0, 700))
  await page.waitForTimeout(400)
  await shot('05-library-scrolled')
  await tap(page, '.bottom-nav button', 'Krepšelis')
  await page.waitForTimeout(900)
  await shot('06-shop')
  await page.evaluate(() => window.scrollTo(0, 800))
  await page.waitForTimeout(400)
  await shot('07-shop-list')
  await tap(page, '.shop-item')
  await page.waitForTimeout(2500)
  await shot('08-products-modal')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await tap(page, '.section-heading .button.primary')
  await page.waitForTimeout(900)
  await shot('09-meal-picker')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await tap(page, '.bottom-nav button', 'Receptai')
  await page.waitForTimeout(700)
  await tap(page, '.toolbar .button.primary')
  await page.waitForTimeout(800)
  await shot('10-recipe-editor')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await tap(page, '.import-button')
  await page.waitForTimeout(800)
  await shot('11-import')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await tap(page, '.icon-button')
  await page.waitForTimeout(800)
  await shot('12-settings')
  await tap(page, '.settings-options button', 'ngredient')
  await page.waitForTimeout(900)
  await shot('13-ingredients')
  await tap(page, '.manager-row .text-button')
  await page.waitForTimeout(700)
  await shot('14-ingredient-form')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await tap(page, '.icon-button')
  await page.waitForTimeout(600)
  await tap(page, '.settings-options button', 'Pakviesti')
  await page.waitForTimeout(700)
  await shot('15-invite')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await tap(page, '.icon-button')
  await page.waitForTimeout(600)
  await tap(page, '.settings-options button', 'Ištrinti receptai')
  await page.waitForTimeout(700)
  await shot('16-deleted')
} catch (e) {
  console.error('drive failed:', e.message)
  await shot('99-failure')
} finally {
  await browser.close(); stop(preview); backend.close()
}
