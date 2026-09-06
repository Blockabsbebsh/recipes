import { cuisineFor, dishTypeFor } from '../lib/categories'
import { groupAccent } from '../lib/palette'
import type { Recipe } from '../lib/types'
import { Modal } from './Modal'

/**
 * A recipe, read rather than edited.
 *
 * The library used to open a recipe by growing its tile in place, and the
 * menu never opened one at all — it offered Pagaminta and Praleisti on a card
 * that showed three of its ingredients. Both are this window now, so there is
 * one place that shows everything a recipe has and one place each decision is
 * made, with the whole recipe in front of you rather than a summary of it.
 *
 * It is deliberately the editor's sheet without the fields. This household's
 * recipes carry no quantities and mostly no method, so what there is to show
 * is a list of things to buy, a note, and when it was last cooked — and a
 * form would only dress that up as something it is not.
 *
 * Growing the tile instead would also have fought the scroll restore:
 * `restoreScroll` waits for `document.documentElement.scrollHeight` to reach
 * the saved position, and an expanding tile moves that number for a quarter
 * of a second. A dialog does not change the document's height at all.
 */
export function RecipeDetail({ recipe, lastCookedLabel, actions, onClose, onEdit, onDelete }: {
  recipe: Recipe
  /** Already phrased — "Gaminta vakar", or "Dar negaminta". */
  lastCookedLabel: string
  /**
   * What this recipe can have done to it here, which is not the same in the
   * two places it opens from: a planned meal is cooked or skipped, a library
   * recipe is put in the basket or on the menu.
   */
  actions: { label: string; tone?: 'ok' | 'quiet'; onClick: () => void }[]
  onClose: () => void
  onEdit: () => void
  onDelete?: () => void
}) {
  const ingredients = [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position)
  const accent = groupAccent(dishTypeFor(recipe))
  return (
    <Modal title={recipe.title} onClose={onClose}>
      <div className="recipe-detail" data-accent={accent}>
        <div className="recipe-detail-tags">
          <span className="dish-tag">{dishTypeFor(recipe)}</span>
          <span>{cuisineFor(recipe)}</span>
          <span>{lastCookedLabel}</span>
        </div>

        <p className="detail-heading">Produktai <b>{ingredients.length}</b></p>
        {ingredients.length === 0
          ? <p className="muted">Produktų nepridėta.</p>
          : <ul className="detail-products">
              {ingredients.map((ingredient) => <li key={ingredient.item}>{ingredient.item}</li>)}
            </ul>}

        {recipe.notes && <>
          <p className="detail-heading">Pastabos</p>
          <p className="detail-notes">{recipe.notes}</p>
        </>}

        <div className="detail-links">
          {recipe.source_url && <a href={recipe.source_url} target="_blank" rel="noreferrer">Originalus receptas ↗</a>}
          <button onClick={onEdit}>Redaguoti</button>
          {onDelete && <button className="danger-text" onClick={onDelete}>Ištrinti</button>}
        </div>
      </div>

      {/* Sticky rather than in the flow: the decision has to be reachable
          with a thumb whatever the length of the ingredient list, and a
          twenty-item recipe pushes it off the bottom otherwise. */}
      <div className="detail-actions">
        {actions.map((action) => (
          <button
            key={action.label}
            className={`button ${action.tone === 'ok' ? 'success' : 'secondary'}`}
            onClick={action.onClick}
          >{action.label}</button>
        ))}
      </div>
    </Modal>
  )
}
