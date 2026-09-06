export type LibraryEntry = {
  id: string
  title: string
  dishType: string
  cuisine: string
  lastCooked: string | null
}
export type LibrarySort = 'type' | 'stale'
export type Facet = { name: string; count: number }

export const SORTS: LibrarySort[]
export function orderLibrary<T extends LibraryEntry>(entries: T[], sort: LibrarySort, typeOrder?: string[]): T[]
export function facetCounts(entries: LibraryEntry[], key: 'dishType' | 'cuisine', order?: string[]): Facet[]
export function liveChoice(choice: string | null, options: Facet[]): string | null
