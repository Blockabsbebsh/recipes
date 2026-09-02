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
- **`planning`** — a week run through: into the basket and out, the shop finished, a meal cooked and un-cooked, a recipe deleted and restored.
- **`back`** — the phone's back button closes dialogs innermost-first, steps back out of a page inside a dialog, comes home from another tab, and leaves the app when there is nothing left of ours.
- **`join`** — the only way a second person gets in: a wrong invite code is refused and said so, a right one typed with a space in it works.
- **`scrolltrace`** — the on-device scroll trace records the app switch, survives the reload it exists to explain, stays inside its cap, and prints in Settings.

A finding beginning with `note:` is advisory: reported, but it does not fail the run. Use it for judgement calls rather than regressions.

## Pitfalls, learned the hard way

**Never use Playwright's `locator.click()` for anything scroll-sensitive.** It scrolls the element into view first, which moves the page. That produced three confident, completely false bug reports in one session: "opening Settings loses your scroll" (Playwright scrolled up to reach the button, which sits 1470px above the fold), and twice "editing an ingredient resets the list" (it scrolled the list to reach the row). Use `tap(page, selector, text)` from `probe.mjs`, which dispatches the click inside the page and moves nothing. Reach for `locator.click()` only where scroll position is irrelevant, such as the sign-in form.

**Simulate the iOS keyboard by shrinking `visualViewport`, not the viewport.** iOS leaves `window.innerHeight` alone and shrinks `visualViewport.height`; `page.setViewportSize()` changes both and tests a situation that never happens. `showKeyboard(page)` does it correctly. This distinction is the whole reason the backdrop bug existed and was missed.

**Test the production build, not the dev server.** React StrictMode double-invokes effects in development, which makes mount/cleanup ordering look broken when it is not. `run.mjs` always builds first.

**Never measure a page against `window.innerWidth`.** With
`width=device-width`, a page too wide for the screen makes the browser zoom out
to fit, and `innerWidth` grows with it — so `scrollWidth > innerWidth` compares
a number against itself. Both of `layout`'s real checks were written that way
and had never once been able to fire; a 140vw card passed clean. Measure
against `PHONE.viewport.width`.

**A mutation that changes nothing proves nothing either.** The first attempt to
break `layout` styled a class the app does not render, so the "broken" run was
the same app. Check the mutation took effect before believing the scenario
survived it.

**Chromium clamps a scroll honestly; iOS does not.** Asked to scroll past the
end, Chromium lands at the end and stops. iOS reports the position it was asked
for and then bounces back, so a correction that reads as successful is undone a
frame later — which is how forty corrections fitted into one second on the
phone and none at all here. The loop cannot be reproduced; what the scenario
checks instead is the thing that prevents it, that the app waits for the height
rather than scrolling at a page which cannot reach.

**Some faults only a phone can show you.** The app dropping to its loading
screen on every resume was invisible here, because the stub never makes the
client revalidate its token and it is that revalidation which triggers the
re-check. The phone's log found it; a unit test on `showsSetupSplash` pins it.
When a scenario cannot reach a fault, say so and pin the rule somewhere that
can, rather than writing a check that passes for the wrong reason.

**`history.length` cannot see a spent entry.** Going back keeps the forward
entry, so the count never drops and an assertion on it can never fire. The
observable symptom of a stale entry is a back press that does nothing — so the
check is that back eventually *leaves the app*, which has to be the last thing
a scenario does.

**A finding is worth nothing if a later step throws.** Findings are returned at
the end, so an exception anywhere after one discards it and reports a crashed
scenario instead. Two cases have been bitten: a back loop that kept pressing
after everything of ours had closed (the press after that leaves the app), and
a shop that was checked for switching tabs and then went on tapping things on
the tab it had not switched to. Where a step can fail, carry on from a known
place rather than assuming the step worked.

**Accept dialogs, do not let Playwright dismiss them.** Every destructive step
in this app asks first, and Playwright answers no by default — half of
`planning` would pass while doing nothing. `page.on('dialog', d => d.accept())`.

**Confirm a finding with a second, independent measurement before believing it.** If the DOM says an element moved, check whether something in the harness moved it.

**A synthetic gesture must dispatch its scroll before `touchend`.** A scroll
event does not fire until the next frame, so on a real device it always
arrives while the finger is still down — and the app relies on that to tell a
scroll from a tap. Dispatching `touchend` in the same task as `window.scrollTo`
models a gesture no phone produces, and turned five passing cases red when the
app started asking whether a touch had actually moved anything. `userScroll`
and `scrollAndLeave` wait a frame; anything new must too.

**A synthetic flick must decelerate to a stop, never teleport at the end.**
The first one moved in shrinking steps and then jumped the remaining 290px to
its target — which is a discontinuity, exactly what the app is right to refuse
as the system moving the page, and the case failed on the harness's own
artefact. `fling` decays to rest and returns where it landed; assert against
that, not against a number you chose.

**Scroll to somewhere the page is not.** `userScroll(page, 1500)` on a page
already at 1500px fires no scroll event and no gesture: the case runs, asserts
its target, and proves nothing. One mid-gesture case sat green like that until
a trace dump showed no capture lines in it at all.

**A wrong answer is a case too.** `join_household` answers `null` for a code it
does not know rather than raising, because the attempt has to survive the call
for the rate limit to count it — so the *client* is the only thing that turns
that into a message, and the stub has to answer `null` too. A stub that always
succeeds tests a path the app does not have. `HARNESS_STUB` holds the stub's
URL so a scenario can arrange the backend directly, which is how `join` signs a
member out of their household before starting.

**Kill the process group, not the process.** `npx vite preview` is a wrapper
around the process that actually holds the port, so killing the child leaves
the grandchild listening and the next run fails on a port already in use — or
worse, silently tests the previous build. `run.mjs` spawns each child
`detached` and kills `-pid`. Anything else it starts must do the same.

**`DUMP_TRACE=1` prints the app's own scroll trace** at the end of `appswitch`,
which is the fastest way to find out why a scenario disagrees with a phone.

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
| `scrolltrace` | the loading screen recording that it appeared | `the loading screen did not record that it appeared` |
| `layout` | measuring against the screen rather than the zoomed viewport | `page scrolls sideways: 566px of content in 390px` |
| `planning` | reloading after an undo | `undoing left 10 meals, not 11` |
| `planning` | going to the menu when a shop is finished | `finishing the shop left the app on "Krepšelis"` |
| `back` | taking a dialog's history entry with it when it is closed by hand | `with nothing open, back stayed in the app instead of leaving it` |
| `back` | counting a page inside a dialog as somewhere to come back from | `back from a settings page closed the whole dialog` |
| `join` | turning the `null` a wrong code answers with into a message | `a wrong invite code was accepted in silence` |
| `back` | ignoring the pop our own going-back causes | `Escape did not leave 2 modal(s) open` (in `modals`, which shares the mechanism) |
| `appswitch` | waiting longer than a second for the page to grow back | `a page that came back short for three seconds landed at 0px instead of 1500px` |
| `appswitch` | waiting for the height instead of scrolling at a page that cannot reach | `the app kept scrolling at a page too short to hold the position instead of waiting for it to grow` |
| `appswitch` | following a flick to where it stops, rather than snapshotting 400ms after the lift | `a flick that came to rest at 1294px saved 1203px` |
| `appswitch` | telling momentum apart from the page being thrown to the top | `the page jumping to the top just after a flick saved 0px instead of about 1500px` |
| `appswitch` | holding the position after the restore reports success | `the web view moving after the app came back left the library at 0px instead of 1500px` |
| `appswitch` | asking whether the household touched the screen before correcting | `scrolling to 300px on the way back in was undone, landing at 1500px` |
| `appswitch` | correcting on the scroll event rather than a timer | `the page sat at the top for 499ms before jumping back` |
| `appswitch` | letting a scroll position go stale | `opening the app the next day landed at 1500px instead of the top` |
| `appswitch` | cancelling a settling gesture when the app goes away | `the switch after a mid-gesture one saved 0px instead of 1500px` |
| `appswitch` | treating a tap as a scroll | `a tap on the way back in saved 0px instead of 1500px` |
| `appswitch` | waiting for the height when a correction clamps | `a page that came back short for two seconds landed at 0px instead of 1500px` |

Do the same for any scenario you add.

## The scroll trace

The app keeps its last 150 scroll-related events in `localStorage` under
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

## Reading a log from a phone

Some things cannot be tested from here at all: what the platform paints over a
resuming app, whether a link to another app kills the process, how any of it
feels. For those, the household runs the sequence and sends the log —
**Nustatymai → Slinkties žurnalas → Kopijuoti**. **Pažymėti** writes a `mark`
line, so they can point at the moment they saw something.

The lines that answer questions the harness cannot:

| Line | |
| --- | --- |
| `boot nav=… os=ios mode=installed` | the app started from nothing. No `boot` after an app switch means it was never reloaded, whatever the screen showed. |
| `splash shown=yes` / `splash shown=gone ms=…` | the app's own loading screen rendered, and for how long. A loading screen with no `splash` line beside it is the platform painting over a resuming app, not this app — the one time it mattered, the line was there and the app was rendering it. |
| `restore-waiting` | the page was too short to hold the position, so the app stopped scrolling at it and waited for the height. |
| `restore-abandoned` | the household scrolled while a restore was still waiting, so it stood down. |
| `capture from=coast` | a flick's momentum, still being followed. The `settle` after it is where the page came to rest. |
| `leave-by-link to=/…` | the app was left by tapping through to the shop, rather than by the app switcher. Whether a `boot` follows says if that killed it. |
| `mark note=pastebėta` | the household saw something here. |

## Adding a scenario

Export an `async function name(page, base)` from `probe.mjs` that returns an array of strings, and add it to `SCENARIOS`. Return `[]` when nothing is wrong. Prefer measuring a specific claim ("the backdrop covers 328px of a 664px screen") over a screenshot; screenshots are for the human reading the report afterwards, via `--shots`.

## Why Playwright is not a dependency

`npm ci` runs on every push to `main` for the Pages deployment, and Playwright would pull a browser toolchain into that build for no reason. It is installed on demand, exactly as the Barbora crawler does it. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points the runner at a Chromium that Playwright did not install itself.
