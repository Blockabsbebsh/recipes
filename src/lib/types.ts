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

/** An entry in the household's shared ingredient vocabulary. */
export type VocabularyIngredient = {
  id: string
  household_id: string
  name: string
  section: IngredientSection
  food_type: string
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
