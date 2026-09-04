import type { RecipeDraft } from './types'

export function cleanIngredient(value: string): string
export function ingredientNameWithoutQuantity(value: string): string
export function ingredientStem(value: string): string
export function ingredientLookupKey(value: string): string
export function looksLikePlaceholder(value: string): boolean
export function matchesIngredient(left: string, right: string): boolean
export function findVocabularyMatch(written: string, vocabulary: string[]): string | null
export function parseRecipeList(text: string, options?: { vocabulary?: string[] }): RecipeDraft[]
export function normalizeTitle(value: string): string
export function titleSimilarity(left: string, right: string): number
