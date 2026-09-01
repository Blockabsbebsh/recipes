// A deliberately small robots.txt reader.
//
// The crawler reads eleven ordinary category pages, so this only needs to
// answer "may this user agent fetch this path". Rules are matched the way
// Google documents them: the longest matching Allow or Disallow wins, and an
// Allow of equal length beats a Disallow.

/**
 * @param {string} text contents of robots.txt
 * @returns {{groups: {agents: string[], rules: {allow: boolean, pattern: string}[]}[]}}
 */
export function parseRobots(text) {
  const groups = []
  let current = null
  let expectingAgents = false

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim()
    if (line === '') continue

    const separator = line.indexOf(':')
    if (separator === -1) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      if (!expectingAgents || current === null) {
        current = { agents: [], rules: [] }
        groups.push(current)
        expectingAgents = true
      }
      current.agents.push(value.toLowerCase())
      continue
    }

    if (field !== 'allow' && field !== 'disallow') continue
    if (current === null) continue
    expectingAgents = false
    // "Disallow:" with an empty value allows everything; it carries no pattern.
    if (field === 'disallow' && value === '') continue
    current.rules.push({ allow: field === 'allow', pattern: value })
  }

  return { groups }
}

/**
 * @param {{groups: object[]}} robots parsed robots.txt
 * @param {string} path path to fetch, e.g. `/bakaleja`
 * @param {string} [userAgent] token to match, e.g. `barbora-category-crawler`
 * @returns {boolean}
 */
export function isAllowed(robots, path, userAgent = '*') {
  const group = selectGroup(robots, userAgent.toLowerCase())
  if (!group) return true

  let best = null
  for (const rule of group.rules) {
    if (!matchesPattern(rule.pattern, path)) continue
    if (
      best === null ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule
    }
  }

  return best === null ? true : best.allow
}

function selectGroup(robots, userAgent) {
  const groups = robots?.groups ?? []
  // Prefer the most specific matching token, then fall back to the `*` group.
  let specific = null
  let wildcard = null
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*') wildcard ??= group
      else if (userAgent.includes(agent) && (specific === null || agent.length > specific.length)) {
        specific = { group, length: agent.length }
      }
    }
  }
  return specific?.group ?? wildcard ?? null
}

function matchesPattern(pattern, path) {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body.split('*').map(escapeRegExp).join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
