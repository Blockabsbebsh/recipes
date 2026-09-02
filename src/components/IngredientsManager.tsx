import type { CategoryIndex } from '../lib/barboraMapping'
import { ingredientLookupKey } from '../lib/parser'
import { SECTION_LABELS } from '../lib/sections'
import type { IngredientSection, Recipe, VocabularyIngredient } from '../lib/types'
import { IngredientFormModal } from './IngredientFormModal'
import { useMemo, useState } from 'react'

export function IngredientsManager({ vocabulary, recipes, categoryIndex, onCreate, onUpdate, onDelete }: {
  vocabulary: VocabularyIngredient[]
  recipes: Recipe[]
  categoryIndex: CategoryIndex
  onCreate: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onUpdate: (ingredient: VocabularyIngredient, name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onDelete: (ingredient: VocabularyIngredient) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<VocabularyIngredient | null>(null)
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    recipes.forEach((r) => r.recipe_ingredients.forEach((i) => counts.set(i.ingredient_id, (counts.get(i.ingredient_id) || 0) + 1)))
    return counts
  }, [recipes])
  const needle = ingredientLookupKey(search)
  const filtered = vocabulary.filter((i) => ingredientLookupKey(i.name).includes(needle))
  const label = (p: string | null) => (p === null ? null : categoryIndex.byPath.get(p)?.name ?? p)

  return <div className="manager-stack">
    <div className="manager-sticky-header">
      <input className="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Ieškoti (${vocabulary.length})`} />
      <button type="button" className="ingredient-add-chip" onClick={() => setCreating(true)}>＋ Pridėti naują ingredientą</button>
    </div>
    <div className="manager-list">
      {filtered.map((ingredient) => (
        <div className="manager-row" key={ingredient.id}>
          <div>
            <strong>{ingredient.name}</strong>
            <small>{SECTION_LABELS[ingredient.section]} · receptų: {usage.get(ingredient.id) || 0}</small>
            {ingredient.barbora_category_path && <small className="category-hint">{label(ingredient.barbora_category_path)}{ingredient.barbora_mapping_source === 'manual' ? ' · pasirinkta' : ''}</small>}
            {ingredient.barbora_direct_url && <small className="category-hint">Tiesioginis URL</small>}
          </div>
          <button className="text-button" onClick={() => setEditing(ingredient)}>Keisti</button>
          <button className="text-button danger-text" onClick={() => void onDelete(ingredient)}>Ištrinti</button>
        </div>
      ))}
    </div>
    {creating && <IngredientFormModal categoryIndex={categoryIndex} onSave={onCreate} onClose={() => setCreating(false)} />}
    {editing && <IngredientFormModal
      ingredient={editing}
      categoryIndex={categoryIndex}
      recipes={recipes}
      onSave={(name, section, path, url) => onUpdate(editing, name, section, path, url)}
      onDelete={onDelete}
      onClose={() => setEditing(null)}
    />}
  </div>
}
