export type LibraryEntry = {
  id: string
  title: string
  dishType: string
  cuisine: string
  lastCooked: string | null
}
export type LibrarySort = 'title' | 'type' | 'stale'
export function daysSinceCooked(value: string, now?: Date): number | null
export function suggestRecipes<T extends LibraryEntry>(entries: T[], excludedIds?: Set<string>, now?: Date): { entry: T; kind: 'familiar' | 'discovery'; days: number | null }[]
export type Facet = { name: string; count: number }

export const SORTS: LibrarySort[]
export function orderLibrary<T extends LibraryEntry>(entries: T[], sort: LibrarySort, typeOrder?: string[]): T[]
export function facetCounts(entries: LibraryEntry[], key: 'dishType' | 'cuisine', order?: string[]): Facet[]
export function liveChoice(choice: string | null, options: Facet[]): string | null
