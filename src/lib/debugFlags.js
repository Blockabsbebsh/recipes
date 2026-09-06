// Things that are in the app for one person on one evening.
//
// The scroll log earned its place while the restore was being fought over and
// no console could be attached to the phone it was failing on. That fight is
// won, and a settings menu of five rows where the fifth is a diagnostic is
// four rows of household business and one of ours. The code stays — the next
// scroll fault will want it, and `scripts/harness/README.md` still documents
// how to read one — but it is no longer on the menu.
//
// Turned on by `?debug=1` in the address bar, which also remembers itself, so
// the household can be walked through switching it on over the phone and it
// survives the reloads that follow. `?debug=0` puts it away again.

const KEY = 'recipes:debug:v1'

/** Called once at boot, before anything reads a flag. */
export function readDebugFlagFromUrl(search = window.location.search) {
  const asked = new URLSearchParams(search).get('debug')
  if (asked === null) return
  try {
    if (asked === '0') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, '1')
  } catch { /* private mode; the flag simply does not stick */ }
}

export function debugEnabled() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
