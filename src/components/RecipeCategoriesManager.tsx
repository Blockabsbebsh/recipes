import type { HouseholdTag, Recipe } from '../lib/types'
import { useState } from 'react'

/**
 * The household's own list for one of the two classification axes. The same
 * screen serves dish types and cuisines: what differs is the tag prefix, the
 * order the built-in names come in, and what it says at the top.
 */
export function RecipeCategoriesManager({ prefix, preferred, blurb, placeholder, categories, recipes, onCreate, onUpdate, onDelete }: {
  prefix: string
  preferred: readonly string[]
  blurb: string
  placeholder: string
  categories: HouseholdTag[]
  recipes: Recipe[]
  onCreate: (name: string) => Promise<boolean>
  onUpdate: (category: HouseholdTag, name: string) => Promise<boolean>
  onDelete: (category: HouseholdTag) => Promise<void>
}) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const ordered = [...categories].sort((a, b) => {
    const left = a.name.slice(prefix.length)
    const right = b.name.slice(prefix.length)
    const leftIndex = preferred.indexOf(left)
    const rightIndex = preferred.indexOf(right)
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
    return left.localeCompare(right, 'lt')
  })
  const countFor = (category: HouseholdTag) => recipes.filter((recipe) => recipe.recipe_tags.some((link) => link.tag.id === category.id)).length

  return <div className="manager-stack">
    <p className="muted">{blurb}</p>
    <form className="manager-create category-create" onSubmit={(event) => {
      event.preventDefault()
      void onCreate(newName).then((saved) => { if (saved) setNewName('') })
    }}><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={placeholder} /><button className="button primary" disabled={!newName.trim()}>Pridėti</button></form>
    <div className="manager-list">
      {ordered.map((category) => {
        const label = category.name.slice(prefix.length)
        return editing === category.id ? (
          <form className="manager-edit category-edit" key={category.id} onSubmit={(event) => {
            event.preventDefault()
            void onUpdate(category, editName).then((saved) => { if (saved) setEditing(null) })
          }}><input value={editName} onChange={(event) => setEditName(event.target.value)} /><div><button className="button primary" disabled={!editName.trim()}>Išsaugoti</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>Atšaukti</button></div></form>
        ) : (
          <div className="manager-row" key={category.id}><div><strong>{label}</strong><small>Receptų: {countFor(category)}</small></div><button className="text-button" onClick={() => { setEditing(category.id); setEditName(label) }}>Keisti</button><button className="text-button danger-text" onClick={() => void onDelete(category)}>Ištrinti</button></div>
        )
      })}
      {ordered.length === 0 && <p className="muted">Dar nieko nėra.</p>}
    </div>
  </div>
}
