import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyRecipe } from './categories.js'

test('detects Italian pasta as cuisine and dish type', () => {
  assert.deepEqual(classifyRecipe('Pasta e ceci', ['makaronai', 'avinžirniai']), {
    dishType: 'Makaronai',
    cuisine: 'Italų',
  })
})

test('detects Lithuanian soup', () => {
  assert.deepEqual(classifyRecipe('Šaltibarščiai', ['burokėliai', 'kefyras']), {
    dishType: 'Sriubos',
    cuisine: 'Lietuvių',
  })
})

test('falls back to neutral categories', () => {
  assert.deepEqual(classifyRecipe('Keptos daržovės', ['cukinija']), {
    dishType: 'Kita',
    cuisine: 'Tarptautinė',
  })
})
