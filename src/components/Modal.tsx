import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { backNav } from '../lib/backNav'

export function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  // Every dialog in the app is one of these, nested ones included, so this is
  // the one place that has to know the phone's back button closes things.
  const backKey = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const remove = backNav.add(backKey, () => closeRef.current())
    return () => { remove() }
  }, [backKey])
  const backdrop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const backdrops = document.querySelectorAll('.modal-backdrop')
      if (backdrops[backdrops.length - 1] === backdrop.current) onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  useEffect(() => {
    const body = document.body
    const scrollY = window.scrollY
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      right: body.style.right,
      left: body.style.left,
      overflow: body.style.overflow,
    }
    const viewport = window.visualViewport
    // The backdrop must always cover the whole screen — it is the dimmer and
    // the tap-catcher. Only the card has to fit above the keyboard, so the
    // keyboard's height is published separately as padding rather than by
    // shrinking the backdrop, which used to leave the page behind visible and
    // tappable in the gap.
    const syncViewport = () => {
      const element = backdrop.current
      if (!element) return
      const visible = viewport?.height ?? window.innerHeight
      const offsetTop = viewport?.offsetTop ?? 0
      const keyboard = Math.max(0, window.innerHeight - (visible + offsetTop))
      element.style.setProperty('--modal-viewport-height', `${visible}px`)
      element.style.setProperty('--modal-viewport-top', `${offsetTop}px`)
      element.style.setProperty('--modal-keyboard-inset', `${keyboard}px`)
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.right = '0'
    body.style.left = '0'
    body.style.overflow = 'hidden'
    syncViewport()
    window.addEventListener('resize', syncViewport)
    viewport?.addEventListener('resize', syncViewport)
    viewport?.addEventListener('scroll', syncViewport)

    return () => {
      window.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('scroll', syncViewport)
      Object.assign(body.style, previousBodyStyles)
      window.scrollTo(0, scrollY)
    }
  }, [])
  // Rendered into the body rather than in place. A modal opened from inside
  // another one would otherwise be a descendant of that modal's scroll
  // container, so focusing a field in the inner one scrolls the list behind
  // it; and the parent's backdrop-filter makes it the containing block for
  // anything fixed inside, which is not where a modal belongs.
  return createPortal(
    <div ref={backdrop} className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="Uždaryti" onClick={onClose}>×</button></header><div className="modal-body">{children}</div></section></div>,
    document.body,
  )
}
