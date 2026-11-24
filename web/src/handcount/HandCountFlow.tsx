import { useRef, useState, type FormEvent } from 'react';
import { adjustmentKinds, type AdjustmentInput, type AdjustmentKind, type Bootstrap } from '../api/contract';
import { findProduct, packSizeFor, totalPieces, type Quantities } from '../count/countState';
import { createRequestIds } from '../lib/id';
import { submitSave } from '../lib/saves';
import { ANY_PACK, containerAt, countingHint } from '../count/containers';
import { QuantityFields } from '../count/QuantityFields';
import { NoticeBox, ProductPicker, SelectField, TextField, type Notice } from '../shared/fields';
import { Icon } from '../shared/Icon';

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

  const problems: string[] = [];
  if (counter.trim() === '') problems.push('Sign in again with your name.');
  if (!product) problems.push('Choose the product.');
  if (quantities.fullCartons > 0 && !packSizeFor(quantities, product)) problems.push(`Enter the pieces per ${(container ?? ANY_PACK).one}.`);
  if (kind !== 'correct' && quantity === 0) problems.push('Enter how many pieces to add or remove.');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!product || problems.length > 0) return;

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
      <h2 id="hand-heading">Count by hand</h2>
      <p className="hint">Use this to fix a photo count, or for stock a photo cannot show. It never uses Claude.</p>

      <form onSubmit={handleSubmit} className="card">
        <SelectField label="Where are you counting from?" value={location} options={bootstrap.locations} onChange={setLocation} />
        <ProductPicker label="Product" products={bootstrap.products} value={productCode} allowNew={false} onChange={setProductCode} />

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
          onChange={(change) => setQuantities({ ...quantities, ...change })}
        />
        <p className="total">
          Total <strong>{quantity}</strong> pieces
        </p>

        <TextField label="Reason (optional)" value={reason} placeholder="Hidden behind other bottles, damaged, expired…" onChange={setReason} />

        {problems.length > 0 && (
          <ul className="problems" id="hand-problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <button type="submit" className="button primary wide" disabled={problems.length > 0 || isSaving} aria-describedby={problems.length > 0 ? 'hand-problems' : undefined}>
          <Icon name="check" />
          {isSaving ? 'Saving…' : 'Save to the Sheet'}
        </button>
      </form>
      <NoticeBox notice={notice} />
    </section>
  );
}
