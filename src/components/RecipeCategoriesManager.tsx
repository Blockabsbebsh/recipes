import { DISH_TAG_PREFIX, DISH_TYPES } from '../lib/categories'
import type { HouseholdTag, Recipe } from '../lib/types'
import { useState } from 'react'

export function RecipeCategoriesManager({ categories, recipes, onCreate, onUpdate, onDelete }: {
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
    const left = a.name.slice(DISH_TAG_PREFIX.length)
    const right = b.name.slice(DISH_TAG_PREFIX.length)
    const leftIndex = DISH_TYPES.indexOf(left)
    const rightIndex = DISH_TYPES.indexOf(right)
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
    return left.localeCompare(right, 'lt')
  })
  const countFor = (category: HouseholdTag) => recipes.filter((recipe) => recipe.recipe_tags.some((link) => link.tag.id === category.id)).length

  return <div className="manager-stack">
    <p className="muted">Šios kategorijos sudaro receptų grupes. Virtuvės, pavyzdžiui, italų ar japonų, lieka atskiromis žymomis.</p>
    <form className="manager-create category-create" onSubmit={(event) => {
      event.preventDefault()
      void onCreate(newName).then((saved) => { if (saved) setNewName('') })
    }}><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nauja kategorija" /><button className="button primary" disabled={!newName.trim()}>Pridėti</button></form>
    <div className="manager-list">
      {ordered.map((category) => {
        const label = category.name.slice(DISH_TAG_PREFIX.length)
        return editing === category.id ? (
          <form className="manager-edit category-edit" key={category.id} onSubmit={(event) => {
            event.preventDefault()
            void onUpdate(category, editName).then((saved) => { if (saved) setEditing(null) })
          }}><input value={editName} onChange={(event) => setEditName(event.target.value)} /><div><button className="button primary" disabled={!editName.trim()}>Išsaugoti</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>Atšaukti</button></div></form>
        ) : (
          <div className="manager-row" key={category.id}><div><strong>{label}</strong><small>Receptų: {countFor(category)}</small></div><button className="text-button" onClick={() => { setEditing(category.id); setEditName(label) }}>Keisti</button><button className="text-button danger-text" onClick={() => void onDelete(category)}>Ištrinti</button></div>
        )
      })}
    </div>
  </div>
}
