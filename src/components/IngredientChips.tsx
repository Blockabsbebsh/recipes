import type { CategoryIndex } from '../lib/barboraMapping'
import { ingredientLookupKey, ingredientNameWithoutQuantity, titleSimilarity } from '../lib/parser'
import { SECTION_LABELS } from '../lib/sections'
import type { IngredientSection, VocabularyIngredient } from '../lib/types'
import { IngredientFormModal } from './IngredientFormModal'
import { useMemo, useState } from 'react'

/**
 * Shared ingredient editor. Typing filters the household vocabulary, first on
 * plain substring matches and then on the same bigram similarity the importer
 * uses, so "svogun" still reaches "Svogūnai" despite the declension. Anything
 * unrecognised is kept as typed; the database links or creates the vocabulary
 * entry when the recipe is saved.
 */
export function IngredientChips({ value, vocabulary, onChange, categoryIndex, onCreateIngredient }: {
  value: string[]
  vocabulary: VocabularyIngredient[]
  onChange: (next: string[]) => void
  categoryIndex?: CategoryIndex
  onCreateIngredient?: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
}) {
  const [entry, setEntry] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [adding, setAdding] = useState(false)
  const [pendingNew, setPendingNew] = useState<string | null>(null)
  const taken = useMemo(() => new Set(value.map(ingredientLookupKey)), [value])

  const suggestions = useMemo(() => {
    const query = entry.trim()
    if (!query) return []
    const needle = ingredientLookupKey(query)
    return vocabulary
      .filter((item) => !taken.has(ingredientLookupKey(item.name)))
      .map((item) => {
        const name = ingredientLookupKey(item.name)
        const score = name.startsWith(needle) ? 1 : name.includes(needle) ? 0.9 : titleSimilarity(query, item.name)
        return { item, score }
      })
      .filter((row) => row.score >= 0.45)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'lt'))
      .slice(0, 6)
      .map((row) => row.item)
  }, [entry, vocabulary, taken])

  const exactMatch = suggestions.some((item) => ingredientLookupKey(item.name) === ingredientLookupKey(entry))

  function add(name: string) {
    const cleaned = ingredientNameWithoutQuantity(name)
    setEntry('')
    setHighlight(0)
    if (!cleaned || taken.has(ingredientLookupKey(cleaned))) return
    const key = ingredientLookupKey(cleaned)
    const exactVocab = vocabulary.find((item) => ingredientLookupKey(item.name) === key)
    if (exactVocab) {
      onChange([...value, exactVocab.name])
      return
    }
    const fuzzyMatch = vocabulary
      .filter((item) => !taken.has(ingredientLookupKey(item.name)))
      .map((item) => ({ item, score: titleSimilarity(cleaned, item.name) }))
      .filter((row) => row.score >= 0.65)
      .sort((a, b) => b.score - a.score)[0]
    if (fuzzyMatch) {
      onChange([...value, fuzzyMatch.item.name])
      return
    }
    if (categoryIndex && onCreateIngredient) {
      setPendingNew(cleaned)
      return
    }
    onChange([...value, cleaned])
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      add(suggestions[highlight] ? suggestions[highlight].name : entry)
      return
    }
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setHighlight((current) => (current + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setHighlight((current) => (current - 1 + suggestions.length) % suggestions.length)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setEntry('')
      setAdding(false)
      return
    }
    if (event.key === 'Backspace' && !entry && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <>
    <div className="chip-field">
      <div className="chip-row">
        {value.map((item, index) => (
          <span className="chip" key={`${item}-${index}`}>
            {item}
            <button type="button" aria-label={`Pašalinti „${item}"`} onClick={() => onChange(value.filter((_, i) => i !== index))}>×</button>
          </span>
        ))}
        {adding ? (
          <div className="chip-input">
            <input
              autoFocus
              value={entry}
              onChange={(event) => { setEntry(event.target.value); setHighlight(0) }}
              onKeyDown={onKeyDown}
              onBlur={() => { if (!entry.trim()) setAdding(false) }}
              placeholder="Pradėkite rašyti…"
              aria-label="Pridėti produktą"
            />
            {suggestions.length > 0 && (
              <ul className="chip-suggestions">
                {suggestions.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={index === highlight ? 'active' : ''}
                      onMouseDown={(event) => { event.preventDefault(); add(item.name) }}
                    >
                      <strong>{item.name}</strong><span>{SECTION_LABELS[item.section]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {entry.trim() && !exactMatch && (
              <p className="chip-hint">„Enter" pridės <strong>{entry.trim()}</strong> kaip naują produktą</p>
            )}
          </div>
        ) : (
          <button type="button" className="chip-add" onClick={() => setAdding(true)}>＋ Pridėti</button>
        )}
      </div>
      {value.length === 0 && !adding && <p className="chip-empty">Produktų dar nėra.</p>}
    </div>
    {pendingNew && categoryIndex && onCreateIngredient && (
      <IngredientFormModal
        categoryIndex={categoryIndex}
        initialName={pendingNew}
        onSave={async (name, section, manualPath, directUrl) => {
          const saved = await onCreateIngredient(name, section, manualPath, directUrl)
          if (saved) {
            const chipName = ingredientNameWithoutQuantity(name) || name
            onChange([...value, chipName])
            setPendingNew(null)
            setAdding(false)
          }
          return saved
        }}
        onClose={() => setPendingNew(null)}
      />
    )}
    </>
  )
}
