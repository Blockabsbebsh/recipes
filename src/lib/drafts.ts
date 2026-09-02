import type { RecipeDraft } from './types'

/** A recipe that has not been written yet. */
export const blankDraft = (): RecipeDraft => ({ title: '', ingredients: [], notes: '', sourceUrl: '', dishType: 'Kita', cuisine: 'Tarptautinė' })
