import type { RecipeDraft } from './types'

/** A recipe that has not been written yet. */
export const blankDraft = (): RecipeDraft => ({ title: '', ingredients: [], notes: '', sourceUrl: '', dishType: 'Kita', cuisine: 'Tarptautinė' })

const PREFIX = 'recipes:recipe-draft:v1:'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000

type StoredDraft = {
  version: 1
  savedAt: number
  baseUpdatedAt: string | null
  draft: RecipeDraft
}

export const recipeDraftKey = (householdId: string, recipeId: string | undefined, destination: string) =>
  `${PREFIX}${householdId}:${recipeId ?? `new:${destination}`}`

function validDraft(value: unknown): value is RecipeDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<RecipeDraft>
  return typeof draft.title === 'string'
    && Array.isArray(draft.ingredients)
    && draft.ingredients.every((item) => typeof item === 'string')
    && typeof draft.notes === 'string'
    && typeof draft.sourceUrl === 'string'
    && (draft.dishType === undefined || typeof draft.dishType === 'string')
    && (draft.cuisine === undefined || typeof draft.cuisine === 'string')
}

export function readRecipeDraft(key: string, baseUpdatedAt: string | null): RecipeDraft | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<StoredDraft> | null
    if (!stored || stored.version !== 1 || stored.baseUpdatedAt !== baseUpdatedAt
      || typeof stored.savedAt !== 'number' || Date.now() - stored.savedAt > MAX_AGE
      || !validDraft(stored.draft)) {
      localStorage.removeItem(key)
      return null
    }
    return stored.draft
  } catch {
    try { localStorage.removeItem(key) } catch { /* storage may be unavailable */ }
    return null
  }
}

export function writeRecipeDraft(key: string, baseUpdatedAt: string | null, draft: RecipeDraft) {
  try {
    const stored: StoredDraft = { version: 1, savedAt: Date.now(), baseUpdatedAt, draft }
    localStorage.setItem(key, JSON.stringify(stored))
  } catch {
    // Private browsing and a full device can refuse storage. Editing still works.
  }
}

export function clearRecipeDraft(key: string) {
  try { localStorage.removeItem(key) } catch { /* storage may be unavailable */ }
}
