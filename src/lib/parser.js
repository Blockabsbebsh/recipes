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
  // How a written recipe abbreviates the spoonfuls, and the imperial units a
  // translated page brings with it.
  'a\\.\\s?š\\.?', 'v\\.\\s?š\\.?', 'š\\.\\s?š\\.?', 'šaukšt\\.?', 'tsp', 'tbsp', 'cup', 'cups', 'oz', 'lb',
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
 * Whether two written ingredients are the same thing to buy.
 *
 * The lookup key already covers declension, so what is left here is the
 * near-miss, and a near-miss on whole strings is how `avinžirnių miltai`
 * became `avinžirniai`: they share every letter of the longer word's stem and
 * score 0.7 on bigrams, but chickpea flour is not chickpeas. A qualifier is
 * never noise in a shopping vocabulary, so a match has to account for every
 * word on both sides — same number of them, each one close to its counterpart.
 * Anything else is left as it was written and becomes its own entry, which is
 * the mistake that costs a tap rather than the one that hides an ingredient.
 */
const WORD_MATCH = 0.82

export function matchesIngredient(left, right) {
  const leftWords = ingredientLookupKey(left).split(' ').filter(Boolean)
  const rightWords = ingredientLookupKey(right).split(' ').filter(Boolean)
  if (!leftWords.length || leftWords.length !== rightWords.length) return false
  const remaining = [...rightWords]
  return leftWords.every((word) => {
    const index = remaining.findIndex((other) => word === other || titleSimilarity(word, other) >= WORD_MATCH)
    if (index < 0) return false
    remaining.splice(index, 1)
    return true
  })
}

/**
 * The vocabulary entry an written ingredient means, or nothing.
 *
 * The exact key first, because that is a fact; then the word-for-word
 * near-match, best score first, because that is a guess worth showing.
 */
export function findVocabularyMatch(written, vocabulary) {
  const key = ingredientLookupKey(written)
  const exact = vocabulary.find((name) => ingredientLookupKey(name) === key)
  if (exact) return exact
  return vocabulary
    .filter((name) => matchesIngredient(written, name))
    .map((name) => ({ name, score: titleSimilarity(ingredientNameWithoutQuantity(written), name) }))
    .sort((a, b) => b.score - a.score)[0]?.name ?? null
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
const BULLET = /^[\s ]*(?:[•·▪◦‣∙*]|[-–—](?=\s))[\s ]*/
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

/**
 * What a recipe written over several lines announces about itself.
 *
 * One dish per line is what a shopping note looks like. Everything else — a
 * page copied out of a browser, a recipe typed into Keep over a week — writes
 * the title on one line and the ingredients under it, and the old parser read
 * every one of those ingredients as a dish of its own. These are the words
 * that say which part of a recipe comes next.
 */
const INGREDIENT_HEADING = new RegExp(
  '^(?:ingredientai|ingridientai|produktai|sudėtis|sudetis|reikės|reikes' +
  '|(?:ko|jums|tau)\\s+reik(?:ės|es)|ingredients|what\\s+you\\s+need|you\\s+will\\s+need)' +
  '\\b\\s*[:：—–-]?\\s*',
  'iu',
)
const STEP_HEADING = new RegExp(
  '^(?:gaminimas|gaminimo\\s+eiga|paruošimas|paruosimas|paruošimo\\s+eiga|ruošimas' +
  '|žingsniai|zingsniai|eiga|kaip\\s+gaminti|instructions|method|directions|steps|preparation)' +
  '\\b\\s*[:：—–-]?\\s*',
  'iu',
)
// A copied page brings its furniture with it. None of it is a dish, and every
// one of these used to become an empty recipe.
const METADATA = new RegExp(
  '^(?:porcij\\w*|porcijų\\s+skaičius|gaminimo\\s+laikas|paruošimo\\s+laikas|bendras\\s+laikas' +
  '|kalorij\\w*|sunkumas|servings|yield|prep\\s+time|cook\\s+time|total\\s+time|difficulty|nutrition)' +
  '\\b\\s*[:：—–-]?',
  'iu',
)

// A line that measures something is an ingredient, whatever else it looks
// like. A number is the only signal strong enough to be trusted on its own:
// `Kopūstų lapai` is a dish and `lapai` is in the unit list.
const AMOUNT_FIRST = new RegExp(`^(?:apie\\s+|~\\s*)?${AMOUNT}(?![\\d.,])`, 'u')
const AMOUNT_WITH_UNIT = new RegExp(`${AMOUNT}\\s*(?:${UNITS})\\.?(?![\\p{L}])`, 'iu')

const SOURCE_LABEL = /^(?:šaltinis|saltinis|nuoroda|receptas|source|link|recipe)\s*[:：—–-]\s*/iu

function describeLine(raw, vocabulary) {
  const line = raw.trim()
  const marked = BULLET.test(line) || CHECKBOX.test(line) || NUMBERING.test(line)
  const body = line.replace(BULLET, '').replace(CHECKBOX, '').replace(NUMBERING, '').trim()
  const ingredientHeading = INGREDIENT_HEADING.test(body)
  const stepHeading = !ingredientHeading && STEP_HEADING.test(body)
  const heading = ingredientHeading ? 'ingredients' : stepHeading ? 'steps' : null
  const rest = heading === 'ingredients'
    ? body.replace(INGREDIENT_HEADING, '').trim()
    : heading === 'steps' ? body.replace(STEP_HEADING, '').trim() : ''
  const parts = splitTopLevel(body).map(cleanIngredient).filter(Boolean)
  return {
    line,
    body,
    blank: !line,
    marked,
    heading,
    rest,
    metadata: !heading && METADATA.test(body),
    sectionType: marked ? undefined : sectionDishType(body),
    // Written as a whole recipe on one line: `Enchiladas — tortilijos, sūris`.
    inlineList: Boolean(!heading && splitRecipeLine(body).ingredientText),
    measured: Boolean(!heading && body) && (AMOUNT_FIRST.test(body) || AMOUNT_WITH_UNIT.test(body)),
    // Weaker, and only ever read as part of a run: everything on the line is
    // already something this household buys.
    known: Boolean(body) && vocabulary.size > 0 && parts.length > 0
      && parts.every((part) => vocabulary.has(ingredientLookupKey(part))),
    // `Šaltinis: https://…` is the same line as the bare address, and used to
    // be the last paragraph of the method.
    urlOnly: Boolean(body) && URL_LIKE.test(body)
      && body.replace(SOURCE_LABEL, '').replace(URL_LIKE, '').trim() === '',
  }
}

export function parseRecipeList(text, options = {}) {
  const vocabulary = new Set((options.vocabulary ?? []).map((name) => ingredientLookupKey(name)).filter(Boolean))
  const rows = text.split(/\r?\n/).map((line) => describeLine(line, vocabulary))

  const nextContent = (index) => {
    let cursor = index
    while (cursor < rows.length && rows[cursor].blank) cursor += 1
    return cursor < rows.length ? cursor : -1
  }
  // A line that could belong to the recipe above it rather than start one.
  const continuable = (row) => !row.blank && !row.heading && !row.metadata && row.sectionType === undefined

  /**
   * Where the run of ingredient lines starting here ends, or `start` if there
   * is none. Judged as a run rather than line by line: two measured lines in a
   * row are an ingredient list, and one line beginning with a digit is a dish
   * called `3 sūrių pica`.
   */
  const runEnd = (start) => {
    let end = start
    while (end < rows.length && continuable(rows[end]) && !rows[end].inlineList) end += 1
    const run = rows.slice(start, end)
    if (run.length < 2) return start
    const supported = run.filter((row) => row.measured || row.known).length
    if (run.every((row) => row.measured)) return end
    return supported * 5 >= run.length * 3 ? end : start
  }

  // A plain line with an ingredient list under it is a dish name, not a
  // section heading — which is what the old heuristic called it, throwing the
  // title away and keeping every ingredient as a recipe.
  const opensBlock = (index) => {
    const row = rows[index]
    if (row.blank || row.metadata || row.heading || row.sectionType !== undefined) return false
    if (row.measured || row.inlineList || row.urlOnly) return false
    const next = nextContent(index + 1)
    if (next < 0) return false
    return rows[next].heading === 'ingredients' || runEnd(next) > next
  }

  // Which lines belong to a block rather than standing on their own, so the
  // marked-line heuristic below counts dishes and not ingredients, and so a
  // line already claimed as an ingredient cannot also open a recipe of its
  // own — two consecutive ingredients look exactly like a title above a run.
  const absorbed = new Array(rows.length).fill(false)
  for (let index = 0; index < rows.length; index += 1) {
    const start = rows[index].heading ? nextContent(index + 1) : opensBlock(index) ? nextContent(index + 1) : -1
    if (start < 0) continue
    const end = rows[index].heading === 'ingredients'
      ? (() => { let cursor = start; while (cursor < rows.length && continuable(rows[cursor])) cursor += 1; return cursor })()
      : runEnd(start)
    for (let cursor = start; cursor < end; cursor += 1) absorbed[cursor] = true
  }

  // Two independent reasons to read an unmarked line as a heading, so neither
  // has to carry the weight alone: it names a dish type, or the paste marks
  // its items and this line is not one of them. The second needs the marked
  // lines to outnumber the unmarked ones it cannot already explain, so that one
  // stray dash in an otherwise plain list cannot turn every other line into a
  // heading and throw the whole paste away. Ingredients inside a block count
  // as neither: they are already spoken for.
  const bulleted = rows.filter((row, index) => BULLET.test(row.line) && !absorbed[index]).length
  const unexplained = rows.filter((row, index) => (
    !row.blank && !row.marked && !absorbed[index] && !row.metadata && !row.heading
    && row.sectionType === undefined && !opensBlock(index)
  )).length
  const sectioned = bulleted > 0 && bulleted > unexplained

  const recipes = []
  let dishType
  let current = null
  // What the lines after the title are still adding to, if anything.
  let mode = null

  const close = () => { current = null; mode = null }
  const keep = (item) => {
    if (item && !current.ingredients.includes(item)) current.ingredients.push(item)
  }
  const addIngredients = (text) => {
    splitTopLevel(text).map(cleanIngredient).filter(Boolean).forEach(keep)
  }
  /**
   * A line of its own is one ingredient, and the comma in `1 svogūnas,
   * smulkintas` says how to cut it rather than naming a second thing to buy.
   * A measured line therefore keeps only the parts that are themselves
   * measured — `200 g miltų, 100 g cukraus` is still two — and an unmeasured
   * one is split as a written list always has been.
   */
  const addIngredientLine = (row) => {
    const parts = splitTopLevel(row.body).map(cleanIngredient).filter(Boolean)
    if (!row.measured || parts.length < 2) return addIngredients(row.body)
    const measured = parts.filter((part, index) => index === 0 || AMOUNT_FIRST.test(part) || AMOUNT_WITH_UNIT.test(part))
    measured.forEach(keep)
  }
  const addNotes = (text) => {
    if (!text) return
    current.notes = current.notes ? `${current.notes}\n${text}` : text
  }
  const open = (row) => {
    const { title, ingredientText, notes } = splitRecipeLine(row.body)
    if (!title) return
    // A link written inside brackets keeps the closing one, and trailing
    // punctuation is never part of an address.
    const link = (notes.match(URL_LIKE)?.[0] ?? '').replace(/[)\]}>.,;]+$/, '')
    current = {
      title,
      ingredients: [],
      notes: (link ? notes.replace(link, '') : notes).replace(/^[\s()[\]]+|[\s()[\]]+$/g, '').trim(),
      sourceUrl: link ? (/^https?:\/\//i.test(link) ? link : `https://${link}`) : '',
      ...(dishType ? { dishType } : {}),
    }
    mode = null
    recipes.push(current)
    if (ingredientText) addIngredients(ingredientText)
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row.blank) continue
    // A recipe's own furniture — `Porcijos: 4` — belongs to nothing.
    if (row.metadata) continue
    if (row.sectionType !== undefined) {
      dishType = row.sectionType
      close()
      continue
    }
    if (row.heading === 'ingredients') {
      if (current) {
        mode = 'ingredients'
        if (row.rest) addIngredients(row.rest)
      }
      continue
    }
    if (row.heading === 'steps') {
      if (current) {
        mode = 'steps'
        if (row.rest) addNotes(row.rest)
      }
      continue
    }
    if (current && row.urlOnly && !current.sourceUrl) {
      const link = (row.body.replace(SOURCE_LABEL, '').match(URL_LIKE)?.[0] ?? '').replace(/[)\]}>.,;]+$/, '')
      current.sourceUrl = /^https?:\/\//i.test(link) ? link : `https://${link}`
      continue
    }
    const startsNew = !absorbed[index] && opensBlock(index)
    if (current && mode && !startsNew) {
      // Instructions run until something says a new recipe has started; a
      // sentence with a colon in it is not that something.
      if (mode === 'steps') { addNotes(row.body); continue }
      if (absorbed[index] || row.measured || row.known) { addIngredientLine(row); continue }
    }
    if (!row.marked && sectioned && !startsNew) {
      dishType = row.sectionType
      close()
      continue
    }
    if (!row.body) continue
    open(row)
    if (current && !current.ingredients.length) {
      const next = nextContent(index + 1)
      if (next >= 0 && rows[next].heading === null && runEnd(next) > next) mode = 'ingredients'
    }
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
