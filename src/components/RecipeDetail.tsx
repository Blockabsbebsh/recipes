import { cuisineFor, dishTypeFor } from '../lib/categories'
import type { Recipe } from '../lib/types'
import { BackIcon, ExternalIcon, PencilIcon, TrashIcon } from './icons'
import { Modal } from './Modal'
import { ActionMenu } from './ActionMenu'

/** Product-first reading view, with decisions outside the scrolling content. */
export function RecipeDetail({ recipe, lastCookedLabel, actions, onClose, onEdit, onDelete }: {
  recipe: Recipe
  lastCookedLabel: string
  actions: { label: string; icon?: React.ReactNode; tone?: 'ok' | 'quiet'; onClick: () => void }[]
  onClose: () => void
  onEdit: () => void
  onDelete?: () => void
}) {
  const ingredients = [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position)
  return <Modal title={recipe.title} variant="detail" onClose={onClose}
    header={<><button className="detail-back" onClick={onClose}><BackIcon size={20} /> Atgal</button>
      <ActionMenu label="Recepto veiksmai"><button onClick={onEdit}><PencilIcon size={18} /> Redaguoti</button>
        {onDelete && <button className="danger-text" onClick={onDelete}><TrashIcon size={18} /> Ištrinti</button>}
      </ActionMenu></>}
    footer={<div className="detail-actions">{actions.map(action => <button key={action.label}
      className={`button ${action.tone === 'ok' ? 'primary' : 'secondary'}`} onClick={action.onClick}>
      {action.icon}{action.label}</button>)}</div>}>
    <div className="recipe-detail">
      <div className="recipe-detail-tags"><span>{dishTypeFor(recipe)}</span><span>{cuisineFor(recipe)}</span></div>
      <h2 className="detail-title">{recipe.title}</h2>
      <p className="detail-history">{lastCookedLabel}</p>
      <p className="detail-heading">Produktai <b>{ingredients.length}</b></p>
      {ingredients.length === 0 ? <p className="muted">Produktų nepridėta.</p> :
        <ul className="detail-products">{ingredients.map(ingredient => <li key={ingredient.item}>{ingredient.item}</li>)}</ul>}
      {recipe.notes && <><p className="detail-heading">Pastabos</p><p className="detail-notes">{recipe.notes}</p></>}
      {recipe.source_url && <div className="detail-links"><a href={recipe.source_url} target="_blank" rel="noreferrer">Originalus receptas <ExternalIcon size={16} /></a></div>}
    </div>
  </Modal>
}
