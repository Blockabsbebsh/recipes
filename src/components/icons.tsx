/**
 * The app's icons, drawn rather than typed.
 *
 * Four of these were already SVG — the ones in the tab bar — and everything
 * else was a character: `＋ × ✓ › ↗ •••`. Those are font glyphs, so their
 * weight, size and vertical alignment come from whatever face the phone
 * happens to be using: the fullwidth plus is a different width on iOS and
 * Android, the check sits on a different baseline, and the ellipsis is three
 * full stops with the font's own spacing between them. Beside a 1.75px stroked
 * bowl they read as a different set of things.
 *
 * One grid and one stroke for all of them, so anything added later has an
 * obvious shape to follow:
 *
 * - a 24×24 viewBox, with the drawing kept inside about 3.5–20.5 so nothing
 *   touches the edge at small sizes;
 * - 1.75 stroke, round caps and joins, no fill — except where a dot *is* the
 *   mark, which is only `More`;
 * - `currentColor`, always, so an icon takes the colour of the text it sits
 *   beside and needs no variant per place it appears;
 * - `size` in CSS pixels, defaulting to 20, which is the inline size. The tab
 *   bar asks for 22, a button inside a chip asks for 16.
 *
 * `aria-hidden` is on every one of them. Each is beside a label or inside a
 * button that carries an `aria-label`; an icon that announced itself as well
 * would be read twice.
 */

type IconProps = { size?: number; strokeWidth?: number }

function svg(size: number, strokeWidth: number, children: React.ReactNode) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >{children}</svg>
  )
}

export function PlusIcon({ size = 20, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, <><path d="M12 5.25v13.5" /><path d="M5.25 12h13.5" /></>)
}

export function CheckIcon({ size = 20, strokeWidth = 2 }: IconProps) {
  return svg(size, strokeWidth, <path d="M5 12.6l4.6 4.6L19 6.8" />)
}

export function CloseIcon({ size = 20, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, <><path d="M6.4 6.4l11.2 11.2" /><path d="M17.6 6.4L6.4 17.6" /></>)
}

export function ChevronIcon({ size = 20, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, <path d="M9.5 5.5L16 12l-6.5 6.5" />)
}

/** The only one that is not a stroke: three dots are dots. */
export function MoreIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5.6" cy="12" r="1.72" /><circle cx="12" cy="12" r="1.72" /><circle cx="18.4" cy="12" r="1.72" />
    </svg>
  )
}

/** Leaving the app — a Barbora aisle, or a recipe's own page. */
export function ExternalIcon({ size = 20, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, <><path d="M9.5 6.2h8.3v8.3" /><path d="M17.8 6.2L6.6 17.4" /></>)
}

export function SearchIcon({ size = 20, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, <><circle cx="10.9" cy="10.9" r="6.4" /><path d="M15.6 15.6l4.2 4.2" /></>)
}

export function PencilIcon({ size = 20, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, <><path d="M4.7 19.3h4.1L19 9a2.05 2.05 0 0 0-2.9-2.9L5.8 16.4v2.9Z" /><path d="M14.8 7.4l2.8 2.8" /></>)
}

export function TrashIcon({ size = 20, strokeWidth = 1.75 }: IconProps) {
  return svg(size, strokeWidth, <>
    <path d="M4.5 6.6h15" />
    <path d="M9.6 6.6V5.1A1.6 1.6 0 0 1 11.2 3.5h1.6a1.6 1.6 0 0 1 1.6 1.6v1.5" />
    <path d="M6.6 6.6l.85 12.05a2 2 0 0 0 2 1.85h5.1a2 2 0 0 0 2-1.85L17.4 6.6" />
  </>)
}

/* The three the tab bar already had, moved here so there is one place to look. */

export function BowlIcon({ size = 22, strokeWidth = 1.75 }: IconProps) {
  return svg(size, strokeWidth, <>
    <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
    <path d="M9.5 8.2c0-1.5 1.5-1.5 1.5-3.2" />
    <path d="M13.5 8.2c0-1.5 1.5-1.5 1.5-3.2" />
  </>)
}

export function BookIcon({ size = 22, strokeWidth = 1.75 }: IconProps) {
  return svg(size, strokeWidth, <>
    <path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2V4.5Z" />
    <path d="M5 17.5a2 2 0 0 1 2-2h11.5" />
  </>)
}

export function BasketIcon({ size = 22, strokeWidth = 1.75 }: IconProps) {
  return svg(size, strokeWidth, <>
    <path d="M4.6 8.5h14.8l-1.2 10.1a2 2 0 0 1-2 1.8H7.8a2 2 0 0 1-2-1.8L4.6 8.5Z" />
    <path d="M9 8.5v-2a3 3 0 0 1 6 0v2" />
  </>)
}
