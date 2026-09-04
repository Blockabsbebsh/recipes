import { useState } from 'react'

/**
 * A dish type or a cuisine, chosen from what the household already uses, plus
 * the one option a fixed list can never offer: a name that is not on it yet.
 *
 * The importer and the editor both need this. Adding a country used to mean
 * editing `CUISINES` in the source, which is not something you do with a
 * phone in one hand and a pan in the other.
 */
export function CategorySelect({ label, value, options, onChange, onCreate }: {
  label: string
  value: string
  options: string[]
  onChange: (next: string) => void
  onCreate?: (name: string) => Promise<boolean>
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Whatever the recipe already says stays on the list even if the household
  // has since removed it, so opening an old recipe never quietly refiles it.
  const listed = options.includes(value) || !value ? options : [value, ...options]

  async function create() {
    const cleaned = name.trim()
    if (!cleaned || !onCreate) return
    setBusy(true)
    const saved = await onCreate(cleaned)
    setBusy(false)
    if (!saved) return
    onChange(cleaned)
    setName('')
    setCreating(false)
  }

  if (creating) {
    return <div className="field category-new">
      <span className="field-label">{label}</span>
      <div className="category-new-row">
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Naujas pavadinimas" onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void create() }
          if (event.key === 'Escape') { event.preventDefault(); setCreating(false); setName('') }
        }} />
        <button type="button" className="button primary" disabled={!name.trim() || busy} onClick={() => void create()}>Pridėti</button>
        <button type="button" className="text-button" onClick={() => { setCreating(false); setName('') }}>Atšaukti</button>
      </div>
    </div>
  }

  return <label>{label}
    <select value={value} onChange={(event) => {
      if (event.target.value === NEW_OPTION) { setCreating(true); return }
      onChange(event.target.value)
    }}>
      {listed.map((option) => <option key={option}>{option}</option>)}
      {onCreate && <option value={NEW_OPTION}>＋ Nauja…</option>}
    </select>
  </label>
}

const NEW_OPTION = '__new__'
