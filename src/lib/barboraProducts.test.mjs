import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dealLabel,
  formatPerUnit,
  formatPrice,
  mergeProducts,
  normaliseProduct,
  productUrl,
  rankProducts,
} from './barboraProducts.js'

// The fixtures below are trimmed copies of real responses captured on
// 2026-09-03: the Constructor results are from a `pienas` search, the
// inventories from `GetInventories` posted with those same ids. Keeping them
// verbatim is the point — the shapes are Barbora's, not ours.

const milkResult = {
  matched_terms: ['pienas'],
  value: 'UAT pienas FARM MILK, 3,2% rieb., 1 l',
  data: {
    id: '000000000000892000',
    url: 'uat-pienas-farm-milk-3-2-proc-rieb-1-l',
    brand: 'Farm milk',
    image_url: 'https://cdn.barbora.lt/products/3cfc2270-a237-445c-928a-f5b38b09b3ff.png',
    description: 'UAT pienas FARM MILK, 3,2% rieb., 1 l',
    inStock_X325: false,
    inStock_X500: true,
    isOnSale_X500: false,
    inAssortment_X500: true,
  },
}

const milkInventory = {
  id: '000000000000892000',
  title: 'UAT pienas FARM MILK, 3,2% rieb., 1 l',
  shopcode: 'X500',
  price: 0.94,
  comparative_unit: 'l',
  comparative_unit_price: 0.94,
  promotion: null,
  status: 'active',
  Url: 'uat-pienas-farm-milk-3-2-proc-rieb-1-l',
}

const creamResult = {
  value: 'ROKIŠKIO NAMINĖ grietinė, 30 % rieb., 400 g',
  data: {
    id: '000000000000534864',
    url: 'rokiskio-namine-grietine-30-proc-rieb-400-g',
    brand: 'ROKIŠKIO NAMINIS',
    image_url: 'https://cdn.barbora.lt/products/f9d51510.png',
    inStock_X500: true,
    isOnSale_X500: true,
    inAssortment_X500: true,
  },
}

const creamInventory = {
  id: '000000000000534864',
  title: 'ROKIŠKIO NAMINĖ grietinė, 30 % rieb., 400 g',
  shopcode: 'X500',
  price: 1.79,
  retail_price: 2.69,
  comparative_unit: 'kg',
  comparative_unit_price: 4.48,
  promotion: {
    oldPrice: 2.69,
    percentage: 33,
    type: 'DISCOUNT_PRICE',
    loyaltyCardRequired: false,
  },
  status: 'active',
  Url: 'rokiskio-namine-grietine-30-proc-rieb-400-g',
}

test('the two payloads are joined by product id', () => {
  const [milk] = mergeProducts([milkResult], [milkInventory])
  assert.equal(milk.id, '000000000000892000')
  assert.equal(milk.title, 'UAT pienas FARM MILK, 3,2% rieb., 1 l')
  assert.equal(milk.brand, 'Farm milk')
  assert.equal(milk.price, 0.94)
})

test('a product links to its own page, which is what opens the Barbora app', () => {
  const [milk] = mergeProducts([milkResult], [milkInventory])
  assert.equal(milk.url, 'https://barbora.lt/produktai/uat-pienas-farm-milk-3-2-proc-rieb-1-l')
  assert.equal(productUrl('abc'), 'https://barbora.lt/produktai/abc')
})

test('the inventory order is not trusted; ids are', () => {
  // GetInventories happens to preserve the order it is given. Nothing here
  // relies on that, so a reordered answer still lands on the right products.
  const merged = mergeProducts([milkResult, creamResult], [creamInventory, milkInventory])
  assert.deepEqual(merged.map((product) => product.price), [0.94, 1.79])
})

test('a was-price is only shown when it is genuinely higher', () => {
  const [cream] = mergeProducts([creamResult], [creamInventory])
  assert.equal(cream.wasPrice, 2.69)
  // Barbora sends retail_price equal to price on plenty of undiscounted rows.
  const [flat] = mergeProducts([milkResult], [{ ...milkInventory, retail_price: 0.94 }])
  assert.equal(flat.wasPrice, null)
})

test('the discount is the shop’s own number, not ours', () => {
  const [cream] = mergeProducts([creamResult], [creamInventory])
  assert.equal(cream.discountPercent, 33)
  assert.equal(dealLabel(cream), '-33 %')
})

test('a discount without a promotion block is computed from the two prices', () => {
  const [product] = mergeProducts(
    [creamResult],
    [{ ...creamInventory, promotion: null, price: 2, retail_price: 4 }],
  )
  assert.equal(product.discountPercent, 50)
})

test('an undiscounted product carries no deal label', () => {
  const [milk] = mergeProducts([milkResult], [milkInventory])
  assert.equal(milk.discountPercent, null)
  assert.equal(dealLabel(milk), null)
})

test('a loyalty price is marked as one, because it is not what you pay without the card', () => {
  const [product] = mergeProducts(
    [creamResult],
    [{ ...creamInventory, promotion: { ...creamInventory.promotion, type: 'LOYALTY_PRICE', loyaltyCardRequired: true } }],
  )
  assert.equal(product.loyaltyRequired, true)
  assert.equal(product.promotionType, 'LOYALTY_PRICE')
})

test('a product with no inventory is still listed, priced nothing', () => {
  // It is a real product with a working link. Dropping it would quietly
  // shorten the alternatives; inventing a price would be worse than both.
  const [milk] = mergeProducts([milkResult], [])
  assert.equal(milk.price, null)
  assert.equal(milk.title, 'UAT pienas FARM MILK, 3,2% rieb., 1 l')
  assert.equal(milk.url, 'https://barbora.lt/produktai/uat-pienas-farm-milk-3-2-proc-rieb-1-l')
})

test('the index flags are still read per store, but only as data', () => {
  const [milk] = mergeProducts([milkResult], [milkInventory])
  assert.equal(milk.indexedInStock, true)
  const unknown = normaliseProduct(milkResult, milkInventory, 'X999')
  assert.equal(unknown.indexedInStock, null)
  assert.equal(unknown.indexedInAssortment, null)
  const elsewhere = normaliseProduct(milkResult, milkInventory, 'X325')
  assert.equal(elsewhere.indexedInStock, false)
})

test('relevance order survives; only rows you cannot act on are demoted', () => {
  const priced = { price: 1, availability: 'available' }
  const unavailable = { price: 1, availability: 'unavailable' }
  const unpriced = { price: null, availability: 'available' }
  const ranked = rankProducts([unpriced, unavailable, priced])
  assert.deepEqual(ranked, [priced, unavailable, unpriced])
})

test('an unknown availability is not demoted; we have nothing against it', () => {
  const known = { price: 1, availability: 'available', id: 'a' }
  const unsure = { price: 1, availability: 'unknown', id: 'b' }
  assert.deepEqual(rankProducts([unsure, known]).map((p) => p.id), ['b', 'a'])
})

test('two equally actionable products keep the order Constructor gave them', () => {
  const first = { price: 1, availability: 'available', id: 'a' }
  const second = { price: 0.5, availability: 'available', id: 'b' }
  // Cheaper does not mean better: the closest match to what was typed does.
  assert.deepEqual(rankProducts([first, second]).map((p) => p.id), ['a', 'b'])
})

test('a repeated id is listed once', () => {
  const merged = mergeProducts([milkResult, milkResult], [milkInventory])
  assert.equal(merged.length, 1)
})

test('a result with no id is skipped rather than rendered blank', () => {
  const merged = mergeProducts([{ value: 'x', data: {} }, milkResult], [milkInventory])
  assert.deepEqual(merged.map((product) => product.id), ['000000000000892000'])
})

test('missing payloads merge to nothing instead of throwing', () => {
  assert.deepEqual(mergeProducts(null, null), [])
  assert.deepEqual(mergeProducts(undefined, [milkInventory]), [])
})

test('prices are written the Lithuanian way', () => {
  assert.equal(formatPrice(0.94), '0,94 €')
  assert.equal(formatPrice(1.8), '1,80 €')
  assert.equal(formatPrice(12), '12,00 €')
  assert.equal(formatPrice(null), null)
  assert.equal(formatPrice(Number.NaN), null)
})

test('the per-unit rate is what makes two package sizes comparable', () => {
  const [cream] = mergeProducts([creamResult], [creamInventory])
  assert.deepEqual(cream.perUnit, { price: 4.48, unit: 'kg' })
  assert.equal(formatPerUnit(cream.perUnit), '4,48 € / kg')
  assert.equal(formatPerUnit(null), null)
})

// The regression this section exists for. On 2026-09-03 a search for
// `avietiniai pomidorai` returned two products Constructor marked out of stock
// that the shop was selling at 1,49 € and 4,69 €, and one it marked in stock
// that the shop would not sell. All three were verified by opening the page.
const tomato = (id, indexedInStock) => ({
  value: 'Avietiniai pomidorai',
  data: { id, url: 'avietiniai-pomidorai', inStock_X500: indexedInStock, inAssortment_X500: true },
})

test('availability comes from the live record, not the search index', () => {
  const [sold] = mergeProducts(
    [tomato('1', false)],
    [{ id: '1', title: 'Avietiniai pomidorai, 57-67 mm, 1 kg', price: 1.49, status: 'active' }],
  )
  assert.equal(sold.availability, 'available')
  assert.equal(sold.indexedInStock, false)
})

test('a suspended product is unavailable even when the index calls it in stock', () => {
  const [suspended] = mergeProducts(
    [tomato('3', true)],
    [{ id: '3', title: 'Uoginiai pomidorai su šakelėmis, 200 g', price: 2.99, status: 'suspended' }],
  )
  assert.equal(suspended.availability, 'unavailable')
})

test('a status we do not recognise claims nothing at all', () => {
  // The day Barbora adds a third value, going quiet is the correct answer.
  const [odd] = mergeProducts([tomato('9', true)], [{ id: '9', price: 1, status: 'preorder' }])
  assert.equal(odd.availability, 'unknown')
})

test('no inventory record means unknown availability, not unavailable', () => {
  const [milk] = mergeProducts([milkResult], [])
  assert.equal(milk.availability, 'unknown')
})

test('a price a shop could not charge is treated as unknown', () => {
  // A null check only catches a field that vanished. This catches one that
  // changed units or meaning, which is the failure that looks like success.
  for (const price of [0, -1, 100000, '1.49', null, undefined]) {
    const [product] = mergeProducts([milkResult], [{ ...milkInventory, price }])
    assert.equal(product.price, null, `price ${price}`)
  }
})

test('an implausible was-price does not become a strikethrough', () => {
  const [product] = mergeProducts([milkResult], [{ ...milkInventory, retail_price: 99999 }])
  assert.equal(product.wasPrice, null)
})

test('a discount outside what a shop could offer is dropped', () => {
  for (const percentage of [0, 100, 4000, -5]) {
    const [product] = mergeProducts(
      [creamResult],
      [{ ...creamInventory, promotion: { ...creamInventory.promotion, percentage } }],
    )
    assert.equal(product.discountPercent, null, `percentage ${percentage}`)
  }
})

test('an implausible per-unit rate is dropped', () => {
  const [product] = mergeProducts([creamResult], [{ ...creamInventory, comparative_unit_price: 0 }])
  assert.equal(product.perUnit, null)
})
