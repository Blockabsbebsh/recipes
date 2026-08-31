import type { RecipeDraft } from './types'

export function cleanIngredient(value: string): string
export function parseRecipeList(text: string): RecipeDraft[]
export function normalizeTitle(value: string): string
export function titleSimilarity(left: string, right: string): number
