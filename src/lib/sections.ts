import type { IngredientSection } from './types'

// The keys here are a contract, not a name: they are the values stored in
// `ingredients.section` and the keys of `SECTION_ROOTS` in barboraMapping.
// The Lithuanian labels beside them are display text and can be changed.
// See docs/barbora-category-integration.md, "Names that are contracts".

// Roughly the order a shop is walked, so the list reads top to bottom.
export const SECTION_ORDER: IngredientSection[] =
  ['Produce', 'Bakery', 'Dairy & alternatives', 'Frozen', 'Pantry', 'Spices', 'Other']

export const SECTION_LABELS: Record<IngredientSection, string> = {
  Produce: 'Vaisiai ir daržovės',
  Bakery: 'Kepiniai',
  'Dairy & alternatives': 'Pieno produktai ir alternatyvos',
  Frozen: 'Šaldyti produktai',
  Pantry: 'Bakalėja',
  Spices: 'Prieskoniai',
  Other: 'Kita',
}
