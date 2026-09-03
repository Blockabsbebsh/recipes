#!/usr/bin/env node
// Runs the migrations against a throwaway Postgres and checks what the
// database does on its own — row security, the row caps, the invite-code
// rotation, and the rate limit on joining.
//
//   node scripts/dbtest/run.mjs            # every test
//   node scripts/dbtest/run.mjs rls caps
//
// It needs a local PostgreSQL 16 and `psql` on PATH; on Debian and Ubuntu that
// is `postgresql` and `postgresql-client`. Nothing here touches the real
// project: the cluster is created in the system temporary directory and deleted.
//
// The one thing it cannot do is run PostgREST, so it stands where PostgREST
// stands: `set local role authenticated` with the caller's id in
// `request.jwt.claim.sub`, which is exactly what a request arrives as.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname
const REPO = join(HERE, '../..')
const BIN = '/usr/lib/postgresql/16/bin'
const PORT = 54329

const args = process.argv.slice(2)
const files = readdirSync(join(HERE, 'tests')).filter((f) => f.endsWith('.sql')).sort()
const wanted = files.filter((f) => !args.length || args.includes(f.replace(/^\d+-|\.sql$/g, '')))

const root = mkdtempSync(join(tmpdir(), 'dbtest-'))
const sock = join(root, 'sock')
const sh = (command, options = {}) =>
  spawnSync('bash', ['-lc', command], { encoding: 'utf8', ...options })

const psql = (sql, { file = null, db = 'app' } = {}) =>
  spawnSync('psql', [
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', String(PORT), '-U', 'postgres', '-d', db,
    ...(file ? ['-f', file] : ['-c', sql]),
  ], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } })

const die = (what, result) => {
  console.error(`${what}\n${result.stderr || result.stdout}`)
  stop()
  process.exit(2)
}
const stop = () => {
  sh(`su postgres -c "${BIN}/pg_ctl -D ${root}/data stop -m immediate" 2>/dev/null`)
  rmSync(root, { recursive: true, force: true })
}

/**
 * Twenty accounts' worth of guesses arriving at once, from one account.
 *
 * Count-then-insert is not a rate limit under concurrency: every simultaneous
 * request reads the same count before any of them has written a row, so twenty
 * parallel calls all see zero attempts and all proceed. The limit held only
 * against a caller polite enough to wait for each answer, which is not the
 * caller it exists for.
 *
 * A run of separate processes started together is not simultaneous enough on
 * its own — process startup jitter is longer than the race window — so every
 * client sleeps until the same instant inside the database first, and only
 * then opens the transaction that takes the lock.
 */
const runTogether = async (statements) => {
  const startAt = new Date(Date.now() + 2500).toISOString()
  const runs = statements.map((statement) => new Promise((resolve) => {
    const child = spawn('psql', [
      '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', String(PORT), '-U', 'postgres', '-d', 'app',
      '-c', `select pg_sleep_until('${startAt}'::timestamptz)`,
      '-c', statement,
    ], { encoding: 'utf8' })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => resolve({ code, err }))
  }))
  return Promise.all(runs)
}

const cleanFixtures = () => psql(`
  delete from public.recipe_tags;
  delete from public.recipe_ingredients;
  delete from public.roster_entries;
  delete from public.shopping_queue;
  delete from public.ingredients;
  delete from public.tags;
  delete from public.recipes;
  delete from public.household_members;
  delete from public.households;
  delete from auth.users;
`)

async function joinConcurrency() {
  const DANA = '00000000-0000-4000-8000-00000000a004'
  const ATTEMPTS = 20
  const problems = []

  const step = psql(`select t.seed(); delete from private.join_attempts;`)
  if (step.status !== 0) return [`the fixture would not commit: ${step.stderr.trim()}`]

  const results = await runTogether(Array.from(
    { length: ATTEMPTS },
    () => `begin; select set_config('request.jwt.claim.sub', '${DANA}', true); set local role authenticated; select public.join_household('FFFFFFFFFFFF'); commit;`,
  ))

  const answered = results.filter((r) => r.code === 0).length
  const throttled = results.filter((r) => /Per daug bandym/.test(r.err)).length
  const other = results.filter((r) => r.code !== 0 && !/Per daug bandym/.test(r.err))
  const recorded = Number(psql('select count(*) from private.join_attempts').stdout.match(/\d+/)?.[0] ?? -1)

  if (other.length) problems.push(`${other.length} of ${ATTEMPTS} failed for some other reason: ${other[0].err.trim().split('\n')[0]}`)
  if (answered !== 5) problems.push(`${answered} of ${ATTEMPTS} simultaneous guesses were answered, not 5`)
  if (throttled !== ATTEMPTS - 5) problems.push(`${throttled} of ${ATTEMPTS} were turned away, not ${ATTEMPTS - 5}`)
  if (recorded !== 5) problems.push(`${recorded} attempts were recorded, not 5`)

  psql('delete from private.join_attempts;')
  cleanFixtures()
  return problems
}

async function householdCapConcurrency() {
  const KITCHEN = '00000000-0000-4000-8000-00000000b001'
  const ATTEMPTS = 8
  const problems = []

  const step = psql(`
    select t.seed();
    insert into auth.users (id, email)
      select ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, 'cap-' || g || '@example.com'
      from generate_series(1, 55) g;
    insert into public.household_members (household_id, user_id)
      select '${KITCHEN}', ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid
      from generate_series(1, 47) g;
  `)
  if (step.status !== 0) {
    cleanFixtures()
    return [`the household-cap fixture would not commit: ${step.stderr.trim()}`]
  }

  const results = await runTogether(Array.from({ length: ATTEMPTS }, (_, i) => {
    const user = `00000000-0000-4000-9000-${String(i + 48).padStart(12, '0')}`
    return `begin; insert into public.household_members (household_id, user_id) values ('${KITCHEN}', '${user}'); commit;`
  }))
  const inserted = results.filter((r) => r.code === 0).length
  const capped = results.filter((r) => /pasiekė ribą/.test(r.err)).length
  const other = results.filter((r) => r.code !== 0 && !/pasiekė ribą/.test(r.err))
  const total = Number(psql(`select count(*) from public.household_members where household_id = '${KITCHEN}'`).stdout.match(/\d+/)?.[0] ?? -1)

  if (other.length) problems.push(`${other.length} of ${ATTEMPTS} failed for some other reason: ${other[0].err.trim().split('\n')[0]}`)
  if (inserted !== 1) problems.push(`${inserted} of ${ATTEMPTS} simultaneous members were inserted, not 1`)
  if (capped !== ATTEMPTS - 1) problems.push(`${capped} of ${ATTEMPTS} were capped, not ${ATTEMPTS - 1}`)
  if (total !== 50) problems.push(`the household finished with ${total} members, not 50`)

  cleanFixtures()
  return problems
}

async function recipeIngredientCapConcurrency() {
  const RECIPE = '00000000-0000-4000-8000-00000000c001'
  const KITCHEN = '00000000-0000-4000-8000-00000000b001'
  const ATTEMPTS = 8
  const problems = []

  const step = psql(`
    select t.seed();
    insert into public.recipe_ingredients (household_id, recipe_id, item, position)
      select '${KITCHEN}', '${RECIPE}', 'concurrency ingredient ' || g, g
      from generate_series(1, 499) g;
  `)
  if (step.status !== 0) {
    cleanFixtures()
    return [`the recipe-ingredient fixture would not commit: ${step.stderr.trim()}`]
  }

  const results = await runTogether(Array.from(
    { length: ATTEMPTS },
    (_, i) => `begin; insert into public.recipe_ingredients (household_id, recipe_id, item, position) values ('${KITCHEN}', '${RECIPE}', 'simultaneous ingredient ${i + 1}', ${500 + i}); commit;`,
  ))
  const inserted = results.filter((r) => r.code === 0).length
  const capped = results.filter((r) => /500 ingredientų/.test(r.err)).length
  const other = results.filter((r) => r.code !== 0 && !/500 ingredientų/.test(r.err))
  const total = Number(psql(`select count(*) from public.recipe_ingredients where recipe_id = '${RECIPE}'`).stdout.match(/\d+/)?.[0] ?? -1)

  if (other.length) problems.push(`${other.length} of ${ATTEMPTS} failed for some other reason: ${other[0].err.trim().split('\n')[0]}`)
  if (inserted !== 1) problems.push(`${inserted} of ${ATTEMPTS} simultaneous ingredients were inserted, not 1`)
  if (capped !== ATTEMPTS - 1) problems.push(`${capped} of ${ATTEMPTS} were capped, not ${ATTEMPTS - 1}`)
  if (total !== 500) problems.push(`the recipe finished with ${total} ingredients, not 500`)

  cleanFixtures()
  return problems
}

// Postgres refuses to run as root, and this container is root.
sh(`mkdir -p ${root}/data ${sock} && chown -R postgres:postgres ${root}`)
let out = sh(`su postgres -c "${BIN}/initdb -D ${root}/data -U postgres --auth=trust -E UTF8 --locale=C"`)
if (out.status !== 0) die('initdb failed', out)
out = sh(`su postgres -c "${BIN}/pg_ctl -D ${root}/data -l ${root}/pg.log -w -o '-k ${sock} -p ${PORT} -c listen_addresses=\\"\\"' start"`)
if (out.status !== 0) die('postgres would not start', out)

try {
  let step = psql('create database app', { db: 'postgres' })
  if (step.status !== 0) die('could not create the database', step)

  step = psql(null, { file: join(HERE, 'shim.sql') })
  if (step.status !== 0) die('the Supabase shim failed to apply', step)

  // The migrations, in the order Supabase applied them. pg_cron is not
  // installable here, so that one statement is dropped and the `cron` schema in
  // the shim records the schedule instead; nothing else is altered.
  const migrations = readdirSync(join(REPO, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
  for (const name of migrations) {
    const path = join(REPO, 'supabase/migrations', name)
    const sql = sh(`cat ${JSON.stringify(path)}`).stdout.replace(/create extension if not exists pg_cron;/g, '')
    const patched = join(root, name)
    writeFileSync(patched, sql)
    step = psql(null, { file: patched })
    if (step.status !== 0) die(`migration ${name} failed`, step)
  }

  step = psql(null, { file: join(HERE, 'helpers.sql') })
  if (step.status !== 0) die('the test helpers failed to apply', step)

  let failures = 0
  for (const name of wanted) {
    const result = psql(null, { file: join(HERE, 'tests', name) })
    const label = name.replace(/^\d+-|\.sql$/g, '')
    if (result.status === 0) {
      console.log(`✓ ${label}`)
    } else {
      failures += 1
      const said = (result.stderr || result.stdout).split('\n')
        .filter((line) => /ERROR|DETAIL|CONTEXT: *PL\/pgSQL function t\./.test(line))
        .slice(0, 4).join('\n    ')
      console.log(`✗ ${label}\n    ${said}`)
    }
  }
  if (!args.length || args.includes('concurrency')) {
    const checks = [
      ['concurrent join attempts', joinConcurrency],
      ['concurrent household cap', householdCapConcurrency],
      ['concurrent recipe-ingredient cap', recipeIngredientCapConcurrency],
    ]
    for (const [name, check] of checks) {
      const said = await check()
      if (said.length) {
        failures += 1
        console.log(`✗ ${name}\n    ${said.join('\n    ')}`)
      } else console.log(`✓ ${name}`)
    }
  }

  console.log(`\n${failures === 0 ? 'no failures' : `${failures} file(s) failed`}`)
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  stop()
}
