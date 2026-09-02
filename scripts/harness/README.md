# Phone harness

Runs the real app on an emulated phone against a fake Supabase, and reports layout and navigation faults. It exists because the interesting bugs in this app are not logic bugs — they are about what a thumb can reach when the keyboard is up, and where you end up after switching apps. None of that shows in a unit test.

```bash
npm i --no-save playwright@1.62.1   # deliberately not a dependency; see below
node scripts/harness/run.mjs        # every scenario
node scripts/harness/run.mjs keyboard appswitch
node scripts/harness/run.mjs --shots tmp/shots layout
```

The runner starts the stub, builds the app pointed at it, serves that build, runs the scenarios, and shuts everything down. It exits non-zero if anything regressed. **It never touches the real Supabase project**, so a scenario may delete every recipe without consequence.

## What it is

| File | |
| --- | --- |
| `server.mjs` | A stub Supabase: enough GoTrue and PostgREST to sign in, load, and mutate. In memory, thrown away on exit. |
| `fixtures.mjs` | Generates 65 recipes, the household's real 217-ingredient vocabulary, a roster and a basket. Lithuanian names of realistic length, because layout breaks on long words. |
| `vocab.json` | The ingredient seed. |
| `probe.mjs` | The scenarios and the helpers they share. |
| `run.mjs` | Starts everything, runs scenarios, reports, cleans up. |

The app reaches the stub through `VITE_SUPABASE_URL`, which the runner sets for the build. Nothing is written to `.env.local`.

The catalogue comes from the real `data/barbora-categories.json`, so the category picker is exercised against all 636 rows.

## Scenarios

- **`layout`** — every tab, top and bottom: sideways scroll, elements past the viewport edge, tap-target sizes.
- **`keyboard`** — opens the ingredient editor (a modal inside a modal), raises the keyboard, and checks the backdrop still covers the screen and the buttons are still reachable.
- **`appswitch`** — leaves the app and returns, leaves with a modal open, and reopens after eviction. Each must land back where you were.
- **`modals`** — three modals deep, Escape closes the topmost one at a time.
- **`scrolltrace`** — the on-device scroll trace records the app switch, survives the reload it exists to explain, stays inside its cap, and prints in Settings.

A finding beginning with `note:` is advisory: reported, but it does not fail the run. Use it for judgement calls rather than regressions.

## Pitfalls, learned the hard way

**Never use Playwright's `locator.click()` for anything scroll-sensitive.** It scrolls the element into view first, which moves the page. That produced three confident, completely false bug reports in one session: "opening Settings loses your scroll" (Playwright scrolled up to reach the button, which sits 1470px above the fold), and twice "editing an ingredient resets the list" (it scrolled the list to reach the row). Use `tap(page, selector, text)` from `probe.mjs`, which dispatches the click inside the page and moves nothing. Reach for `locator.click()` only where scroll position is irrelevant, such as the sign-in form.

**Simulate the iOS keyboard by shrinking `visualViewport`, not the viewport.** iOS leaves `window.innerHeight` alone and shrinks `visualViewport.height`; `page.setViewportSize()` changes both and tests a situation that never happens. `showKeyboard(page)` does it correctly. This distinction is the whole reason the backdrop bug existed and was missed.

**Test the production build, not the dev server.** React StrictMode double-invokes effects in development, which makes mount/cleanup ordering look broken when it is not. `run.mjs` always builds first.

**Confirm a finding with a second, independent measurement before believing it.** If the DOM says an element moved, check whether something in the harness moved it.

**Scroll the way a finger does, with `userScroll`.** The app only remembers a scroll that a touch produced, because a scroll with no contact behind it is the system moving the web view — the thing that must not be saved. A bare `window.scrollTo` therefore stands for the *system*, and the two are not interchangeable. `appswitch` relies on the difference: it uses `userScroll` for the household's scrolling and a bare `scrollTo` for iOS shifting the page.

**A green suite means nothing until you re-run it on the merged result.** The `appswitch` scenario was strengthened in review while the fix it tested was written against the weaker version. Both were merged, the combination was never run, and the app shipped with the bug the scenario was already catching. Run the suite against `main` after every merge, not only against your branch.

## Trusting it

Each scenario has been run against the broken code it is meant to catch, because a check that has never failed proves nothing:

| Scenario | Reverted | Reported |
| --- | --- | --- |
| `keyboard` | the backdrop sized to the visual viewport | `backdrop covers 328px of a 664px screen — 336px of live page shows below it` |
| `appswitch` | recording scrolls with no touch behind them | `switching away when the web view moved first left the library at 0px instead of 1500px` |
| `modals` | Escape closing the topmost modal | `Escape did not leave 2 modal(s) open` |
| `scrolltrace` | recording anything at all | `the trace never recorded a "capture" event` |
| `scrolltrace` | keeping the trace in memory instead of localStorage | `the trace never recorded a "boot" event` (nothing survived the reload) |
| `appswitch` | holding the position after the restore reports success | `the web view moving after the app came back left the library at 0px instead of 1500px` |
| `appswitch` | asking whether the household touched the screen before correcting | `scrolling to 300px on the way back in was undone, landing at 1500px` |
| `appswitch` | correcting on the scroll event rather than a timer | `the page sat at the top for 499ms before jumping back` |
| `appswitch` | letting a scroll position go stale | `opening the app the next day landed at 1500px instead of the top` |

Do the same for any scenario you add.

## The scroll trace

The app keeps its last 60 scroll-related events in `localStorage` under
`recipes:scroll-trace:v1`, and prints them in **Nustatymai → Slinkties žurnalas**.
It exists because the one moment that matters — the phone backgrounding the app —
has no console attached, and iOS often reloads the web view before you could
attach one. `src/lib/scrollTrace.js` is the whole of it.

Read the tail after an app switch. It answers one question:

| Tail | Reading |
| --- | --- |
| `write … y=0` before the app went away | the position was lost *before* leaving — some capture site recorded a scroll the household did not make |
| `restore … y=1500 vp=0` | the page believes it is scrolled and the phone is showing the top: `y` and `vp` disagreeing is always the answer on its own |
| `restore … y=1500`, then `scroll-ignored y=0` a second or two later | the phone moved the web view *after* handing the app back; `restore-again` says the correction caught it |
| `write … y=1500`, then `boot nav=reload`, then `restore-gave-up` | the position survived; the restore ran out of frames before the list was tall enough |
| `write … y=1500`, then `boot nav=reload`, then `restore … y=0` | the restore landed and something scrolled back afterwards |
| no `boot nav=reload` at all | iOS resumed the page rather than reloading it, so this is the `visibility` path, not the load path |

Every entry carries `y` (`window.scrollY`) and `vp` (`visualViewport.pageTop`,
or `-1` where the browser will not say). They normally agree; on iOS they need
not, and where they disagree `vp` is what the household is looking at.

`capture-skipped` says a scroll was seen and deliberately not recorded, with
`why=hidden` or `why=modal`. `scroll-ignored` says the page moved with no touch
behind it — that is the system, and seeing a run of them next to a lost position
is the strongest signal there is. `restore-again` says the position was put back
after the phone moved it post-resume; `from=scroll` means the phone's own
scroll event triggered the correction in the same frame, and `from=t300` that a
backstop timer caught a move that arrived without one. `load … kept=false` says
the saved position was older than an hour and the tab started at the top.

Reading the log requires opening Settings, which parks the body at the top and
therefore writes a `capture-skipped … why=modal` of its own. The last two lines
of any trace you read are usually you, opening it.

## Adding a scenario

Export an `async function name(page, base)` from `probe.mjs` that returns an array of strings, and add it to `SCENARIOS`. Return `[]` when nothing is wrong. Prefer measuring a specific claim ("the backdrop covers 328px of a 664px screen") over a screenshot; screenshots are for the human reading the report afterwards, via `--shots`.

## Why Playwright is not a dependency

`npm ci` runs on every push to `main` for the Pages deployment, and Playwright would pull a browser toolchain into that build for no reason. It is installed on demand, exactly as the Barbora crawler does it. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points the runner at a Chromium that Playwright did not install itself.
