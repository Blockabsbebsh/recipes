# Barbora product pricing

How tapping an ingredient on the shopping list shows what Barbora sells, at what price, with a link that opens the shop's app.

Built on 2026-09-03, against the state of the shop that day. [`barbora-category-integration.md`](barbora-category-integration.md) covers the older, separate feature — which *aisle* an ingredient links to — and is still accurate; this is the layer above it.

## Outcome

The shopping list used to link each ingredient to a Barbora category, which is a good answer to "where do I find this" and no answer at all to "which one, and what does it cost". Tapping an ingredient now opens a sheet with the two or three products Barbora actually matches, each with its price, its was-price when discounted, its price per kilo or litre, whether it is in stock at our shop, and a link straight to the product page.

Nothing is scraped, no HTML is parsed, and no bot protection is involved. Both calls are the same unauthenticated JSON Barbora's own website and mobile app use.

## The two APIs, and the id that joins them

```
GET  ac.cnstrc.com/search/{query}?key=…&section=Products&us=X500
POST barbora.lt/api/eshop/v1/product/GetInventories        body: ["000000000000892000", …]
```

Barbora's search runs on **Constructor.io**. Its results carry a product id, a URL slug, brand, image, and per-store stock — and **no prices at all**. Barbora's own **eshop API** takes an array of those same ids and answers with `price`, `retail_price`, `comparative_unit_price`, and a `promotion` block. The id is the same 18-digit material number in both, so one is the index and the other is the price list.

A real answer, for the milk that a search for `pienas` returns first:

```json
{ "id": "000000000000892000",
  "title": "UAT pienas FARM MILK, 3,2% rieb., 1 l",
  "shopcode": "X500", "price": 0.94,
  "comparative_unit": "l", "comparative_unit_price": 0.94,
  "promotion": null, "Url": "uat-pienas-farm-milk-3-2-proc-rieb-1-l" }
```

`GetInventories` preserves the order of the ids it is given. Nothing here is built on that — the records are indexed by id, so a partial or reordered answer still lands on the right products.

## Why it took finding

The obvious reading of Barbora is that prices are server-rendered into the HTML and reachable no other way. That reading is correct about the HTML and wrong about the conclusion, and it took a while to see why.

**The browser never asks Constructor for anything.** Watching a search for `pienas` shows three requests to `ac.cnstrc.com`, and all three are analytics beacons — `trackSearchSubmit`, `trackAutocompleteSelect`, and `search_result_load`, each returning `204 No Content`. The results grid arrives already rendered; Constructor is told what happened afterwards. Category pagination behaves the same way. So no amount of work on the Constructor endpoint could produce prices, because Barbora's own front end does not get them that way either.

**Constructor's index genuinely has no price.** Asking for it explicitly through `fmt_options[hidden_fields]` — fourteen candidate names, including the `price_X500` shape the rest of the index uses — returns nothing. There is no price sort option and no price facet. What the index *does* carry is `inStock_X500`, `isOnSale_X500`, `inAssortment_X500` and `HasLoyaltyDiscount_X500`: someone deliberately indexed the price-adjacent booleans and left the number out. `fmt_options[show_hidden_fields]` needs a server-side token, so that door is shut too.

**The API was hidden by the search filter, not by Barbora.** Every network capture had been filtered to `cnstrc`, which hid every request to `barbora.lt` itself. Removing the filter showed `getSearchPlaceholderInventories` — full pricing, in JSON, on Barbora's own domain — and its path, `/api/eshop/v1/product/…`, named a whole REST namespace. Grepping the site's bundle for that namespace turned up `product/GetInventories`, and its call site gave the contract outright:

```js
F()("POST", "product/GetInventories", [t.ProductCode]).then(n => …n[0])
```

**And it answers a datacentre.** The category crawler in `scripts/barbora/` has been parked since 2026-09-01 because Cloudflare refuses it — a first run degraded to 403 and a second was refused at the homepage, on IP reputation rather than markup. That wall is around the HTML pages. This API answered a Supabase Edge Function in Frankfurt with `200` and `cf_mitigated: null`, in 37 ms, **with a user-agent that identifies itself honestly as this app**. A browser user-agent performed identically, so nothing here depends on looking like a browser and no fingerprint evasion is involved — the line the crawler declined to cross stays uncrossed. The likely reason is simply that Barbora's mobile app hits this API from arbitrary consumer IPs with no browser fingerprint, so it cannot be guarded the way the website is.

## Why an Edge Function

`barbora.lt` sends no `Access-Control-Allow-Origin`, so a browser on another origin gets `200` from the server and a refusal from itself. CORS is a browser policy, not a server one, so a server-side fetch simply reads the response.

`supabase/functions/barbora-products/` is therefore **a deliberately dumb proxy**. It takes `{ query, limit }`, makes the two calls, and forwards both raw arrays. It holds no judgement, because judgement in an Edge Function is judgement without unit tests — everything that decides anything lives in `src/lib/barboraProducts.js`, which runs in the app and is tested there. The practical benefit is that the function almost never needs redeploying.

What it does hold:

- `verify_jwt` is **on**. Only a signed-in member can spend our quota or make requests of Barbora in our name.
- A ten-minute in-memory cache, keyed by query and limit, capped at 200 entries. Long enough that walking a list is one round trip per ingredient; short enough that a promotion starting today is not missed by much. A degraded answer is never cached.
- A limit of six results, hard-capped at ten, and queries over 80 characters refused.
- An honest `User-Agent` naming the app and this repository.
- Graceful degradation: if the search succeeds and `GetInventories` fails, the matches are returned anyway with no prices. Products with working links and no price are better than an empty sheet, and the client renders them as unpriced rather than inventing a number.

**The deployed function and `supabase/functions/barbora-products/index.ts` must be kept identical.** There is no CI step that checks this; changing the file means redeploying it.

## The rules in `barboraProducts.js`

The same instinct as the category mapper: decline rather than guess.

- **A product with no inventory record is still listed, priced nothing.** It is a real product with a working link; dropping it would quietly shorten the alternatives, and inventing a price would be worse than both.
- **`retail_price` is only a was-price when it is genuinely higher.** Barbora sends it equal to `price` on plenty of undiscounted rows, and "was 0,94 €, now 0,94 €" reads as a bug.
- **The discount percentage is Barbora's own `promotion.percentage`**, because that is the number their pages show. Arithmetic on the two prices is only a fallback, and a computed zero is not a discount.
- **A loyalty price is labelled as one.** `loyaltyCardRequired` means the number shown is not what you pay without the card.
- **Stock is read for our store, and silence is not "out of stock".** `inStock_X500` missing gives `null`, which renders as nothing at all rather than as a warning.
- **Relevance order survives.** Constructor ranks by closeness to what was typed, which is what a shopping list wants. Ranking only demotes rows you cannot act on — unpriced last, known out-of-stock above them — and leaves the rest in the order they arrived. Cheaper is not better: a cheap wrong product is worse than an accurate expensive one.
- Prices are written the Lithuanian way, `0,94 €`, and per-unit rates as `4,48 € / kg`.

## The store code

`BARBORA_STORE = 'X500'` in `src/lib/barboraProducts.js`, and `STORE` in the Edge Function. **The two must match.**

X500 appears to be Barbora's default and is this household's shop: an anonymous server-side call returns `shopcode: "X500"`, and its prices match what the browser shows while signed in. Barbora scopes stock, promotions and loyalty discounts per store — the same code is the `us=X500` parameter on Constructor requests and the `_X500` suffix on its per-store fields — so if either of us ever switches shops, these two constants are the change, and the Edge Function needs redeploying.

## What the sheet shows

`src/components/BarboraProductsModal.tsx`, opened from the shopping list in **Krepšelis**.

- The ingredient name is now a button rather than a link. Tapping it opens the sheet.
- **The aisle link is drawn first, from data the app already holds, before anything is fetched.** A tap is therefore never a dead end: a failed lookup, an empty result, or no network still leaves you one tap from where the ingredient lives in the shop — which is exactly what the list did before this existed. It costs one extra tap compared to the old behaviour, and buys never showing a spinner that ends in nothing.
- Each product row is image, title, brand, price, was-price, a `-33 %` badge, the per-unit rate, and `Neturima` when the shop says it is out of stock at X500.
- Every link is a plain HTTPS link to `/produktai/{slug}` with `target="_blank"`, traced through `scrollTrace` like the category links. Product links open the Barbora app reliably on both phones, which `/paieska` links never did.
- A closing note says the prices are for store X500 and that only the shop confirms them.

Reopening on a different ingredient discards the first one's answer, and a sheet closed before its answer arrives does not write into a component that has gone.

## Tests

`src/lib/barboraProducts.test.mjs` — 17 tests, in `npm test`. The fixtures are trimmed copies of real responses captured on 2026-09-03, kept verbatim because the shapes are Barbora's, not ours.

They cover the id join, a deliberately reordered inventory answer, the was-price rule in both directions, the stated and the computed discount, the loyalty flag, a product with no inventory, stock read for a store that is not ours, the ranking rules including that cheaper does not win, duplicate and id-less results, missing payloads, and both number formats.

`npm run harness` reaches the sheet through a stub route in `scripts/harness/server.mjs` that answers from a fixture. The harness must never reach Barbora — a scenario that depended on a real shop's stock and prices would fail for reasons that have nothing to do with this app — so the stub serves the same shapes the Edge Function forwards, which means the merge is exercised for real while the network is not.

## Outstanding work

1. **Device acceptance on both phones.** That a `/produktai/` link opens the Barbora app is established by hand; that it does so *from this dialog*, and that closing the app returns to the same tab and scroll position, has not been checked on either phone.
2. **No caching beyond the Edge Function's ten minutes.** Every cold tap is two upstream calls. That is fine at this volume — a tap is a deliberate act by one of two people — but a shopping list opened repeatedly will re-fetch. If it ever wants fixing, a small Postgres table keyed by product id with a fetched-at column is the shape, and it must show its age rather than present a stale price as current.
3. **The store code is a constant, not a setting.** See above.
4. **The category crawler may now be revivable.** Both Constructor's `groups` and every eshop inventory record carry `category_path_url` in the exact slug scheme `data/barbora-categories.json` already uses, plus display names in three languages — from JSON, with no Cloudflare in the path. That would address outstanding item 2 in [`barbora-category-integration.md`](barbora-category-integration.md), which has been blocked since the crawler was parked. It is a separate piece of work and is deliberately not part of this change.

## External references

- Constructor.io hidden fields: <https://docs.constructor.com/docs/using-the-constructor-dashboard-indexes-manage-searchability-and-displayability>
- Constructor.io results response structure: <https://docs.constructor.com/reference/shared-results-response-structure>
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
