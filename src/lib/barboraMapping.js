// Choosing one Barbora category for an ingredient, deterministically.
//
// The crawler discovers the tree; this chooses within it. The rule is
// deliberately timid: descend only where the shop's own wording makes the
// answer obvious, and otherwise stop at a branch that is merely broad rather
// than wrong. A category that is too broad costs a household a few taps. A
// category that is confidently wrong sends someone to the wrong aisle.
//
// Nothing here writes anything. `mapIngredient` returns a proposal, and a
// manual choice always outranks it.

import { ingredientNameWithoutQuantity, normalizeTitle, titleSimilarity } from './parser.js'

export const BARBORA_ORIGIN = 'https://barbora.lt'
/**
 * The live shopping URL for a path discovered by the crawler.
 *
 * Do not rewrite this using Barbora's association files. Those files currently
 * contain some retired routes which launch the mobile app but then return a
 * 404. A working web URL is the source of truth, even when Barbora has not yet
 * registered it as an App/Universal Link.
 */
export function shoppingUrl(path) {
  return `${BARBORA_ORIGIN}${path}`
}

/**
 * Where to begin descending for each shop section. `Other` has no honest
 * starting point, so ingredients there are left unmapped rather than guessed
 * at from the top of the shop.
 */
export const SECTION_ROOTS = {
  Produce: '/darzoves-ir-vaisiai',
  Bakery: '/duonos-gaminiai-ir-konditerija',
  'Dairy & alternatives': '/pieno-gaminiai-kiausiniai-ir-majonezas',
  Frozen: '/saldytas-maistas',
  Pantry: '/bakaleja',
  Spices: '/bakaleja/prieskoniai-marinatai-ir-sultiniai',
  Other: null,
}

/**
 * Reviewed exceptions, for ingredients Barbora files somewhere the section
 * root cannot reach, or names its categories never spell out. Each one was
 * read against the live category name; none is a guess from a product listing.
 * Keyed by normalized ingredient name.
 */
export const CATEGORY_ALIASES = {
  // Bread names are more specific than Barbora's combined shelf labels.
  'kukuruzu tortilijos': '/duonos-gaminiai-ir-konditerija/duona/tortilijos-ir-picu-paplociai',
  lavasas: '/duonos-gaminiai-ir-konditerija/duona/tortilijos-ir-picu-paplociai',
  'pita duona': '/duonos-gaminiai-ir-konditerija/duona/tortilijos-ir-picu-paplociai',
  'rugine duona': '/duonos-gaminiai-ir-konditerija/duona/tamsi-duona',
  // Dairy alternatives and named cheeses.
  'augaline grietinele': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augaliniai-gerimai-ir-grietinele',
  'augalinis jogurtas': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augaliniai-jogurto-ir-desertu-pakaitalai',
  'augalinis sviestas': '/pieno-gaminiai-kiausiniai-ir-majonezas/sviestas-margarinas-ir-riebalai/margarinas-ir-tepieji-riebalu-misiniai',
  'avizinis pienas': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augaliniai-gerimai-ir-grietinele',
  'migdolu pienas': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augaliniai-gerimai-ir-grietinele',
  'sojos pienas': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augaliniai-gerimai-ir-grietinele',
  'fetos suris': '/pieno-gaminiai-kiausiniai-ir-majonezas/suris/fetos-brinzos-ir-halumi-suriai',
  grietinele: '/pieno-gaminiai-kiausiniai-ir-majonezas/grietine-ir-grietinele/grietinele',
  jogurtas: '/pieno-gaminiai-kiausiniai-ir-majonezas/jogurtai-ir-desertai',
  mocarela: '/pieno-gaminiai-kiausiniai-ir-majonezas/suris/mocarelos-ir-buratos-suriai',
  parmezanas: '/pieno-gaminiai-kiausiniai-ir-majonezas/suris/kietieji-suriai',
  varske: '/pieno-gaminiai-kiausiniai-ir-majonezas/varskes-produktai/varske',
  // The shop files these proteins outside the dairy-alternatives aisle.
  seitanas: '/mesa-zuvis-ir-kulinarija/sviezia-mesa-ir-paukstiena/augaliniai-mesos-pakaitalai',
  tempe: '/mesa-zuvis-ir-kulinarija/sviezia-mesa-ir-paukstiena/augaliniai-mesos-pakaitalai',
  // Dry-vs-canned disambiguation for ingredients the tree sells both ways.
  avinzirniai: '/bakaleja/kruopos/lesiai-avinzirniai-zirniai-ir-pupeles',
  'konservuoti avinzirniai': '/bakaleja/konservuotas-maistas/konservuoti-lesiai-ir-avinzirniai',
  'konservuoti kukuruzai': '/bakaleja/konservuotas-maistas/konservuoti-zirneliai-ir-kukuruzai',
  'skaldyti pomidorai': '/bakaleja/konservuotas-maistas/konservuoti-pomidorai',
  'sauleje dziovinti pomidorai': '/bakaleja/konservuotas-maistas/konservuoti-sauleje-dziovinti-pomidorai',
  // Individual frozen vegetables share one honest shelf.
  edamame: '/saldytas-maistas/saldytos-darzoves-vaisiai-ir-uogos/saldytos-darzoves-grybai-ir-ju-misiniai',
  'saldyti kukuruzai': '/saldytas-maistas/saldytos-darzoves-vaisiai-ir-uogos/saldytos-darzoves-grybai-ir-ju-misiniai',
  'saldyti spinatai': '/saldytas-maistas/saldytos-darzoves-vaisiai-ir-uogos/saldytos-darzoves-grybai-ir-ju-misiniai',
  'saldyti zirneliai': '/saldytas-maistas/saldytos-darzoves-vaisiai-ir-uogos/saldytos-darzoves-grybai-ir-ju-misiniai',
  // Pantry staples whose ingredient names are synonyms or narrower examples
  // of Barbora's combined category labels.
  'agavu sirupas': '/bakaleja/cukrus-druska-ir-kepimo-priedai/sirupai-ir-desertiniai-padazai',
  'klevu sirupas': '/bakaleja/cukrus-druska-ir-kepimo-priedai/sirupai-ir-desertiniai-padazai',
  anakardziai: '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/riesutai',
  'graikiniai riesutai': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/riesutai',
  'lazdyno riesutai': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/riesutai',
  migdolai: '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/riesutai',
  pistacijos: '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/riesutai',
  'zemes riesutai': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/riesutai',
  'aviziniai dribsniai': '/bakaleja/kruopos/avizines-kruopos-ir-dribsniai',
  bulguras: '/bakaleja/kruopos/bulguro-ir-kuskuso-kruopos',
  kuskusas: '/bakaleja/kruopos/bulguro-ir-kuskuso-kruopos',
  kvinoja: '/bakaleja/kruopos/bolivine-balanda-soru-ir-kukuruzu-kruopos',
  'jazminu ryziai': '/bakaleja/kruopos/ilgagrudziai-ryziai',
  'rudieji ryziai': '/bakaleja/kruopos/rudieji-apvalieji-ir-kiti-ryziai',
  'susio ryziai': '/bakaleja/kruopos/plikyti-susiu-ir-rizoto-ryziai',
  ryziai: '/bakaleja/kruopos',
  'raudonieji lesiai': '/bakaleja/kruopos/lesiai-avinzirniai-zirniai-ir-pupeles',
  'zali lesiai': '/bakaleja/kruopos/lesiai-avinzirniai-zirniai-ir-pupeles',
  'chia seklos': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/seklos-ir-ju-misiniai',
  sezamai: '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/seklos-ir-ju-misiniai',
  'saulegrazu seklos': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/seklos-ir-ju-misiniai',
  'linu semenys': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/selenos-ir-semenys',
  datules: '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/dziovinti-vaisiai',
  'dziovinti abrikosai': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/dziovinti-vaisiai',
  'dziovintos slyvos': '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/dziovinti-vaisiai',
  razinos: '/bakaleja/riesutai-seklos-dziovinti-vaisiai-ir-uogos/dziovinti-vaisiai',
  'darzoviu sultinys': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/sultiniai-ir-sultiniu-kubeliai',
  'grybu sultinys': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/sultiniai-ir-sultiniu-kubeliai',
  kecupas: '/bakaleja/padazai-ir-konservuotos-uztepeles/kecupai',
  pesto: '/bakaleja/padazai-ir-konservuotos-uztepeles/pesto-padazai',
  'pomidoru padazas': '/bakaleja/padazai-ir-konservuotos-uztepeles/pomidoru-padazai-ir-pasta',
  'pomidoru pasta': '/bakaleja/padazai-ir-konservuotos-uztepeles/pomidoru-padazai-ir-pasta',
  tahini: '/bakaleja/padazai-ir-konservuotos-uztepeles',
  'veganiskas majonezas': '/pieno-gaminiai-kiausiniai-ir-majonezas/majonezas/majonezas',
  'kokosu aliejus': '/bakaleja/aliejus-ir-actas/kokosu-ir-kitu-riesutu-aliejus',
  'augalinis aliejus': '/bakaleja/aliejus-ir-actas',
  'sezamu aliejus': '/bakaleja/aliejus-ir-actas',
  'obuoliu actas': '/bakaleja/aliejus-ir-actas/actas-ir-citrinu-sultys',
  'ryziu actas': '/bakaleja/aliejus-ir-actas/actas-ir-citrinu-sultys',
  'lazanijos lakstai': '/bakaleja/makaronai/ilgieji-plokstieji-ir-lazanijos-makaronai',
  spageciai: '/bakaleja/makaronai/ilgieji-plokstieji-ir-lazanijos-makaronai',
  orzo: '/bakaleja/makaronai/trumpieji-ir-smulkieji-makaronai',
  'pilno grudo miltai': '/bakaleja/miltai-ir-ju-misiniai/kvietiniai-ir-ruginiai-miltai',
  'marinuoti agurkai': '/bakaleja/konservuotas-maistas/konservuoti-agurkai',
  'raudonosios pupeles': '/bakaleja/konservuotas-maistas/konservuotos-pupeles',
  uogiene: '/bakaleja/konservuotas-maistas/uogienes-ir-dzemai',
  'brukniu uogiene': '/bakaleja/konservuotas-maistas/uogienes-ir-dzemai',
  alyvuoges: '/bakaleja/konservuotas-maistas/konservuotos-alyvuoges-kapareliai-ir-svogunai',
  'riesutu sviestas': '/bakaleja/saldumynai/sokolado-ir-riesutu-kremai',
  'sojos kubeliai': '/mesa-zuvis-ir-kulinarija/sviezia-mesa-ir-paukstiena/augaliniai-mesos-pakaitalai',
  'soju farsas': '/mesa-zuvis-ir-kulinarija/sviezia-mesa-ir-paukstiena/augaliniai-mesos-pakaitalai',
  'soju kotletu misinys': '/mesa-zuvis-ir-kulinarija/sviezia-mesa-ir-paukstiena/augaliniai-mesos-pakaitalai',
  'nori lapai': '/mesa-zuvis-ir-kulinarija/kulinarija/susiai-ir-juros-kopustai',
  'baltas vynas': '/gerimai/vynas/baltasis-vynas',
  'raudonas vynas': '/gerimai/vynas/raudonasis-vynas',
  'tamsus alus': '/gerimai/alus/tamsusis-alus',
  // Produce categories intentionally combine several everyday ingredients.
  apelsinai: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/citrusiniai-vaisiai',
  citrinos: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/citrusiniai-vaisiai',
  laimai: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/citrusiniai-vaisiai',
  avietes: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/vynuoges-ir-uogos',
  braskes: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/vynuoges-ir-uogos',
  melynes: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/vynuoges-ir-uogos',
  granatai: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/egzotiniai-vaisiai',
  mangai: '/darzoves-ir-vaisiai/vaisiai-ir-uogos/egzotiniai-vaisiai',
  bazilikas: '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  ciobreliai: '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  'kalendros lapai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  krapai: '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  metos: '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  petrazoles: '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  rozmarinas: '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  salavijas: '/darzoves-ir-vaisiai/darzoves-ir-grybai/prieskonines-darzoves-ir-zoleles',
  'cili pipirai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/paprikos',
  'vysniniai pomidorai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/pomidorai-ir-agurkai',
  'kiniski kopustai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/bulves-morkos-ir-kopustai',
  'raudonieji kopustai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/bulves-morkos-ir-kopustai',
  'ziediniai kopustai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/bulves-morkos-ir-kopustai',
  'raudonieji svogunai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/svogunai-porai-ir-cesnakai',
  'zali svogunai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/svogunai-porai-ir-cesnakai',
  ridikeliai: '/darzoves-ir-vaisiai/darzoves-ir-grybai/burokeliai-ridikai-ir-imbieras',
  pievagrybiai: '/darzoves-ir-vaisiai/darzoves-ir-grybai/grybai',
  'sitake grybai': '/darzoves-ir-vaisiai/darzoves-ir-grybai/grybai',
  rukola: '/darzoves-ir-vaisiai/darzoves-ir-grybai/salotos-ir-ju-misiniai',
  spinatai: '/darzoves-ir-vaisiai/darzoves-ir-grybai/salotos-ir-ju-misiniai',
  'sparagines pupeles': '/darzoves-ir-vaisiai/darzoves-ir-grybai/kukuruzai-zirniai-pupeles-ir-smidrai',
  brokoliai: '/darzoves-ir-vaisiai/darzoves-ir-grybai',
  pastarnokai: '/darzoves-ir-vaisiai/darzoves-ir-grybai',
  ropes: '/darzoves-ir-vaisiai/darzoves-ir-grybai',
  'saldziosios bulves': '/darzoves-ir-vaisiai/darzoves-ir-grybai',
  salierai: '/darzoves-ir-vaisiai/darzoves-ir-grybai',
  'cukiniju ziedai': '/darzoves-ir-vaisiai/darzoves-ir-grybai',
  // Dry spices: only peppers and blends have narrower shelves.
  'juodieji pipirai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/pipirai',
  'kajeno pipirai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/pipirai',
  'cili dribsniai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/pipirai',
  'cili milteliai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/pipirai',
  'kario prieskoniai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/prieskoniu-ir-zoleliu-misiniai',
  'tikka masala prieskoniai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/prieskoniu-ir-zoleliu-misiniai',
  'cesnako milteliai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  ciberzole: '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  cinamonas: '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'dziovinti ciobreliai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'garstyciu seklos': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'imbiero milteliai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  kuminas: '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'lauro lapai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'malta kalendra': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  muskatas: '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  raudonelis: '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'rukyta paprika': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'saldzioji paprika': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  'svogunu milteliai': '/bakaleja/prieskoniai-marinatai-ir-sultiniai/grynieji-prieskoniai-ir-zoleles',
  // Baking staples live under sugar and salt, not under spices.
  druska: '/bakaleja/cukrus-druska-ir-kepimo-priedai/druska',
  cukrus: '/bakaleja/cukrus-druska-ir-kepimo-priedai/baltasis-cukrus',
  'rudasis cukrus': '/bakaleja/cukrus-druska-ir-kepimo-priedai/rudasis-cukrus',
  soda: '/bakaleja/cukrus-druska-ir-kepimo-priedai/soda-ir-krakmolas',
  'kukuruzu krakmolas': '/bakaleja/cukrus-druska-ir-kepimo-priedai/soda-ir-krakmolas',
  'kepimo milteliai': '/bakaleja/cukrus-druska-ir-kepimo-priedai/kepimo-milteliai-ir-vanilinis-cukrus',
  // "Sojų, terijakio ir vorčesterio padažai" names the sauce, not the bean.
  'soju padazas': '/bakaleja/padazai-ir-konservuotos-uztepeles/soju-terijakio-ir-vorcesterio-padazai',
  // The category is literally "Augalinis sūris, užtepai ir tofu".
  tofu: '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augalinis-suris-uztepai-ir-tofu',
  'rukytas tofu': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augalinis-suris-uztepai-ir-tofu',
  'augalinis pienas': '/pieno-gaminiai-kiausiniai-ir-majonezas/augaliniai-produktai/augaliniai-gerimai-ir-grietinele',
  miltai: '/bakaleja/miltai-ir-ju-misiniai/kvietiniai-ir-ruginiai-miltai',
}

/**
 * Barbora names a category after everything in it: "Bulvės, morkos ir
 * kopūstai" is three answers wearing one label. Splitting on commas and the
 * conjunction turns the label back into the terms a person would match.
 */
export function categoryTerms(name) {
  // Split the label first: normalizing strips punctuation, so a comma has to
  // be spent before it is erased.
  return String(name ?? '')
    .split(/\s*,\s*/)
    .flatMap((part) => part.split(/\s+ir\s+/iu))
    .map((term) => normalizeTitle(term))
    .filter(Boolean)
}

/** Index the catalogue by path, with children derived from the paths alone. */
export function buildCategoryIndex(categories) {
  const byPath = new Map()
  const children = new Map()

  for (const category of categories) {
    byPath.set(category.path, category)
    const parent = parentOf(category.path)
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(category)
  }

  return { byPath, children }
}

/** Every category below `path`, deepest last. */
export function descendantsOf(index, path) {
  const found = []
  const queue = [...(index.children.get(path) ?? [])]
  while (queue.length > 0) {
    const category = queue.shift()
    found.push(category)
    queue.push(...(index.children.get(category.path) ?? []))
  }
  return found
}

/**
 * Propose a category for an ingredient, or `null` when nothing narrower than
 * the section is known.
 *
 * @param {string} name ingredient name as the household typed it
 * @param {string} section the ingredient's shop section
 * @param {{byPath: Map, children: Map}} index from {@link buildCategoryIndex}
 * @returns {{path: string, reason: 'exact'|'alias'|'parent_fallback'}|null}
 */
export function mapIngredient(name, section, index) {
  const normalized = normalizeTitle(ingredientNameWithoutQuantity(name))
  if (normalized === '') return null

  const alias = CATEGORY_ALIASES[normalized]
  if (alias !== undefined && index.byPath.has(alias)) return { path: alias, reason: 'alias' }

  const root = SECTION_ROOTS[section] ?? null
  if (root === null || !index.byPath.has(root)) return null

  const matches = descendantsOf(index, root)
    .filter((category) => categoryTerms(category.name).includes(normalized))
  if (matches.length === 0) return null

  // Several matches on one branch are the same answer said twice: "Grietinė"
  // names both the shelf and the aisle above it, and the shelf is the answer.
  const deepest = matches.reduce((a, b) => (a.depth >= b.depth ? a : b))
  if (matches.every((category) => isAncestorOrSelf(category.path, deepest.path))) {
    return { path: deepest.path, reason: 'exact' }
  }

  // Genuinely different branches: "Pupelės" is sold tinned and dry. Retreat to
  // whatever contains them all, and only if that says more than the section.
  const shared = commonAncestor(matches.map((category) => category.path))
  if (shared === null || shared === root || !index.byPath.has(shared)) return null
  return { path: shared, reason: 'parent_fallback' }
}

/**
 * Rank categories by name similarity, for a person choosing in the picker.
 * Never used to write a mapping: a resemblance is not a relationship.
 */
export function suggestCategories(name, categories, limit = 8) {
  const normalized = ingredientNameWithoutQuantity(name)
  if (normalizeTitle(normalized) === '') return []
  return categories
    .map((category) => ({ category, score: titleSimilarity(normalized, category.name) }))
    .filter((entry) => entry.score > 0.3)
    .sort((a, b) => b.score - a.score || a.category.path.localeCompare(b.category.path))
    .slice(0, limit)
    .map((entry) => entry.category)
}

/** The breadcrumb from the top of the shop down to `path`. */
export function trailTo(index, path) {
  const trail = []
  let current = path
  while (current) {
    const category = index.byPath.get(current)
    if (category) trail.unshift(category)
    current = parentOf(current)
  }
  return trail
}

function parentOf(path) {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? null : path.slice(0, cut)
}

function isAncestorOrSelf(path, candidate) {
  return candidate === path || candidate.startsWith(`${path}/`)
}

function commonAncestor(paths) {
  return paths.reduce((shared, path) => {
    if (shared === null) return path
    const a = shared.split('/')
    const b = path.split('/')
    const kept = []
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      if (a[index] !== b[index]) break
      kept.push(a[index])
    }
    return kept.length > 1 ? kept.join('/') : null
  }, null)
}
