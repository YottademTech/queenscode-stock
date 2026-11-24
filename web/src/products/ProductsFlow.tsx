import { useState } from 'react';
import type { Bootstrap, Product } from '../api/contract';
import { driveThumbnail } from '../lib/image';
import { NoticeBox, type Notice } from '../shared/fields';
import { ProductForm } from './ProductForm';
import { Icon } from '../shared/Icon';

type Editing = { kind: 'list' } | { kind: 'adding' } | { kind: 'editing'; product: Product };

type ProductsFlowProps = { bootstrap: Bootstrap; onSaved: () => void };

export function ProductsFlow({ bootstrap, onSaved }: ProductsFlowProps) {
  const [editing, setEditing] = useState<Editing>({ kind: 'list' });
  const [notice, setNotice] = useState<Notice | null>(null);

  const handleSaved = (message: string) => {
    setEditing({ kind: 'list' });
    setNotice({ tone: 'success', text: message });
    onSaved();
  };

  if (editing.kind !== 'list') {
    return (
      <section aria-label="Product details">
        <ProductForm
          key={editing.kind === 'editing' ? editing.product.code : 'new'}
          product={editing.kind === 'editing' ? editing.product : null}
          onSaved={handleSaved}
          onCancel={() => setEditing({ kind: 'list' })}
        />
      </section>
    );
  }

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
      <ul className="product-list">
        {bootstrap.products.map((product) => {
          const thumbnail = driveThumbnail(product.imageUrl, 160);
          const missing = [
            product.packSize === null && 'pack size',
            product.reorderLevel === null && 'reorder level',
            thumbnail === null && 'photo',
          ].filter(Boolean);
          return (
            <li key={product.code}>
              <button type="button" className="product-item" onClick={() => { setNotice(null); setEditing({ kind: 'editing', product }); }}>
                {thumbnail ? <img src={thumbnail} alt="" className="thumb" loading="lazy" referrerPolicy="no-referrer" /> : <span className="thumb placeholder" aria-hidden="true">＋</span>}
                <span className="product-text">
                  <strong>{product.name}</strong>
                  <small>
                    {[product.size, product.category, product.expiry && `expires ${product.expiry}`].filter(Boolean).join(' · ') || product.code}
                  </small>
                  {missing.length > 0 && <small className="warn">Missing: {missing.join(', ')}</small>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
