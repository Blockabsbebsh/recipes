import type { IngredientSection } from './types'

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
