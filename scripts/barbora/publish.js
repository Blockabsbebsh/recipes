#!/usr/bin/env node
// Publishes a validated catalogue snapshot to Supabase.
//
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
//     node scripts/barbora/publish.js crawl/barbora-categories.json
//
// The database does the work in one transaction through
// `public.publish_barbora_categories`, which re-checks the snapshot before
// touching anything. Execution of that function is granted only to the
// server-side role, so this script is the only way in and the key never
// belongs anywhere but a repository secret.

import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path) {
  process.stderr.write('usage: publish.js <catalogue.json>\n')
  process.exit(2)
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  process.stderr.write(
    'SUPABASE_URL and SUPABASE_SECRET_KEY are not set; nothing was published.\n',
  )
  process.exit(3)
}

const snapshot = JSON.parse(await readFile(path, 'utf8'))
if (!Array.isArray(snapshot.categories) || snapshot.categories.length === 0) {
  process.stderr.write(`${path} holds no categories\n`)
  process.exit(1)
}

const endpoint = `${url.replace(/\/$/, '')}/rest/v1/rpc/publish_barbora_categories`
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ snapshot }),
})

// The body can carry the failed statement, but never the request headers.
const body = await response.text()
if (!response.ok) {
  process.stderr.write(`Publication failed with HTTP ${response.status}: ${body}\n`)
  process.exit(1)
}

process.stdout.write(`Published ${snapshot.categories.length} categories.\n${body}\n`)
