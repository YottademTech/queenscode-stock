import { useRef, useState } from 'react';
import { api } from '../api/client';
import type { Currency, Product } from '../api/contract';
import { createRequestIds } from '../lib/id';
import { NoticeBox, type Notice } from '../shared/fields';
import { Icon } from '../shared/Icon';
import { PriceFields } from './PriceFields';
import { formatPrice, priceDraft, readPrice } from './price';

type ProductPriceProps = { product: Product; currencies: readonly Currency[]; onSaved: () => void };

/**
 * A product's selling price, set on its own from the Adjustments screen. It has its own Save, so
 * changing a price never records a stock adjustment, and recording one never changes a price.
 */
export function ProductPrice({ product, currencies, onSaved }: ProductPriceProps) {
  const [draft, setDraft] = useState(() => priceDraft(product.price, product.currency, currencies));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const requestIds = useRef(createRequestIds()).current;

  const read = readPrice(draft, currencies);
  const unchanged = read.ok && read.value.price === product.price && (read.value.price === null || read.value.currency === product.currency);
  const current = formatPrice(product.price, product.currency, currencies);

  const handleSave = async () => {
    if (!read.ok || unchanged) return;
    const content = { productCode: product.code, ...read.value };
    setSaving(true);
    setNotice(null);
    const result = await api.setPrice({ requestId: requestIds.for(content), ...content });
    setSaving(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error.message });
      return;
    }
    requestIds.reset();
    setNotice({ tone: 'success', text: read.value.price === null ? 'Price cleared.' : `Price saved: ${formatPrice(read.value.price, read.value.currency, currencies)}.` });
    onSaved();
  };

  return (
    <div className="product-price">
      <p className="product-price-now">
        Current price: <strong>{current || 'not set yet'}</strong>
      </p>
      <PriceFields value={draft} currencies={currencies} error={read.ok ? undefined : read.error} onChange={(next) => { setDraft(next); setNotice(null); }} />
      <button type="button" className="button small" disabled={saving || !read.ok || unchanged} onClick={handleSave}>
        <Icon name="check" size={18} />
        {saving ? 'Saving…' : 'Save price'}
      </button>
      <NoticeBox notice={notice} />
    </div>
  );
}
