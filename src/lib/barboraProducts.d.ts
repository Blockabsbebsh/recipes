/** A Barbora product, ready to render. Prices are euros; nulls mean unknown. */
export type BarboraProduct = {
  id: string | null
  title: string
  brand: string | null
  image: string | null
  slug: string | null
  /** Opens the Barbora app on both phones, unlike a category or search link. */
  url: string | null
  price: number | null
  /** Only set when it is genuinely higher than `price`. */
  wasPrice: number | null
  perUnit: { price: number; unit: string } | null
  discountPercent: number | null
  /** How many must be bought for the discount; null when one is enough. */
  minQuantity: number | null
  orMore: boolean
  mixAndMatch: boolean
  loyaltyRequired: boolean
  promotionType: string | null
  /** From the live inventory record. `unknown` renders as nothing at all. */
  availability: BarboraAvailability
  /** What Constructor's index published. Unreliable; nothing renders these. */
  indexedInStock: boolean | null
  indexedInAssortment: boolean | null
  onSale: boolean
}

export type BarboraAvailability = 'available' | 'unavailable' | 'unknown'

/** What the `barbora-products` Edge Function returns. */
export type BarboraProductsResponse = {
  query: string
  store: string
  fetchedAt: string
  results: unknown[]
  inventories: unknown[]
  /** Set when matches were found but prices could not be fetched. */
  degraded?: string
}

export const BARBORA_STORE: string
export const BARBORA_STORE_LABEL: string
export function productUrl(slug: string): string
export function formatPrice(amount: number | null | undefined): string | null
export function formatPerUnit(perUnit: { price: number; unit: string } | null): string | null
export function dealLabel(product: BarboraProduct): string | null
export function normaliseProduct(result: unknown, inventory: unknown, store?: string): BarboraProduct
export function rankProducts(products: BarboraProduct[]): BarboraProduct[]
export function mergeProducts(
  results: unknown[] | null | undefined,
  inventories: unknown[] | null | undefined,
  store?: string,
): BarboraProduct[]
