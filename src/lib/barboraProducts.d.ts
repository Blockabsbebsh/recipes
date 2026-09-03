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
  loyaltyRequired: boolean
  promotionType: string | null
  /** Null rather than false when Barbora says nothing about this store. */
  inStock: boolean | null
  inAssortment: boolean | null
  onSale: boolean
}

/** What the `barbora-products` Edge Function returns. */
export type BarboraProductsResponse = {
  query: string
  store: string
  fetchedAt: string
  results: unknown[]
  inventories: unknown[]
}

export const BARBORA_STORE: string
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
