# Barbora product pricing

How tapping an ingredient on the shopping list shows what Barbora sells, at what price, with a link that opens the shop's app.

Built on 2026-09-03, against the state of the shop that day. [`barbora-apis.md`](barbora-apis.md) is the reference for the APIs themselves — every endpoint, every field, the dead ends, and which findings are proven rather than assumed. [`barbora-category-integration.md`](barbora-category-integration.md) covers the older, separate feature — which *aisle* an ingredient links to — and is still accurate; this is the layer above it.

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
- **A ceiling of 30 upstream calls a minute per signed-in account**, answered with `429` and a `Retry-After`. Not a policy for people — two of us tapping a shopping list could not reach it if we tried. It is a guard against a bug: a render loop or a bad effect dependency calling this a few hundred times a minute would look exactly like abuse from Barbora's side, and we would find out by being blocked. Counted *past* the cache, so repeating something already held is absorbed rather than refused, and a refused request is not recorded — being over the limit must not extend the wait.
- Graceful degradation: if the search succeeds and `GetInventories` fails, the matches are returned anyway with no prices. Products with working links and no price are better than an empty sheet, and the client renders them as unpriced rather than inventing a number.

The window itself is `src/lib/rateLimit.js`, symlinked into the function directory rather than copied, because a limiter that silently admits everything or silently refuses everything is worse than none and neither failure is visible from outside. One file, one set of tests, no second copy to drift.

Two honest limitations. The count is **per instance**: Supabase may run several, so the real ceiling is a multiple of 30, and the cap is approximate by design — it is a backstop, not an accounting system. And the caller is identified by reading the JWT's `sub` without verifying it, which is safe only because `verify_jwt` means the platform verified it first; it decides which bucket to count against, never what anyone may do.

**The deployed function and the files in `supabase/functions/barbora-products/` must be kept identical.** There is no CI step that checks this; changing either file means redeploying both.

## The rules in `barboraProducts.js`

The same instinct as the category mapper: decline rather than guess.

- **A product with no inventory record is still listed, priced nothing.** It is a real product with a working link; dropping it would quietly shorten the alternatives, and inventing a price would be worse than both.
- **`retail_price` is only a was-price when it is genuinely higher.** Barbora sends it equal to `price` on plenty of undiscounted rows, and "was 0,94 €, now 0,94 €" reads as a bug.
- **The discount percentage is Barbora's own `promotion.percentage`**, because that is the number their pages show. Arithmetic on the two prices is only a fallback, and a computed zero is not a discount.
- **A discount conditional on quantity says so on the badge**: `-30 % (2+)`, not `-30 %`. Barbora prices these at the *undiscounted* rate until the condition is met — the cat litter in their own placeholder payload reads `price: 3.19` beside `promotion.oldPrice: 3.19` with `minQuantity: 2` — so a bare percentage claims money off that is not off.
- **An offer shape we do not model claims nothing.** `extra` can carry `buy_x_quantity_for_y_price_promo`, `buy_x_or_more_promo` or `maxi_pack_price_promo`. Three-for-two is not a percentage, and rendering it as one describes a different offer, so the badge disappears instead. The product page is one tap away and is always right.
- **A loyalty price is labelled as one.** `loyaltyCardRequired` means the number shown is not what you pay without the card.
- **Availability comes from the live record, never from the search index.** `status` is `active` or `suspended`; anything else, or no record at all, means we say nothing. Constructor's `inStock_X500` is kept as data under the name `indexedInStock` and is never rendered — see below for why.
- **A price has to be plausible, not merely present.** A null check catches a field that vanished; it does not catch one that changed units or meaning, and that failure looks exactly like success. Prices must be above zero and under a ceiling, a was-price must be strictly higher than the price, a discount must fall between 1 % and 99 %. Anything else is treated as unknown, which turns *silently wrong* into *silently absent* — the only one of those two you can live with.
- **Relevance order survives.** Constructor ranks by closeness to what was typed, which is what a shopping list wants. Ranking only demotes rows you cannot act on — unpriced last, known unavailable above them; an unknown availability is not demoted at all, because it is a product we have nothing against — and leaves the rest in the order they arrived. Cheaper is not better: a cheap wrong product is worse than an accurate expensive one.
- Prices are written the Lithuanian way, `0,94 €`, and per-unit rates as `4,48 € / kg`.

## The store code

`BARBORA_STORE = 'X500'` in `src/lib/barboraProducts.js`, and `STORE` in the Edge Function. **The two must match.**

X500 is this household's shop, confirmed rather than assumed: a signed-in session reports `customerShopCode: "X500"`, and an anonymous server-side call returns the same `shopcode` and the same prices. Nothing in Barbora's own client picks a store — there is no store code anywhere in their bundle or cookies — so the server resolves it, which is why hardcoding a constant here is the only option available and happens to be the right one. Barbora scopes stock, promotions and loyalty discounts per store — the same code is the `us=X500` parameter on Constructor requests and the `_X500` suffix on its per-store fields — so if either of us ever switches shops, these two constants are the change, and the Edge Function needs redeploying.

## What the sheet shows

`src/components/BarboraProductsModal.tsx`, opened from the shopping list in **Krepšelis**.

- The ingredient name is now a button rather than a link. Tapping it opens the sheet.
- **The aisle link is drawn first, from data the app already holds, before anything is fetched.** A tap is therefore never a dead end: a failed lookup, an empty result, or no network still leaves you one tap from where the ingredient lives in the shop — which is exactly what the list did before this existed. It costs one extra tap compared to the old behaviour, and buys never showing a spinner that ends in nothing.
- Each product row is image, title, brand, price, was-price, a `-33 %` badge, the per-unit rate, and `Neturima` when the live record says the product is suspended.
- When matches come back but prices do not, the sheet says so. "No price for this product" and "we could not fetch prices" look identical otherwise, and only one of them is worth retrying.
- Every link is a plain HTTPS link to `/produktai/{slug}` with `target="_blank"`, traced through `scrollTrace` like the category links. Product links open the Barbora app reliably on both phones, which `/paieska` links never did.
- A closing note names the shop — **Barbora Vilnius**, from `BARBORA_STORE_LABEL` — and says only the shop confirms a price. A bare `X500` told a person nothing about whose prices they were reading; Barbora publishes no name for a shop code, so the label is ours rather than theirs.
- **Our own ceiling and the shop refusing us look different**, because the answers differ — wait a moment, versus come back later. Being throttled says so in a bordered notice and names us as the cause; a failed upstream call says the shop could not be reached. Neither may be blamed for the other.

Reopening on a different ingredient discards the first one's answer, and a sheet closed before its answer arrives does not write into a component that has gone.

## Tests

`src/lib/rateLimit.test.mjs` — 10 tests covering the window: admission, refusal, that a refused request is not recorded, that room appears exactly when the oldest hit leaves, that the wait is never reported as zero, that a limit of zero fails closed, and that junk in the stored hits is ignored.

`src/lib/barboraProducts.test.mjs` — 33 tests, in `npm test`. The fixtures are trimmed copies of real responses captured on 2026-09-03, kept verbatim because the shapes are Barbora's, not ours.

They cover the id join, a deliberately reordered inventory answer, the was-price rule in both directions, the stated and the computed discount, the loyalty flag, a product with no inventory, the ranking rules including that cheaper does not win, duplicate and id-less results, missing payloads, and both number formats.

They also cover the availability bug directly, using the three real products it was found on: one Constructor marked out of stock that the shop was selling at 1,49 €, one it marked in stock that the shop would not sell, and a status value we have never seen, which must claim nothing. Alongside those, the sanity rules: a price of zero or a hundred thousand, a was-price of 99999, discounts of 0 %, 100 % and 4000 %.

`npm run harness` reaches the sheet through a stub route in `scripts/harness/server.mjs` that answers from a fixture. The harness must never reach Barbora — a scenario that depended on a real shop's stock and prices would fail for reasons that have nothing to do with this app — so the stub serves the same shapes the Edge Function forwards, which means the merge is exercised for real while the network is not.

## Outstanding work

1. **Device acceptance on both phones.** That a `/produktai/` link opens the Barbora app is established by hand; that it does so *from this dialog*, and that closing the app returns to the same tab and scroll position, has not been checked on either phone.
2. **No caching beyond the Edge Function's ten minutes.** Every cold tap is two upstream calls. That is fine at this volume — a tap is a deliberate act by one of two people — but a shopping list opened repeatedly will re-fetch. If it ever wants fixing, a small Postgres table keyed by product id with a fetched-at column is the shape, and it must show its age rather than present a stale price as current.
3. **The store code is a constant, not a setting — and everyone gets this household's store.** The Edge Function calls Barbora with no session from one server, so Barbora resolves its default (X500) for every user of this app, whoever they are and wherever they live. That is correct today, because the only two users live in Vilnius.

   It stops being correct the moment someone elsewhere is invited, and the failure is specific: **the availability badge would lie.** Prices and promotions were identical between Vilnius (X500) and Kaunas (X481) for the three products compared, but a bag of crisps was `suspended` at X500 and `active` at X481 — so a Kaunas member would be told "Neturima" about something they could buy. That is exactly the bug fixed by reading `status` instead of Constructor's index, reintroduced by geography.

   **The rule if it ever happens:** stop rendering the badge for anyone whose store we do not know, rather than render X500's. Decline rather than guess, as everywhere else here. Beyond that, `us=<code>` genuinely scopes Constructor's stock and assortment per store, so per-city availability is reachable if the household can say which store is theirs — a person reads it off `window.b_user_info.customerShopCode` on barbora.lt. Prices cannot be scoped that way, because they come from the session Barbora resolves and not from anything we send. See [`barbora-apis.md`](barbora-apis.md) for what actually differs between stores and how much of it is proven.
4. **The category crawler may now be revivable.** Both Constructor's `groups` and every eshop inventory record carry `category_path_url` in the exact slug scheme `data/barbora-categories.json` already uses, plus display names in three languages — from JSON, with no Cloudflare in the path. That would address outstanding item 2 in [`barbora-category-integration.md`](barbora-category-integration.md), which has been blocked since the crawler was parked. It is a separate piece of work and is deliberately not part of this change.

## External references

- Constructor.io hidden fields: <https://docs.constructor.com/docs/using-the-constructor-dashboard-indexes-manage-searchability-and-displayability>
- Constructor.io results response structure: <https://docs.constructor.com/reference/shared-results-response-structure>
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
