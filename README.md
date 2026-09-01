# Recipes

A shared, mobile-first recipe library, current meal roster, and deliberately simple shopping list for two people. It is a static React PWA backed by Supabase Auth, Postgres, Realtime, and Row Level Security.

## What works

- Separate email/password accounts sharing one household through an invite code
- Compact, dish-type-grouped recipe library with expandable details, actions, notes, and source links
- Checklist importer with editable previews and case/quantity-tolerant ingredient matching
- Current recipes with Cooked/Skipped actions and a 30-second Undo
- Recently cooked section for the last five days and per-recipe last-cooked dates
- Temporary meal batch and a deduplicated ingredient list showing which recipes use each item
- Barbora search links for individual ingredients, native-link category shortcuts, and a device link test in Settings
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

## Current MVP limits

- The importer parses checkboxes, numbering, dish names, and comma-separated ingredients, but preserves the source language. Automated translation needs a separate model/API and review rules.
- Ingredient quantities and shopping-item checkboxes are intentionally absent.
- Barbora ingredient links use HTTPS search URLs. The Settings link test compares search, Android intent, category, and exact-product routes because native-app opening is controlled by Barbora's iOS/Android association files and the device. Basket aisle headings use Barbora category URLs, which are more stable than exact product SKUs.
- No recipe images or licensing machinery.
