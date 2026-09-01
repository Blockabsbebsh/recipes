export function cleanIngredient(value) {
  return value.trim().replace(/[.;]+$/, '').replace(/\s+/g, ' ')
}

/**
 * Recipe imports often carry shopping quantities even though the app tracks
 * ingredients rather than amounts. Removing a simple trailing quantity lets
 * `pomidorai`, `Pomidorai` and `pomidorai 2x` resolve to the same vocabulary
 * entry instead of creating three shopping-list rows.
 */
export function ingredientNameWithoutQuantity(value) {
  const cleaned = cleanIngredient(value)
  const withoutQuantity = cleaned.replace(
    /\s*[([]?\s*(?:x\s*)?\d+(?:[.,]\d+)?\s*(?:x|vnt|vnt\.|vienet(?:as|ai|ų)?|g|kg|ml|l)?\s*[)\]]?\s*$/iu,
    '',
  ).trim()
  return withoutQuantity || cleaned
}

export function ingredientLookupKey(value) {
  return normalizeTitle(ingredientNameWithoutQuantity(value))
}

// A dash or a colon separates the dish from its ingredients. The colon needs
// trailing whitespace so that a pasted URL is never mistaken for a divider.
const DIVIDER = /\s+[—–-]\s+|\s*:\s+/
// Some lines carry the ingredients in brackets instead, optionally followed by
// a loose remark. A comma inside the brackets is what marks it as a list, so a
// qualifier like "Sriuba (šalta)" stays part of the title.
const BRACKETED = /^([^(]+)\(([^)]*)\)\s*(.*)$/

function splitRecipeLine(cleaned) {
  const divider = cleaned.search(DIVIDER)
  if (divider >= 0) {
    return {
      title: cleaned.slice(0, divider).trim(),
      ingredientText: cleaned.slice(divider).replace(/^\s*(?:[—–-]|:)\s*/, ''),
      notes: '',
    }
  }
  const bracketed = cleaned.match(BRACKETED)
  if (bracketed && bracketed[2].includes(',')) {
    return { title: bracketed[1].trim(), ingredientText: bracketed[2], notes: bracketed[3].trim() }
  }
  return { title: cleaned, ingredientText: '', notes: '' }
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
      const { title, ingredientText, notes } = splitRecipeLine(cleaned)
      const ingredients = ingredientText
        .split(/[,;]\s*/)
        .map(cleanIngredient)
        .filter(Boolean)
      return { title, ingredients, notes, sourceUrl: '' }
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
