import type { CategoryIndex } from '../lib/barboraMapping'
import { findVocabularyMatch, ingredientLookupKey, ingredientNameWithoutQuantity, titleSimilarity } from '../lib/parser'
import { SECTION_LABELS } from '../lib/sections'
import type { IngredientSection, VocabularyIngredient } from '../lib/types'
import { IngredientFormModal } from './IngredientFormModal'
import { useMemo, useState } from 'react'

/**
 * Shared ingredient editor. Typing filters the household vocabulary, first on
 * plain substring matches and then on the same bigram similarity the importer
 * uses, so "svogun" still reaches "Svogūnai" despite the declension.
 *
 * Nothing in the list is chosen for you. It used to be: the first suggestion
 * was highlighted from the moment it appeared, so on a phone — where there are
 * no arrow keys and Enter is the only key on the row — every new ingredient
 * became whichever old one happened to look nearest, and the hint underneath
 * promising otherwise was simply wrong. Enter now adds what was typed, a
 * suggestion is taken by touching it, and creating an entry has a row of its
 * own that a thumb can reach.
 */
export function IngredientChips({ value, vocabulary, onChange, categoryIndex, onCreateIngredient }: {
  value: string[]
  vocabulary: VocabularyIngredient[]
  onChange: (next: string[]) => void
  categoryIndex?: CategoryIndex
  onCreateIngredient?: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
}) {
  const [entry, setEntry] = useState('')
  // -1 is "nothing chosen", which is where it stays unless the arrow keys are
  // used. A phone never leaves it.
  const [highlight, setHighlight] = useState(-1)
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

  function add(name: string, { asWritten = false } = {}) {
    const cleaned = ingredientNameWithoutQuantity(name)
    setEntry('')
    setHighlight(-1)
    if (!cleaned || taken.has(ingredientLookupKey(cleaned))) return
    // A vocabulary entry picked from the list is itself. Typed text is matched
    // against the vocabulary word for word, so `avinžirnių miltai` reaches
    // `Avinžirnių miltai` and never `Avinžirniai`.
    const existing = asWritten ? null : findVocabularyMatch(cleaned, vocabulary.map((item) => item.name))
    if (existing) {
      onChange([...value, existing])
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
      const chosen = highlight >= 0 ? suggestions[highlight] : null
      if (chosen) add(chosen.name, { asWritten: true })
      else add(entry)
      return
    }
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setHighlight((current) => (current + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setHighlight((current) => (current <= 0 ? suggestions.length : current) - 1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setEntry('')
      setHighlight(-1)
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
              onChange={(event) => { setEntry(event.target.value); setHighlight(-1) }}
              onKeyDown={onKeyDown}
              onBlur={() => { if (!entry.trim()) setAdding(false) }}
              enterKeyHint="done"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Pradėkite rašyti…"
              aria-label="Pridėti produktą"
            />
            {(suggestions.length > 0 || entry.trim()) && (
              <ul className="chip-suggestions">
                {entry.trim() && !exactMatch && (
                  <li key="__new__">
                    <button
                      type="button"
                      className={`chip-create${highlight < 0 ? ' active' : ''}`}
                      onMouseDown={(event) => { event.preventDefault(); add(entry, { asWritten: true }) }}
                    >
                      <strong>＋ {ingredientNameWithoutQuantity(entry.trim()) || entry.trim()}</strong><span>naujas produktas</span>
                    </button>
                  </li>
                )}
                {suggestions.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={index === highlight ? 'active' : ''}
                      onMouseDown={(event) => { event.preventDefault(); add(item.name, { asWritten: true }) }}
                    >
                      <strong>{item.name}</strong><span>{SECTION_LABELS[item.section]}</span>
                    </button>
                  </li>
                ))}
              </ul>
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
