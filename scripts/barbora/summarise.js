#!/usr/bin/env node
// Turns a crawl report into the workflow's job summary.
//
//   node scripts/barbora/summarise.js crawl/report.json >> "$GITHUB_STEP_SUMMARY"

import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path) {
  process.stderr.write('usage: summarise.js <report.json>\n')
  process.exit(2)
}

let report
try {
  report = JSON.parse(await readFile(path, 'utf8'))
} catch (error) {
  process.stdout.write(`## Barbora catalogue\n\nNo crawl report was produced (${error.message}).\n`)
  process.exit(0)
}

const diff = report.diff ?? { added: [], removed: [], renamed: [], reordered: [] }
const lines = [
  '## Barbora catalogue',
  '',
  `- ${report.ok ? 'Passed validation' : '**Failed validation** — nothing was published'}`,
  `- ${report.categoryCount} categories from ${report.roots?.length ?? 0} top-level pages`,
  `- ${diff.added.length} added, ${diff.removed.length} removed, ` +
    `${diff.renamed.length} renamed, ${diff.reordered.length} reordered`,
  ...(report.errors ?? []).map((error) => `- **error:** ${error}`),
  ...(report.warnings ?? []).map((warning) => `- warning: ${warning}`),
]

const named = (entries, heading) =>
  entries.length === 0 ? [] : ['', `### ${heading}`, '', ...entries.slice(0, 50).map((entry) =>
    `- \`${entry.path}\`${entry.from ? ` — "${entry.from}" → "${entry.to}"` : entry.name ? ` — ${entry.name}` : ''}`)]

lines.push(...named(diff.added, 'Added'), ...named(diff.removed, 'Removed'), ...named(diff.renamed, 'Renamed'))
process.stdout.write(`${lines.join('\n')}\n`)
