# Recipes

A shared, mobile-first recipe library, current meal roster, and deliberately simple shopping list for two people. It is a static React PWA backed by Supabase Auth, Postgres, Realtime, and Row Level Security.

## What works

- Separate email/password accounts sharing one household through an invite code
- Compact, dish-type-grouped recipe library with expandable details, actions, notes, and source links
- Checklist importer with editable previews and case/quantity-tolerant ingredient matching
- Current recipes with Cooked/Skipped actions and a 30-second Undo
- Recently cooked section for the last five days and per-recipe last-cooked dates
- Temporary meal batch and a deduplicated ingredient list showing which recipes use each item
- Barbora category links for individual ingredients, chosen automatically or by hand through a tree picker, with the shop aisle as a fallback
- Real Barbora products behind every shopping-list item: tap an ingredient for two or three matches with prices, discounts, price per kilo, stock at our shop, and a link that opens the Barbora app
- One-tap shopping completion that atomically moves planned meals to Current
- Soft deletion and recovery
- Live refresh when the other person edits data
- Installable PWA layout for Android and iOS, remembering your tab and scroll position across app switches and eviction
- The Android back button closes what is open — dialogs innermost first, then the settings page you are on, then home from another tab — before it leaves the app
- Lithuanian interface copy and metadata
- Automatic dish-type and cuisine classification with manual editing
- Library search across recipe names, ingredients, dish types, and cuisines
- Library sections grouped by dish type, with cuisine shown as an extra tag
- Household ingredient and recipe-category management from the settings menu

## Run locally

Requirements: Node 24 or later — the test script uses `--test-isolation=none`, which older versions do not accept.

```bash
npm ci
npm run dev
```

The Supabase project URL and publishable key are included in `src/lib/supabase.ts`. A publishable key is designed to be public; access is enforced by RLS. Never put a Supabase secret/service-role key in this repository.

New sign-ups are disabled in the Supabase dashboard, which is why a public publishable key costs nothing: the key gets you as far as the sign-in screen. That setting is not in this repository, and some of the reasoning in [`docs/barbora-category-integration.md`](docs/barbora-category-integration.md) depends on it — read that before turning sign-ups on.

## Testing

```bash
npm test          # 154 unit tests, none of which need a browser
npm run harness   # the real app on an emulated phone, against a fake Supabase
npm run dbtest    # every migration applied to a throwaway Postgres, then checked
```

The unit tests cover the parser, the classifier, the Barbora mapper, crawler and price merge, and the rules the phone taught us: what counts as the household's own scrolling, when a remembered position has gone stale, what the back button should undo, and whether the loading screen belongs on screen.

The harness exists because this app's bugs are rarely logic bugs. They are about what a thumb can reach with the keyboard up, and where you land after switching apps — which no unit test sees. It builds the app against an in-memory stub, drives it in a phone-emulated browser, and runs seven scenarios: layout on every tab, the keyboard against a nested modal, the modal stack, view restoration across app switches and eviction, the on-device scroll log, a week of shopping and cooking, and the back button. It never touches the real Supabase project, so a scenario may delete every recipe without consequence.

It needs Playwright, which is installed on demand rather than carried as a dependency:

```bash
npm i --no-save playwright@1.62.1
```

[`scripts/harness/README.md`](scripts/harness/README.md) explains the scenarios, how to add one, and the pitfalls — above all that Playwright's own `click()` scrolls the page and will invent bugs that are not there.

The app also keeps its own record of what happened to the scroll position — the last 150 events, readable on the phone under **Nustatymai → Slinkties žurnalas**, because the moment restoration fails in has no console attached. Reading one is described in the harness README; it is what found every scroll fault that mattered.

The database has a harness of its own. Every policy, grant and trigger in `supabase/migrations/` used to be written, reviewed by reading, and applied to production without ever being run against a test; `npm run dbtest` applies them all to a throwaway PostgreSQL and checks what they actually do — who can read whose kitchen, what a signed-in account may write, where the ceilings are, and whether the throttle on joining survives twenty simultaneous requests. Its first run found two faults that were live at the time: creating a household had been broken for a day, and every column grant in the project was decoration. [`scripts/dbtest/README.md`](scripts/dbtest/README.md) has both stories and the mutations that keep the checks honest.

[`docs/app-behaviour.md`](docs/app-behaviour.md) explains where the code lives and what each phone behaviour does and why. [`docs/possible-features.md`](docs/possible-features.md) lists what was considered and deliberately not built, with the reasoning kept so it does not have to be worked out again. [`docs/barbora-apis.md`](docs/barbora-apis.md) records what Barbora's own APIs will and will not tell you, which claims are proven rather than assumed, and the dead ends — including the search filter that hid the whole eshop API for six rounds of looking.

## First use

1. Create an account in the app and confirm the email if Supabase asks.
2. One person creates the kitchen.
3. Open the `•••` menu and copy the invite code.
4. The other person creates their own account and joins with that code.

For confirmation links, set the Supabase **Authentication → URL Configuration → Site URL** to the deployed app URL and add local/deployed redirect URLs as needed.

## Deploy with GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds every push to `main`. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source. The production build uses `/recipes/` as its base path.

The repository is public because GitHub Pages needs a paid plan to serve a private one. If Pages is ever unavailable, the same `dist` folder deploys unchanged to Cloudflare Pages, Netlify, or Vercel.

Being public matters for Actions secrets: logs and artifacts are world-readable. No Supabase secret key is configured any more — the crawl workflow reads one if it is there and reports "not published" when it is not — but if one is ever added again, no workflow holding it may gain a trigger that runs pull-request code. See [`docs/barbora-category-integration.md`](docs/barbora-category-integration.md).

## Database

The live schema is in Supabase project `recipes` (`malrgdecuaqtkwnloixa`). The reproducible SQL lives in `supabase/migrations/`, applied in filename order. Ingredients are a per-household vocabulary with two independent axes: `section` is the part of a shop it is bought in, `food_type` is what the food actually is. Recipes carry free-form tags through `recipe_tags`.

Every public table has RLS. Policies authorize through `household_members`, not user-editable JWT metadata. The two household RPCs authenticate the caller and have execution revoked from `PUBLIC` and `anon`; `publish_barbora_categories` is revoked from browser clients entirely and granted only to the server-side role.

Grants are as narrow as the app allows and are pinned by a test, because RLS does not cover everything. TRUNCATE is not subject to row security at all, and a column a policy does not mention is a column a policy cannot protect. Supabase grants the client roles everything on `public` by default, so both of those were open until a table-level revoke replaced the blanket with an explicit list. A new table now starts closed and is opened deliberately.

Recipe classifications reuse the existing normalized tag relation. Machine-readable names use `Tipas: ` for the single dish-type axis and `Virtuvė: ` for cuisine; the UI removes those prefixes. Dish type controls library grouping, while both axes participate in search. New recipes are classified locally with deterministic Lithuanian/English keyword rules and can be corrected in the editor.

## Barbora shopping links

An ingredient links to the Barbora category it is sold in, so a tap opens the shop's app at the right shelf. Four pieces make that work, each documented in [`docs/barbora-category-integration.md`](docs/barbora-category-integration.md):

- **The catalogue.** `data/barbora-categories.json` is the reviewed snapshot of Barbora's hierarchy — 636 categories under 11 aisles, three levels deep — mirrored in `public.barbora_categories`. It is global reference data rather than household data: signed-in members read active rows and cannot write them, and publication is a single transaction through a function only the server-side key can execute.
- **The crawler**, in `scripts/barbora/`. Category-only; nothing about products, prices, or stock is read. It needs one page load per aisle, because each aisle page already renders its whole subtree.
- **The mapper**, `src/lib/barboraMapping.js`. Deterministic and deliberately timid: it descends only where Barbora's own wording makes the answer obvious, and otherwise leaves an ingredient on its section's aisle. Reviewed rules now map 200 of the 217 vocabulary ingredients.
- **The picker**, in **Ingredientai**. Any ingredient's category can be set by hand, at any depth, and a hand-picked one survives every later refresh.

```bash
npm i --no-save playwright@1.62.1
npx playwright install chromium   # add --with-deps on Linux only
npm run crawl:barbora
```

The crawler has never completed a production run: Barbora's bot protection refuses it, and no Supabase secret key is configured for it to publish with. It is kept because the catalogue it produced by hand is the thing the app depends on, and the validation around it is worth having if the crawl is ever revived. Nothing in the app depends on a successful run: a blocked run, or one failing any validation check, writes nothing and leaves the published catalogue in place. The **Crawl Barbora categories** workflow runs the same crawl on demand; with no key configured it reports "not published" instead of writing.

### Product prices

Tapping an ingredient on the shopping list shows what Barbora actually sells for it: two or three matches with prices, discounts, price per kilo, stock at our shop, and a link that opens the product in the Barbora app. Documented in [`docs/barbora-product-pricing.md`](docs/barbora-product-pricing.md).

Two of Barbora's own unauthenticated JSON APIs, joined by product id. Constructor.io answers what an ingredient matches and carries no prices at all; `barbora.lt/api/eshop/v1/product/GetInventories` takes those same ids and answers with prices, was-prices and promotions. No HTML is parsed and no bot protection is involved: the API the shop's mobile app depends on answers a datacentre in 37 ms with a user-agent that names this repository, unlike the website pages the category crawler was refused by.

[`docs/barbora-apis.md`](docs/barbora-apis.md) is the reference for both surfaces: every endpoint, what each field means, and what was tried and failed.

A browser cannot call the second one — `barbora.lt` sends no CORS headers, and CORS is a browser policy rather than a server one — so the `barbora-products` Edge Function fetches both and forwards them. It is deliberately a dumb proxy: every rule about was-prices, discounts, stock and ordering lives in `src/lib/barboraProducts.js`, where 17 unit tests can reach it. The deployed function and `supabase/functions/barbora-products/index.ts` must be kept identical by hand.

## Current MVP limits

- The importer parses checkboxes, numbering, dish names, and comma-separated ingredients, but preserves the source language. Automated translation needs a separate model/API and review rules.
- Ingredient quantities and shopping-item checkboxes are intentionally absent.
- 17 of 217 ingredients still link to their section's aisle because Barbora's tree does not distinguish them safely (for example dry versus canned chickpeas). The picker closes the gap for anything worth choosing by hand.
- Barbora's app-link files contain at least one retired route that launches the app and then returns a 404. Links therefore always preserve the crawler's current website path and use plain HTTPS with `target="_blank"`. Whether the link opens the app is decided by the OS and Barbora's association files. On iOS the preference may have to be granted once — long-press a category link in Notes and choose **Open in Barbora**.
- The PWA restores the active tab, each tab's scroll position, and the expanded library recipe across an app switch and after the phone evicts and reloads it. A remembered position lasts an hour, so opening the app the next morning starts at the top; the tab survives either way. Unsaved editor drafts are not persisted.
- Back does not step up a level inside the category picker; it closes the picker. Settings pages and dialogs do step back one at a time.
- No recipe images or licensing machinery.
