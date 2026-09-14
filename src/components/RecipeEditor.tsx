import type { CategoryIndex } from '../lib/barboraMapping'
import { classifyRecipe, cuisineFor, dishTypeFor } from '../lib/categories'
import { CategorySelect } from './CategorySelect'
import { blankDraft, clearRecipeDraft, readRecipeDraft, recipeDraftKey, writeRecipeDraft } from '../lib/drafts'
import { normalizeTitle, titleSimilarity } from '../lib/parser'
import type { IngredientSection, Recipe, RecipeDestination, RecipeDraft, VocabularyIngredient } from '../lib/types'
import { IngredientChips } from './IngredientChips'
import { Modal } from './Modal'
import { useConfirmation } from './Confirmation'
import { useEffect, useMemo, useState } from 'react'

export function RecipeEditor({ householdId, recipe, destination, vocabulary, categories, cuisines, recipes: allRecipes, loading, onClose, onSave, categoryIndex, onCreateIngredient, onCreateCategory, onCreateCuisine }: {
  householdId: string
  recipe?: Recipe
  destination: RecipeDestination
  vocabulary: VocabularyIngredient[]
  categories: string[]
  cuisines: string[]
  recipes: Recipe[]
  loading: boolean
  onClose: () => void
  onSave: (draft: RecipeDraft) => Promise<boolean>
  categoryIndex?: CategoryIndex
  onCreateIngredient?: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onCreateCategory?: (name: string) => Promise<boolean>
  onCreateCuisine?: (name: string) => Promise<boolean>
}) {
  const confirm = useConfirmation()
  const fallbackCategory = categories.includes('Kita') ? 'Kita' : categories[0] || 'Kita'
  const selectableCategories = categories.length ? categories : [fallbackCategory]
  const key = recipeDraftKey(householdId, recipe?.id, destination)
  const [initial] = useState(() => {
    const server: RecipeDraft = recipe ? {
      title: recipe.title,
      ingredients: [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position).map((item) => item.item),
      notes: recipe.notes || '',
      sourceUrl: recipe.source_url || '',
      dishType: categories.includes(dishTypeFor(recipe)) ? dishTypeFor(recipe) : fallbackCategory,
      cuisine: cuisineFor(recipe),
    } : { ...blankDraft(), dishType: fallbackCategory }
    const restored = readRecipeDraft(key, recipe?.updated_at ?? null)
    return { server, draft: restored ?? server, restored: Boolean(restored) }
  })
  const [draft, setDraft] = useState<RecipeDraft>(initial.draft)
  const [categoriesTouched, setCategoriesTouched] = useState(Boolean(recipe || initial.restored))
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.server)

  useEffect(() => {
    if (dirty) writeRecipeDraft(key, recipe?.updated_at ?? null, draft)
    else clearRecipeDraft(key)
  }, [dirty, draft, key, recipe?.updated_at])

  const similarRecipe = useMemo(() => {
    const title = draft.title.trim()
    if (!title || title.length < 3) return null
    const candidates = allRecipes.filter((r) => r.id !== recipe?.id)
    const exact = candidates.find((r) => normalizeTitle(r.title) === normalizeTitle(title))
    if (exact) return exact.title
    const best = candidates
      .map((r) => ({ title: r.title, score: titleSimilarity(title, r.title) }))
      .filter((r) => r.score >= 0.7)
      .sort((a, b) => b.score - a.score)[0]
    return best ? best.title : null
  }, [draft.title, allRecipes, recipe?.id])

  function updateContent(next: Pick<RecipeDraft, 'title' | 'ingredients'>) {
    const detected = categoriesTouched ? null : classifyRecipe(next.title, next.ingredients)
    const classification = detected ? {
      ...detected,
      dishType: categories.includes(detected.dishType) ? detected.dishType : fallbackCategory,
    } : {}
    setDraft((current) => ({ ...current, ...next, ...classification }))
  }

  async function requestClose() {
    if (loading) return
    if (dirty && !await confirm('Atmesti neišsaugotus recepto pakeitimus?')) return
    clearRecipeDraft(key)
    onClose()
  }

  return (
    <Modal title={recipe ? 'Redaguoti receptą' : destination === 'queue' ? 'Naujas patiekalas' : 'Naujas receptas'} onClose={() => void requestClose()}>
      {initial.restored && <p className="form-notice">Atkurtas neišsaugotas juodraštis.</p>}
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault()
        if (loading) return
        void onSave(draft).then((saved) => { if (saved) clearRecipeDraft(key) })
      }}>
        <label>Patiekalo pavadinimas<input autoFocus required value={draft.title} onChange={(event) => updateContent({ title: event.target.value, ingredients: draft.ingredients })} placeholder="Pasta e ceci" /></label>
        {similarRecipe && <p className="form-notice">Panašus receptas jau yra: <strong>{similarRecipe}</strong></p>}
        <div className="field"><span className="field-label">Produktai <span className="optional">po vieną</span></span>
          <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => updateContent({ title: draft.title, ingredients })} categoryIndex={categoryIndex} onCreateIngredient={onCreateIngredient} />
        </div>
        <div className="category-grid">
          <CategorySelect
            label="Patiekalo tipas"
            value={draft.dishType || fallbackCategory}
            options={selectableCategories}
            onChange={(dishType) => { setCategoriesTouched(true); setDraft({ ...draft, dishType }) }}
            onCreate={onCreateCategory}
          />
          <CategorySelect
            label="Virtuvė"
            value={draft.cuisine || cuisines[0] || ''}
            options={cuisines}
            onChange={(cuisine) => { setCategoriesTouched(true); setDraft({ ...draft, cuisine }) }}
            onCreate={onCreateCuisine}
          />
        </div>
        {!categoriesTouched && <p className="category-hint">Kategorijos parenkamos automatiškai pagal pavadinimą ir produktus.</p>}
        <label>Pastabos <span className="optional">nebūtina</span><textarea rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Kas svarbu gaminant…" /></label>
        <label>Šaltinio nuoroda <span className="optional">nebūtina</span><input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://…" /></label>
        <button className="button primary wide" disabled={loading}>{loading ? 'Saugoma…' : recipe ? 'Išsaugoti pakeitimus' : destination === 'queue' ? 'Išsaugoti ir pridėti į krepšelį' : 'Išsaugoti receptą'}</button>
      </form>
    </Modal>
  )
}
