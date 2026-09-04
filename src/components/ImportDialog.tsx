import { classifyRecipe } from '../lib/categories'
import { findVocabularyMatch, ingredientLookupKey, ingredientNameWithoutQuantity, looksLikePlaceholder, normalizeTitle, parseRecipeList, titleSimilarity } from '../lib/parser'
import type { Recipe, RecipeDraft, VocabularyIngredient } from '../lib/types'
import { CategorySelect } from './CategorySelect'
import { IngredientChips } from './IngredientChips'
import { Modal } from './Modal'
import { useState } from 'react'

/** A parsed recipe plus what the importer wants to say about it. */
type Preview = {
  draft: RecipeDraft
  /** An existing recipe with much the same name, decided once, when parsing. */
  similar: string | null
  /** Near-matches the importer swapped in, as `written → chosen`. */
  swaps: string[]
}

export function ImportDialog({ vocabulary, recipes: allRecipes, categories, cuisines, loading, onClose, onSave, onCreateCategory, onCreateCuisine }: {
  vocabulary: VocabularyIngredient[]
  recipes: Recipe[]
  categories: string[]
  cuisines: string[]
  loading: boolean
  onClose: () => void
  onSave: (drafts: RecipeDraft[]) => void
  onCreateCategory?: (name: string) => Promise<boolean>
  onCreateCuisine?: (name: string) => Promise<boolean>
}) {
  const [raw, setRaw] = useState('')
  const [previews, setPreviews] = useState<Preview[] | null>(null)
  const fallbackCategory = categories.includes('Kita') ? 'Kita' : categories[0] || 'Kita'
  const selectableCategories = categories.length ? categories : [fallbackCategory]

  function review() {
    const names = vocabulary.map((item) => item.name)
    const swapsByName = new Map<string, string>()
    function resolveIngredient(written: string) {
      const cleaned = ingredientNameWithoutQuantity(written)
      const match = findVocabularyMatch(cleaned, names)
      // A near-match is a guess, not a fact. Record what it replaced so the
      // preview can show the swap rather than making it silently.
      if (match && ingredientLookupKey(match) !== ingredientLookupKey(cleaned)) swapsByName.set(match, cleaned)
      return match ?? cleaned
    }
    // The vocabulary tells the parser which unmeasured lines are shopping and
    // which are dishes, which is most of what separates a pasted page from a
    // list of dinners.
    setPreviews(parseRecipeList(raw, { vocabulary: names }).map((parsed) => {
      const ingredients = [...new Map(parsed.ingredients.map((item) => {
        const resolved = resolveIngredient(item)
        return [ingredientLookupKey(resolved), resolved]
      })).values()]
      const detected = classifyRecipe(parsed.title, ingredients)
      const draft: RecipeDraft = {
        ...parsed,
        ingredients,
        // A heading in the paste beats the classifier, and a type the
        // household does not keep is no type at all.
        dishType: categories.includes(parsed.dishType ?? '') ? parsed.dishType
          : categories.includes(detected.dishType) ? detected.dishType : fallbackCategory,
        cuisine: cuisines.includes(detected.cuisine) ? detected.cuisine : cuisines[0] || detected.cuisine,
      }
      const similar = draft.title.trim().length >= 3
        ? allRecipes.find((r) => normalizeTitle(r.title) === normalizeTitle(draft.title))?.title
          ?? allRecipes.filter((r) => titleSimilarity(draft.title, r.title) >= 0.7)
            .sort((a, b) => titleSimilarity(draft.title, b.title) - titleSimilarity(draft.title, a.title))[0]?.title
          ?? null
        : null
      return {
        draft,
        similar,
        swaps: ingredients.filter((name) => swapsByName.has(name)).map((name) => `${swapsByName.get(name)} → ${name}`),
      }
    }))
  }

  function edit(index: number, changes: Partial<RecipeDraft>) {
    setPreviews((current) => (current ?? []).map((preview, position) => (
      position === index ? { ...preview, draft: { ...preview.draft, ...changes } } : preview
    )))
  }

  if (!previews) return (
    <Modal title="Importuoti receptų sąrašą" onClose={onClose}>
      <p className="muted">Tinka abu būdai: po vieną patiekalą eilutėje (produktai skliaustuose arba po brūkšnio) arba visas receptas per kelias eilutes — pavadinimas, po juo „Ingredientai“ ir „Gaminimas“. Sąrašo ženkliukai, numeracija, žymimieji langeliai, porcijos ir laikai pašalinami; antraštės (SRIUBOS, SALOTOS) tampa patiekalo tipu, o nuoroda — recepto šaltiniu.</p>
      <textarea className="import-area" rows={10} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'Pomidorų sriuba\nIngredientai:\n- 500 g pomidorų\n- 1 svogūnas\nGaminimas:\nPakepinti svogūną, suberti pomidorus.'} />
      <p className="fine-print">Kalba nekeičiama. Prieš išsaugodami galėsite pataisyti kiekvieną receptą — įskaitant tipą ir virtuvę.</p>
      <button className="button primary wide" disabled={!raw.trim()} onClick={review}>Peržiūrėti receptus</button>
    </Modal>
  )
  return (
    <Modal title={`Peržiūrėti receptus (${previews.length})`} onClose={onClose} wide>
      <div className="import-preview">
        {previews.map(({ draft, similar, swaps }, index) => {
          // Computed from the chips as they stand, so correcting one clears its
          // flag. A silent import is worse than a noisy one: an ingredient that
          // was guessed at, or is about to become a new vocabulary entry, is
          // exactly what is worth a second's attention before saving.
          const known = new Set(vocabulary.map((item) => ingredientLookupKey(item.name)))
          const stillSwapped = swaps.filter((swap) => draft.ingredients.includes(swap.split(' → ')[1]))
          const placeholders = draft.ingredients.filter(looksLikePlaceholder)
          const fresh = draft.ingredients.filter(
            (name) => !known.has(ingredientLookupKey(name)) && !looksLikePlaceholder(name),
          )
          return <div className="preview-card" key={index}>
          <div className="preview-number">{index + 1}</div>
          <label>Patiekalas<input value={draft.title} onChange={(event) => edit(index, { title: event.target.value })} /></label>
          {similar && <p className="form-notice">Panašus receptas jau yra: <strong>{similar}</strong></p>}
          <div className="field"><span className="field-label">Produktai</span>
            <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => edit(index, { ingredients })} />
          </div>
          <div className="category-grid">
            <CategorySelect label="Patiekalo tipas" value={draft.dishType || fallbackCategory} options={selectableCategories} onChange={(dishType) => edit(index, { dishType })} onCreate={onCreateCategory} />
            <CategorySelect label="Virtuvė" value={draft.cuisine || cuisines[0] || ''} options={cuisines} onChange={(cuisine) => edit(index, { cuisine })} onCreate={onCreateCuisine} />
          </div>
          {draft.notes && <label>Gaminimo žingsniai<textarea rows={3} value={draft.notes} onChange={(event) => edit(index, { notes: event.target.value })} /></label>}
          {stillSwapped.length > 0 && <p className="fine-print">Spėta: {stillSwapped.join(', ')}</p>}
          {placeholders.length > 0 && <p className="form-notice">Neatrodo kaip produktas: {placeholders.join(', ')}</p>}
          {fresh.length > 0 && <p className="fine-print">Nauji produktai: {fresh.join(', ')}</p>}
          <button className="text-button danger-text" onClick={() => setPreviews(previews.filter((_, position) => position !== index))}>Pašalinti</button>
        </div>})}
      </div>
      <div className="button-row sticky-actions"><button className="button secondary" onClick={() => setPreviews(null)}>Atgal</button><button className="button primary" disabled={loading || previews.length === 0 || previews.some(({ draft }) => !draft.title.trim())} onClick={() => onSave(previews.map(({ draft }) => draft))}>{loading ? 'Importuojama…' : `Importuoti (${previews.length})`}</button></div>
    </Modal>
  )
}
