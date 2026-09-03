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
 * this one. Null is not false: an unknown stock state must not be shown as
 * "out of stock", the same way an unmapped ingredient gets no link rather than
 * a guessed one.
 */
function storeFlag(data, field, store) {
  const value = data?.[`${field}_${store}`]
  return typeof value === 'boolean' ? value : null
}

/**
 * How much cheaper than usual, as a whole percent.
 *
 * Barbora states this itself in `promotion.percentage` and that is the number
 * their own pages show, so it wins. Falling back to arithmetic on the two
 * prices covers a discount recorded without a promotion block; a computed 0 is
 * not a discount and is dropped.
 */
function discountPercent(inventory, price, wasPrice) {
  const stated = number(inventory?.promotion?.percentage)
  if (stated !== null) return Math.round(stated)
  if (price === null || wasPrice === null || wasPrice <= price) return null
  const computed = Math.round(((wasPrice - price) / wasPrice) * 100)
  return computed > 0 ? computed : null
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
  const price = number(inventory?.price)
  const retail = number(inventory?.retail_price)
  // `retail_price` is only a was-price when it is actually higher. Barbora
  // sends it equal to `price` on plenty of undiscounted products, and "was
  // 0,94 €, now 0,94 €" reads as a bug.
  const wasPrice = price !== null && retail !== null && retail > price ? retail : null
  const comparativePrice = number(inventory?.comparative_unit_price)
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
    inStock: storeFlag(data, 'inStock', store),
    inAssortment: storeFlag(data, 'inAssortment', store),
    onSale: storeFlag(data, 'isOnSale', store) === true || Boolean(inventory?.promotion),
  }
}

/**
 * Constructor's ordering is relevance, which is the thing we actually want:
 * the closest match to what someone typed on a shopping list. So this only
 * demotes rows that cannot be acted on — no price, then known out of stock —
 * and leaves the rest exactly as they arrived.
 */
export function rankProducts(products) {
  const tier = (product) => {
    if (product.price === null) return 2
    if (product.inStock === false) return 1
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
