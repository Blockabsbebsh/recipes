import { ingredientLookupKey, ingredientNameWithoutQuantity, normalizeTitle, parseRecipeList, titleSimilarity } from '../lib/parser'
import type { Recipe, RecipeDraft, VocabularyIngredient } from '../lib/types'
import { IngredientChips } from './IngredientChips'
import { Modal } from './Modal'
import { useState } from 'react'

export function ImportDialog({ vocabulary, recipes: allRecipes, loading, onClose, onSave }: { vocabulary: VocabularyIngredient[]; recipes: Recipe[]; loading: boolean; onClose: () => void; onSave: (drafts: RecipeDraft[]) => void }) {
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<RecipeDraft[] | null>(null)
  if (!drafts) return (
    <Modal title="Importuoti receptų sąrašą" onClose={onClose}>
      <p className="muted">Įklijuokite po vieną patiekalą eilutėje. Brūkšnys atskiria pavadinimą nuo kableliais išvardytų produktų. Žymimieji langeliai ir numeracija bus pašalinti.</p>
      <textarea className="import-area" rows={10} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="[ ] 1. Pasta e ceci — makaronai, avinžirniai, pomidorai" />
      <p className="fine-print">Kalba nekeičiama. Prieš išsaugodami galėsite pataisyti kiekvieną receptą.</p>
      <button className="button primary wide" disabled={!raw.trim()} onClick={() => {
        const vocabularyByKey = new Map(vocabulary.map((item) => [ingredientLookupKey(item.name), item.name]))
        function resolveIngredient(raw: string) {
          const key = ingredientLookupKey(raw)
          const exact = vocabularyByKey.get(key)
          if (exact) return exact
          const cleaned = ingredientNameWithoutQuantity(raw)
          const best = vocabulary
            .map((item) => ({ name: item.name, score: titleSimilarity(cleaned, item.name) }))
            .filter((row) => row.score >= 0.65)
            .sort((a, b) => b.score - a.score)[0]
          return best ? best.name : cleaned
        }
        setDrafts(parseRecipeList(raw).map((draft) => ({
          ...draft,
          ingredients: [...new Map(draft.ingredients.map((item) => {
            const resolved = resolveIngredient(item)
            return [ingredientLookupKey(resolved), resolved]
          })).values()],
        })))
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
          return <div className="preview-card" key={index}>
          <div className="preview-number">{index + 1}</div>
          <label>Patiekalas<input value={draft.title} onChange={(event) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label>
          {similar && <p className="form-notice">Panašus receptas jau yra: <strong>{similar}</strong></p>}
          <div className="field"><span className="field-label">Produktai</span>
            <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, ingredients } : item))} />
          </div>
          <button className="text-button danger-text" onClick={() => setDrafts(drafts.filter((_, itemIndex) => itemIndex !== index))}>Pašalinti</button>
        </div>})}
      </div>
      <div className="button-row sticky-actions"><button className="button secondary" onClick={() => setDrafts(null)}>Atgal</button><button className="button primary" disabled={loading || drafts.length === 0 || drafts.some((draft) => !draft.title.trim())} onClick={() => onSave(drafts)}>{loading ? 'Importuojama…' : `Importuoti (${drafts.length})`}</button></div>
    </Modal>
  )
}
