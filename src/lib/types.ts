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
  item: string
  position: number
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
}
