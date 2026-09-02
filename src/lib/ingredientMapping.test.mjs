import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildCategoryIndex } from './barboraMapping.js'
import { mappingFields } from './ingredientMapping.js'

const index = buildCategoryIndex(JSON.parse(readFileSync(new URL('../../data/barbora-categories.json', import.meta.url))).categories)
const empty = buildCategoryIndex([])

test('a category the household picked by hand is recorded as theirs', () => {
  const columns = mappingFields('Alyvuogės', 'Pantry', index, '/bakaleja/konservuotas-maistas')
  assert.equal(columns.barbora_category_path, '/bakaleja/konservuotas-maistas')
  assert.equal(columns.barbora_mapping_source, 'manual')
  assert.equal(columns.barbora_mapping_reason, 'manual')
  assert.ok(columns.barbora_mapping_updated_at)
})

test('everything else is the mapper’s proposal, marked as automatic', () => {
  const columns = mappingFields('Grietinė', 'Dairy & alternatives', index)
  assert.ok(columns.barbora_category_path?.startsWith('/pieno-gaminiai'))
  assert.equal(columns.barbora_mapping_source, 'automatic')
})

test('a name the mapper cannot place clears the columns rather than guessing', () => {
  const columns = mappingFields('Kažkoks neegzistuojantis daiktas', 'Pantry', index)
  assert.deepEqual(columns, {
    barbora_category_path: null,
    barbora_mapping_reason: null,
    barbora_mapping_source: null,
    barbora_mapping_updated_at: null,
  })
})

test('no catalogue means no opinion, not no category', () => {
  // The catalogue is fetched once per session. Writing an ingredient while
  // that fetch is still in flight must not quietly discard a good mapping.
  assert.deepEqual(mappingFields('Grietinė', 'Dairy & alternatives', empty), {})
})

test('but a hand-picked category is written even with no catalogue loaded', () => {
  const columns = mappingFields('Grietinė', 'Dairy & alternatives', empty, '/pieno-gaminiai-kiausiniai-ir-majonezas')
  assert.equal(columns.barbora_mapping_source, 'manual')
})
