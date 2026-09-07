import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { backNav } from '../lib/backNav'
import { MoreIcon } from './icons'

/** A labelled disclosure: normal Tab navigation, Escape/back and outside dismissal. */
export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
    const remove = backNav.add(id, close)
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key, true)
    return () => { remove(); document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key, true) }
  }, [open, id])
  return <div className="action-menu" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <button type="button" ref={trigger} className="icon-button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><MoreIcon /></button>
    {open && <div className="action-menu-panel" id={id} onClick={() => setOpen(false)}>{children}</div>}
  </div>
}
