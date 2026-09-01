# Barbora category integration

How a shopping-list ingredient becomes a link that opens the right category in the Barbora app.

Built and in use; **Outstanding work** at the end lists the remaining device checks and crawler limitation. Written against the state of the shop on 2026-09-01.

## Outcome

Ingredient links were Barbora search URLs, which do not open the Barbora app. They are now stable category links: the catalogue is built from Barbora's visible hierarchy, a deterministic mapper chooses only categories that can be inferred without guessing, and a household member can override any ingredient through a touch-friendly tree picker.

The category hierarchy is a shopping navigation system, not a food ontology. `ingredients.section` and `ingredients.food_type` describe the food and stay independent of the Barbora mapping, which describes only where a link points.

## How a link is chosen

1. `scripts/barbora/` crawls the category tree and publishes it to `public.barbora_categories`.
2. `src/lib/barboraMapping.js` proposes one category per ingredient, or none.
3. A household member may override that choice in **Ingredientai**, and their choice outranks everything.
4. `shoppingUrl` turns the stored path into the exact live URL discovered by the crawler.

Each step is separately testable, and each declines rather than guesses. `npm test` runs 52 tests across the four suites.

## The catalogue

`data/barbora-categories.json` is the reviewed snapshot: **636 categories under 11 top-level aisles, three levels deep**. `public.barbora_categories` holds the same rows, checksum-identical to the file.

The crawler in `scripts/barbora/` is category-only — it never reads product pagination, prices, stock, or exact-product pages.

The original plan was to recurse through every category page. That is unnecessary: **each Barbora top-level page already renders its whole child and grandchild tree in one `category-page-tree` block**, so the catalogue is 11 page loads rather than hundreds. The parent relationship never has to be read out of the markup either, because it is encoded in the path: `/bakaleja/makaronai/ilgi-makaronai` is by definition a child of `/bakaleja/makaronai`.

That is why the crawler is markup-agnostic. It collects anchors in document order, keeps those that stay inside the aisle it is reading, and derives depth, parent, and sibling order from the paths and their order of appearance. A redesign of Barbora's cards or lists will not break it; only a change to the URL scheme would.

| File | Responsibility |
| --- | --- |
| `paths.js` | Canonical path shape and the rules that reject non-category links |
| `tree.js` | Ordered per-page collection, tree building, deterministic serialization |
| `validate.js` | Every check between a crawl and a publication, plus the diff |
| `robots.js` | The robots.txt subset the crawler obeys |
| `challenge.js` | Recognising a Cloudflare interstitial served in place of a category |
| `crawl.js` | The Playwright driver and CLI |
| `publish.js` | Posts a validated snapshot to the publication RPC |
| `summarise.js` | Turns a run report into the workflow job summary |
| `crawler.test.mjs` | 17 tests, including a rebuild of the whole reviewed catalogue |

A stored path begins with `/`, has no query, fragment, or trailing slash, and holds only lowercase slug segments. Links to other hosts, `/produktai/`, `/paieska`, basket, account, promotion, and paginated routes are rejected, as is anything deeper than four levels.

Before anything is written, the result must pass: the seven food aisles present (the four non-food ones only warn), at least 450 categories and within 0.9–1.5× the previous run, every non-root parent present, declared depth and parent matching the path, siblings numbered `0..n`, and no duplicates, cycles, product paths, or cross-domain URLs. **A failed run writes no catalogue at all**, so the previous one keeps working. Removals and renames appear in the diff for review rather than being applied quietly.

### Running it

```bash
npm i --no-save playwright@1.62.1
npx playwright install chromium   # add --with-deps on Linux only
npm run crawl:barbora
```

Useful flags: `--dump-html <dir>` saves each fetched page, `--headed` shows the browser, `--pause` waits for you to answer the cookie banner, `--channel chrome` / `--profile <dir>` borrow a real browser and keep its profile, `--report <file>` writes the run report, and `--delay` / `--retries` / `--timeout` adjust politeness. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points at a Chromium that Playwright did not install itself.

### The crawler is parked

**As of 2026-09-01 the crawler cannot reach Barbora.** A first live run degraded across the session — the homepage rendered but exposed no category links, the first aisle came back empty, the second returned 403 — and a second run was refused at the homepage. The signature is IP reputation, not markup: the catalogue crawled the same morning came back whole. Neither a real Chrome nor a persistent profile changed the outcome, and going further would mean fingerprint evasion, which is out of scope and unwinnable besides. A scheduled run from a datacentre address is, if anything, less likely to be let in.

This blocks nothing. The catalogue is published, its links do not expire, and Barbora's aisles change rarely. When a refresh is wanted: try again after the address has cooled off, or build an offline mode that parses pages saved by hand from an ordinary browsing session, which no bot protection can object to.

### The workflow

`.github/workflows/crawl-barbora-categories.yml`, `workflow_dispatch` only, in a `barbora-catalogue` concurrency group that never cancels a running crawl. It sets up Node 24, runs the test suite before touching Barbora, installs a pinned Playwright and Chromium, crawls, validates, writes a job summary of the diff, uploads the catalogue and report as an artifact, and publishes through `scripts/barbora/publish.js`.

The `SUPABASE_URL` and `SUPABASE_SECRET_KEY` repository secrets are configured and are passed only to the publication step, never logged. The `publish` input allows a deliberate dry run. Playwright is installed in the workflow rather than in `package.json`, so the Pages deployment does not carry browser automation on every push.

Because the repository is public, its Actions logs and artifacts are world-readable. That is safe as things stand — the workflow is manual-only, never checks out untrusted code, and the key reaches one step that does not log it — but **never give this workflow a `pull_request_target` trigger or any trigger that runs PR-authored code while those secrets are in scope**, and do not enable step debug logging on a run that uses the key. The secret key bypasses RLS entirely, so its blast radius is the whole database.

No `schedule` yet: it waits on the crawler being able to reach Barbora at all.

## Supabase data model

`supabase/migrations/20260901113617_barbora_category_catalogue.sql`. A global read-only catalogue plus a household-scoped mapping on the existing ingredient vocabulary.

`public.barbora_categories`: `path` (primary key), `name`, `parent_path`, `depth`, `sort_order`, `active`, `first_seen_at`, `last_seen_at`, `crawl_version`.

Depth and parent are not independent facts — both are read off the path — so check constraints enforce that `depth` equals the number of segments and that `parent_path` is the path with its last segment removed. **A cycle is therefore not representable.** `parent_path` is deferrable, so a whole tree publishes in any order inside one transaction.

`public.ingredients` gains four nullable columns: `barbora_category_path`, `barbora_mapping_reason` (`exact`, `alias`, `parent_fallback`, `manual`), `barbora_mapping_source` (`automatic`, `manual`), and `barbora_mapping_updated_at`. Constraints require a mapping to be either complete or entirely absent, and allow only a hand-picked category to claim the `manual` reason. The mapping is per household because `ingredients` is; the catalogue contains no household information because it is the same shop for everyone.

`public.publish_barbora_categories(snapshot jsonb)` applies a crawl in one transaction: it re-validates the payload, inserts new paths active, refreshes paths seen again, and **deactivates missing paths rather than deleting them**, since ingredients may still point at them. Ingredients left pointing at an inactive category are counted and reported for a person, never repaired automatically.

Verified directly against the database after applying:

- `anon` cannot read the catalogue; `authenticated` reads active rows and is denied insert, update, and delete by both grant and policy.
- `authenticated` cannot execute `publish_barbora_categories`; only the server-side role can.
- A member can map their own household's ingredient; a non-member's identical update matches no rows.
- A half-written mapping, an `automatic` mapping claiming the `manual` reason, a mapping to a nonexistent category, a malformed path, and a contradictory depth are all rejected.
- The publication function refuses an empty payload, a payload with no categories array, a catalogue missing a required root, and one with orphaned children — leaving the live catalogue untouched.
- Database advisors report nothing new for these objects.

Two standing constraints worth remembering when extending this: grants on `ingredients` are **column-specific**, so a new field needs adding to the authenticated `UPDATE` grant or writes fail silently despite a correct RLS policy; and catalogue writes belong to the server-side credential only — never expose a secret key in Vite or committed files.

## Automatic mapping

`src/lib/barboraMapping.js`, with 23 tests. The reviewed alias table lives in code.

The rule is deliberately timid: descend only where the shop's own wording makes the answer obvious, and otherwise stop somewhere merely broad rather than wrong. **A category that is too broad costs a few taps; one that is confidently wrong sends someone to the wrong aisle.**

1. Normalize the ingredient: case, whitespace, punctuation, and a trailing quantity, reusing the existing ingredient normalization.
2. A reviewed alias wins immediately (`alias`).
3. Otherwise begin at the section's root — `Other` has none, so those stay unmapped — and search the whole subtree for categories whose name contains the ingredient as an exact term.
4. One match, or several on a single branch, means the deepest is meant (`exact`).
5. Matches on different branches retreat to whatever contains them all (`parent_fallback`), or give up when that is only the section itself.
6. No match means no mapping, and the link falls back to the section aisle.

Two details make this work. Barbora names a category after everything in it, so "Bulvės, morkos ir kopūstai" is three answers wearing one label; splitting a label into terms on commas and the conjunction — **before** normalizing, which strips the punctuation — is what makes an exact match possible at all. And the search covers the whole subtree rather than one level at a time, because Barbora's middle level is a broad grouping no ingredient name matches, so a level-by-level walk would never reach the shelf below it.

Similarity ranks suggestions for a person through `suggestCategories` and **never writes a mapping**. Product listings are never consulted: membership is volatile and would turn a small taxonomy crawler into a stock catalogue crawler.

Worked examples:

- `Pomidorai` descends to "Pomidorai ir agurkai".
- `Grietinė` names both the aisle and the shelf; the shelf wins.
- `Batonas` appears on two bread shelves, so it retreats to "Duona".
- `Avinžirniai` is sold tinned and dry in different aisles, so it maps to nothing.
- `Sojų padažas` needs an alias: "Sojų, terijakio ir vorčesterio padažai" names the sauce, not the bean.
- `Druska` needs an alias: salt is filed under sugar and baking, not spices.

The mapper runs when an ingredient is created or renamed. The original reviewed backfill covered 66 ingredients; `20260901135707_expand_reviewed_barbora_mappings.sql` adds reviewed synonyms and combined-category cases. The live household now has **200 of 217 ingredients mapped**, including olives, named cheeses, grains, sauces, produce, and spices. The remaining 17 are deliberately broad because the tree cannot distinguish them safely. Only `automatic` mappings are ever recomputed; a `manual` one survives catalogue refreshes, backfills, and renames. With no catalogue loaded the mapper has no opinion and the columns are left alone, so a slow fetch cannot wipe a good mapping.

The 17 broad fallbacks on 2026-09-01 are: artišokai; avinžirniai; baltosios, juodosios, and sojos pupelės; ordinary and panko breadcrumbs; falafel; gnocchi; gochujang; curry and miso pastes; coconut milk and cream; yeast and nutritional yeast; and rice noodles. Those are split across several plausible Barbora branches or have no matching shelf in the published tree, so the app does not pretend to know which one is right.

## Category tree picker

`CategoryPicker` in `src/App.tsx`, in the **Ingredientai** manager for both creating and editing.

- The field is labelled **Barbora kategorija** and shows the current choice or "Parenkama automatiškai".
- It opens at the current mapping, or at the top of the shop.
- A clickable breadcrumb runs along the top; only the current node's direct children are shown, as rows large enough to hit with a thumb.
- **Every node is selectable, including a non-leaf**, through **Pasirinkti šią kategoriją** — a household knows when a branch is good enough, and forcing them deeper would be inventing precision.
- Tapping a row selects it and descends if it has children. Descending scrolls back to the top of the new list.
- Nothing is written until **Gerai**. **Atšaukti** discards; **Atkurti automatinį parinkimą** hands the choice back to the mapper.
- Automatic versus manual is marked quietly in the ingredient row; no confidence scores are exposed.

Verified by driving it in Chromium against the real catalogue: the eleven roots, descending two levels, breadcrumbs, choosing a non-leaf, and confirming. Two layout faults were found and fixed — a sticky footer that list rows scrolled through, and a descent that left the list scrolled where the previous one had been.

An optional tree search may be added later, but it must navigate to a result inside the hierarchy rather than replacing the hierarchy with an opaque flat select.

## Shopping links

- An ingredient with an active mapping links to that category; otherwise to its section's aisle; otherwise it stays plain text rather than inventing a URL.
- The ingredient name itself is the clickable text. Section headings link to their aisle.
- Every link is a plain HTTPS link with `target="_blank"`. There are no exact-product or `/paieska` links.

**Every link goes through `shoppingUrl`**, and it preserves the crawler path exactly. Barbora's association files are not a catalogue and are no longer used to rewrite URLs:

- The website's live dairy aisle is `/pieno-gaminiai-kiausiniai-ir-majonezas`; the association file still names `/pieno-gaminiai-ir-kiausiniai/*`.
- The retired path launches the app but produces a 404. Consequently, “claimed by the phone” is not evidence that Barbora can resolve a category.
- Root paths also keep the exact no-trailing-slash shape stored in the catalogue instead of being adjusted to fit an association pattern.

`src/lib/barboraMapping.test.mjs` asserts that all 636 categories produce their exact crawled URL. A working browser page is preferred to an app-opening 404.

## Device behavior

- All links are plain HTTPS with `target="_blank"`. Whether the link opens the Barbora app or a browser tab is decided by the OS and Barbora's association files, not by anything in this app.
- iOS initially opened every tested URL in an embedded browser. Pasting a category URL into Notes, long-pressing it and choosing **Open in Barbora** restored the domain's Universal Link preference, after which the same links opened the app from this PWA.
- The Android `intent://` experiment for package `lt.barbora` was removed because the app did not handle the intent. Plain HTTPS links let Android's own App Links or Digital Asset Links do the right thing when Barbora registers them.
- The temporary **Nuorodų testas** screen was removed after device behavior was established. An ordinary category link falls back to a browser when Barbora is not installed or the association is unavailable.

## Outstanding work

1. **Device regression testing** on both phones, especially the iOS Universal Link preference for the current dairy path.
2. **The crawler is parked**, so no `schedule` on the workflow and no successful production run of it yet. An offline mode parsing hand-saved pages is the likeliest way forward.
3. **One pending migration-history entry**: the two recipe-import files have been renamed to the exact versions recorded remotely (`20260831181733` and `20260831181818`), after verifying their SQL hashes match the database. The classification backfill's effects are already present, but version `20260831220714` was never recorded. Reconcile it once with `supabase migration repair 20260831220714 --status applied --linked`, then verify with `supabase migration list --linked`. Do not use `db pull`, because this is data/migration history rather than missing schema. If repairing is unavailable, the migration is idempotent and may instead be replayed with `supabase db push --include-all`.

### PWA state restoration

The app persists a small versioned, non-sensitive object in `localStorage`, keyed by user and household:

- active top-level tab;
- scroll position per tab;
- expanded library recipe ID, if still present after data reload;
- no Settings subview, modal, destructive confirmation, secret, or whole Supabase record.

State is saved as it changes and on `pagehide`/`visibilitychange`, then restored only after auth, household, and the first successful data load are ready. Browser scroll restoration is set to manual and scrolling waits for the selected tab to render. A different account or household uses a different key. Unsaved recipe-editor drafts remain separate future work.

## Tests

`npm test` runs 52 tests. Covered:

- Tree construction preserves parent/child relationships and Barbora's order, including a rebuild of all 636 reviewed categories from the pages they came from.
- URL normalization rejects products, queries, foreign hosts, and impossible depths; cycles are unrepresentable by construction.
- Challenge and truncated fixtures fail validation and never publish — verified end to end against a local mock serving an interstitial for one aisle.
- Exact mapping descends to the expected node; ambiguity retreats to the parent or declines; similarity alone never writes a mapping.
- Every alias points at a category that exists.
- Every catalogue category produces its exact live crawler URL, and the Android intent retains that URL as its fallback.

Left to manual acceptance:

- On Android, a mapped ingredient either opens the correct current category in Barbora or its exact live browser fallback; on iOS the normal Universal Link preference still applies.
- Without that preference, the browser fallback opens and closing it returns to the same tab and scroll position.
- Descending several levels, returning through breadcrumbs, cancelling without saving, and resetting to automatic.
- A failed crawler run leaves every previously published link working.

## External references

- Barbora's app-link claims: <https://barbora.lt/.well-known/apple-app-site-association> and <https://barbora.lt/.well-known/assetlinks.json>
- Barbora hierarchy example: <https://barbora.lt/bakaleja/kruopos>
- Apple Universal Link debugging and remembered user choice: <https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links/>
- GitHub scheduled and manual workflow behavior: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Supabase Data API security: <https://supabase.com/docs/guides/api/securing-your-api>
