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
- Installable PWA layout for Android and iOS
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

## First use

1. Create an account in the app and confirm the email if Supabase asks.
2. One person creates the kitchen.
3. Open the `•••` menu and copy the invite code.
4. The other person creates their own account and joins with that code.

For confirmation links, set the Supabase **Authentication → URL Configuration → Site URL** to the deployed app URL and add local/deployed redirect URLs as needed.

## Deploy with GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds every push to `main`. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source. The production build uses `/recipes/` as its base path.

If Pages is unavailable for this private repository on the current GitHub plan, the same `dist` folder can be deployed unchanged to Cloudflare Pages, Netlify, or Vercel.

## Database

The live schema is in Supabase project `recipes` (`malrgdecuaqtkwnloixa`). The reproducible SQL lives in `supabase/migrations/`, applied in filename order. Ingredients are a per-household vocabulary with two independent axes: `section` is the part of a shop it is bought in, `food_type` is what the food actually is. Recipes carry free-form tags through `recipe_tags`.

Every public table has RLS. Policies authorize through `household_members`, not user-editable JWT metadata. The two privileged RPCs authenticate the caller and have execution revoked from `PUBLIC` and `anon`.

Recipe classifications reuse the existing normalized tag relation. Machine-readable names use `Tipas: ` for the single dish-type axis and `Virtuvė: ` for cuisine; the UI removes those prefixes. Dish type controls library grouping, while both axes participate in search. New recipes are classified locally with deterministic Lithuanian/English keyword rules and can be corrected in the editor.

## Barbora category catalogue

`data/barbora-categories.json` is the reviewed snapshot of Barbora's shopping hierarchy: 636 categories under 11 top-level aisles, three levels deep. It is rebuilt by the category-only crawler in `scripts/barbora/`, which reads one page per top-level aisle because each of those pages already renders its whole child and grandchild tree. Nothing about products, prices, or stock is crawled.

```bash
npm i --no-save playwright@1.62.1
npx playwright install chromium
npm run crawl:barbora
```

Barbora's bot protection currently refuses the crawler, so the catalogue is refreshed rarely and by hand; nothing in the app depends on a successful run. A run that is blocked, or that fails any validation check, writes nothing and leaves the previous catalogue in place. The **Crawl Barbora categories** workflow runs the same crawl on demand, uploads the result and its diff as an artifact, and publishes it to Supabase once the `SUPABASE_URL` and `SUPABASE_SECRET_KEY` repository secrets are configured.

The catalogue lives in `public.barbora_categories`, which is global reference data rather than household data: signed-in members may read active rows and may not write them, and publication is a single transaction through a function only the server-side key can execute. `public.ingredients` carries four nullable mapping columns alongside the untouched `section` and `food_type`. Details are in [`docs/barbora-category-integration.md`](docs/barbora-category-integration.md).

## Current MVP limits

- The importer parses checkboxes, numbering, dish names, and comma-separated ingredients, but preserves the source language. Automated translation needs a separate model/API and review rules.
- Ingredient quantities and shopping-item checkboxes are intentionally absent.
- Ingredient links are ordinary Barbora category URLs on both platforms. Device testing confirmed these open the Android app directly; on iOS, choosing **Open in Barbora** once from a long-pressed category link in Notes restores the Universal Link preference, after which they open the app from this PWA too.
- 66 of the 217 vocabulary ingredients carry an automatic category. The rest link to their section's aisle, which is as specific as the shop's own wording allows without guessing; any of them can be set by hand in **Ingredientai**.
- PWA tab and scroll restoration is still planned, in [`docs/barbora-category-integration.md`](docs/barbora-category-integration.md).
- No recipe images or licensing machinery.
