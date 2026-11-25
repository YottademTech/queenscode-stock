import { useRef, useState, type FormEvent } from 'react';
import { adjustmentKinds, type AdjustmentInput, type AdjustmentKind, type Bootstrap } from '../api/contract';
import { findProduct, packSizeFor, totalPieces, type Quantities } from '../count/countState';
import { createRequestIds } from '../lib/id';
import { submitSave } from '../lib/saves';
import { ANY_PACK, containerAt, countingHint } from '../count/containers';
import { QuantityFields } from '../count/QuantityFields';
import { NoticeBox, ProductPicker, SelectField, TextField, type Notice } from '../shared/fields';
import { Icon } from '../shared/Icon';
import { ProductPrice } from '../products/ProductPrice';

const KIND_HELP: Record<AdjustmentKind, string> = {
  correct: "Replaces the photo count for this product and place. The latest entry wins.",
  add: 'Added on top of the count, for stock the photo missed.',
  remove: 'Taken off the count, for damaged or expired stock, or stock counted twice.',
};

const noQuantities: Quantities = { fullCartons: 0, packSize: null, loosePieces: 0 };

type HandCountFlowProps = { bootstrap: Bootstrap; counter: string; onSaved: () => void };

export function HandCountFlow({ bootstrap, counter, onSaved }: HandCountFlowProps) {
  const [location, setLocation] = useState(bootstrap.locations[0] ?? '');
  const [productCode, setProductCode] = useState<string | null>(null);
  const [kind, setKind] = useState<AdjustmentKind>('correct');
  const [quantities, setQuantities] = useState<Quantities>(noQuantities);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const requestIds = useRef(createRequestIds()).current;

  const product = findProduct(bootstrap.products, productCode);
  const container = containerAt(location);
  const quantity = totalPieces(quantities, product);

  // What is missing, by the field it belongs to. Shown under each field once Save has been tapped,
  // and then kept up to date as the counter fills them in.
  const packSizeMissing = quantities.fullCartons > 0 && !packSizeFor(quantities, product);
  const errors = {
    product: product ? undefined : 'Choose the product.',
    packSize: packSizeMissing ? `Enter the pieces per ${(container ?? ANY_PACK).one}.` : undefined,
    // Full packs with no size count as nothing yet; the message on the pack size already says why.
    pieces: kind !== 'correct' && quantity === 0 && !packSizeMissing ? 'Enter how many pieces to add or remove.' : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const [showErrors, setShowErrors] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const signedOut = counter.trim() === '';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (hasErrors) {
      setShowErrors(true);
      // Takes the counter to the first field that needs them, once its message is on screen.
      window.requestAnimationFrame(() => {
        const field = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        field?.focus({ preventScroll: true });
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    if (!product || signedOut) return;

    const content = { location, counter: counter.trim(), productCode: product.code, type: kind, quantity, reason: reason.trim() };
    const payload: AdjustmentInput = { requestId: requestIds.for(content), ...content };

    setIsSaving(true);
    setNotice(null);
    const outcome = await submitSave({
      kind: 'adjustment',
      id: payload.requestId,
      label: `${bootstrap.adjustmentTypes[kind]}: ${quantity} × ${product.name}, ${location}`,
      payload,
      lastError: null,
    });
    setIsSaving(false);

    if (outcome.kind === 'rejected') {
      setNotice({ tone: 'error', text: outcome.message });
      return;
    }
    requestIds.reset();
    setShowErrors(false);
    setQuantities(noQuantities);
    setReason('');
    setProductCode(null);
    setNotice(
      outcome.kind === 'sent'
        ? { tone: 'success', text: `Saved: ${quantity} pieces of ${product.name}.` }
        : { tone: 'info', text: 'Saved on this phone. It will be sent to the Sheet when the connection is back.' },
    );
    onSaved();
  };

  return (
    <section aria-labelledby="hand-heading">
      <h2 id="hand-heading">Adjustments</h2>
      <p className="hint">Use this to fix a photo count, or for stock a photo cannot show.</p>

      <form ref={form} onSubmit={handleSubmit} className="card" noValidate>
        <SelectField label="Where are you counting from?" value={location} options={bootstrap.locations} onChange={setLocation} />
        <ProductPicker label="Product" products={bootstrap.products} value={productCode} allowNew={false} error={showErrors ? errors.product : undefined} onChange={setProductCode} />
        {/* The chosen product's selling price, with its own Save: no stock is adjusted by it. */}
        {product && bootstrap.currencies.length > 0 && bootstrap.actions.includes('setPrice') && (
          <ProductPrice key={product.code} product={product} currencies={bootstrap.currencies} onSaved={onSaved} />
        )}

        <fieldset className="choices">
          <legend>What is this entry?</legend>
          {adjustmentKinds.map((option) => (
            <label key={option} className="choice">
              <input type="radio" name="adjustment-kind" value={option} checked={kind === option} onChange={() => setKind(option)} />
              <span>
                <strong>{bootstrap.adjustmentTypes[option]}</strong>
                <small>{KIND_HELP[option]}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {countingHint(location) && <p className="hint">{countingHint(location)}</p>}
        <QuantityFields
          value={quantities}
          container={container}
          recordedPackSize={product?.packSize ?? null}
          errors={showErrors ? { packSize: errors.packSize, pieces: errors.pieces } : {}}
          onChange={(change) => setQuantities({ ...quantities, ...change })}
        />
        <p className="total">
          Total <strong>{quantity}</strong> pieces
        </p>

        <TextField label="Reason (optional)" value={reason} placeholder="Hidden behind other bottles, damaged, expired…" onChange={setReason} />

        {signedOut && <p className="field-error">Sign in again with your name.</p>}
        <button type="submit" className="button primary wide" disabled={isSaving || signedOut}>
          <Icon name="check" />
          {isSaving ? 'Saving…' : 'Save to the Sheet'}
        </button>
      </form>
      <NoticeBox notice={notice} />
    </section>
  );
}
