import { ingredientLookupKey, ingredientNameWithoutQuantity, looksLikePlaceholder, normalizeTitle, parseRecipeList, titleSimilarity } from '../lib/parser'
import type { Recipe, RecipeDraft, VocabularyIngredient } from '../lib/types'
import { IngredientChips } from './IngredientChips'
import { Modal } from './Modal'
import { useState } from 'react'

export function ImportDialog({ vocabulary, recipes: allRecipes, loading, onClose, onSave }: { vocabulary: VocabularyIngredient[]; recipes: Recipe[]; loading: boolean; onClose: () => void; onSave: (drafts: RecipeDraft[]) => void }) {
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<RecipeDraft[] | null>(null)
  // What the importer changed on the way in, so the preview can say so. Keyed
  // by the name it settled on, because that is what the chips now show.
  const [guessed, setGuessed] = useState<Map<string, string>>(new Map())
  if (!drafts) return (
    <Modal title="Importuoti receptų sąrašą" onClose={onClose}>
      <p className="muted">Įklijuokite po vieną patiekalą eilutėje. Produktus rašykite skliaustuose arba po brūkšnio, atskirtus kableliais. Sąrašo ženkliukai, numeracija ir žymimieji langeliai pašalinami. Antraštės (SRIUBOS, SALOTOS) tampa patiekalo tipu, o nuoroda — recepto šaltiniu.</p>
      <textarea className="import-area" rows={10} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'SRIUBOS\n• Pomidorų sriuba (pomidorai 2x, svogūnas, morka, sultinys)'} />
      <p className="fine-print">Kalba nekeičiama. Prieš išsaugodami galėsite pataisyti kiekvieną receptą.</p>
      <button className="button primary wide" disabled={!raw.trim()} onClick={() => {
        const vocabularyByKey = new Map(vocabulary.map((item) => [ingredientLookupKey(item.name), item.name]))
        const substitutions = new Map<string, string>()
        function resolveIngredient(raw: string) {
          const key = ingredientLookupKey(raw)
          const exact = vocabularyByKey.get(key)
          if (exact) return exact
          const cleaned = ingredientNameWithoutQuantity(raw)
          const best = vocabulary
            .map((item) => ({ name: item.name, score: titleSimilarity(cleaned, item.name) }))
            .filter((row) => row.score >= 0.65)
            .sort((a, b) => b.score - a.score)[0]
          // A near-match is a guess, not a fact. Record what it replaced so the
          // preview can show the swap rather than making it silently.
          if (best) substitutions.set(best.name, cleaned)
          return best ? best.name : cleaned
        }
        setDrafts(parseRecipeList(raw).map((draft) => ({
          ...draft,
          ingredients: [...new Map(draft.ingredients.map((item) => {
            const resolved = resolveIngredient(item)
            return [ingredientLookupKey(resolved), resolved]
          })).values()],
        })))
        setGuessed(substitutions)
      }}>Peržiūrėti receptus</button>
    </Modal>
  )
  return (
    <Modal title={`Peržiūrėti receptus (${drafts.length})`} onClose={onClose} wide>
      <div className="import-preview">
        {drafts.map((draft, index) => {
          const similar = draft.title.trim().length >= 3
            ? allRecipes.find((r) => normalizeTitle(r.title) === normalizeTitle(draft.title))?.title
              ?? allRecipes.filter((r) => titleSimilarity(draft.title, r.title) >= 0.7).sort((a, b) => titleSimilarity(draft.title, b.title) - titleSimilarity(draft.title, a.title))[0]?.title
              ?? null
            : null
          // Computed from the chips as they stand, so correcting one clears its
          // flag. A silent import is worse than a noisy one: an ingredient that
          // was guessed at, or is about to become a new vocabulary entry, is
          // exactly what is worth a second's attention before saving.
          const known = new Set(vocabulary.map((item) => ingredientLookupKey(item.name)))
          const swaps = draft.ingredients
            .filter((name) => guessed.has(name))
            .map((name) => `${guessed.get(name)} → ${name}`)
          const placeholders = draft.ingredients.filter(looksLikePlaceholder)
          const fresh = draft.ingredients.filter(
            (name) => !known.has(ingredientLookupKey(name)) && !looksLikePlaceholder(name),
          )
          return <div className="preview-card" key={index}>
          <div className="preview-number">{index + 1}</div>
          <label>Patiekalas<input value={draft.title} onChange={(event) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label>
          {similar && <p className="form-notice">Panašus receptas jau yra: <strong>{similar}</strong></p>}
          <div className="field"><span className="field-label">Produktai</span>
            <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, ingredients } : item))} />
          </div>
          {swaps.length > 0 && <p className="fine-print">Spėta: {swaps.join(', ')}</p>}
          {placeholders.length > 0 && <p className="form-notice">Neatrodo kaip produktas: {placeholders.join(', ')}</p>}
          {fresh.length > 0 && <p className="fine-print">Nauji produktai: {fresh.join(', ')}</p>}
          <button className="text-button danger-text" onClick={() => setDrafts(drafts.filter((_, itemIndex) => itemIndex !== index))}>Pašalinti</button>
        </div>})}
      </div>
      <div className="button-row sticky-actions"><button className="button secondary" onClick={() => setDrafts(null)}>Atgal</button><button className="button primary" disabled={loading || drafts.length === 0 || drafts.some((draft) => !draft.title.trim())} onClick={() => onSave(drafts)}>{loading ? 'Importuojama…' : `Importuoti (${drafts.length})`}</button></div>
    </Modal>
  )
}
