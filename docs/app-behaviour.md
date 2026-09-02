# How the app behaves on a phone

Everything here was learnt from a real device rather than from a scenario, and
most of it cost several wrong theories first. The harness came afterwards, to
keep it learnt: see [`scripts/harness/README.md`](../scripts/harness/README.md).

## Where the code lives

`App.tsx` holds the wiring and the four tab views. Everything with a rule in it
lives somewhere it can be read on its own — and, for the pure parts, tested
without a browser.

| | |
| --- | --- |
| `src/lib/scrollMemory.js` | what a movement of the page was: the household dragging it, the momentum of a flick, or the phone moving the web view |
| `src/lib/viewState.js` | the record kept between visits — tab, per-tab position, expanded recipe — and when a position has gone stale |
| `src/lib/backNav.js` | the stack of things the back button should undo |
| `src/lib/scrollTrace.js` | the on-device log, and the environment it was recorded on |
| `src/lib/readiness.js` | whether the loading screen belongs on screen |
| `src/lib/ingredientMapping.js` | what the four Barbora columns say about an ingredient |
| `src/hooks/useHouseholdData.ts` | the five reads, the realtime subscription, and the coalescing refresh |
| `src/hooks/useRecipeWriting.ts` | saving, importing, deleting and restoring recipes |
| `src/hooks/usePlanning.ts` | the week: basket, shop, cooked, undone |
| `src/hooks/useVocabulary.ts`, `useRecipeCategories.ts` | the household's own lists |
| `src/components/` | the dialogs, and the shared `Modal` every one of them uses |

The `Modal` is worth knowing about: it is where Escape, the keyboard inset and
the back button are handled, so a new dialog gets all three by using it.

## Opening on the right tab

The record of where you were is keyed by user and household, and neither is
known until auth has answered and the household has been fetched. That is
several hundred milliseconds after the app has drawn — so a cold start used to
paint the menu, fill it, and then jump to wherever you actually were.

The tab alone is therefore left under a key that needs no identity,
`recipes:view:last-tab`, written whenever the view state is. Reading it is one
synchronous lookup in the initialiser of the tab state, so the first painted
frame is already the right one; the real record corrects it a moment later in
the rare case they disagree — a different person on a shared device, say.

Only the tab is treated this way. A scroll position painted before the list
exists would be clamped to the top and would have to be restored again anyway,
which is what `restoreScroll` is for.

## Two people at once

The app never blocks on the other person, so both are always working from a
picture of the household that may have stopped being true. Realtime narrows the
window; it does not close it.

Where that matters is the basket. The menu has always refused to draw a recipe
in the bin — `if (!recipe || recipe.deleted_at) return null` — and the basket
did not, so a recipe deleted by one person stayed in the other's basket, its
ingredients stayed on the shopping list, and `complete_shopping` refused to turn
it into a meal without saying so. You would buy for a dinner that could never be
cooked. Reachable alone, too: delete something already in your own basket.

Both halves are needed. Deleting a recipe now clears it out of the basket, so
the state does not linger; and the basket refuses to draw a binned recipe
whatever the state says, which is the only thing that helps when the row was
added by an app that had not heard about the deletion yet.

The database is still the only party that knows the truth — a stale app can
insert a basket row for a recipe already deleted, and nothing stops it. That row
is invisible and harmless, and refusing it belongs in a constraint rather than a
client; noted in [`possible-features.md`](possible-features.md).

## The roster is permanent history

Nothing deletes a `roster_entries` row. "Recently cooked" showing the last five
days is a filter on the way out, not a lifecycle — a meal cooked in August is
still in the table, and the whole log grows by one row per meal for ever.

That is deliberate rather than an oversight. Each recipe's *Gaminta prieš…* date
is computed from the log, so entries older than five days are doing work even
though nothing lists them. Delete them and every recipe in the library reads
*Dar negaminta* from the sixth day.

It costs roughly 70KB a year against a 500MB tier, so it can be left alone
indefinitely. Pruning it is written up in
[`possible-features.md`](possible-features.md), including the reason not to
prune on the write.

`skipped` entries are the exception: they are written and read nowhere at all.

## The back button

On Android the back button is how things get closed, and until now it closed the whole app — mid-recipe, mid-shop, whatever was open. The web has no notion of "close the thing on top"; it has history. So `src/lib/backNav.js` keeps a stack of things a back press should undo and one history entry for each, and every dialog registers itself through the shared `Modal`, nested ones included. Being away from the menu is one more entry, so back comes home before it leaves.

A page inside a dialog counts too. Settings keeps its pages — the invite code, the ingredients, the recipe categories, the scroll log — in one dialog rather than a dialog each, so the stack saw a single layer and back closed the lot from halfway in. The pages register themselves the same way, one entry for being off the menu.

The awkward half is that a dialog can also be dismissed the ordinary way. The entry it pushed has to come off with it, and taking it off means going back programmatically — which fires the same event as a real press, so those are counted and ignored. Registering an entry per tab rather than one for being away broke this in a way worth remembering: going back is asynchronous, so a drop and an add in the same breath let the queued back land after the new push and undo it, and a few taps later the app walked off its own page.

## PWA state restoration

The rules live in modules of their own, and `App.tsx` holds only the wiring between them and the page. `src/lib/viewState.js` is the record itself — what is kept, how it is read back from a storage shared with every other page on the origin, and when a position has gone stale. `src/lib/scrollMemory.js` decides what a movement of the page *was*: the household dragging it, the momentum of a flick they have let go of, or the phone moving the web view on its own. Nothing in the browser distinguishes those three, saving the wrong one loses the place they were reading, and every rule for telling them apart was learnt from a log off a real phone. Both are exercised with plain numbers rather than a browser, so the reasoning can be read and tested without one.


The app persists a small versioned, non-sensitive object in `localStorage`, keyed by user and household:

- active top-level tab;
- scroll position per tab;
- expanded library recipe ID, if still present after data reload;
- no Settings subview, modal, destructive confirmation, secret, or whole Supabase record.

State is saved as it changes and on `pagehide`/`visibilitychange`, then restored only after auth, household, and the first successful data load are ready. Browser scroll restoration is set to manual and scrolling waits for the selected tab to render. A different account or household uses a different key. Unsaved recipe-editor drafts remain separate future work.

A scroll is only recorded when a gesture produced it. iOS shifts the web view as it backgrounds the app — sometimes before it reports the page hidden, and often within a second of the last real scroll — so neither the visibility flag nor a time window separates the two. Contact does: the household's scrolling happens while a touch is down, and carries on coasting after it lifts. Restoring then waits for the page to be tall enough to hold the position rather than scrolling after a fixed number of frames, which silently clamped to the top on a slow connection.

`npm run harness` covers leaving and returning, leaving with a modal open, reopening after eviction, coming back to a page that is briefly too short to hold the position, and a flick still coasting when the app goes away. See [`scripts/harness/README.md`](../scripts/harness/README.md).

### Reading what actually happened on the phone

Restoration used to fail on a real device where the harness passed: the tab came back, the scroll did not. The moment it failed in has no console attached, and iOS frequently reloads the web view before one could be, so the app keeps its own record: the last 150 scroll events — every capture, every write to `localStorage`, every visibility, `pagehide`, `pageshow`, `freeze` and `resume` transition, and the outcome of every restore — under `recipes:scroll-trace:v1`, printed in **Nustatymai → Slinkties žurnalas** with copy and clear.

Every entry carries both `window.scrollY` and `visualViewport.pageTop`, because on iOS the page can report a position it is not showing.

The first trace from the phone ruled out the whole persistence layer: the position was saved correctly on `visibilitychange`, restored correctly on the way back, and then the web view moved to the top on its own a few seconds later, with nothing left to put it back. Restoring now holds: for two seconds after a restore lands, a drift away from the target with no touch behind it is corrected, and a touch since the restore cancels the correction so the app never fights the household. The correction rides the phone's own scroll event rather than a timer, because putting the page back 300ms later is a jump the household can watch happen; timers at 300, 900 and 1800ms stay behind it for a move that arrives without a scroll event.

Three things must never be mistaken for the household's own scrolling, all found on a phone rather than in a scenario. A gesture that was still settling when the app went away is cancelled: Android holds the pending timer while the app is backgrounded and runs it on the way back, after the system has moved the page to the top, and the position it settled on was a zero written over the one about to be restored — which is why the scroll survived one switch and was lost on the next. A touch that moved nothing is a tap, and a tap says nothing about where the page should be. And a correction that clamps because the page came back shorter than it was hands over to the height-aware restore rather than assuming it landed.

Coming back to the app is not a cold start, and for a while it was treated as one. Supabase hands out a new session object each time it revalidates the token, which the phone provokes on every app switch, and the household check was keyed off that object — so stepping out to the shop for two seconds blanked the page to the loading screen and re-queried over the network. The check now keys off the user, and a re-check of a household already in hand never blanks the app (`showsSetupSplash`). That loading screen was also why the position was lost on iOS: a page with nothing on it is 62px tall, so the restore spent its whole budget against a page that could not have held the position, and gave up. It now waits up to eight seconds for the height, stands down if the household scrolls meanwhile, and stops scrolling at a page it cannot reach instead of arguing with it forty times a second.

A flick is followed to where it stops rather than sampled a fixed moment after the finger lifts. The phone caught the difference outright: the position was taken at 572px, the page coasted on to 907px and stayed there for nine seconds, and 572 came back. Momentum decelerates, so a step larger than the flick that started it is the system throwing the page to the top — which arrives in the same window, and is refused on that basis.

A remembered position lasts an hour. Stepping out to Barbora and back should return you to the row you were reading; opening the app the next morning should not, because the list has changed underneath and landing halfway down it reads as a fault. The tab survives either way. Per-tab positions are kept within that hour — switching tabs and coming back is the one case that always worked, and matches what a tab bar does everywhere else.

The log also records what the harness cannot reach: whether the app's own loading screen rendered and for how long, whether the app was left by tapping a shop link or by the app switcher, and which phone the log came from. A `mark` button writes a line the household controls, so they can point at the moment they saw something.

That loading-screen line settled an argument, and against the theory held here at the time. Both iOS and Android *do* paint something of their own over a resuming web app, and the loading screen the household kept seeing was assumed to be that — a stored image of an earlier launch. It was not. A `splash shown=yes` with no `boot` line beside it says the app rendered it, live, on a page that was never reloaded, which is how the real cause was found. The lesson is the general one: a plausible platform explanation is worth exactly as much as the line in the log that confirms it.

The log exists to separate two failures that look identical from the outside: a position already lost before the app went away (a capture site recorded a scroll the household did not make) from a position that survived and was not put back (the restore ran out of frames, or the page was reloaded and the list was still short). The tail after one app switch says which. The reading table is in [`scripts/harness/README.md`](../scripts/harness/README.md); the `scrolltrace` harness scenario keeps the record itself honest, including that it survives the reload.
