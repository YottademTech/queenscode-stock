import { useId } from 'react';
import type { Currency } from '../api/contract';
import { FieldError } from '../shared/fields';
import type { PriceDraft } from './price';

type PriceFieldsProps = {
  value: PriceDraft;
  currencies: readonly Currency[];
  onChange: (value: PriceDraft) => void;
  error?: string;
  hint?: string;
};

/**
 * The selling price per piece and its currency, side by side. The list names each currency by its
 * international code, its name and its short name, so the till can use the short name later.
 */
export function PriceFields({ value, currencies, onChange, error, hint }: PriceFieldsProps) {
  const id = useId();
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className="price-fields">
      <legend>Selling price (per piece)</legend>
      <div className="price-row">
        <div className="field">
          <label htmlFor={`${id}-currency`}>Currency</label>
          <select id={`${id}-currency`} value={value.currency} onChange={(event) => onChange({ ...value, currency: event.target.value })}>
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} · {currency.name} ({currency.shortName})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-amount`}>Price</label>
          <input
            id={`${id}-amount`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={value.amount}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange({ ...value, amount: event.target.value })}
          />
        </div>
      </div>
      <FieldError id={`${id}-error`} error={error} />
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
    </fieldset>
  );
}
