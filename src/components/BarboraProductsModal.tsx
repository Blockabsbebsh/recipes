import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../lib/supabase'
import { BARBORA_ORIGIN } from '../lib/barboraMapping'
import { dealLabel, formatPerUnit, formatPrice, mergeProducts } from '../lib/barboraProducts'
import type { BarboraProduct, BarboraProductsResponse } from '../lib/barboraProducts'
import { trace } from '../lib/scrollTrace'

/**
 * What Barbora sells for one ingredient on the shopping list, with prices.
 *
 * The aisle link is drawn immediately from data the app already holds, before
 * anything is fetched, so a tap is never a dead end: a failed or empty lookup
 * still leaves you one tap from where the ingredient lives in the shop, which
 * is exactly what the list did before this dialog existed.
 *
 * See docs/barbora-product-pricing.md.
 */
export function BarboraProductsModal({ item, aisleHref, onClose }: {
  item: string
  aisleHref: string | null
  onClose: () => void
}) {
  const [products, setProducts] = useState<BarboraProduct[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [degraded, setDegraded] = useState(false)

  useEffect(() => {
    let live = true
    setProducts(null)
    setFailed(false)
    setDegraded(false)
    void (async () => {
      const { data, error } = await supabase.functions.invoke<BarboraProductsResponse>(
        'barbora-products',
        { body: { query: item } },
      )
      if (!live) return
      if (error || !data) {
        setFailed(true)
        return
      }
      // Matches without prices are a different thing from products that
      // have no price, and the sheet has to say which happened.
      setDegraded(Boolean(data.degraded))
      setProducts(mergeProducts(data.results, data.inventories))
    })()
    // A dialog closed before the answer arrives must not write into a gone
    // component, and reopening on another ingredient must not show the first
    // one's products.
    return () => { live = false }
  }, [item])

  return (
    <Modal title={item} onClose={onClose}>
      {aisleHref && (
        <p className="product-aisle">
          <a href={aisleHref} target="_blank" rel="noopener noreferrer"
            onClick={() => trace('leave-by-link', { to: aisleHref.replace(BARBORA_ORIGIN, '') })}>
            Atidaryti skyrių „Barbora" ↗
          </a>
        </p>
      )}

      {products === null && !failed && <p className="muted product-status">Ieškoma parduotuvėje…</p>}
      {failed && <p className="muted product-status">Nepavyko gauti kainų. Bandykite dar kartą vėliau.</p>}
      {products !== null && products.length === 0 && (
        <p className="muted product-status">Atitikmenų parduotuvėje nerasta.</p>
      )}

      {degraded && products !== null && products.length > 0 && (
        <p className="muted product-status">Kainų šįkart gauti nepavyko. Jos matomos parduotuvėje.</p>
      )}

      {products !== null && products.length > 0 && (
        <>
          <ul className="product-list">
            {products.map((product) => <ProductRow key={product.id ?? product.url} product={product} />)}
          </ul>
          <p className="category-hint">
            Kainos ir atsargos – „Barbora" parduotuvei X500. Kainą patvirtina tik pati parduotuvė.
          </p>
        </>
      )}
    </Modal>
  )
}

function ProductRow({ product }: { product: BarboraProduct }) {
  const price = formatPrice(product.price)
  const perUnit = formatPerUnit(product.perUnit)
  const deal = dealLabel(product)
  const body = (
    <>
      {product.image
        ? <img src={product.image} alt="" loading="lazy" width={56} height={56} />
        : <span className="product-image-placeholder" aria-hidden="true" />}
      <span className="product-main">
        <strong>{product.title}</strong>
        {product.brand && <span className="product-brand">{product.brand}</span>}
        <span className="product-prices">
          {price ? <b>{price}</b> : <em>Kaina nežinoma</em>}
          {product.wasPrice !== null && <s>{formatPrice(product.wasPrice)}</s>}
          {deal && <span className="product-deal">{deal}</span>}
        </span>
        <span className="product-meta">
          {perUnit && <span>{perUnit}</span>}
          {/* Only the live record may say this. Constructor's index gets it
              wrong in both directions, and an unrecognised status says
              nothing at all rather than guessing. */}
          {product.availability === 'unavailable' && <span className="product-out">Neturima</span>}
          {product.loyaltyRequired && <span>su „Ačiū" kortele</span>}
        </span>
      </span>
    </>
  )
  return (
    <li className="product-row">
      {product.url
        ? <a href={product.url} target="_blank" rel="noopener noreferrer"
            onClick={() => trace('leave-by-link', { to: product.url!.replace(BARBORA_ORIGIN, '') })}>{body}</a>
        : <div>{body}</div>}
    </li>
  )
}
