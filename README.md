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
- One-tap shopping completion that atomically moves planned meals to Current
- Soft deletion and recovery
- Live refresh when the other person edits data
- Installable PWA layout for Android and iOS, remembering your tab and scroll position across app switches and eviction
- Lithuanian interface copy and metadata
- Automatic dish-type and cuisine classification with manual editing
- Library search across recipe names, ingredients, dish types, and cuisines
- Library sections grouped by dish type, with cuisine shown as an extra tag
- Household ingredient and recipe-category management from the settings menu

## Run locally

Requirements: Node 24 or later.

```bash
npm ci
npm run dev
```

The Supabase project URL and publishable key are included in `src/lib/supabase.ts`. A publishable key is designed to be public; access is enforced by RLS. Never put a Supabase secret/service-role key in this repository.

## Testing

```bash
npm test          # 52 unit tests: the parser, classifier, Barbora mapper, crawler
npm run harness   # the real app on an emulated phone, against a fake Supabase
```

The harness exists because this app's bugs are rarely logic bugs. They are about what a thumb can reach with the keyboard up, and where you land after switching apps — which no unit test sees. It builds the app against an in-memory stub, drives it in a phone-emulated browser, and checks layout, the keyboard, modal stacking, and view restoration. It never touches the real Supabase project.

It needs Playwright, which is installed on demand rather than carried as a dependency:

```bash
npm i --no-save playwright@1.62.1
```

[`scripts/harness/README.md`](scripts/harness/README.md) explains the scenarios, how to add one, and the pitfalls — above all that Playwright's own `click()` scrolls the page and will invent bugs that are not there.

The app also keeps its own record of what happened to the scroll position — the last 60 events, readable on the phone under **Nustatymai → Slinkties žurnalas**, because the moment restoration fails in has no console attached.

## First use

1. Create an account in the app and confirm the email if Supabase asks.
2. One person creates the kitchen.
3. Open the `•••` menu and copy the invite code.
4. The other person creates their own account and joins with that code.

For confirmation links, set the Supabase **Authentication → URL Configuration → Site URL** to the deployed app URL and add local/deployed redirect URLs as needed.

## Deploy with GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds every push to `main`. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source. The production build uses `/recipes/` as its base path.

The repository is public because GitHub Pages needs a paid plan to serve a private one. If Pages is ever unavailable, the same `dist` folder deploys unchanged to Cloudflare Pages, Netlify, or Vercel.

Being public matters for Actions secrets: logs and artifacts are world-readable, so no workflow holding a Supabase secret key may ever gain a trigger that runs pull-request code. See [`docs/barbora-category-integration.md`](docs/barbora-category-integration.md).

## Database

The live schema is in Supabase project `recipes` (`malrgdecuaqtkwnloixa`). The reproducible SQL lives in `supabase/migrations/`, applied in filename order. Ingredients are a per-household vocabulary with two independent axes: `section` is the part of a shop it is bought in, `food_type` is what the food actually is. Recipes carry free-form tags through `recipe_tags`.

Every public table has RLS. Policies authorize through `household_members`, not user-editable JWT metadata. The two household RPCs authenticate the caller and have execution revoked from `PUBLIC` and `anon`; `publish_barbora_categories` is revoked from browser clients entirely and granted only to the server-side role.

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

Barbora's bot protection currently refuses the crawler, so the catalogue is refreshed rarely and by hand. Nothing in the app depends on a successful run: a blocked run, or one failing any validation check, writes nothing and leaves the published catalogue in place. The **Crawl Barbora categories** workflow runs the same crawl on demand and publishes the result.

## Current MVP limits

- The importer parses checkboxes, numbering, dish names, and comma-separated ingredients, but preserves the source language. Automated translation needs a separate model/API and review rules.
- Ingredient quantities and shopping-item checkboxes are intentionally absent.
- 17 of 217 ingredients still link to their section's aisle because Barbora's tree does not distinguish them safely (for example dry versus canned chickpeas). The picker closes the gap for anything worth choosing by hand.
- Barbora's app-link files contain at least one retired route that launches the app and then returns a 404. Links therefore always preserve the crawler's current website path and use plain HTTPS with `target="_blank"`. Whether the link opens the app is decided by the OS and Barbora's association files. On iOS the preference may have to be granted once — long-press a category link in Notes and choose **Open in Barbora**.
- The PWA restores the active tab, each tab's scroll position, and the expanded library recipe after iOS evicts and reloads it. Unsaved editor drafts are not persisted. Scroll restoration is still reported as failing on at least one real device where every scenario passes — **Nustatymai → Slinkties žurnalas** records what the phone actually did, so the next report can say which half of it broke.
- No recipe images or licensing machinery.
