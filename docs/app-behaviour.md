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
| `src/lib/readiness.js` | whether the loading screen belongs on screen, and whether the household check failed or merely came back empty |
| `src/lib/ingredientMapping.js` | what the four Barbora columns say about an ingredient |
| `src/lib/palette.js` | which accent an aisle or a dish type wears, and why a name keeps it |
| `src/lib/debugFlags.js` | the things that are in the app for us rather than for the household |
| `src/lib/shoppingTicks.js` | what is already in the trolley, and why it is not in the database |
| `src/lib/library.js` | what the library shows and in what order, as plain objects |
| `src/hooks/useHouseholdData.ts` | the five reads, the realtime subscription, and the coalescing refresh |
| `src/hooks/useRecipeWriting.ts` | saving, importing, deleting and restoring recipes |
| `src/hooks/usePlanning.ts` | the week: basket, shop, cooked, undone |
| `src/hooks/useVocabulary.ts`, `useRecipeCategories.ts` | the household's own lists — ingredients, dish types, cuisines |
| `src/lib/parser.js` | what a pasted list or page says: where one recipe ends, which lines are ingredients, and whether two written ingredients are the same thing |
| `src/components/` | the dialogs, and the shared `Modal` every one of them uses |

The `Modal` is worth knowing about: it is where Escape, the keyboard inset and
the back button are handled, so a new dialog gets all three by using it.

## Reading a pasted recipe

The importer began as one recipe per line, because that is what the list it was
written for looked like: `Enchiladas — tortilijos, pupelės, sūris`. Anything
else — a page copied out of a browser, a recipe typed into a notes app over a
week — is written the other way round, with the title on one line and its
ingredients under it, and every one of those ingredients used to become a
recipe of its own. The bulleted-list heuristic made it worse rather than
better: bulleted lines outnumbered plain ones, so the *title* was read as a
section heading and thrown away.

Both shapes now go through the same walk over the lines, and the parser reads
a block only where the paste gives it a reason to:

- **A heading says so.** `Ingredientai:` starts the ingredients, `Gaminimas:`
  starts the method, and everything after the second one is notes until
  something announces a new recipe. `Porcijos: 4` and `Gaminimo laikas` belong
  to neither and are dropped.
- **A number says so.** Two consecutive lines that measure something —
  `200 g miltų`, `1 svogūnas` — are an ingredient list. One is not: `3 sūrių
  pica` is a dish. A number is the only signal trusted without a heading,
  because `Kopūstų lapai` is a dish and `lapai` is in the unit list.
- **The household's own vocabulary says so.** Lines that are all things this
  kitchen already buys are ingredients. This is what separates `• bulvės` from
  `• Cepelinai` without either carrying a quantity, and it is why the importer
  hands the vocabulary to the parser rather than only using it afterwards.

Where none of that holds, the paste is still read a dish to a line, exactly as
before. Both readings are wrong sometimes; the preview is where that gets
fixed, which is also where the dish type and the cuisine are now chosen rather
than merely being announced.

### Which vocabulary entry an ingredient means

`avinžirnių miltai` used to be imported as `avinžirniai`. The two score 0.7
against each other on bigrams — they share every letter of the shorter one —
and 0.65 was the threshold. Chickpea flour is not chickpeas, and the shopping
list said to buy the wrong bag.

A near-match now has to account for every word on both sides: the same number
of significant words, each one close to its counterpart, on the stems the
lookup key already produces. `kokoso pienas` still reaches `Kokosų pienas`;
`avinžirnių miltai` reaches nothing and becomes its own entry. That is the
mistake that costs a tap, rather than the one that hides an ingredient — and
the same rule now governs the chip editor, where the substitution used to
happen silently as you typed.

## What a whole import costs

Importing called `saveRecipe` in a loop. Each pass read the vocabulary, read
the tags, wrote its rows and then reloaded the entire household before the next
recipe started — six round trips each, over whatever a phone had. Twenty
recipes was a minute of a dialog that would not close, and the preview behind
it kept re-deciding which recipes looked familiar as the earlier ones landed,
so recipes still on screen began announcing that a similar recipe already
existed. They were describing themselves.

Three things fixed it, in `saveImported`:

- The dialog closes first. Everything has been decided by then; keeping it up
  only gives it something to say.
- Recipe ids are made in the browser rather than read back from the insert,
  which is what allows every recipe, every ingredient link and every tag to go
  in one statement each instead of one per recipe.
- The household is reloaded once, at the end.

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

## When the backend cannot be reached

The household check has two failure modes that look identical once it has
finished: the household genuinely does not exist, and we could not find out.
Both leave the app holding `null`.

Treating them the same was a real fault. With the network down the membership
read fails, the check finishes empty, and two people who had been cooking from
this app for months were shown `Sukurkite savo virtuvę` — an invitation to
create a household on top of the one they already have. Accepting it would
have left them with two memberships and the app choosing between them by
whichever row came back first.

So the app tracks whether the check *failed* as well as what it *found*, and
`showsUnreachable` in `src/lib/readiness.js` holds the rule: only a check that
completed and genuinely found nothing may offer the setup screen. A failed one
gets a screen that says the recipes are still there, prints the technical error
in small type — `TypeError: Failed to fetch` is meaningless to the household
but is the difference between no signal and a real fault when it gets read out
to me — and offers to try again.

Nothing is shown for the first seven seconds, and that is correct: supabase-js
retries a failed GET three times, a second apart and doubling. The loading
screen during that is the client being patient, not the app being stuck.

A failure never displaces a household already on screen. The check runs again
whenever the user changes, and a flaky connection is not news that the recipes
are gone.

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

## Colour

The app was cream on cream: a `#f7f2e8` page, `#fffdf8` cards, and four
percent between them — which at arm's length in a kitchen is nothing, so a
card did not read as a card. Orange was the only other colour and it was on
everything that could be tapped, which meant it told you nothing about which
of two things to tap. The primary button and the import link beside it were
the same colour, and on a recipe tile the cuisine was set in bold orange
beside a black dish name, so the aside won.

What is there now is three things, and `src/styles.css` begins with all of
them:

- **A quiet neutral shell.** A cool grey canvas with white cards on it. The
  point is not the grey; it is that white is now available to mean "this is a
  surface", and black text has something to be black against.
- **One brand colour, spent deliberately.** The primary button, the brand
  mark, the active tab, the basket badge. Secondary actions are grey, which
  is the whole reason the primary one is visible.
- **Accents that mean something.** Seven shop aisles and every dish type
  carry a colour, from `src/lib/palette.js`. The aisle is still written out
  in words beside its colour — the colour halves the time it takes to find
  where the frozen things start, and costs nothing to anyone who cannot see
  it. A recipe card takes the same colour as a wash across the whole card,
  which is what makes a soup and a pudding different objects at a glance
  without drawing anything new.

The first version of this ran a coloured rail down the side of every aisle
and every library group as well. It said what the coloured heading already
said, and a hard vertical edge beside a column of soft cards is the loudest
mark on the screen for the least information. The tint replaced it.

Two rules hold the rest together. Every ink clears 4.5:1 on the surface it is
written on, in both themes; the old orange-on-white text button was at 2.6.
And no rule outside the token block at the top of the stylesheet names a
colour, which is what makes the dark theme thirty lines rather than a second
stylesheet — and what keeps the two themes from drifting apart in layout.

Dark is by `prefers-color-scheme` only. There is no in-app switch, because
the phone already has one and a second one is a setting to get wrong.

## The dish names are set in the system font

For a long time the stylesheet asked for DM Serif Display and nothing loaded
it — no `@font-face`, no link — so every phone drew whatever serif it had, and
Android's is not Georgia. Three candidates were set on the same recipe card
and compared side by side: a downloaded serif, a downloaded grotesk, and the
system font at a heavier weight. The system font won, and not by default: it
already draws `ąčęėįšųūž` correctly on both phones, it costs nothing to
fetch, and at 660 with -.021em of tracking it has more presence than the
serif it replaces.

`--title-weight` and `--title-tracking` are the whole treatment. Adding a
webfont later means adding a family beside them, not rewriting seven rules.

## The scroll log is no longer on the menu

It earned its place while the restore was being fought over and there was no
console to attach to the phone it was failing on. That fight is won. A
settings menu of five rows, four of them the household's business and one of
them ours, was paying for a diagnostic nobody opens.

The code is untouched — `src/lib/scrollTrace.js` still records, the harness
still checks that it survives a reload, and the README still explains how to
read one. Only the way in changed: `?debug=1` in the address bar turns it on
and it remembers, so the household can be talked through switching it on over
the phone and it survives the reloads that follow; `?debug=0` puts it away.
`src/lib/debugFlags.js` is the whole mechanism.

## Three tabs, and where the bin went

`Ištrinti` was a quarter of the tab bar and the last thumb-width before
`Krepšelis` — a recovery view sitting at equal weight with the three screens
used every day, and one you have to reach past to get to the basket. It is a
page inside settings now, **Nustatymai → Ištrinti receptai**, which is where
the rest of the household's rarely-touched business already lives.

Two things this touched that are easy to miss:

- `TABS` in `src/lib/viewState.js` is the list of places the app can open on,
  and a phone that has not been opened since the change still has `deleted`
  written in its record. Refusing the whole record over it would also throw
  away how far down the library they were, so a retired tab now falls back to
  the menu and everything else in the record survives. `RETIRED_TABS` is
  where the next one goes.
- The `planning` scenario used to restore a recipe by opening the fourth tab.
  It goes through settings now. Nothing else in the harness names a tab by
  index above 2.

## A recipe opens in a window

The library used to open a recipe by growing its tile in place, and the menu
never opened one at all — it offered Pagaminta and Praleisti on a card showing
three of its ingredients. Both are one window now, `RecipeDetail`: the
editor's sheet without the fields, over a blurred page. There is one place
that shows everything a recipe has, and each decision is made with the whole
thing in front of you rather than a summary of it.

It is also the safer answer, which was not why it was chosen but is why it
stays. `restoreScroll` waits for `document.documentElement.scrollHeight` to
reach the saved position before it scrolls. A tile that grows moves that
number for a quarter of a second, so a restore landing mid-animation measures
a page that is still moving — the exact class of fault the scroll log exists
to chase. A dialog changes the document's height by nothing at all.

The library still remembers which recipe was open, under the same
`expandedRecipeId` it always used; only what that means on screen changed.

## Ticking things off in the shop

The list had no per-item state: thirty-eight things in seven aisles, and the
only record of what was already in the trolley was your own memory. There is
a box on each row now, on the left where a thumb already is, and it is its
own button — tapping the *name* still opens the Barbora products, and the two
must not be the same tap.

Three rules, all in `src/lib/shoppingTicks.js`:

- **A tick never blocks finishing.** Apsipirkta is a normal button at every
  point. Buying without ticking is the ordinary way to use a list, and a
  screen that refuses to believe you is worse than one that cannot count. The
  count and the bar sit at the top, beside the list they describe; there is
  deliberately nothing beside the button, because a line explaining that it
  is not disabled was answering a question the screen had stopped asking. The
  `shopticks` scenario exists mostly to keep the rule true — it has been run
  against a `disabled={left > 0}` and fails three ways.
- **It lives on the phone.** A tick is worth nothing an hour after the shop.
  Putting it in Postgres means a table, a policy, a migration and a realtime
  subscription for a value with a half-life of twenty minutes.
- **So two people shopping together do not see each other's ticks.** That is
  the real cost of the line above. If a shop is ever split between two
  trolleys, this is the thing to move into the database, and the shape in
  that module — a set of ingredient names under one household — is what the
  table would hold.

A tick for something that has left the basket is **forgotten**, not merely
hidden. The first version filtered on the way out and left storage alone, so
emptying the basket and refilling it with the same meals brought every tick
back — the names had never gone anywhere. `readTicks` now writes the shorter
set back.

That fix has a trap in it, and the harness caught it rather than the phone:
pruning against a household that has not finished loading prunes against an
empty list, which deletes every tick. The effect is gated on `dataReady` for
that reason, and `shopticks` reloads mid-shop to keep it that way.

## Movement

Nothing in the app moved: a tapped card swapped to its open state in one
frame, which reads as a redraw rather than as a response. What there is now
is four transitions at the bottom of `styles.css` — the window arriving, the
tap that precedes it, the tab cross-fade, and the tick — and two rules that
govern all of them.

Everything is on `transform` and `opacity`, which the compositor can do
without laying the page out again; a phone mid-scroll has nothing spare. And
**nothing animates a height**, for the reason in the section above.

Tabs cross-fade rather than slide. Three tabs are not a sequence, and sliding
invents a left and a right that mean nothing.

`prefers-reduced-motion` turns all of it off, and that block now covers
`animation` as well as `transition` — it did not, which would have left every
new keyframe running for the people who asked for none.

## The library filters rather than groups

Every dish type used to be a card of its own with a heading and a count, and
the recipes lived inside it. That was a whole level of nesting to say
something the tint on each card now says by itself, and on a phone it meant
scrolling past a heading every four recipes.

The dish types are a rail across the top instead. Tapping one filters; tapping
it again clears. The rail scrolls sideways on purpose — this household's list
of dish types has no ceiling, and wrapping it to three rows would push the
recipes off the screen in order to describe them.

Two rules keep the rail honest. It counts what the *search* left, so a chip
never offers a number it cannot then show; and a chip whose dish type the
search has emptied stops being a filter, so you cannot end up looking at an
empty library with no way to see why.

The filter is not remembered between visits. A filter you cannot see the top
of is a library that has silently lost half its recipes. The search and the
rail are sticky for the same reason: in a library this long, a filter you have
to scroll back up to reach is a filter you stop using.

The grid is **sorted by dish type**, in the order the rail lists, then by name
inside each type. That is one change doing two jobs. Sixty-five recipes in
whatever order the database returned them become sixty-five recipes in the
order of the chips above them, so a chip is a place on the page as well as a
filter. And the tints arrive in bands rather than as confetti — which is what
had made a deliberate palette read as a random one. The colours were never the
problem; the ordering was.

Dish types also gave up the two coldest accents. Indigo and slate belong to
the shop, where an aisle's colour has a job and dairy is meant to be blue; the
library draws from seven warm ones, plus slate for `Kita`, which is less a
colour than the absence of one. They are assigned along the order the types
ship in, so no two bands that touch are the same colour — `palette.test.mjs`
fails if a later edit breaks that.

This also meant teaching the `layout` and `shapes` scenarios the difference
between content off the edge and content further along a rail: both now walk
up from an offending element and ask whether an ancestor scrolls sideways.
Both were re-run against a 140vw card afterwards, and both still catch it.

## The icons are drawn

Four of them always were — the ones in the tab bar. Everything else was a
character: `＋ × ✓ › ↗ •••`. Those are font glyphs, so their weight, size and
vertical alignment come from whichever face the phone is using. The fullwidth
plus is a different width on iOS and Android, the check sits on a different
baseline, and the ellipsis is three full stops with the font's own spacing
between them. Beside a 1.75px stroked bowl they read as a different set of
things, and at a glance that is what made the app look assembled rather than
drawn.

`src/components/icons.tsx` is all of them now, on one grid: a 24×24 viewBox
with the drawing kept inside about 3.5–20.5 so nothing touches the edge at
small sizes, a 1.75-ish stroke with round caps and joins, and `currentColor`
throughout so an icon takes the colour of the text beside it and needs no
variant per place it appears. `More` is the one exception to the stroke rule,
because three dots are dots.

Every one carries `aria-hidden`. Each sits beside a label or inside a button
with an `aria-label`; an icon that announced itself as well would be read
twice. The one place a glyph survives is the "+ Nauja…" option inside a
`<select>`, where markup is not allowed — it is a plain ASCII `+` rather than
the fullwidth one, so at least it is a character every font draws the same.

## The menu card says less than the window

It used to print the dish type on its own row, the cuisine on another, the
whole ingredient list wrapping to as many lines as it needed, and the notes
underneath — two cards to a screen. All of that is what the window it opens is
*for*, so the card was a card you never needed to open.

It is the title, one row with the two tags, and a single line of ingredients
cut off where it runs out of room. Four fit where two did.

## Two questions the library can answer

Sorting by dish type answers "where is the one I am thinking of". The other
order answers the question a planner is actually for — "what have we not had
in a while" — and the app has always known: every cooked meal leaves a dated
row behind for ever, and nothing prunes `roster_entries`. It was simply never
asked.

**Seniausiai gaminti** is longest-since-cooked first, and a recipe never
cooked counts as longest of all: it has been waiting since the day it was
written down, and those are the ones you meant to make. Ties break on the
title in both orders, so the list never depends on which row the database
returned first — two people on two phones see the same library.

Cuisine is the second filter. It is a select rather than a second rail:
fourteen more chips would be another forty pixels of a header that is already
sticky, in order to narrow a list the first rail has usually narrowed already.

Both axes are counted **against everything filtered except themselves**, which
is the rule that makes a faceted filter honest. A dish-type chip has to say
what choosing it would show, so it is counted after the cuisine filter and
before its own — count it after its own and every chip but the chosen one
reads zero, which is both useless and alarming.

Neither filter is remembered between visits, for the reason the dish rail
never was. The sort is not remembered either, which is a smaller loss and
keeps the two consistent.

`src/lib/library.js` holds all of it as pure functions over plain objects, so
the ordering can be read and tested without a browser — including the one that
matters most and is easiest to break: that neither order depends on the order
the rows arrived in.

## One bar, and it stays

The page title used to be a hundred-pixel block at the top of every tab — an
eyebrow with the household's name and a line of display type — scrolled past
within a thumb's flick and never seen again. Meanwhile the thing you actually
wanted up there, *add something*, was a button further down the page and in a
different place on each tab: above the meal cards on Meniu, beside the search
on Receptai, next to a section heading on Krepšelis.

Both are the sticky bar now: the tab's name, a count of what is on it, the
one primary action, and the settings button. Three tabs, one place to add.

`position: sticky` rather than `fixed`, deliberately. A fixed bar comes out of
the flow and the page below it has to be padded to compensate; a sticky one
changes no document height at all — and document height is exactly what
`restoreScroll` waits on. The same reasoning as the recipe window.

Two details that are easy to get wrong:

- The bar is pulled up into the shell's `env(safe-area-inset-top)` padding and
  pads itself by the same amount, so when it is stuck it covers the notch
  rather than sliding under it.
- Its height is set from `--appbar-h` rather than falling out of its padding,
  because the library's own sticky row sticks at `--appbar-h` below it. When
  the two numbers disagree by a pixel, a sliver of scrolled card shows through
  the seam.

The household's name lived only in the eyebrow the bar replaced. It is in
**Nustatymai** now, above the address you are signed in as.
