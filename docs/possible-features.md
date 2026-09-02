# Things deliberately not built

Each of these was considered and put down, with the reason and whatever design
work had already been done. The point is that picking one up later should not
mean re-deriving the argument — or rediscovering the trap.

## Count how often a recipe is cooked

**Why it is not there:** nothing asks for it yet.

**Why it is written down:** the data it needs is being kept right now, and one
plausible tidy-up would destroy it.

`roster_entries` is an append-only log — see the note in
[`app-behaviour.md`](app-behaviour.md). Every meal ever planned is still in it,
and only two things read the cooked ones: the five-day "recently cooked" list,
and each recipe's last-cooked date. Neither needs more than the most recent
entry per recipe, so pruning the rest looks free. It is not quite: those rows
are the only record of how often anything has been cooked, and deleted rows do
not come back.

If both are wanted, the shape is a `times_cooked` column on `recipes`,
incremented where an entry is marked cooked, after which the log can be pruned
freely.

**The trap, if the pruning is ever written.** Do not prune on the write:

> Cook a recipe on the 1st. Cook it again on the 2nd, and a trigger deletes the
> 1st. Tap **Atšaukti** within the five-second undo window, and the 2nd reverts
> to `ready` — leaving no cooked row at all, and a library that says *Dar
> negaminta* for something eaten yesterday.

Prune on a schedule instead. There is already a daily `pg_cron` job for invite
rotation; a sweep that removes non-latest cooked rows older than a day cannot
race a five-second undo. `skipped` entries can go entirely — they are written
and never read anywhere.

**What it is worth:** the storage saved is around 70KB a year against a 500MB
tier, so this is not about space. Do it when the counter is wanted for its own
sake.

## Back stepping up one level in the category picker

Descending Barbora's tree is state inside one dialog, so the phone's back button
closes the picker rather than going up a level. The same fix as the settings
pages would apply, but "one entry for not being at the root" means back would
jump to the top of the tree rather than up one — which may read worse than what
it does now. A taste question, left alone deliberately.

## CI running the tests on pull requests

Today a green tick on a PR means "Claude ran the tests and reported that they
passed". A workflow running `npm test`, and ideally the harness, would make it
mean something independent. Perhaps thirty lines of YAML; the harness needs
Playwright, so a couple of minutes per run.

## Harness scenarios not yet written

Named because each is a real class of fault the suite cannot currently see:

- **Concurrent edits.** Two people changing the same recipe at once. The stub
  serves one session, so nothing exercises the realtime merge.
- **Offline and flaky network.** The service worker is network-first; nothing
  tests what the app does when the network is slow rather than absent.
- **Rotation and small screens.** Every scenario runs one portrait viewport.

## Opening the app beyond two people

Kept where the reasoning lives, in
[`barbora-category-integration.md`](barbora-category-integration.md) under
"If this is ever opened up": sign-up controls, short-lived hashed invitations,
column-level grants on audit fields.
