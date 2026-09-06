// Which accent a group of things wears.
//
// The app used to be one colour — a cream page, cream cards, and orange on
// everything that could be tapped. Colour said "this is interactive" and
// nothing else, so a shopping list of forty items in seven aisles looked the
// same all the way down, and every dish type in the library looked the same
// as every other.
//
// Colour is now a second axis, and this module is the whole of it. Two rules
// it exists to keep:
//
// - **The label always says it too.** A section is never only a colour: the
//   aisle name is written beside it. Colour speeds up a scan for people who
//   can use it and costs nothing to anyone who cannot, which is the only
//   honest way to use it in a shop.
// - **A name keeps its colour.** The accent comes from the name, not from
//   where it happens to sit in a list, so adding a dish type does not repaint
//   the ones already there — and the same recipe is the same colour on both
//   phones.

/** Every accent the stylesheet defines a `--accent-*` triple for. */
export const ACCENTS = ['green', 'amber', 'indigo', 'cyan', 'brown', 'red', 'violet', 'teal']

/**
 * The seven shop sections are a fixed contract (`src/lib/sections.ts`), so
 * they are mapped by hand rather than hashed: the aisle you walk first should
 * be the green one every time, and produce being green is worth more than any
 * rule about how the mapping is derived.
 */
export const SECTION_ACCENTS = {
  Produce: 'green',
  Bakery: 'amber',
  'Dairy & alternatives': 'indigo',
  Frozen: 'cyan',
  Pantry: 'brown',
  Spices: 'red',
  Other: 'slate',
}

export function sectionAccent(section) {
  return SECTION_ACCENTS[section] ?? 'slate'
}

/**
 * The dish types that ship with the app, so the library opens on a spread of
 * colour rather than on whatever a hash happened to choose. Anything a
 * household adds itself is hashed instead.
 */
const DISH_ACCENTS = {
  'Pusryčiai': 'amber',
  'Sriubos': 'red',
  'Troškiniai ir kariai': 'brown',
  'Makaronai': 'indigo',
  'Salotos': 'green',
  'Ryžių ir kruopų patiekalai': 'teal',
  'Bulvių patiekalai': 'amber',
  'Sumuštiniai ir kebabai': 'brown',
  'Užkandžiai': 'cyan',
  'Kepiniai ir picos': 'red',
  'Desertai': 'violet',
  'Kita': 'slate',
}

/**
 * A stable, order-independent accent for a group name.
 *
 * FNV-1a over the code points, so `Pica` lands on the same accent in both
 * kitchens and stays there when the list around it grows. Diacritics are part
 * of the name — `Užkandžiai` is not `Uzkandziai` — because the household types
 * one of them, not both.
 */
export function groupAccent(name) {
  const known = DISH_ACCENTS[name]
  if (known) return known
  let hash = 0x811c9dc5
  for (const character of String(name ?? '')) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return ACCENTS[hash % ACCENTS.length]
}
