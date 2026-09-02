import { DISH_TYPES } from './categories.js'

export function cleanIngredient(value) {
  return value.trim().replace(/[.;]+$/, '').replace(/\s+/g, ' ')
}

/**
 * The units a Lithuanian recipe measures in, plus the metric ones. Written out
 * because `300 g` and `3 skiltelės` have to come off an ingredient name for
 * `česnakas` to mean the same thing twice.
 */
const UNITS = [
  'vnt', 'vienetas', 'vienetai', 'vienetų', 'g', 'gr', 'kg', 'ml', 'l',
  'šaukštas', 'šaukštai', 'šaukšto', 'šaukštų', 'šaukštelis', 'šaukšteliai', 'šaukštelio',
  'stiklinė', 'stiklinės', 'puodelis', 'puodeliai', 'puodelio',
  'sauja', 'saujelė', 'saujos', 'skiltelė', 'skiltelės', 'skiltelių',
  'žiupsnelis', 'žiupsnis', 'pakelis', 'pakelio', 'pakeliai',
  'skardinė', 'skardinės', 'skardinėlė', 'lapas', 'lapai', 'lapelis',
].join('|')
const AMOUNT = '(?:½|¼|¾|⅓|⅔|\\d+(?:[.,]\\d+)?)'

/**
 * Recipe imports carry shopping quantities even though the app tracks
 * ingredients rather than amounts. Removing them lets `pomidorai`,
 * `pomidorai 2x` and `2x pomidorai` resolve to one vocabulary entry instead of
 * three shopping-list rows.
 *
 * Both ends, because a real list writes them at both: `lęšiai 150g` and
 * `2x tofu` sit in the same paste. `pusė` is here too — `pusė morkos` is still
 * a carrot, and `grybai pusė pakelio` is still mushrooms.
 */
const LEADING_QUANTITY = new RegExp(
  `^\\s*(?:(?:apie\\s+|~\\s*)?${AMOUNT}(?:\\s*[-–—/]\\s*${AMOUNT})?\\s*(?:x\\b)?\\s*(?:(?:${UNITS})\\.?\\s+)?` +
  `|(?:pusė|pusės|puse)\\s+(?:(?:${UNITS})\\.?\\s+)?)`,
  'iu',
)
const TRAILING_QUANTITY = new RegExp(
  `\\s*[([]?\\s*(?:(?:pusė|puse)\\s+(?:${UNITS})\\.?` +
  `|(?:x\\s*)?${AMOUNT}\\s*(?:x\\b)?\\s*(?:(?:${UNITS})\\.?)?)\\s*[)\\]]?\\s*$`,
  'iu',
)

export function ingredientNameWithoutQuantity(value) {
  const cleaned = cleanIngredient(value)
  const trimmed = cleaned.replace(TRAILING_QUANTITY, '').replace(LEADING_QUANTITY, '').trim()
  return trimmed || cleaned
}

/**
 * Lithuanian nouns decline, and a recipe list uses whichever case the sentence
 * wanted: `morka` and `morkos`, `svogūnas` and `svogūnai`, `mielės` and
 * `mielių`. Those are one thing to buy, and were three rows on the shopping
 * list because the lookup key was an exact string match.
 *
 * Only the ending comes off, and only when what is left is still a real stem —
 * four characters, so `tofu` and `miso` survive whole. Adjectives are left
 * alone deliberately: `raudoni lęšiai` and `žali lęšiai` are different bags,
 * and a stemmer cannot tell which qualifiers matter.
 *
 * This runs on the already-normalised form, so the endings are spelled without
 * their diacritics.
 */
const ENDINGS = [
  'iuose', 'iomis', 'uose', 'iams', 'iais', 'emis', 'omis', 'imis',
  'ams', 'ais', 'ose', 'yje', 'ies', 'aus', 'iai', 'ius',
  'as', 'is', 'ys', 'us', 'os', 'es', 'ai', 'ei', 'ui', 'io', 'iu',
  'a', 'o', 'e', 'u', 'i', 'y', 's',
]
const MIN_STEM = 4

function stemWord(word) {
  if (word.length <= MIN_STEM) return word
  for (const ending of ENDINGS) {
    if (word.length - ending.length >= MIN_STEM && word.endsWith(ending)) {
      return word.slice(0, -ending.length)
    }
  }
  return word
}

export function ingredientStem(value) {
  return normalizeTitle(value).split(' ').filter(Boolean).map(stemWord).join(' ')
}

export function ingredientLookupKey(value) {
  return ingredientStem(ingredientNameWithoutQuantity(value))
}

/**
 * Things written where an ingredient goes that are not one.
 *
 * A list written for a person carries `kažkas aštraus` and `picos
 * ingredientai` — a note to self, not something to buy. They cannot be
 * resolved and should not quietly become vocabulary entries, so the importer
 * marks them and leaves the decision to whoever pasted the list.
 */
const PLACEHOLDER = /^(?:kažk(?:as|o)|bet\s+kok\w+|kiti|kitos)\b|\bingredientai$|\bpagal\s+skonį$/iu

export function looksLikePlaceholder(value) {
  return PLACEHOLDER.test(cleanIngredient(value))
}

// A dash or a colon separates the dish from its ingredients. The colon needs
// trailing whitespace so that a pasted URL is never mistaken for a divider.
const DIVIDER = /\s+[—–-]\s+|\s*:\s+/

// What a pasted list marks its items with. A dash counts only when a space
// follows, so a hyphenated word is never mistaken for a bullet.
const BULLET = /^[\s ]*(?:[•·▪◦‣∙*]|[-–—](?=\s))[\s ]*/
const NUMBERING = /^\d+[.)]\s*/
const CHECKBOX = /^\[\s*[xXvV✓✔]?\s*\]\s*/

// A link written without a scheme still has a dot and a slash in it, which is
// what tells `cookieandkate.com/vegetable-paella` from `kalafijoras/brokolis`.
const URL_LIKE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]{2,})+\/\S*/i

/**
 * The bracket groups in a line, outermost only and balanced.
 *
 * `raudonas vynas (sausas pinot noir, merlot, burgundy)` inside an ingredient
 * list used to end the list early, leaving `merlot` and `burgundy` as
 * ingredients of their own and a stray `)` as the recipe's note.
 */
function bracketGroups(line) {
  const groups = []
  let depth = 0
  let start = -1
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '(' || character === '[') {
      if (depth === 0) start = index
      depth += 1
    } else if (character === ')' || character === ']') {
      depth -= 1
      if (depth === 0) groups.push({ start, end: index, inner: line.slice(start + 1, index) })
      if (depth < 0) depth = 0
    }
  }
  // An unclosed bracket is a list someone forgot to finish, not a reason to
  // throw the ingredients away.
  if (depth > 0 && start >= 0) groups.push({ start, end: line.length, inner: line.slice(start + 1) })
  return groups
}

/** Split on commas that are not inside brackets. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of text) {
    if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && (character === ',' || character === ';')) {
      parts.push(current)
      current = ''
    } else current += character
  }
  parts.push(current)
  return parts
}

function splitRecipeLine(cleaned) {
  const divider = cleaned.search(DIVIDER)
  if (divider >= 0) {
    return {
      title: cleaned.slice(0, divider).trim(),
      ingredientText: cleaned.slice(divider).replace(/^\s*(?:[—–-]|:)\s*/, ''),
      notes: '',
    }
  }
  // A comma inside the brackets is what marks a list, so `Sriuba (šalta)` and
  // `Spagečiai (Aglio e Oleo)` keep their qualifier in the title. The last such
  // group wins, so `Bolivinių balandų (quinoa) troškinys (balanda, morkos)`
  // keeps the quinoa where it was written.
  const list = bracketGroups(cleaned).filter((group) => /[,;]/.test(group.inner)).pop()
  if (list) {
    return {
      title: cleaned.slice(0, list.start).trim(),
      ingredientText: list.inner,
      notes: cleaned.slice(list.end + 1).trim(),
    }
  }
  return { title: cleaned, ingredientText: '', notes: '' }
}

/**
 * A section heading carries the same answer the classifier has to guess at, so
 * `SRIUBOS` above nine recipes is nine classifications nobody had to make.
 * Headings this does not recognise still end the previous section rather than
 * carrying a wrong type down the page.
 */
const SECTION_DISH_TYPES = new Map(Object.entries({
  troskiniai: 'Troškiniai ir kariai', kariai: 'Troškiniai ir kariai',
  sriubos: 'Sriubos', makaronai: 'Makaronai', salotos: 'Salotos',
  pusrytiniai: 'Pusryčiai', pusryciai: 'Pusryčiai',
  bulviniai: 'Bulvių patiekalai', bulves: 'Bulvių patiekalai',
  ryziai: 'Ryžių ir kruopų patiekalai', grikiai: 'Ryžių ir kruopų patiekalai',
  kukuruzai: 'Ryžių ir kruopų patiekalai', kruopos: 'Ryžių ir kruopų patiekalai',
  sumustiniai: 'Sumuštiniai ir kebabai', kebabai: 'Sumuštiniai ir kebabai',
  uzkandziai: 'Užkandžiai', desertai: 'Desertai',
  picos: 'Kepiniai ir picos', kepiniai: 'Kepiniai ir picos',
}))

function sectionDishType(line) {
  const key = normalizeTitle(line)
  return SECTION_DISH_TYPES.get(key) ?? DISH_TYPES.find((type) => normalizeTitle(type) === key)
}

export function parseRecipeList(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const marked = (line) => BULLET.test(line) || CHECKBOX.test(line) || NUMBERING.test(line)
  // Two independent reasons to read an unmarked line as a heading, so neither
  // has to carry the weight alone: it names a dish type, or the paste marks
  // its items and this line is not one of them. The second needs the marked
  // lines to outnumber the unmarked ones it cannot already explain, so that one
  // stray dash in an otherwise plain list cannot turn every other line into a
  // heading and throw the whole paste away.
  const bulleted = lines.filter((line) => BULLET.test(line)).length
  const unexplained = lines.filter((line) => !marked(line) && !sectionDishType(line)).length
  const sectioned = bulleted > 0 && bulleted > unexplained

  const recipes = []
  let dishType
  for (const line of lines) {
    if (!marked(line) && (sectioned || sectionDishType(line))) {
      dishType = sectionDishType(line)
      continue
    }
    const cleaned = line.replace(BULLET, '').replace(CHECKBOX, '').replace(NUMBERING, '').trim()
    if (!cleaned) continue
    const { title, ingredientText, notes } = splitRecipeLine(cleaned)
    const ingredients = splitTopLevel(ingredientText).map(cleanIngredient).filter(Boolean)
    // A link written inside brackets keeps the closing one, and trailing
    // punctuation is never part of an address.
    const link = (notes.match(URL_LIKE)?.[0] ?? '').replace(/[)\]}>.,;]+$/, '')
    recipes.push({
      title,
      ingredients,
      notes: (link ? notes.replace(link, '') : notes).replace(/^[\s()[\]]+|[\s()[\]]+$/g, '').trim(),
      sourceUrl: link ? (/^https?:\/\//i.test(link) ? link : `https://${link}`) : '',
      ...(dishType ? { dishType } : {}),
    })
  }
  return recipes.filter((recipe) => recipe.title)
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
