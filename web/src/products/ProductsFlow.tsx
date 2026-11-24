import { useLayoutEffect, useRef, useState } from 'react';
import type { Bootstrap, Product } from '../api/contract';
import { driveThumbnail } from '../lib/image';
import { NoticeBox, type Notice } from '../shared/fields';
import { ProductForm } from './ProductForm';
import { Icon } from '../shared/Icon';

/** Products shown on one slide of the list. */
const PRODUCTS_PER_SLIDE = 20;

type Editing = { kind: 'list' } | { kind: 'adding' } | { kind: 'editing'; product: Product };

type ProductsFlowProps = { bootstrap: Bootstrap; onSaved: () => void };

function inSlides(products: readonly Product[]): Product[][] {
  const slides: Product[][] = [];
  for (let start = 0; start < products.length; start += PRODUCTS_PER_SLIDE) slides.push(products.slice(start, start + PRODUCTS_PER_SLIDE));
  return slides;
}

function missingDetails(product: Product): string[] {
  return [
    product.packSize === null && 'pack size',
    product.reorderLevel === null && 'reorder level',
    driveThumbnail(product.imageUrl, 160) === null && 'photo',
  ].filter((missing): missing is string => missing !== false);
}

export function ProductsFlow({ bootstrap, onSaved }: ProductsFlowProps) {
  const [editing, setEditing] = useState<Editing>({ kind: 'list' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [slide, setSlide] = useState(0);
  const slidesRef = useRef<HTMLDivElement>(null);

  // The strip is built again each time the list comes back from a product's details; this puts it
  // back on the slide the counter left, before anything is painted.
  const isList = editing.kind === 'list';
  useLayoutEffect(() => {
    const strip = slidesRef.current;
    if (isList && strip) strip.scrollTo({ left: slide * strip.clientWidth, behavior: 'instant' });
    // Only when the list appears: while it is showing, the strip itself is what moves.
  }, [isList]);

  const handleDone = (message: string) => {
    setEditing({ kind: 'list' });
    setNotice({ tone: 'success', text: message });
    onSaved();
  };

  if (editing.kind !== 'list') {
    const product = editing.kind === 'editing' ? editing.product : null;
    const countedPieces = bootstrap.counted.filter((entry) => entry.code === product?.code).reduce((sum, entry) => sum + entry.pieces, 0);
    return (
      <section aria-label="Product details" className="product-details">
        <ProductForm
          key={product?.code ?? 'new'}
          product={product}
          countedPieces={countedPieces}
          canDelete={bootstrap.actions.includes('deleteProduct')}
          onDone={handleDone}
          onCancel={() => setEditing({ kind: 'list' })}
        />
      </section>
    );
  }

  const slides = inSlides(bootstrap.products);
  // The list can shrink while a later slide is showing, for example after a delete.
  const shown = Math.min(slide, Math.max(slides.length - 1, 0));
  const anyMissing = bootstrap.products.some((product) => missingDetails(product).length > 0);

  // Steps from where the strip really is, which a swipe may have changed since the last render.
  const step = (by: number) => {
    const strip = slidesRef.current;
    if (strip && strip.clientWidth > 0) strip.scrollTo({ left: (Math.round(strip.scrollLeft / strip.clientWidth) + by) * strip.clientWidth });
  };
  // Swiping moves the strip on its own; this keeps the page number in step with it.
  const handleScroll = () => {
    const strip = slidesRef.current;
    if (strip && strip.clientWidth > 0) setSlide(Math.round(strip.scrollLeft / strip.clientWidth));
  };

  return (
    <section aria-labelledby="products-heading">
      <h2 id="products-heading">Products</h2>
      <NoticeBox notice={notice} />
      <div className="button-row">
        <button type="button" className="button primary" onClick={() => { setNotice(null); setEditing({ kind: 'adding' }); }}>
          <Icon name="plus" />
          Add a product
        </button>
      </div>

      {bootstrap.products.length === 0 && <p className="hint">No products yet. Add one, or count by photo and Claude will suggest them.</p>}
      {anyMissing && <p className="hint">A gold dot marks a product with no pack size, reorder level or photo yet.</p>}

      {/* Above the strip, so the arrows are in reach however tall a slide is. */}
      {slides.length > 1 && (
        <div className="slide-controls">
          <button type="button" className="slide-button" aria-label="Previous products" disabled={shown === 0} onClick={() => step(-1)}>
            <Icon name="back" />
          </button>
          <p role="status" aria-live="polite">
            {shown * PRODUCTS_PER_SLIDE + 1} to {shown * PRODUCTS_PER_SLIDE + (slides[shown]?.length ?? 0)} of {bootstrap.products.length}
          </p>
          <button type="button" className="slide-button" aria-label="More products" disabled={shown === slides.length - 1} onClick={() => step(1)}>
            <Icon name="forward" />
          </button>
        </div>
      )}

      <div className="product-slides" ref={slidesRef} onScroll={handleScroll} role="group" aria-roledescription="carousel" aria-label="Products">
        {slides.map((products, index) => (
          <ul key={index} className="product-slide" aria-label={`Products ${index * PRODUCTS_PER_SLIDE + 1} to ${index * PRODUCTS_PER_SLIDE + products.length} of ${bootstrap.products.length}`}>
            {products.map((product) => {
              const thumbnail = driveThumbnail(product.imageUrl, 160);
              const missing = missingDetails(product);
              return (
                <li key={product.code}>
                  <button type="button" className="product-tile" title={product.name} onClick={() => { setNotice(null); setEditing({ kind: 'editing', product }); }}>
                    <span className="tile-photo">
                      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="tile-placeholder" aria-hidden="true">＋</span>}
                      {missing.length > 0 && <span className="tile-flag" aria-hidden="true" />}
                    </span>
                    <strong>{product.name}</strong>
                    {missing.length > 0 && <span className="visually-hidden">Missing: {missing.join(', ')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </div>

    </section>
  );
}
