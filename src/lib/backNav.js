/**
 * What the phone's back button should undo.
 *
 * On Android the back button is how you close things, and until now it closed
 * the whole app — mid-recipe, mid-shop, whatever was open. The web has no
 * notion of "close the thing on top"; all it has is history. So the app keeps
 * a stack of things that can be undone and one history entry per item on it,
 * and reads a back press as "undo the most recent".
 *
 * The awkward part is that a layer can also be dismissed the ordinary way, by
 * a tap on × or Escape. The entry it pushed has to come off too, or the next
 * back press does nothing visible. Taking it off means going back
 * programmatically, which fires the same event as a real press — so those are
 * counted and ignored, which is the whole reason this is a stack with a memory
 * rather than a listener.
 */
export function createBackNav({ pushEntry, goBack }) {
  const undoable = []
  let pushed = 0
  let ignoring = 0

  return {
    /**
     * Something opened that back should close. Answers a function that says
     * it was closed some other way.
     */
    add(key, undo) {
      undoable.push({ key, undo })
      pushEntry()
      pushed += 1
      return () => this.drop(key)
    },

    /** Closed by a tap rather than by back: take its history entry with it. */
    drop(key) {
      const at = undoable.findIndex((layer) => layer.key === key)
      // Not here means back has already dealt with it, and going back again
      // would take the household somewhere they did not ask to go.
      if (at === -1) return false
      undoable.splice(at, 1)
      if (pushed > 0) {
        pushed -= 1
        ignoring += 1
        goBack()
      }
      return true
    },

    /**
     * A back press. Answers whether it was ours to handle; false means there
     * was nothing left to undo, and leaving the app is the right answer.
     */
    onPop() {
      if (ignoring > 0) {
        ignoring -= 1
        return true
      }
      const layer = undoable.pop()
      if (!layer) return false
      if (pushed > 0) pushed -= 1
      layer.undo()
      return true
    },

    get depth() {
      return undoable.length
    },
  }
}

/** The app's one stack, wired to the browser's history. */
export const backNav = createBackNav({
  pushEntry: () => window.history.pushState({ backNav: true }, ''),
  goBack: () => window.history.back(),
})
