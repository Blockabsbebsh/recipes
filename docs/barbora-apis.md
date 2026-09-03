# Barbora's surfaces: a reference

What Barbora runs, what each surface will and will not tell you, and what was tried and did not work. Written on 2026-09-03 from live captures, so that none of it has to be worked out a second time.

**None of this is a public API.** There is no documentation, no versioning promise, no rate-limit contract, and no changelog. It is the private backend of Barbora's own website and mobile app, and it can change without notice. Everything below is an observation with a date on it, not a guarantee. Before building on any of it, re-verify with the snippets at the end.

Two documents sit above this one: [`barbora-category-integration.md`](barbora-category-integration.md) for aisle links and the category catalogue, and [`barbora-product-pricing.md`](barbora-product-pricing.md) for the price feature that came out of these findings.

## The four surfaces

| Surface | What it is | Usable? |
| --- | --- | --- |
| `barbora.lt` HTML pages | Server-rendered, prices included | **No.** Cloudflare refuses automated fetching on IP reputation |
| `ac.cnstrc.com` | Constructor.io — search index and behavioural beacons | **Yes.** Unauthenticated, permissive CORS, no prices |
| `barbora.lt/api/eshop/v1/` | The eshop backend the site and app run on | **Yes, server-side.** Unauthenticated, prices, but no CORS headers |
| `production-elb.barbora.lt` | A second API host — banners, analytics | Not explored beyond noticing it |

## Everything on the page is server-rendered

This is the finding that explains all the others. Searching `pienas` on barbora.lt fires exactly three requests to `ac.cnstrc.com`, and **all three are analytics beacons returning `204 No Content`**:

| Request | What it is |
| --- | --- |
| `GET /autocomplete/{term}/search?original_query=…` | `trackSearchSubmit` |
| `GET /autocomplete/{term}/select?tr=enter&section=Search Suggestions` | `trackAutocompleteSelect` |
| `POST /v2/behavioral_action/search_result_load` | results-page-loaded beacon |

The data endpoints are the same paths **without** the trailing `/search` or `/select`. Category pagination behaves identically — page 2 fires no data request at all.

So Barbora's server calls Constructor server-to-server, joins prices from its own systems, and ships finished HTML. The browser is told what happened afterwards. **No configuration of the Constructor endpoint can produce prices, because Barbora's own front end does not get them that way either.**

## Constructor.io

```
GET https://ac.cnstrc.com/search/{query}
      ?key=key_ptvOPViaQiWJxzdL      public client key, served on every page
      &section=Products
      &num_results_per_page=6
      &us=X500                        store; scopes the result set and stock
```

Permissive CORS, no auth, no session needed. `c`, `i`, `s` (client/user/session) are optional. Adding `us=X500` narrowed `pienas` from 2498 to 1436 results.

**What a result carries** — the whole `data` object, verbatim:

```
id  url  brand  image_url  description  group_ids
inStock_X325 … inStock_X864          per store, boolean — UNRELIABLE, see below
isOnSale_X325 … isOnSale_X864        per store, boolean
inAssortment_X325 … inAssortment_X864
```

**Do not use `inStock_*` for availability.** On 2026-09-03 a search for `avietiniai pomidorai` returned two products flagged out of stock that the shop was selling at 1,49 € and 4,69 €, and one flagged in stock that the shop refused to sell — all three confirmed by opening the product pages. It is a periodically rebuilt index; the live `status` field on an inventory record is the one that matches what a shopper sees. `inAssortment_*` is no better: it stays `true` for suspended products, so it means "this shop carries this line", not "you can buy it".

`id` is an 18-digit zero-padded material number — the same id the eshop API takes. `url` is the product page slug: `https://barbora.lt/produktai/{url}`.

**There is no price in this index.** Established three ways:

1. `fmt_options[hidden_fields]` was asked for `price`, `sale_price`, `regular_price`, `price_1`, `unit_price`, then for the store-suffixed shapes the index actually uses (`price_X500`, `Price_X500`, `salePrice_X500`, … 14 names). The server echoed every name back in the request and returned none of them.
2. `sort_options` contains only `relevance` and `Brand`. No price sort.
3. The facets are `HasLoyaltyDiscount_X{325,481,483,500,532,631,693,864}`, `brand`, `countryOfOrigin`, `tags`. No price range facet.

Barbora indexed the price-*adjacent* booleans — on sale, has loyalty discount, in stock — and left the number out. That looks deliberate rather than accidental.

**The response also carries the category tree.** Each group has `group_id`, `display_name`, `is_active`, display names in Lithuanian, English and Russian, and a `url` of the form `c/JZV8/pieno-gaminiai-kiausiniai-ir-majonezas`. Note that this `c/{id}/{slug}` scheme is **not** the `/pieno-gaminiai-kiausiniai-ir-majonezas` scheme the published catalogue uses, and whether it opens the Barbora app is untested. This request used `groups_max_depth: 1`; raising it should return deeper levels.

## The eshop API

Base path `https://barbora.lt/api/eshop/v1/`. Endpoints are assembled at runtime from that constant plus a method string, which is why grepping the bundle for the full path finds only the base. Their client helper is `F()(method, path, body)`.

**Every endpoint referenced in the site bundle**, as of 2026-09-03:

```
product/GetInventories                      cart/item[?id=…]
product/getSearchPlaceholderInventories     cart/getsinglebasket?basketId=
promo/GetHomePromos                         cart/removeallitems
recommendations/GetHomeRecommendationsInventories
popupcampaign/GetAvailablePopUpCampaign?urlAttribute=
cart/GetAdditionalOrderBasketItems          cart/GetDonationsCategories
cart/IsUserEmailVerified                    cart/SetPickingAction
cart/UpdateBasketAddition                   cart/UpdateDonationCategoryId
cart/getfavbasketvaluesbymatnr?matnr=       order/info?orderid=
order/list?limit=…&offset=                  order/AddToCartFromBasketFavourites
order/ConfirmArrivalInDriveIn               order/DeleteSavedBasket
order/DownloadCustomerInvoice?orderId=      order/SubmitOrderFeedback
user/info  user/address  user/cities  user/loyaltycard  user/changepassword
user/GetSavedBaskets  user/CreateSavedBasket  user/SetLanguage  user/remind
user/CheckCustomerAlreadyRegistered?email=  user/deleteaccount  user/resetpassword
userAuth/login  UserAuth/register  UserAuth/SocialLogin  UserAuth/ValidateRegistrationInfo
```

Everything under `cart/`, `order/`, `user/` and `userAuth/` needs a signed-in session and is nobody's business here. `matnr` in `getfavbasketvaluesbymatnr` is SAP's *material number*, which confirms what the 18-digit ids are.

**There is no text-search endpoint.** Search is Constructor's job, called server-side. That is why the price feature needs both calls.

### `POST product/GetInventories`

Body is a bare JSON array of product ids. Returns an array of inventory records. Observed to preserve input order, but nothing should rely on that — index by `id`.

```json
["000000000000892000", "000000000000534864"]
```

An anonymous call returns `shopcode: "X500"` and prices matching what a signed-in browser sees. The fields that matter:

```
id  title  shopcode  Url  brand_name  brand_id
status                      "active" or "suspended". Suspended means the shop
                            will not sell it today. This is the availability
                            signal; anything else, treat as unknown
price                       what you pay now
retail_price                the was-price — often equal to price, so only a
                            was-price when genuinely higher
comparative_unit            "kg", "l", "vnt."
comparative_unit_price      …_brutto and …_netto also present
promotion { oldPrice, percentage, type, loyaltyCardRequired, minQuantity,
            orMore, mixAndMatch, id, promoVisibility }
            type seen: LOYALTY_PRICE, DISCOUNT_PRICE, CATEGORY_PERCENTAGE
units [ { price, retail_price, unit, min, max, step, defaultValue } ]
            `max` is a per-order purchase cap, NOT availability: it reads
            10 on suspended products too
attributes.additional { sugar_free, e_free, lactose_free, gluten_free, eco,
            frozen, is_for_vegetarians, yellow_price, … }
image  big_image  images_original
category_id  root_category_id
category_name_full_path     "Pieno gaminiai…/Grietinė ir grietinėlė/…"
category_path_url           "pieno-gaminiai-…/grietine-ir-grietinele/…"
```

**`category_path_url` is the same slug scheme as `data/barbora-categories.json`.** That is the standing lead for reviving the parked category crawler without Playwright or Cloudflare.

### `GET product/getSearchPlaceholderInventories`

Eight featured products with full pricing. Ignores every parameter — it is the fixed list behind the empty search box. Useless as a query, but it was the thread that led to the namespace, and it is a good zero-argument endpoint for connectivity checks.

## Access characteristics

**CORS.** `barbora.lt` sends no `Access-Control-Allow-Origin`. A cross-origin browser fetch gets `200` from the server and a refusal from the browser. Same-origin (a console on barbora.lt, or a userscript) works. Server-side, CORS does not exist, so an Edge Function simply reads it. `ac.cnstrc.com` is permissive and callable from anywhere.

**Cloudflare.** The HTML pages are guarded and refuse datacentre IPs — see the parked crawler in [`barbora-category-integration.md`](barbora-category-integration.md), which degraded to 403 on IP reputation with a real Chrome and a persistent profile. **The API is not.** From a Supabase Edge Function in Frankfurt: `200`, `cf_mitigated: null`, 34–37 ms, on both the placeholder and `GetInventories`.

**The user-agent does not matter.** A string identifying itself honestly as this app performed identically to a Firefox string. Nothing here depends on looking like a browser, and no fingerprint evasion is involved. The likely reason the API is open is that Barbora's mobile app calls it from arbitrary consumer IPs with no browser fingerprint, so it cannot be guarded the way the website is.

**Store codes.** Eight appear in the facets: `X325 X481 X483 X500 X532 X631 X693 X864`. The same code is `us=X500` on Constructor, the `_X500` field suffix, and `shopcode` in the eshop response.

This household's is **X500**, and that is established rather than inferred: `window.b_user_info.customerShopCode` reads `X500` in a signed-in session, the eshop API stamps `shopcode: "X500"` on responses to both that session and an anonymous server-side call, and both return the same price for the same product.

**The client never chooses a store.** There is not a single `X###` literal anywhere in the site bundle, and no store code in any cookie — only `X-Session-ID`, `X-Fingerprint` and the AWS load-balancer stickiness pair. The server resolves the shop from the session and stamps it onto the response.

**The codes are not decorative.** Stock and promotions genuinely differ between them. One `pienas` search returned loyalty-discount counts of 83, 89, 88, 87, 84, 81, 75 and 73 across the eight, and a carton of milk that was `inStock_X325: false` while five other codes had it. Whether the *base* price is uniform nationally is untested and not testable from one account: `GetInventories` only ever answers for the store the session resolves to.

**An invoice may show a different code in a different namespace.** A delivery invoiced from Ozo g. 25 carried `X555`, which is not one of the eight and is not this account's `customerShopCode`. Reading it as a fulfilment or issuing site rather than a price zone is the interpretation that fits, though nothing here proves it.

**The shop code follows the delivery address.** Adding a Kaunas address to this account changed `customerShopCode` from `X500` to `X481` — so the code is a property of where the order goes, not of the account. Two are known by observation: **X500 serves Vilnius, X481 serves Kaunas**. The other six are unidentified.

**What actually differs between stores.** With the same three products read from a Vilnius session and then a Kaunas one:

| | X500 Vilnius | X481 Kaunas |
| --- | --- | --- |
| Farm Milk, 1 l | 0.94, no promotion, active | 0.94, no promotion, active |
| Rokiškio grietinė, 400 g | 1.79 was 2.69, −33 % | 1.79 was 2.69, −33 % |
| Brets traškučiai, 125 g | 2.39, **suspended** | 2.39, **active** |

Prices and the discount were identical; availability was not. Three products across two stores is evidence, not proof — and it does **not** generalise to promotions, which the facets disprove directly: one `pienas` search returned per-store loyalty-discount counts of 83, 89, 88, 87, 84, 81, 75 and 73. So: base prices probably national, promotions usually but demonstrably not always, stock genuinely local.

**There is no *published* mapping from a place to a shop code.** `GET user/cities` returns 14 served areas as `{ id, title, RegionId }` — Vilnius and Trakai share `RegionId: 1`, Klaipėda/Kretinga/Palanga share `3` — so regions are coarser than cities, and 11 distinct regions against 8 shop codes means regions are not shops either. Three granularities, none derivable from the others. `b_data.regionShortId` is not the missing link: it reads `LT_MAIN_WEB`, a site identifier rather than a region. And there is no store or delivery-location endpoint anywhere in the client, because their server always decides.

**Which means one store serves every user of an app like this one.** A request carrying no session gets Barbora's default — X500 — whoever made it and wherever they live. An app that calls through one server is therefore pinned to one store's prices for everyone. `us=<code>` does scope Constructor's stock and assortment per store, so availability *can* be made correct per city; prices cannot, unless `GetInventories` turns out to take a store parameter, which is untested. Mixing correct availability with one store's prices is worse than being uniformly one store's, unless the screen says which.

**robots.txt.** The copy in `scripts/barbora/fixtures/robots.txt` records `Disallow: /paieska`, `/krepselis`, `/produktai/*?` and `Allow: /` — so product pages without a query string are allowed and search is not. That fixture is trimmed and the crawler reads the live file at run time; re-read it before relying on the detail. It says nothing about `/api/`, and robots.txt governs crawlers rather than an app's own backend in any case.

## Proven, versus assumed

| Claim | Status |
| --- | --- |
| Constructor's ids are the eshop API's material numbers | **Proven** — round-tripped end to end |
| Constructor's index holds no price | **Strongly evidenced** — 19 field names, no sort, no facet. Name guessing can never be exhaustive |
| The results page and category pages are server-rendered | **Proven** — zero data XHRs observed |
| `GetInventories` answers a datacentre IP | **Proven** — 200 from Frankfurt, twice, two user-agents |
| `X500` is this household's shop | **Proven** — `b_user_info.customerShopCode`, in a signed-in session |
| `X500` is also the anonymous default | **Assumed** — ours resolves there too, so the two cannot be told apart from here |
| Stock and promotions vary by store code | **Proven** — differing per-code counts and flags in one search |
| Base prices are the same nationally | **Untested.** One account sees one store; there is no way to compare from here |
| The `X555` on an invoice is a different namespace | **Inferred** — this account's shop code is X500, so X555 is something else |
| The shop code follows the delivery address | **Proven** — changing the address moved this account from X500 to X481 |
| X500 serves Vilnius, X481 serves Kaunas | **Proven** by observation. The other six codes are unidentified |
| A place can be mapped to a shop code from published data | **Disproven** — cities, regions and shops are three granularities with no published mapping. Only changing an address reveals one |
| Base prices are the same nationally | **Evidenced, not proven** — three products identical across X500 and X481 |
| Promotions are the same across stores | **Disproven** — per-store loyalty-discount counts differ, even though the three sampled products matched |
| Availability differs between stores | **Proven** — one product suspended at X500 and active at X481 |
| `GetInventories` accepts a store parameter | **Still untested**, and no longer needed to compare stores: changing the delivery address moves the whole session, which is how the table above was gathered |
| `GetInventories` preserves input order | **Observed once.** Do not rely on it |
| `status: "suspended"` means you cannot buy it | **Proven** — two suspended products, both unavailable on their pages |
| `active` and `suspended` are the only `status` values | **Assumed.** Only those two have been seen. Treat anything else as unknown rather than as available |
| Constructor's `inStock_*` reflects real availability | **Disproven** — wrong in both directions in one six-row sample |
| `c/{id}/{slug}` category URLs open the Barbora app | **Untested** |
| Barbora's terms permit this | **Not established.** Assume automated access is disallowed in the fine print, as it is everywhere |

## Dead ends — do not re-run these

- `fmt_options[show_hidden_fields]=true` → `"You must supply an authorized token."` It is a server-token parameter; a public client key cannot bulk-enumerate hidden fields.
- Guessing price field names through `fmt_options[hidden_fields]`. Nineteen names across two rounds, including the store-suffixed convention the index actually uses. Nothing.
- Filtering the Network tab to `cnstrc`. **This is what hid the eshop API for six rounds of investigation.** Look at the site's own requests first.
- Expecting an XHR on search submit or on category page 2. There isn't one.
- Fetching `barbora.lt` HTML from a datacentre. Already established as blocked; nothing has changed.
- Looking for a shop-code list, in the bundle or in an endpoint. There is neither. `b_data.regionShortId` is `LT_MAIN_WEB`, not a region id, and `ShopInShop/GetShopInShopSmallBanners` is about brands sold inside the shop, not locations.

## Re-verifying

Firefox blocks console pasting until you type `allow pasting` once.

```js
// On any page — Constructor is CORS-permissive.
const u = new URL('https://ac.cnstrc.com/search/pienas')
u.searchParams.set('key', 'key_ptvOPViaQiWJxzdL')
u.searchParams.set('section', 'Products')
u.searchParams.set('num_results_per_page', '3')
u.searchParams.set('us', 'X500')
const r = await (await fetch(u)).json()
console.log(r.response.results[0].data, r.response.sort_options, r.response.facets.map(f => f.name))
```

```js
// On barbora.lt only — no CORS headers, so this fails anywhere else.
await (await fetch('/api/eshop/v1/product/GetInventories', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(['000000000000892000']),
})).json()
```

```js
// On barbora.lt — re-list the API surface from their own bundle.
(async () => {
  const srcs = [...document.querySelectorAll('script[src]')]
    .map((s) => s.src).filter((u) => new URL(u).origin === location.origin)
  const t = (await Promise.all(srcs.map((u) => fetch(u).then((r) => r.text()).catch(() => '')))).join('\n')
  const hits = new Set()
  for (const m of t.matchAll(/["'`]([^"'`\s]{3,90})["'`]/g))
    if (/Inventor|^(product|cart|categor|order|user|promo|recommendations|popupcampaign)[\w-]*\//i.test(m[1])) hits.add(m[1])
  console.log([...hits].sort().join('\n'))
})()
```

To check whether the API still answers a server rather than a browser, deploy a throwaway Edge Function that fetches `getSearchPlaceholderInventories` and reports the status code. Gate it behind a token, keep `verify_jwt` on, and delete it afterwards.
