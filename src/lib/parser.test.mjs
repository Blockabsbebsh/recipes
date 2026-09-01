import assert from 'node:assert/strict'
import test from 'node:test'
import { ingredientLookupKey, ingredientNameWithoutQuantity, parseRecipeList, titleSimilarity } from './parser.js'

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
