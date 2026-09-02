import { cuisineFor, dishTypeFor } from '../lib/categories'
import { normalizeTitle } from '../lib/parser'
import type { Recipe } from '../lib/types'
import { Modal } from './Modal'
import { useState } from 'react'

export function MealPicker({ recipes, queuedIds, onClose, onPick, onNew }: {
  recipes: Recipe[]
  queuedIds: Set<string>
  onClose: () => void
  onPick: (recipe: Recipe) => void
  onNew: () => void
}) {
  const [search, setSearch] = useState('')
  const mealNeedle = normalizeTitle(search)
  const filtered = recipes.filter((recipe) => !mealNeedle || normalizeTitle(`${recipe.title} ${cuisineFor(recipe)} ${dishTypeFor(recipe)}`).includes(mealNeedle))
  return (
    <Modal title="Pridėti patiekalų" onClose={onClose}>
      <div className="picker-actions"><input autoFocus className="search" type="search" placeholder="Rasti receptą" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button secondary" onClick={onNew}>＋ Naujas</button></div>
      <div className="picker-list">{filtered.map((recipe) => <button className="picker-row" key={recipe.id} disabled={queuedIds.has(recipe.id)} onClick={() => onPick(recipe)}><span><strong>{recipe.title}</strong><small>Produktų: {recipe.recipe_ingredients.length}</small></span><span>{queuedIds.has(recipe.id) ? 'Pridėta' : '＋'}</span></button>)}</div>
    </Modal>
  )
}
