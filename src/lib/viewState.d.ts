import type { Tab } from './types'

export type PersistedViewState = {
  version: 1
  tab: Tab
  scrollByTab: Record<Tab, number>
  expandedRecipeId: string | null
  savedAt: number
}

export const TABS: readonly Tab[]
export const EMPTY_SCROLL: Record<Tab, number>
export const SCROLL_MEMORY_MS: number

export function rememberLastTab(tab: Tab, storage?: Storage): void
export function lastTab(storage?: Storage): Tab | null
export function viewStateKey(userId: string, householdId: string): string
export function parseViewState(raw: string | null): PersistedViewState | null
export function readViewState(key: string, storage?: Storage): PersistedViewState | null
export function writeViewState(key: string, state: PersistedViewState, storage?: Storage): boolean
export function positionsFrom(state: PersistedViewState | null, now?: number): Record<Tab, number>
