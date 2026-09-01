#!/usr/bin/env node
// Runs the app against the fake backend on an emulated phone and reports what
// it finds.
//
//   npm i --no-save playwright@1.62.1     # once; deliberately not a dependency
//   node scripts/harness/run.mjs          # every scenario
//   node scripts/harness/run.mjs keyboard appswitch
//   node scripts/harness/run.mjs --shots tmp/shots layout
//
// It starts the stub, builds the app pointed at it, serves that build, and
// tears everything down again. Nothing touches the real Supabase project.

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

import { PHONE, SCENARIOS } from './probe.mjs'

const args = process.argv.slice(2)
const shotsAt = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const wanted = args.filter((a) => a in SCENARIOS)
const scenarios = wanted.length ? wanted : Object.keys(SCENARIOS)
const PORT = 5199

const run = (command, argv, env) => spawn(command, argv, { stdio: 'pipe', env: { ...process.env, ...env } })
const waitFor = async (url, tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(url)).ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} never came up`)
}

// The stub runs in this process so it can be shut down reliably.
const { createBackend } = await import('./server.mjs')
const backend = await createBackend()
console.log(`stub Supabase on ${backend.url}`)

console.log('building the app against the stub...')
const build = run('npx', ['vite', 'build'], { VITE_SUPABASE_URL: backend.url, VITE_SUPABASE_PUBLISHABLE_KEY: 'harness-key' })
const buildFailed = await new Promise((resolve) => {
  let out = ''
  build.stdout.on('data', (d) => { out += d })
  build.stderr.on('data', (d) => { out += d })
  build.on('close', (code) => resolve(code === 0 ? null : out))
})
if (buildFailed) { console.error(buildFailed); process.exit(1) }

const preview = run('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'])
const base = `http://localhost:${PORT}/`
await waitFor(base)

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
let total = 0
try {
  if (shotsAt) await mkdir(shotsAt, { recursive: true })
  for (const name of scenarios) {
    const context = await browser.newContext(PHONE)
    const page = await context.newPage()
    const crashes = []
    page.on('pageerror', (error) => crashes.push(`uncaught: ${error.message}`))
    let findings
    try {
      findings = [...(await SCENARIOS[name](page, base)), ...crashes]
    } catch (error) {
      findings = [`the scenario itself failed: ${error.message}`]
    }
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png` }).catch(() => {})
    // `note:` findings are advisory and do not fail the run.
    const failures = findings.filter((f) => !/(^|: )note:/.test(f))
    total += failures.length
    console.log(`\n${failures.length ? '✗' : '✓'} ${name}`)
    for (const finding of findings) console.log(`    ${finding}`)
    await context.close()
  }
} finally {
  await browser.close()
  preview.kill('SIGKILL')
  backend.close()
}

console.log(`\n${total === 0 ? 'no regressions' : `${total} regression(s)`}`)
process.exit(total === 0 ? 0 : 1)
