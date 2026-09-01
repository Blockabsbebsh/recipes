# Barbora category integration handoff

Status: partly implemented, based on device testing on 2026-09-01.

The crawler, its validation, its tests, the reviewed catalogue snapshot, the manual GitHub Action, and the Supabase catalogue and mapping schema exist; the 636-category catalogue is published and live. Automatic mapping, the tree picker, the basket link change, and PWA state restoration are still the agreed plan and are not implemented. Each section below says which of the two it is.

## Outcome

Replace ingredient search and exact-product links with stable Barbora category links. Build the category catalogue from Barbora's visible hierarchy, automatically choose only categories that can be inferred without guessing, and let a household member override any ingredient through a touch-friendly tree picker.

The category hierarchy is a shopping navigation system, not a food ontology. Keep `ingredients.section` and `ingredients.food_type` independent from the Barbora mapping.

## Verified device behavior

- Android opens ordinary Barbora category and exact-product HTTPS URLs in the installed Barbora app. Barbora search URLs and the explicit `intent://` search experiment do not open the native app reliably.
- iOS initially opened every tested URL in an embedded browser. Pasting a Barbora category URL into Notes, long-pressing it, and choosing **Open in Barbora** restored the domain's Universal Link preference. The two ordinary category links on the app's test page then opened directly in the Barbora app.
- Therefore production code should use the same ordinary category HTTPS URL on Android and iOS. Do not maintain an Android-only intent path.
- Use `target="_blank"` for the production links. Native app links still hand off to Barbora; browser fallback does not navigate the Recipes PWA away from its current screen.
- Keep a short iOS recovery instruction in the link test/help UI: paste a category URL into Notes, long-press it, and choose **Open in Barbora**. Whether the option is available is controlled by Barbora's Universal Link configuration and iOS.

## Current implementation

Built:

- The category crawler, its validation, and its tests live in `scripts/barbora/`.
- `.github/workflows/crawl-barbora-categories.yml` runs it on demand and uploads the catalogue and its diff as an artifact.
- `data/barbora-categories.json` holds the reviewed catalogue from the 2026-09-01 crawl: 636 categories under 11 top-level pages, three levels deep.
- `supabase/migrations/20260901120000_barbora_category_catalogue.sql` adds `public.barbora_categories`, the four mapping columns on `public.ingredients`, and the `public.publish_barbora_categories` publication function. It is applied, and the catalogue in the database matches the snapshot exactly.
- `BarboraCategory` and the ingredient mapping fields are in `src/lib/types.ts`.

Not built:

- Broad aisle URLs are still hardcoded in `src/App.tsx` as `SECTION_BARBORA_URLS`.
- Ingredient names still use `barboraUrl(item)`, which creates `/paieska?q=...` links.
- `androidBarboraIntent()` is still only an experiment and does not solve native search opening.
- The Settings link test still compares search, Android intent, category, and exact-product URLs.
- Nothing in the app reads the catalogue yet: no mapper, no picker, and no query.
- Every ingredient mapping is still null, so every shopping link is unchanged.
- The top-level `tab` state and library's expanded recipe are React-only state. They are lost if iOS discards and reloads the PWA.
- The hardcoded dairy URL is stale: the crawled root is `/pieno-gaminiai-kiausiniai-ir-majonezas`, not `/pieno-gaminiai-ir-kiausiniai/`. The crawled catalogue is the place to correct this from.

## Mapping rule: deepest unambiguous category

For an ingredient, begin at the known broad branch and descend only while exactly one child is clearly correct.

1. Normalize Lithuanian case, surrounding whitespace, punctuation, and simple quantity suffixes using the existing ingredient normalization where possible.
2. Pick a broad root from an explicit reviewed rule or the existing shop section.
3. Descend when the ingredient/category relationship is an exact normalized match or a reviewed alias selects one child.
4. If zero children clearly match, select the current node.
5. If multiple children plausibly match, select the current node.
6. Fuzzy matching may rank suggestions for a human, but must never commit a narrower category automatically.
7. A manual mapping always wins and must survive later crawler and auto-mapping runs.

Examples:

- `Pomidorai` can descend to the tomatoes-and-cucumbers category.
- `Sojų padažas` can descend to Barbora's soy/teriyaki/Worcestershire sauce category.
- `Tamari` should stop at the unambiguous sauces branch unless a reviewed alias maps it to the soy-sauce category. Barbora currently sells Tamari in that category, but the hierarchy name alone does not prove the relationship.
- A niche vegan item should stop at the closest useful branch when Barbora offers no clean category. Do not infer semantics from neighboring product names or departments.

Store why a category was chosen. Suggested values are `exact`, `alias`, `parent_fallback`, and `manual`. Keep the mapping source separate if useful (`automatic` or `manual`).

## Supabase data model

Implemented in `supabase/migrations/20260901120000_barbora_category_catalogue.sql`, as a global read-only category catalogue and a household-scoped mapping on the existing ingredient vocabulary.

`public.barbora_categories` columns:

- `path text primary key`: normalized path beginning with `/`, without query or fragment; choose one trailing-slash convention.
- `name text not null`
- `parent_path text null references public.barbora_categories(path) on update cascade`
- `depth smallint not null`
- `sort_order integer not null`: preserve Barbora's display order among siblings.
- `active boolean not null default true`
- `first_seen_at timestamptz not null`
- `last_seen_at timestamptz not null`
- optional `last_crawl_id uuid` or `crawl_version text` for auditing.

Add nullable fields to `public.ingredients` rather than mixing this navigation data into `section` or `food_type`:

- `barbora_category_path text null references public.barbora_categories(path) on update cascade on delete set null`
- `barbora_mapping_reason text null` constrained to the agreed reason values.
- `barbora_mapping_source text null` constrained to `automatic` or `manual`.
- `barbora_mapping_updated_at timestamptz null`.

The mapping remains per household because `ingredients` remains per household. The category catalogue itself is shared reference data and contains no household information.

Two invariants are enforced by check constraints rather than left to the writer: `depth` must equal the number of segments in `path`, and `parent_path` must be the path with its last segment removed. A cycle is therefore not representable. `parent_path` is deferrable, so a whole tree can be published in any order inside one transaction.

Verified after the migration was applied:

- `anon` cannot read the catalogue; `authenticated` can read active rows and is denied insert, update, and delete by both grant and policy.
- `authenticated` cannot execute `publish_barbora_categories`; only the server-side role can.
- A member can write a mapping on their own household's ingredient; a non-member's identical update matches no rows.
- A half-written mapping, an `automatic` mapping claiming the `manual` reason, a mapping to a nonexistent category, a malformed path, and a contradictory depth are all rejected.
- The database advisors report nothing new for these objects.

Security requirements:

- Enable RLS on every new table in `public`.
- Grant `authenticated` read-only access to active category rows. Do not grant category writes to browser clients.
- Keep all catalogue writes in the crawler's server-side credential. Never expose a Supabase secret/service-role key in Vite or committed files.
- Existing `ingredients` grants are column-specific. Extend the authenticated `UPDATE` column grant to the new mapping fields or updates will silently fail even with a correct RLS policy.
- Existing household membership policies must continue to protect ingredient rows. A member may update mappings only for their household's ingredients.
- Verify whether the new table is exposed by the project's Data API settings; current Supabase projects may require an explicit API exposure/grant in addition to RLS.
- Run Supabase database advisors after the migration and test both allowed and denied operations.

The migration filename follows the existing `supabase/migrations/` convention. The Supabase CLI is not available in the environment this was written in, so the file was written by hand and applied through the Supabase MCP tooling; a later `supabase db pull` is the way to confirm the checked-in SQL and the live schema agree.

Note a pre-existing drift, unrelated to this work: the database's migration history stops at `20260831181818`, while the repository carries three later files whose effects are present in the data. The names and timestamps of those files do not match the recorded history.

## Crawler

Implemented, in `scripts/barbora/`. Category-only: it never reads product pagination, prices, stock, or exact-product pages.

The original plan was to recurse through every category page. It is not necessary. **Each Barbora top-level page already renders its whole child and grandchild tree in one `category-page-tree` block**, so the full catalogue is 11 page loads rather than hundreds, and the parent relationship never has to be read out of the markup: it is encoded in the path, because `/bakaleja/makaronai/ilgi-makaronai` is by definition a child of `/bakaleja/makaronai`.

That is why the crawler is markup-agnostic. It collects anchors in document order, keeps the ones that stay inside the top-level category it is reading, and derives depth, parent, and sibling order from the paths and their order of appearance. A redesign of Barbora's cards or lists does not break it; only a change to the URL scheme would.

| File | Responsibility |
| --- | --- |
| `paths.js` | Canonical path shape and the rules that reject non-category links |
| `tree.js` | Ordered per-page collection, tree building, deterministic serialization |
| `validate.js` | Every check that stands between a crawl and a publication, plus the diff |
| `robots.js` | The robots.txt subset the crawler must obey |
| `challenge.js` | Recognising a Cloudflare interstitial served in place of a category |
| `crawl.js` | The Playwright driver and CLI |
| `summarise.js` | Turns a run report into the workflow job summary |
| `crawler.test.mjs` | Tests, including a rebuild of the reviewed catalogue |

A stored path begins with `/`, has no query, fragment, or trailing slash, and holds only lowercase slug segments, so `https://barbora.lt${path}` is always a valid shopping link. Links to other hosts, `/produktai/`, `/paieska`, basket, account, promotion, and paginated routes are rejected, as is anything deeper than four levels.

Run it locally:

```bash
npm i --no-save playwright@1.62.1
npx playwright install --with-deps chromium
npm run crawl:barbora
```

`npm run crawl:barbora` compares against `data/barbora-categories.json` and rewrites it only if the result passes validation. Useful flags: `--dump-html <dir>` keeps the fetched HTML for inspection, `--headed` shows the browser, `--report <file>` writes the run report, and `--delay`/`--retries`/`--timeout` adjust politeness. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points at a Chromium that Playwright did not install itself.

Direct unattended HTTP requests receive Cloudflare responses, while a rendered browser can read the hierarchy. An interstitial parses perfectly well and simply yields no categories, so `challenge.js` names it explicitly and the run fails instead of publishing an empty aisle. The crawler does not attempt to defeat a challenge.

Validation, all of it enforced before anything is written:

- The seven top-level categories the shopping links depend on are present; the four non-food roots only warn.
- At least 450 categories, and within 0.9x to 1.5x of the previous catalogue.
- Every non-root parent exists, every declared depth and parent matches the path, and siblings are numbered `0..n`.
- No duplicate paths, cycles, product paths, cross-domain URLs, or impossible depths.
- Removals and renames are reported in the diff for review rather than being applied quietly.

A failed run writes no catalogue at all, so the previous one keeps working. `data/barbora-categories.json` is the reviewed snapshot of the 2026-09-01 crawl and is updated deliberately, not by the workflow, so a crawl cannot cause a noisy Pages deployment.

## GitHub Action

Implemented as `.github/workflows/crawl-barbora-categories.yml`, minus the publication step, which arrives with the catalogue table. GitHub Actions is preferred over a Supabase Edge Function because this job needs a real browser and may take longer than an edge request.

The workflow is `workflow_dispatch` only, in a `barbora-catalogue` concurrency group that never cancels a running crawl. It sets up Node 24, runs the test suite before touching Barbora, installs a pinned Playwright and Chromium, crawls, validates, writes a job summary of the diff, and uploads the catalogue, the run report, and optionally the fetched HTML as an artifact. Playwright is deliberately not a `package.json` dependency: the Pages deployment runs `npm ci` on every push to `main` and should not carry browser automation.

Publication runs as the last step, through `scripts/barbora/publish.js`, which posts the validated snapshot to the `publish_barbora_categories` RPC. It needs two repository secrets, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, passed only to that step and never logged; until they are configured the step reports a warning and the run still produces its artifact. The `publish` input allows a deliberate dry run.

Still to add:

- A monthly `schedule` at a non-round time, only after at least two successful manual production runs.

The existing Pages deployment workflow remains independent.

For safe publication, validate the complete JSON first and replace/upsert the catalogue as one logical operation. New paths become active, seen paths update their names/order/timestamps, and missing paths become inactive rather than being deleted. Never overwrite `manual` ingredient mappings. Automatic mappings whose category becomes inactive should be recomputed or flagged; manual mappings should display a warning and wait for a person.

## Automatic ingredient mapping

Keep auto-mapping deterministic and testable. A reviewed alias table may live in code initially or in a small global Supabase table later.

- Run the mapper when an ingredient is created/imported and as a reviewed backfill for existing ingredients.
- Recompute only mappings whose source is `automatic`.
- Prefer a safe parent category over a speculative leaf.
- When no narrower category is known, retain the broad `section` destination as the shopping-link fallback.
- Do not scrape products merely to infer ingredient semantics. Product membership is volatile and would turn the small taxonomy crawler into a stock catalogue crawler.

The crawler discovers the tree; the mapper chooses within that tree. Keep these modules separate so both can be unit-tested with static fixtures.

## Category tree picker

Add the custom mapping control to the existing **Ingredientai** manager when creating or editing an ingredient.

Recommended interaction:

- Field label: **Barbora kategorija**.
- Tapping it opens a mobile sheet/modal at the current mapping or at the inferred root.
- Show a clickable breadcrumb at the top, for example `Bakalėja › Padažai ir konservuotos užtepėlės`.
- Show only the current node's direct children as large touch rows/cards.
- Every node, including a non-leaf, must be selectable. The user explicitly needs to stop when the current branch is good enough.
- Provide **Pasirinkti šią kategoriją** (or an equivalent clear current-node action), **Atšaukti**, and **Gerai**.
- Do not write to Supabase until **Gerai** is pressed.
- Opening an existing manual mapping starts at that node.
- Offer **Atkurti automatinį parinkimą** to remove the manual override and rerun the deterministic mapper.
- Mark automatic versus manual choice quietly; avoid exposing technical confidence scores in the normal UI.
- Optional tree search may be added later, but it must navigate to a result inside the hierarchy rather than replacing the hierarchy with an opaque flat select.
- Reuse the existing modal scroll-lock approach and test keyboard/viewport scrolling on iOS. The tree and confirmation buttons must remain reachable with large catalogues.

## Shopping basket links

- Replace ingredient search hyperlinks with `https://barbora.lt${barbora_category_path}` when a mapped category is active.
- Keep the ingredient name itself as the clickable text.
- If no ingredient mapping exists, link to its broad `section` category when available. If even that is unavailable, render plain text rather than inventing a URL.
- A section heading may continue linking to its broad Barbora root.
- Use a plain user-clicked `<a>` with an ordinary HTTPS URL, `target="_blank"`, and `rel="noopener noreferrer"` on both platforms.
- Remove the Android intent branch and do not default to exact-product URLs or `/paieska` URLs.
- Exact-product URLs may remain only as a temporary diagnostic fixture; they are volatile and can point to sold-out products.

Simplify **Nuorodų testas** after production mappings work:

- Keep one representative category link and the iOS Notes recovery instructions.
- Remove or clearly label search, exact-product, and Android-intent entries as legacy diagnostics; preferably remove them once device regression testing is complete.
- Explain that an ordinary category link falls back to a browser if Barbora is not installed or the device association is unavailable.

## iOS/PWA state restoration

Native linking now works after correcting the iOS Universal Link preference, but state restoration is still required as a fallback and for ordinary app switching.

Persist a small versioned, non-sensitive UI state object keyed by user/household:

- active top-level tab;
- scroll position per tab;
- expanded library recipe ID, if still present after data reload;
- optionally the Settings subview, but do not restore destructive confirmation dialogs automatically.

Use `localStorage` rather than memory-only React state so an iOS process eviction can be recovered. Save on state changes and `pagehide`/`visibilitychange`; restore after auth, household, and relevant data are ready. Set browser scroll restoration deliberately and restore scroll after the tab has rendered, usually with `requestAnimationFrame`. Clear or switch the keyed state on sign-out/household change.

Do not persist secrets or complete Supabase records. Treat unsaved recipe-editor drafts as separate future work unless explicitly implemented and tested.

## Suggested implementation order

1. ~~Add static crawler fixtures and tree-building tests.~~ Done; mapping tests arrive with the mapper.
2. ~~Implement and run the crawler locally without database writes.~~ Done.
3. ~~Review the generated hierarchy and validation thresholds.~~ Done: 636 categories, thresholds in `scripts/barbora/validate.js`.
4. ~~Add the Supabase migration, RLS/grants, and TypeScript types.~~ Done; the app's read queries arrive with the picker.
5. ~~Publish a reviewed initial catalogue.~~ Done, though seeded directly rather than through the workflow, which still needs its two secrets before its first real run.
6. Add deterministic auto-mapping and backfill existing ingredients without touching manual mappings.
7. Add the tree picker to ingredient create/edit flows.
8. Change basket ingredient links to the selected category URL and remove platform-specific link logic.
9. Add PWA tab/scroll/expanded-item restoration.
10. Test both devices, then enable the monthly crawler schedule.
11. Update this document and `README.md` from planned to implemented behavior.

## Tests and acceptance criteria

Automated tests:

- ~~Tree construction preserves parent/child relationships and Barbora order.~~ Covered, including a rebuild of all 636 reviewed categories from the pages they came from.
- ~~URL normalization rejects products, queries, foreign hosts, and cycles.~~ Covered.
- ~~Challenge/incomplete fixtures fail validation and never publish.~~ Covered, and verified end to end against a local mock that serves an interstitial for one aisle.
- Exact mapping descends to the expected node.
- Ambiguous or unmatched mapping stops at the parent.
- Fuzzy similarity alone never writes a leaf mapping.
- Manual mapping survives catalogue and automatic-mapping refreshes.
- Inactive mapped categories produce a safe fallback/warning.
- ~~RLS permits authenticated category reads, denies client category writes, isolates household ingredient updates, and permits the server publication path.~~ Verified directly against the database; see **Supabase data model**.

Manual acceptance:

- On Android, tapping a mapped ingredient opens the correct category in Barbora.
- On iOS with Barbora selected for the domain, the same link opens the correct category in Barbora.
- On iOS without that preference, the browser fallback opens and closing it returns to the same Recipes tab and scroll position.
- A user can select a broad non-leaf category and press **Gerai**.
- A user can descend several levels, move back through breadcrumbs, cancel without saving, and reset to automatic.
- A failed crawler run leaves every previously published link working.
- No production shopping link depends on current product availability.

## External references

- Barbora hierarchy example: <https://barbora.lt/bakaleja/kruopos>
- Barbora soy-sauce category containing Tamari: <https://barbora.lt/bakaleja/padazai-ir-konservuotos-uztepeles/soju-terijakio-ir-vorcesterio-padazai>
- Apple Universal Link debugging and remembered user choice: <https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links/>
- GitHub scheduled and manual workflow behavior: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Supabase Edge Function guidance: <https://supabase.com/docs/guides/functions>
- Supabase Edge Function limits: <https://supabase.com/docs/guides/functions/limits>
- Supabase Data API security: <https://supabase.com/docs/guides/api/securing-your-api>

