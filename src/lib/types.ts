export type Household = {
  id: string
  name: string
  invite_code: string
  owner_id: string
}

export type Ingredient = {
  id: string
  household_id: string
  recipe_id: string
  ingredient_id: string
  item: string
  position: number
}

export type IngredientSection =
  'Produce' | 'Pantry' | 'Dairy & alternatives' | 'Bakery' | 'Frozen' | 'Spices' | 'Other'

/**
 * A node in Barbora's shopping hierarchy. Global reference data, not
 * household-specific, and read-only for the app: `https://barbora.lt${path}`
 * is the shopping link.
 */
export type BarboraCategory = {
  path: string
  name: string
  parent_path: string | null
  depth: number
  sort_order: number
  active: boolean
}

/** Why an ingredient points at the category it does. */
export type BarboraMappingReason = 'exact' | 'alias' | 'parent_fallback' | 'manual'

/** Who chose it. A `manual` choice survives crawler and auto-mapping runs. */
export type BarboraMappingSource = 'automatic' | 'manual'

/** An entry in the household's shared ingredient vocabulary. */
export type VocabularyIngredient = {
  id: string
  household_id: string
  name: string
  section: IngredientSection
  food_type: string
  // Independent of `section` and `food_type`: those describe the food, this
  // describes where its shopping link points. Null until mapped.
  barbora_category_path: string | null
  barbora_mapping_reason: BarboraMappingReason | null
  barbora_mapping_source: BarboraMappingSource | null
  barbora_mapping_updated_at: string | null
  barbora_direct_url: string | null
}

export type Recipe = {
  id: string
  household_id: string
  title: string
  notes: string | null
  source_url: string | null
  created_by: string
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
  recipe_ingredients: Ingredient[]
  recipe_tags: RecipeTagLink[]
}

export type RecipeTag = {
  id: string
  name: string
}

export type HouseholdTag = RecipeTag & {
  household_id: string
}

export type RecipeTagLink = {
  tag: RecipeTag
}

export type RosterEntry = {
  id: string
  household_id: string
  recipe_id: string
  status: 'ready' | 'cooked' | 'skipped'
  added_at: string
  resolved_at: string | null
}

export type QueueEntry = {
  id: string
  household_id: string
  recipe_id: string
  added_at: string
}

export type RecipeDraft = {
  title: string
  ingredients: string[]
  notes: string
  sourceUrl: string
  dishType?: string
  cuisine?: string
}

export type Tab = 'current' | 'library' | 'shop' | 'deleted'
