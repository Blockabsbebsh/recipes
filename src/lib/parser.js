export function cleanIngredient(value) {
  return value.trim().replace(/[.;]+$/, '').replace(/\s+/g, ' ')
}

export function parseRecipeList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cleaned = line
        .replace(/^\[\s*[xXvV✓✔]?\s*\]\s*/, '')
        .replace(/^\d+[.)]\s*/, '')
        .trim()
      const divider = cleaned.search(/\s+[—–-]\s+/)
      const title = (divider >= 0 ? cleaned.slice(0, divider) : cleaned).trim()
      const ingredientText = divider >= 0 ? cleaned.slice(divider).replace(/^\s*[—–-]\s*/, '') : ''
      const ingredients = ingredientText
        .split(/[,;]\s*/)
        .map(cleanIngredient)
        .filter(Boolean)
      return { title, ingredients, notes: '', sourceUrl: '' }
    })
    .filter((recipe) => recipe.title)
}

export function normalizeTitle(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigrams(value) {
  const normalized = ` ${normalizeTitle(value)} `
  const result = []
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.push(normalized.slice(index, index + 2))
  }
  return result
}

export function titleSimilarity(left, right) {
  const a = normalizeTitle(left)
  const b = normalizeTitle(right)
  if (!a || !b) return 0
  if (a === b) return 1
  const leftBigrams = bigrams(a)
  const rightBigrams = bigrams(b)
  const remaining = [...rightBigrams]
  let overlap = 0
  leftBigrams.forEach((pair) => {
    const match = remaining.indexOf(pair)
    if (match >= 0) {
      overlap += 1
      remaining.splice(match, 1)
    }
  })
  return (2 * overlap) / (leftBigrams.length + rightBigrams.length)
}
