// Realistic-enough data to exercise layout: real ingredient names, Lithuanian
// titles of varying length, and volumes matching the live household.
import { readFileSync } from 'node:fs'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const HOUSEHOLD_ID = uuid(1)
export const USER_ID = uuid(2)

const VOCAB = JSON.parse(readFileSync(new URL('./vocab.json', import.meta.url), 'utf8'))

const TITLES = [
  'Pomidorų sriuba', 'Avinžirnių karis', 'Lęšių troškinys', 'Špinatų lazanija',
  'Keptos daržovės su bolivine balanda', 'Moliūgų sriuba su kokosų pienu',
  'Cukinijų blynai', 'Bulvių plokštainis', 'Šaltibarščiai', 'Grybų rizotas',
  'Makaronai su pesto', 'Falafeliai su humusu', 'Tofu kepsniai su sezamų sėklomis',
  'Burokėlių salotos', 'Kuskuso salotos su mėtomis', 'Sojų padažo marinuotas tofu',
  'Pupelių troškinys su rūkyta paprika', 'Kario pasta su kokosų pienu ir ryžiais',
  'Ilgai troškintos daržovės su timjonu ir česnakais bei baltuoju vynu',
  'Avižinė košė', 'Kiaušinienė su pomidorais', 'Sumuštiniai su avokadu',
]
const NOTES = [null, 'Galima pakeisti grietinėle.', null,
  'Receptas dviems. Kepti 40 min 200 laipsnių temperatūroje, tada palikti atvėsti.']

export function makeData() {
  const recipes = []
  for (let i = 0; i < 65; i += 1) {
    const title = i < TITLES.length ? TITLES[i] : `${TITLES[i % TITLES.length]} ${Math.floor(i / TITLES.length) + 1}`
    const count = 3 + (i % 6)
    const ingredients = []
    for (let j = 0; j < count; j += 1) {
      const entry = VOCAB[(i * 7 + j * 13) % VOCAB.length]
      if (ingredients.some((x) => x.item === entry.name)) continue
      ingredients.push({
        id: uuid(1000 + i * 20 + j),
        household_id: HOUSEHOLD_ID,
        recipe_id: uuid(100 + i),
        ingredient_id: `ing-${entry.name}`,
        item: entry.name,
        position: j,
      })
    }
    recipes.push({
      id: uuid(100 + i),
      household_id: HOUSEHOLD_ID,
      title,
      notes: NOTES[i % NOTES.length],
      source_url: i % 5 === 0 ? 'https://example.com/receptas' : null,
      created_by: USER_ID,
      deleted_at: i % 23 === 22 ? new Date(Date.now() - 86400000).toISOString() : null,
      deleted_by: i % 23 === 22 ? USER_ID : null,
      created_at: new Date(Date.now() - i * 3600000).toISOString(),
      updated_at: new Date(Date.now() - i * 3600000).toISOString(),
      recipe_ingredients: ingredients,
      recipe_tags: [
        { tag: { id: `tag-type-${i % 6}`, name: `Tipas: ${['Sriubos','Troškiniai ir kariai','Makaronai','Salotos','Pusryčiai','Kita'][i % 6]}` } },
        { tag: { id: `tag-cui-${i % 5}`, name: `Virtuvė: ${['Italų','Indų','Lietuvių','Tarptautinė','Tailando'][i % 5]}` } },
      ],
    })
  }

  const ingredients = VOCAB.map((entry, i) => ({
    id: `ing-${entry.name}`,
    household_id: HOUSEHOLD_ID,
    name: entry.name,
    section: entry.section,
    food_type: 'Other',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    barbora_category_path: entry.path ?? null,
    barbora_mapping_reason: entry.path ? 'exact' : null,
    barbora_mapping_source: entry.path ? 'automatic' : null,
    barbora_mapping_updated_at: entry.path ? new Date().toISOString() : null,
    direct_url: null,
  }))

  const tags = []
  for (let i = 0; i < 6; i += 1) tags.push({ id: `tag-type-${i}`, household_id: HOUSEHOLD_ID, name: `Tipas: ${['Sriubos','Troškiniai ir kariai','Makaronai','Salotos','Pusryčiai','Kita'][i]}` })
  for (let i = 0; i < 5; i += 1) tags.push({ id: `tag-cui-${i}`, household_id: HOUSEHOLD_ID, name: `Virtuvė: ${['Italų','Indų','Lietuvių','Tarptautinė','Tailando'][i]}` })

  const live = recipes.filter((r) => !r.deleted_at)
  const roster_entries = live.slice(0, 9).map((r, i) => ({
    id: uuid(5000 + i), household_id: HOUSEHOLD_ID, recipe_id: r.id,
    status: i < 5 ? 'ready' : 'cooked',
    added_by: USER_ID, resolved_by: i < 5 ? null : USER_ID,
    added_at: new Date(Date.now() - i * 7200000).toISOString(),
    resolved_at: i < 5 ? null : new Date(Date.now() - i * 3600000).toISOString(),
    updated_at: new Date().toISOString(),
  }))
  const shopping_queue = live.slice(10, 16).map((r, i) => ({
    id: uuid(6000 + i), household_id: HOUSEHOLD_ID, recipe_id: r.id,
    added_by: USER_ID, added_at: new Date(Date.now() - i * 600000).toISOString(),
  }))

  return {
    households: [{ id: HOUSEHOLD_ID, name: 'Mūsų virtuvė', invite_code: 'ABCD1234', owner_id: USER_ID, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    household_members: [{ household_id: HOUSEHOLD_ID, user_id: USER_ID, display_name: 'Testas', created_at: new Date().toISOString() }],
    recipes, ingredients, tags, roster_entries, shopping_queue,
    recipe_ingredients: recipes.flatMap((r) => r.recipe_ingredients),
    recipe_tags: [],
  }
}
