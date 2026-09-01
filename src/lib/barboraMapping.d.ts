import type { BarboraCategory, BarboraMappingReason, IngredientSection } from './types'

export type CategoryIndex = {
  byPath: Map<string, BarboraCategory>
  children: Map<string | null, BarboraCategory[]>
}

export type CategoryProposal = { path: string; reason: BarboraMappingReason }

export const BARBORA_ORIGIN: string
export function shoppingUrl(path: string): string
export const SECTION_ROOTS: Record<IngredientSection, string | null>
export const CATEGORY_ALIASES: Record<string, string>
export function categoryTerms(name: string): string[]
export function buildCategoryIndex(categories: BarboraCategory[]): CategoryIndex
export function descendantsOf(index: CategoryIndex, path: string): BarboraCategory[]
export function mapIngredient(
  name: string,
  section: IngredientSection,
  index: CategoryIndex,
): CategoryProposal | null
export function suggestCategories(
  name: string,
  categories: BarboraCategory[],
  limit?: number,
): BarboraCategory[]
export function trailTo(index: CategoryIndex, path: string): BarboraCategory[]
