import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { ACCENTS, DISH_POOL, SECTION_ACCENTS, groupAccent, sectionAccent } from './palette.js'

const SECTIONS = ['Produce', 'Bakery', 'Dairy & alternatives', 'Frozen', 'Pantry', 'Spices', 'Other']

test('every shop section has an accent, and no two share one', () => {
  const accents = SECTIONS.map(sectionAccent)
  assert.equal(accents.length, new Set(accents).size)
  assert.equal(accents.includes(undefined), false)
})

test('the section map covers exactly the sections the app ships', () => {
  assert.deepEqual(Object.keys(SECTION_ACCENTS).sort(), [...SECTIONS].sort())
})

test('a section nobody knows about still gets a colour rather than nothing', () => {
  assert.equal(sectionAccent('Wine cellar'), 'slate')
})

test('a dish type keeps its accent whatever else the household adds', () => {
  // The point of hashing the name rather than indexing a list: the library
  // does not repaint itself when a new dish type appears above an old one.
  const before = groupAccent('Pica')
  assert.equal(groupAccent('Pica'), before)
})

test('a household-invented dish type lands on a real accent', () => {
  for (const name of ['Pica', 'Vakarienė svečiams', 'Ką nors greito', '🍜']) {
    assert.equal(ACCENTS.includes(groupAccent(name)), true, `${name} → ${groupAccent(name)}`)
  }
})

test('diacritics are part of the name', () => {
  // The household types one spelling, not both, so folding them together
  // would only mean two different dish types sharing a colour for free.
  assert.notEqual(groupAccent('Užkandžiai'), groupAccent('Uzkandziai'))
})

test('an empty name does not throw', () => {
  assert.equal(ACCENTS.includes(groupAccent('')), true)
})

test('the stylesheet defines every accent this module can return', () => {
  // A name that reaches the DOM with no `--accent-*` triple behind it draws
  // an invisible heading, and nothing else in the app would say so.
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  for (const accent of [...ACCENTS, 'slate']) {
    assert.match(css, new RegExp(`\\[data-accent="${accent}"\\]`), `no rule for ${accent}`)
  }
})

const SHIPPED_DISH_TYPES = [
  'Pusryčiai', 'Sriubos', 'Troškiniai ir kariai', 'Makaronai', 'Salotos',
  'Ryžių ir kruopų patiekalai', 'Bulvių patiekalai', 'Sumuštiniai ir kebabai',
  'Užkandžiai', 'Kepiniai ir picos', 'Desertai', 'Kita',
]

test('no two dish types that sit next to each other share a colour', () => {
  // The library is sorted by dish type, so the colours arrive in bands — and a
  // band is only a boundary if the band beside it is a different colour.
  const accents = SHIPPED_DISH_TYPES.map(groupAccent)
  for (let i = 1; i < accents.length; i += 1) {
    assert.notEqual(accents[i], accents[i - 1],
      `${SHIPPED_DISH_TYPES[i - 1]} and ${SHIPPED_DISH_TYPES[i]} are both ${accents[i]}`)
  }
})

test('a dish type never wears one of the cold accents', () => {
  // Indigo and slate belong to the shop, where dairy being blue is the point.
  // "Kita" is the deliberate exception: the absence of a colour.
  for (const name of [...SHIPPED_DISH_TYPES, 'Pica', 'Vakarienė svečiams', 'Sriubytė']) {
    if (name === 'Kita') continue
    assert.equal(DISH_POOL.includes(groupAccent(name)), true, `${name} → ${groupAccent(name)}`)
  }
})

test('the shop keeps the accents the library gave up', () => {
  assert.equal(SECTION_ACCENTS['Dairy & alternatives'], 'indigo')
  assert.equal(DISH_POOL.includes('indigo'), false)
})
