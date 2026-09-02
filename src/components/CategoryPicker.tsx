import { trailTo } from '../lib/barboraMapping'
import type { CategoryIndex } from '../lib/barboraMapping'
import { Modal } from './Modal'
import { useEffect, useRef, useState } from 'react'

/**
 * Browsing the shop's hierarchy to pick one category by hand.
 *
 * Every node is choosable, not only the leaves: a household knows when a
 * branch is good enough, and forcing them deeper would be inventing precision.
 * Nothing is written until Gerai.
 */
export function CategoryPicker({ index, ingredientName, initialPath, onCancel, onConfirm }: {
  index: CategoryIndex
  ingredientName: string
  initialPath: string | null
  onCancel: () => void
  onConfirm: (path: string) => void
}) {
  const [node, setNode] = useState<string | null>(initialPath)
  const [selected, setSelected] = useState<string | null>(initialPath)
  const top = useRef<HTMLParagraphElement | null>(null)

  // Moving a level down should start at the top of the new list, not wherever
  // the previous one happened to be scrolled to.
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }) }, [node])

  const children = index.children.get(node) ?? []
  const trail = node === null ? [] : trailTo(index, node)
  const selectedName = selected === null ? null : index.byPath.get(selected)?.name ?? selected

  function open(path: string) {
    setSelected(path)
    if ((index.children.get(path) ?? []).length > 0) setNode(path)
  }

  return <Modal title="Barbora kategorija" onClose={onCancel}>
    <p className="muted" ref={top}>Kur ieškoti „{ingredientName || 'ingrediento'}“ parduotuvėje.</p>
    <nav className="category-crumbs" aria-label="Kategorijų kelias">
      <button type="button" onClick={() => setNode(null)}>Visos</button>
      {trail.map((category) => (
        <button type="button" key={category.path} onClick={() => setNode(category.path)}>
          <span aria-hidden="true">›</span> {category.name}
        </button>
      ))}
    </nav>
    {node !== null && (
      <button type="button" className="button secondary wide" onClick={() => setSelected(node)}>
        Pasirinkti šią kategoriją
      </button>
    )}
    <div className="category-rows">
      {children.length === 0
        ? <p className="muted">Giliau nebeskirstoma.</p>
        : children.map((category) => {
          const deeper = (index.children.get(category.path) ?? []).length
          return <button
            type="button"
            key={category.path}
            className={`category-row ${selected === category.path ? 'is-selected' : ''}`}
            onClick={() => open(category.path)}
          >
            <span>{category.name}</span>
            {deeper > 0 ? <b aria-hidden="true">›</b> : null}
          </button>
        })}
    </div>
    <div className="category-picker-footer">
      <p className="muted">{selectedName ? <>Pasirinkta: <strong>{selectedName}</strong></> : 'Nieko nepasirinkta'}</p>
      <div>
        <button type="button" className="button secondary" onClick={onCancel}>Atšaukti</button>
        <button type="button" className="button primary" disabled={selected === null} onClick={() => selected && onConfirm(selected)}>Gerai</button>
      </div>
    </div>
  </Modal>
}
