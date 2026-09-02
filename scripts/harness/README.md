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

A finding beginning with `note:` is advisory: reported, but it does not fail the run. Use it for judgement calls rather than regressions.

## Pitfalls, learned the hard way

**Never use Playwright's `locator.click()` for anything scroll-sensitive.** It scrolls the element into view first, which moves the page. That produced three confident, completely false bug reports in one session: "opening Settings loses your scroll" (Playwright scrolled up to reach the button, which sits 1470px above the fold), and twice "editing an ingredient resets the list" (it scrolled the list to reach the row). Use `tap(page, selector, text)` from `probe.mjs`, which dispatches the click inside the page and moves nothing. Reach for `locator.click()` only where scroll position is irrelevant, such as the sign-in form.

**Simulate the iOS keyboard by shrinking `visualViewport`, not the viewport.** iOS leaves `window.innerHeight` alone and shrinks `visualViewport.height`; `page.setViewportSize()` changes both and tests a situation that never happens. `showKeyboard(page)` does it correctly. This distinction is the whole reason the backdrop bug existed and was missed.

**Test the production build, not the dev server.** React StrictMode double-invokes effects in development, which makes mount/cleanup ordering look broken when it is not. `run.mjs` always builds first.

**Confirm a finding with a second, independent measurement before believing it.** If the DOM says an element moved, check whether something in the harness moved it.

## Trusting it

Each scenario has been run against the broken code it is meant to catch, because a check that has never failed proves nothing:

| Scenario | Reverted | Reported |
| --- | --- | --- |
| `keyboard` | the backdrop sized to the visual viewport | `backdrop covers 328px of a 664px screen — 336px of live page shows below it` |
| `appswitch` | the guard on recording scrolls | `switching away and back left the library at 0px instead of 1500px`, and the modal case |
| `modals` | Escape closing the topmost modal | `Escape did not leave 2 modal(s) open` |

Do the same for any scenario you add.

## Adding a scenario

Export an `async function name(page, base)` from `probe.mjs` that returns an array of strings, and add it to `SCENARIOS`. Return `[]` when nothing is wrong. Prefer measuring a specific claim ("the backdrop covers 328px of a 664px screen") over a screenshot; screenshots are for the human reading the report afterwards, via `--shots`.

## Why Playwright is not a dependency

`npm ci` runs on every push to `main` for the Pages deployment, and Playwright would pull a browser toolchain into that build for no reason. It is installed on demand, exactly as the Barbora crawler does it. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points the runner at a Chromium that Playwright did not install itself.
