import assert from 'node:assert/strict'
import test from 'node:test'
import { findVocabularyMatch, ingredientLookupKey, ingredientNameWithoutQuantity, looksLikePlaceholder, matchesIngredient, parseRecipeList, titleSimilarity } from './parser.js'

test('parses a numbered checked Lithuanian recipe line', () => {
  const [recipe] = parseRecipeList('[v] 2. Enchiladas — tortilijos, pupelės, sūris.')
  assert.equal(recipe.title, 'Enchiladas')
  assert.deepEqual(recipe.ingredients, ['tortilijos', 'pupelės', 'sūris'])
})

test('keeps a title-only recipe', () => {
  const [recipe] = parseRecipeList('[  ] 5. Burokų sriuba')
  assert.equal(recipe.title, 'Burokų sriuba')
  assert.deepEqual(recipe.ingredients, [])
})

test('detects close titles without blocking distinct ones', () => {
  assert.ok(titleSimilarity('Gochujang tofu', 'Gochujang tofu su ryžiais') > 0.6)
  assert.ok(titleSimilarity('Gyozos', 'Lęšių sriuba') < 0.4)
})

test('reads ingredients held in brackets', () => {
  const [recipe] = parseRecipeList('[  ] 6. Gyozos (grybai, miltai, soju farsas, soju padazas, kopustas)')
  assert.equal(recipe.title, 'Gyozos')
  assert.deepEqual(recipe.ingredients, ['grybai', 'miltai', 'soju farsas', 'soju padazas', 'kopustas'])
})

test('keeps a remark after the brackets as a note', () => {
  const [recipe] = parseRecipeList('[  ] 7. Lęšių sriuba (kalafijoras/brokolis, skarbė pomidoru, kokosu kremas) turiu recepta visa')
  assert.equal(recipe.title, 'Lęšių sriuba')
  assert.deepEqual(recipe.ingredients, ['kalafijoras/brokolis', 'skarbė pomidoru', 'kokosu kremas'])
  assert.equal(recipe.notes, 'turiu recepta visa')
})

test('treats a bracketed qualifier as part of the title', () => {
  const [recipe] = parseRecipeList('[  ] 9. Burokų sriuba (šalta)')
  assert.equal(recipe.title, 'Burokų sriuba (šalta)')
  assert.deepEqual(recipe.ingredients, [])
})

test('accepts a colon as the divider', () => {
  const [recipe] = parseRecipeList('[  ] 10. Kiaušinienė: kiaušiniai, sviestas, krapai')
  assert.equal(recipe.title, 'Kiaušinienė')
  assert.deepEqual(recipe.ingredients, ['kiaušiniai', 'sviestas', 'krapai'])
})

test('does not mistake a url colon for a divider', () => {
  const [recipe] = parseRecipeList('Pasta e ceci — makaronai, avinžirniai')
  assert.equal(recipe.title, 'Pasta e ceci')
  assert.deepEqual(recipe.ingredients, ['makaronai', 'avinžirniai'])
})

test('normalizes capitalization and trailing ingredient quantities', () => {
  assert.equal(ingredientLookupKey('Pomidorai'), ingredientLookupKey('pomidorai 2x'))
  assert.equal(ingredientLookupKey('POMIDORAI'), ingredientLookupKey('pomidorai x2'))
  assert.equal(ingredientNameWithoutQuantity('Pomidorai 2 vnt.'), 'Pomidorai')
})

test('strips the bullet a pasted list marks its items with', () => {
  const [recipe] = parseRecipeList('• Grybų sriuba (grybai, svogūnas)')
  assert.equal(recipe.title, 'Grybų sriuba')
  assert.deepEqual(recipe.ingredients, ['grybai', 'svogūnas'])
})

test('reads a section heading as the dish type, and does not save it as a recipe', () => {
  const recipes = parseRecipeList([
    'Mano sąrašas',
    'SRIUBOS',
    '• Grybų sriuba (grybai, svogūnas)',
    'SALOTOS',
    '• Agurkų salotos (agurkai, krapai)',
  ].join('\n'))
  assert.deepEqual(recipes.map((r) => r.title), ['Grybų sriuba', 'Agurkų salotos'])
  assert.deepEqual(recipes.map((r) => r.dishType), ['Sriubos', 'Salotos'])
})

test('a heading it does not recognise ends the section instead of carrying a wrong type on', () => {
  const recipes = parseRecipeList([
    'SRIUBOS', '• Grybų sriuba (grybai, svogūnas)', '• Agurkų sriuba (agurkai, krapai)',
    'KAŽKAS KITA', '• Kugelis', '• Blynai',
  ].join('\n'))
  assert.deepEqual(recipes.map((r) => r.title), ['Grybų sriuba', 'Agurkų sriuba', 'Kugelis', 'Blynai'])
  assert.deepEqual(recipes.map((r) => r.dishType), ['Sriubos', 'Sriubos', undefined, undefined])
})

test('one stray dash does not turn a plain list into headings', () => {
  // Everything here would be a heading if a single marked line were enough,
  // and the whole paste would come back empty.
  const recipes = parseRecipeList('Grybų sriuba (grybai, svogūnas)\nAgurkų salotos (agurkai, krapai)\n- Kugelis')
  assert.equal(recipes.length, 3)
})

test('keeps a bracket inside the ingredient list as part of its ingredient', () => {
  const [recipe] = parseRecipeList('• Troškinys (bulvės, raudonas vynas (sausas merlot, burgundy), miltai)')
  assert.deepEqual(recipe.ingredients, ['bulvės', 'raudonas vynas (sausas merlot, burgundy)', 'miltai'])
  assert.equal(recipe.notes, '')
})

test('a qualifier in brackets before the list stays in the title', () => {
  const [recipe] = parseRecipeList('• Bolivinių balandų (quinoa) troškinys (balanda, morkos, pomidorai)')
  assert.equal(recipe.title, 'Bolivinių balandų (quinoa) troškinys')
  assert.deepEqual(recipe.ingredients, ['balanda', 'morkos', 'pomidorai'])
})

test('a link after the ingredients becomes the source, not a note', () => {
  const [recipe] = parseRecipeList('• Paella (ryžiai, paprika) (cookieandkate.com/vegetable-paella-recipe/#jump)')
  assert.equal(recipe.sourceUrl, 'https://cookieandkate.com/vegetable-paella-recipe/#jump')
  assert.equal(recipe.notes, '')
})

test('a slash between two alternatives is not a link', () => {
  const [recipe] = parseRecipeList('• Sriuba (kalafijoras/brokolis, morkos)')
  assert.equal(recipe.sourceUrl, '')
  assert.deepEqual(recipe.ingredients, ['kalafijoras/brokolis', 'morkos'])
})

test('takes a quantity off either end of an ingredient', () => {
  assert.equal(ingredientNameWithoutQuantity('2x pomidorai'), 'pomidorai')
  assert.equal(ingredientNameWithoutQuantity('pomidorai 2x'), 'pomidorai')
  assert.equal(ingredientNameWithoutQuantity('300 g miltų'), 'miltų')
  assert.equal(ingredientNameWithoutQuantity('lęšiai 150g'), 'lęšiai')
  assert.equal(ingredientNameWithoutQuantity('3 skiltelės česnako'), 'česnako')
  assert.equal(ingredientNameWithoutQuantity('pusė morkos'), 'morkos')
  assert.equal(ingredientNameWithoutQuantity('grybai pusė pakelio'), 'grybai')
})

test('a quantity is never allowed to eat the whole name', () => {
  assert.equal(ingredientNameWithoutQuantity('2 vnt.'), '2 vnt')
})

test('the same noun in two cases is one thing to buy', () => {
  const same = (left, right) => assert.equal(ingredientLookupKey(left), ingredientLookupKey(right), `${left} vs ${right}`)
  same('morka', 'morkos')
  same('svogūnas', 'svogūnai')
  same('agurkas', 'agurkai')
  same('paprika', 'paprikos')
  same('mielės', 'mielių')
  same('grybai', 'grybų')
})

test('but an adjective still separates two things you buy separately', () => {
  const differ = (left, right) => assert.notEqual(ingredientLookupKey(left), ingredientLookupKey(right), `${left} vs ${right}`)
  differ('raudoni lęšiai', 'žali lęšiai')
  differ('raudonas svogūnas', 'svogūnas')
  differ('rūkyta paprika', 'paprika')
  differ('agurkai', 'agurkėliai')
  differ('pomidorai', 'pomidorų pasta')
})

test('a short word keeps its ending, because there is no stem left under it', () => {
  assert.equal(ingredientLookupKey('tofu'), 'tofu')
  assert.equal(ingredientLookupKey('miso'), 'miso')
  assert.notEqual(ingredientLookupKey('pica'), ingredientLookupKey('pita'))
})

test('knows a note to self from something to buy', () => {
  assert.ok(looksLikePlaceholder('kažkas aštraus'))
  assert.ok(looksLikePlaceholder('kažko pasaldinti'))
  assert.ok(looksLikePlaceholder('bet kokie grybai'))
  assert.ok(looksLikePlaceholder('picos ingredientai'))
  assert.ok(looksLikePlaceholder('druska pagal skonį'))
  // Generic, but still a thing you put in a basket.
  assert.ok(!looksLikePlaceholder('daržovės'))
  assert.ok(!looksLikePlaceholder('skirtingi grybai'))
  assert.ok(!looksLikePlaceholder('kokosų kremas'))
})

test('a title with its ingredients underneath is one recipe, not five', () => {
  const recipes = parseRecipeList([
    'Lęšių troškinys',
    'Ingredientai:',
    '200 g raudonų lęšių',
    '1 svogūnas',
    '2 morkos',
    'Gaminimas:',
    'Svogūnus pakepinti, suberti lęšius.',
    'Virti 20 minučių.',
  ].join('\n'))
  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].title, 'Lęšių troškinys')
  assert.deepEqual(recipes[0].ingredients, ['200 g raudonų lęšių', '1 svogūnas', '2 morkos'])
  assert.equal(recipes[0].notes, 'Svogūnus pakepinti, suberti lęšius.\nVirti 20 minučių.')
})

test('measured lines are ingredients even with no heading above them', () => {
  const [recipe] = parseRecipeList('Blynai\n- 200 g miltų\n- 300 ml pieno\n- 2 kiaušiniai')
  assert.equal(recipe.title, 'Blynai')
  assert.deepEqual(recipe.ingredients, ['200 g miltų', '300 ml pieno', '2 kiaušiniai'])
})

test('the household vocabulary carries an unmeasured ingredient list', () => {
  const recipes = parseRecipeList('Kugelis\n• bulvės\n• svogūnai\n• grietinė', {
    vocabulary: ['Bulvės', 'Svogūnai', 'Grietinė'],
  })
  assert.deepEqual(recipes.map((r) => r.title), ['Kugelis'])
  assert.deepEqual(recipes[0].ingredients, ['bulvės', 'svogūnai', 'grietinė'])
})

test('without that vocabulary the same lines are dishes, never ingredients', () => {
  // Nothing here says `Blynai` is something you buy, so the marked lines stay
  // what a marked line has always been: a dish, under a heading.
  const recipes = parseRecipeList('Kugelis\n• Blynai\n• Cepelinai')
  assert.deepEqual(recipes.map((r) => r.title), ['Blynai', 'Cepelinai'])
  assert.deepEqual(recipes.map((r) => r.ingredients), [[], []])
})

test('several blocks in one paste, separated by blank lines', () => {
  const recipes = parseRecipeList([
    'Pomidorų sriuba', 'Ingredientai:', 'pomidorai', 'svogūnas', '',
    'Agurkų salotos', 'Ingredientai:', 'agurkai', 'krapai',
  ].join('\n'))
  assert.deepEqual(recipes.map((r) => r.title), ['Pomidorų sriuba', 'Agurkų salotos'])
  assert.deepEqual(recipes[1].ingredients, ['agurkai', 'krapai'])
})

test('a copied page keeps its link and drops its furniture', () => {
  const [recipe] = parseRecipeList([
    'Paella', 'Porcijos: 4', 'Gaminimo laikas: 40 min', 'https://cookieandkate.com/vegetable-paella-recipe/',
    'Ingredientai:', '300 g ryžių', '1 paprika',
  ].join('\n'))
  assert.equal(recipe.title, 'Paella')
  assert.equal(recipe.sourceUrl, 'https://cookieandkate.com/vegetable-paella-recipe/')
  assert.deepEqual(recipe.ingredients, ['300 g ryžių', '1 paprika'])
})

test('a section heading still groups blocks under it', () => {
  const recipes = parseRecipeList([
    'SRIUBOS', 'Lęšių sriuba', 'Ingredientai:', 'lęšiai', 'morkos',
  ].join('\n'))
  assert.deepEqual(recipes.map((r) => r.dishType), ['Sriubos'])
  assert.deepEqual(recipes[0].ingredients, ['lęšiai', 'morkos'])
})

test('a comma-separated ingredient line inside a block is still split', () => {
  const [recipe] = parseRecipeList('Kiaušinienė\nIngredientai:\nkiaušiniai, sviestas, krapai')
  assert.deepEqual(recipe.ingredients, ['kiaušiniai', 'sviestas', 'krapai'])
})

test('flour made of a thing is not the thing', () => {
  assert.ok(!matchesIngredient('avinžirnių miltai', 'Avinžirniai'))
  assert.ok(!matchesIngredient('pomidorų pasta', 'Pomidorai'))
  assert.ok(!matchesIngredient('kokosų pienas', 'Kokosai'))
  assert.ok(!matchesIngredient('česnako milteliai', 'Česnakas'))
})

test('but the same thing in another case still is', () => {
  assert.ok(matchesIngredient('kokoso pienas', 'Kokosų pienas'))
  assert.ok(matchesIngredient('svogūno', 'Svogūnai'))
  assert.ok(matchesIngredient('raudonų lęšių', 'Raudoni lęšiai'))
  assert.ok(!matchesIngredient('žali lęšiai', 'Raudoni lęšiai'))
})

test('finds the vocabulary entry a written ingredient means', () => {
  const vocabulary = ['Avinžirniai', 'Miltai', 'Pomidorai']
  assert.equal(findVocabularyMatch('avinžirnių', vocabulary), 'Avinžirniai')
  assert.equal(findVocabularyMatch('avinžirnių miltai', vocabulary), null)
})
