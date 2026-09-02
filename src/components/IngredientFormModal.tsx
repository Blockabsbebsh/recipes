import type { CategoryIndex } from '../lib/barboraMapping'
import { SECTION_LABELS, SECTION_ORDER } from '../lib/sections'
import type { IngredientSection, Recipe, VocabularyIngredient } from '../lib/types'
import { CategoryPicker } from './CategoryPicker'
import { Modal } from './Modal'
import { useMemo, useState } from 'react'

export function IngredientFormModal({ ingredient, categoryIndex, recipes, initialName, onSave, onDelete, onClose }: {
  ingredient?: VocabularyIngredient
  categoryIndex: CategoryIndex
  recipes?: Recipe[]
  initialName?: string
  onSave: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onDelete?: (ingredient: VocabularyIngredient) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(ingredient?.name ?? initialName ?? '')
  const [section, setSection] = useState<IngredientSection>(ingredient?.section ?? 'Other')
  const [path, setPath] = useState<string | null>(ingredient?.barbora_mapping_source === 'manual' ? ingredient.barbora_category_path : null)
  const [directUrl, setDirectUrl] = useState(ingredient?.barbora_direct_url ?? '')
  const [picking, setPicking] = useState(false)
  const hasCatalogue = categoryIndex.byPath.size > 0
  const label = (p: string | null) => (p === null ? null : categoryIndex.byPath.get(p)?.name ?? p)

  const usage = useMemo(() => {
    if (!ingredient || !recipes) return 0
    return recipes.reduce((n, r) => n + (r.recipe_ingredients.some((i) => i.ingredient_id === ingredient.id) ? 1 : 0), 0)
  }, [ingredient, recipes])

  return <>
    <Modal title={ingredient ? 'Redaguoti ingredientą' : 'Naujas ingredientas'} onClose={onClose}>
      <form className="form-stack" onSubmit={(e) => {
        e.preventDefault()
        void onSave(name, section, path, directUrl || null).then((ok) => { if (ok) onClose() })
      }}>
        <label>Pavadinimas<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Skyrius parduotuvėje<select value={section} onChange={(e) => setSection(e.target.value as IngredientSection)}>{SECTION_ORDER.map((s) => <option value={s} key={s}>{SECTION_LABELS[s]}</option>)}</select></label>
        {hasCatalogue && <div className="category-field">
          <button type="button" className="category-field-button" onClick={() => setPicking(true)}>
            <span><strong>Barbora kategorija</strong><small>{label(path) ?? (ingredient ? label(ingredient.barbora_category_path) : null) ?? 'Parenkama automatiškai'}</small></span><b>›</b>
          </button>
          {(path !== null || ingredient?.barbora_mapping_source === 'manual') && <button type="button" className="text-button" onClick={() => setPath(null)}>Atkurti automatinį parinkimą</button>}
        </div>}
        <label>Tiesioginis produkto URL <span className="optional">nebūtina</span><input type="url" value={directUrl} onChange={(e) => setDirectUrl(e.target.value)} placeholder="https://barbora.lt/produktai/..." /></label>
        {ingredient && <p className="muted ingredient-form-meta">Naudojamas receptuose: {usage}</p>}
        <div className="ingredient-form-actions">
          <button className="button primary" disabled={!name.trim()}>{ingredient ? 'Išsaugoti' : 'Pridėti'}</button>
          <button type="button" className="button secondary" onClick={onClose}>Atšaukti</button>
        </div>
        {ingredient && onDelete && <button type="button" className="text-button danger-text ingredient-form-delete" onClick={() => void onDelete(ingredient)}>Ištrinti ingredientą</button>}
      </form>
    </Modal>
    {picking && <CategoryPicker index={categoryIndex} ingredientName={name} initialPath={path} onCancel={() => setPicking(false)} onConfirm={(p) => { setPath(p); setPicking(false) }} />}
  </>
}
