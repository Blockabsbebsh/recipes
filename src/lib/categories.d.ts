import type { Recipe, RecipeDraft } from './types'

export const DISH_TYPES: readonly string[]
export const CUISINES: readonly string[]
export const DISH_TAG_PREFIX: string
export const CUISINE_TAG_PREFIX: string
export function classifyRecipe(title: string, ingredients?: string[]): { dishType: string; cuisine: string }
export function classificationTags(draft: RecipeDraft): string[]
export function recipeTagNames(recipe: Recipe): string[]
export function dishTypeFor(recipe: Recipe): string
export function cuisineFor(recipe: Recipe): string
