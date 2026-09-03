import { BARBORA_ORIGIN } from './barboraMapping.js'

/**
 * Turning an ingredient into two or three real Barbora products with prices.
 *
 * Two of Barbora's own APIs, joined by product id:
 *
 *   1. Constructor.io (`ac.cnstrc.com`) answers "what does `grietinė` match",
 *      returning names, brands, images, per-store stock — and no prices.
 *   2. `barbora.lt/api/eshop/v1/product/GetInventories` takes an array of those
 *      same ids and answers with prices, was-prices, per-unit rates and promos.
 *
 * Neither call is authenticated, and neither is scraped: both are the JSON
 * Barbora's own front end and app use. The browser cannot call the second one
 * (no CORS headers), so the `barbora-products` Edge Function fetches both and
 * hands the two raw arrays here. Everything below is pure, which is why the
 * function is a dumb proxy: all the judgement lives in one tested place.
 *
 * See docs/barbora-product-pricing.md.
 */

/**
 * The store whose prices and stock we read. Barbora scopes both per store, and
 * an anonymous request answers for X500, which is this household's. Changing
 * shops means changing this and redeploying the Edge Function; nothing else
 * reads it. The same code appears as `us=X500` in Constructor requests and as
 * the `_X500` suffix on its per-store fields.
 */
export const BARBORA_STORE = 'X500'

/** `data.url` from Constructor is the product page slug, not a path. */
export function productUrl(slug) {
  return `${BARBORA_ORIGIN}/produktai/${slug}`
}

/**
 * `1.79` → `1,79 €`. Lithuanian writes the decimal comma, and every price in
 * this app is euros, so the currency is a suffix rather than a formatter.
 */
export function formatPrice(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  return `${amount.toFixed(2).replace('.', ',')} €`
}

/** `{ price: 4.48, unit: 'kg' }` → `4,48 € / kg`. */
export function formatPerUnit(perUnit) {
  if (!perUnit) return null
  const price = formatPrice(perUnit.price)
  return price ? `${price} / ${perUnit.unit}` : null
}

/** `-33 %`, or nothing when the product is not discounted. */
export function dealLabel(product) {
  return typeof product.discountPercent === 'number' ? `-${product.discountPercent} %` : null
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * A boolean Barbora publishes per store, or null when it says nothing about
 * this one. Null is not false: an unknown state must not be shown as a fact,
 * the same way an unmapped ingredient gets no link rather than a guessed one.
 *
 * None of these are reliable as availability — see `availability` below.
 */
function storeFlag(data, field, store) {
  const value = data?.[`${field}_${store}`]
  return typeof value === 'boolean' ? value : null
}

/** No grocery item costs this much; a number above it is a changed field. */
const MAX_PRICE = 1000

/**
 * A price we are willing to put on screen.
 *
 * A null check alone only catches a field that disappeared. It does not catch
 * one that changed meaning or units — and a confidently displayed wrong price
 * is worse than no price, because nothing about it looks wrong. Anything
 * outside what a shop could plausibly charge is treated as unknown.
 */
function plausiblePrice(value) {
  const amount = number(value)
  return amount !== null && amount > 0 && amount < MAX_PRICE ? amount : null
}

/** `status` values seen in the wild. Anything else is deliberately unknown. */
const STATUS_AVAILABLE = 'active'
const STATUS_UNAVAILABLE = new Set(['suspended'])

/**
 * Whether this can be bought right now, read from the live inventory record
 * rather than from Constructor's index.
 *
 * Constructor publishes `inStock_X500`, and it is wrong in both directions: a
 * search for `avietiniai pomidorai` on 2026-09-03 returned two products marked
 * out of stock that were on sale at 1,49 € and 4,69 €, and one marked in stock
 * that the shop would not sell. It is a periodically rebuilt index; `status`
 * comes from the same backend the product page reads.
 *
 * A status we do not recognise returns `unknown` and puts nothing on screen.
 * The day Barbora adds a third value we go quiet rather than confidently
 * wrong, which is the whole lesson of the flag this replaced.
 */
function availability(inventory) {
  const status = inventory?.status
  if (typeof status !== 'string') return 'unknown'
  if (status === STATUS_AVAILABLE) return 'available'
  return STATUS_UNAVAILABLE.has(status) ? 'unavailable' : 'unknown'
}

/**
 * How much cheaper than usual, as a whole percent.
 *
 * Barbora states this itself in `promotion.percentage` and that is the number
 * their own pages show, so it wins. Falling back to arithmetic on the two
 * prices covers a discount recorded without a promotion block.
 *
 * Either way the answer has to be a discount a shop could actually offer: 0 %
 * is not a discount, and 100 % or 4000 % is a field that has changed meaning.
 */
function discountPercent(inventory, price, wasPrice) {
  const stated = number(inventory?.promotion?.percentage)
  if (stated !== null) return sensiblePercent(Math.round(stated))
  if (price === null || wasPrice === null || wasPrice <= price) return null
  return sensiblePercent(Math.round(((wasPrice - price) / wasPrice) * 100))
}

function sensiblePercent(value) {
  return value >= 1 && value <= 99 ? value : null
}

/**
 * One Constructor result plus the inventory record for the same id, or null
 * when `GetInventories` had nothing to say about it.
 *
 * A product with no inventory is still returned, priced `null`. It is a real
 * product with a working link, and dropping it would silently shorten a list
 * of alternatives; showing it without a price is honest, inventing one is not.
 */
export function normaliseProduct(result, inventory, store = BARBORA_STORE) {
  const data = result?.data ?? {}
  const price = plausiblePrice(inventory?.price)
  const retail = plausiblePrice(inventory?.retail_price)
  // `retail_price` is only a was-price when it is actually higher. Barbora
  // sends it equal to `price` on plenty of undiscounted products, and "was
  // 0,94 €, now 0,94 €" reads as a bug.
  const wasPrice = price !== null && retail !== null && retail > price ? retail : null
  const comparativePrice = plausiblePrice(inventory?.comparative_unit_price)
  const comparativeUnit = inventory?.comparative_unit

  return {
    id: data.id ?? inventory?.id ?? null,
    // The shop's own title is the one printed on the shelf label; Constructor's
    // `value` is the same string in practice, but only one of them is canonical.
    title: inventory?.title ?? result?.value ?? data.description ?? '',
    brand: data.brand || inventory?.brand_name || null,
    image: data.image_url ?? inventory?.image ?? null,
    slug: data.url ?? inventory?.Url ?? null,
    url: data.url ? productUrl(data.url) : inventory?.Url ? productUrl(inventory.Url) : null,
    price,
    wasPrice,
    perUnit: comparativePrice !== null && comparativeUnit
      ? { price: comparativePrice, unit: comparativeUnit }
      : null,
    discountPercent: discountPercent(inventory, price, wasPrice),
    // A loyalty price is not the price you pay without the card, so the badge
    // has to say which it is.
    loyaltyRequired: inventory?.promotion?.loyaltyCardRequired === true,
    promotionType: inventory?.promotion?.type ?? null,
    availability: availability(inventory),
    // Kept because they are what Barbora published, and named so that nothing
    // mistakes them for the answer to "can I buy this". They cannot be: see
    // `availability`. Nothing renders them.
    indexedInStock: storeFlag(data, 'inStock', store),
    indexedInAssortment: storeFlag(data, 'inAssortment', store),
    onSale: storeFlag(data, 'isOnSale', store) === true || Boolean(inventory?.promotion),
  }
}

/**
 * Constructor's ordering is relevance, which is the thing we actually want:
 * the closest match to what someone typed on a shopping list. So this only
 * demotes rows that cannot be acted on — no price, then known unavailable —
 * and leaves the rest exactly as they arrived. An unknown availability is not
 * demoted: it is a product we have nothing bad to say about.
 */
export function rankProducts(products) {
  const tier = (product) => {
    if (product.price === null) return 2
    if (product.availability === 'unavailable') return 1
    return 0
  }
  return products
    .map((product, index) => ({ product, index }))
    .sort((a, b) => tier(a.product) - tier(b.product) || a.index - b.index)
    .map((row) => row.product)
}

/**
 * Join the two payloads the Edge Function returns.
 *
 * `GetInventories` preserves the order it is given, but nothing is built on
 * that: the records are indexed by id, so a reordered or partial answer still
 * lands on the right products.
 */
export function mergeProducts(results, inventories, store = BARBORA_STORE) {
  const byId = new Map()
  for (const inventory of inventories ?? []) {
    if (inventory?.id) byId.set(String(inventory.id), inventory)
  }
  const seen = new Set()
  const products = []
  for (const result of results ?? []) {
    const id = result?.data?.id
    if (!id || seen.has(String(id))) continue
    seen.add(String(id))
    products.push(normaliseProduct(result, byId.get(String(id)) ?? null, store))
  }
  return rankProducts(products)
}
