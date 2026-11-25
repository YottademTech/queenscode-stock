import { useLayoutEffect, useRef, useState } from 'react';
import type { Bootstrap, Product } from '../api/contract';
import { driveThumbnail } from '../lib/image';
import { NoticeBox, type Notice } from '../shared/fields';
import { ProductForm } from './ProductForm';
import { matchesSearch } from './search';
import { Icon } from '../shared/Icon';

/** Product cards in view at once in the carousel; the arrows move by this many. */
const CARDS_IN_VIEW = 3;

type Editing = { kind: 'list' } | { kind: 'adding' } | { kind: 'editing'; product: Product };

type ProductsFlowProps = { bootstrap: Bootstrap; onSaved: () => void };

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
  // The first card in view. Kept while a product is open, so the carousel comes back where it was.
  const [first, setFirst] = useState(0);
  const [search, setSearch] = useState('');
  const stripRef = useRef<HTMLUListElement>(null);

  /** The distance from one card to the next, read from the page so it follows the phone's width. */
  const cardStep = () => {
    const cards = stripRef.current?.children;
    if (!cards || cards.length < 2) return 0;
    return (cards[1] as HTMLElement).offsetLeft - (cards[0] as HTMLElement).offsetLeft;
  };

  // The strip is built again each time the list comes back from a product's details; this puts it
  // back on the card the counter left, before anything is painted.
  const isList = editing.kind === 'list';
  useLayoutEffect(() => {
    if (isList) stripRef.current?.scrollTo({ left: first * cardStep(), behavior: 'instant' });
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
          photoLimit={bootstrap.productPhotoLimit}
          onDone={handleDone}
          onCancel={() => setEditing({ kind: 'list' })}
        />
      </section>
    );
  }

  const found = bootstrap.products.filter((product) => matchesSearch(product, search));
  const total = found.length;
  // The list can shrink while later cards are showing, for example after a delete.
  const shown = Math.min(first, Math.max(total - CARDS_IN_VIEW, 0));
  const anyMissing = bootstrap.products.some((product) => missingDetails(product).length > 0);

  // Moves a view at a time, from where the strip really is: a swipe may have moved it since the last render.
  const step = (by: number) => {
    const strip = stripRef.current;
    if (strip) strip.scrollBy({ left: by * CARDS_IN_VIEW * cardStep() });
  };
  // Swiping moves the strip on its own; this keeps the count above it in step.
  const handleScroll = () => {
    const strip = stripRef.current;
    const distance = cardStep();
    if (strip && distance > 0) setFirst(Math.round(strip.scrollLeft / distance));
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

      {bootstrap.products.length === 0 && <p className="hint">No products yet. Add one, or count by photo and new products will be suggested.</p>}
      {bootstrap.products.length > 0 && (
        <div className="product-search">
          <label htmlFor="product-search" className="visually-hidden">Search products</label>
          <input
            id="product-search"
            type="search"
            placeholder="Search by name, size, brand or barcode"
            autoComplete="off"
            enterKeyHint="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              // A new search starts at its first match.
              setFirst(0);
              stripRef.current?.scrollTo({ left: 0, behavior: 'instant' });
            }}
          />
          {search !== '' && (
            <button type="button" className="search-clear" aria-label="Clear the search" onClick={() => { setSearch(''); setFirst(0); stripRef.current?.scrollTo({ left: 0, behavior: 'instant' }); }}>
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      )}
      {search !== '' && (
        <p className="hint" role="status" aria-live="polite">
          {total === 0 ? `No product matches "${search.trim()}".` : `${total} ${total === 1 ? 'product matches' : 'products match'}.`}
        </p>
      )}
      {anyMissing && <p className="hint">A gold dot marks a product with no pack size, reorder level or photo yet.</p>}

      {/* Above the strip, where the thumb reaches them, with what is in view. */}
      {total > CARDS_IN_VIEW && (
        <div className="slide-controls">
          <button type="button" className="slide-button" aria-label="Previous products" disabled={shown === 0} onClick={() => step(-1)}>
            <Icon name="back" />
          </button>
          <p role="status" aria-live="polite">
            {shown + 1} to {Math.min(shown + CARDS_IN_VIEW, total)} of {total}
          </p>
          <button type="button" className="slide-button" aria-label="More products" disabled={shown + CARDS_IN_VIEW >= total} onClick={() => step(1)}>
            <Icon name="forward" />
          </button>
        </div>
      )}

      <div className="carousel-frame">
      <ul className="product-carousel" ref={stripRef} onScroll={handleScroll} aria-label={search === '' ? `Products, ${total} in all` : `Products matching the search, ${total}`}>
        {found.map((product) => {
          const thumbnail = driveThumbnail(product.imageUrl, 400);
          const missing = missingDetails(product);
          const facts = [product.size, product.category].filter(Boolean).join(' · ');
          return (
            <li key={product.code}>
              <button type="button" className="product-card" title={product.name} onClick={() => { setNotice(null); setEditing({ kind: 'editing', product }); }}>
                <span className="card-photo">
                  {thumbnail ? <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="card-placeholder" aria-hidden="true">＋</span>}
                  {missing.length > 0 && <span className="card-flag" aria-hidden="true" />}
                </span>
                <span className="card-text">
                  <strong>{product.name}</strong>
                  {facts && <small>{facts}</small>}
                </span>
                {missing.length > 0 && <span className="visually-hidden">Missing: {missing.join(', ')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      </div>
    </section>
  );
}
