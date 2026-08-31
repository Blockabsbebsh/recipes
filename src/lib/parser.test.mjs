import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRecipeList, titleSimilarity } from './parser.js'

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
