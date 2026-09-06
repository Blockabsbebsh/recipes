import type { IngredientSection } from './types'

export type Accent = 'green' | 'amber' | 'indigo' | 'cyan' | 'brown' | 'red' | 'violet' | 'teal' | 'slate'

export const ACCENTS: Accent[]
export const SECTION_ACCENTS: Record<IngredientSection, Accent>
export function sectionAccent(section: IngredientSection): Accent
export function groupAccent(name: string): Accent
export const DISH_POOL: Accent[]
