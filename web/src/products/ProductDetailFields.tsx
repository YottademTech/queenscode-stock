import type { ProductDetails } from '../api/contract';
import { TextAreaField, TextField } from '../shared/fields';
import { MAIN_FIELDS, MORE_KEYS, MORE_LONG_FIELDS, MORE_SHORT_FIELDS, filledCount, type DetailErrors } from './details';

type ProductDetailFieldsProps = {
  value: ProductDetails;
  onChange: (change: Partial<ProductDetails>) => void;
  nameReadOnly?: boolean;
  nameHint?: string;
  /** What is wrong, shown under each field it is about. */
  errors?: DetailErrors;
};

/** Every product detail, editable. Used when adding a product and when a count finds a new one. */
export function ProductDetailFields({ value, onChange, nameReadOnly = false, nameHint, errors = {} }: ProductDetailFieldsProps) {
  const moreFilled = filledCount(value, MORE_KEYS);
  // A mistake in a field under "More details" opens it, so the message is not hidden.
  const moreHasError = MORE_KEYS.some((key) => errors[key]);

  return (
    <>
      <TextField label="Name" value={value.name} readOnly={nameReadOnly} hint={nameHint} error={errors.name} onChange={(name) => onChange({ name })} />
      <div className="grid-2">
        {MAIN_FIELDS.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            value={value[field.key]}
            placeholder={field.placeholder}
            inputMode={field.numeric ? 'numeric' : 'text'}
            error={errors[field.key]}
            onChange={(text) => onChange({ [field.key]: text })}
          />
        ))}
      </div>
      {/* Claude does not fill this one: a photo cannot be relied on to decode a QR code. */}
      <TextField
        label="QR code"
        value={value.qrCode}
        hint="Optional, like the barcode. Type, paste or scan in what the code holds."
        error={errors.qrCode}
        onChange={(qrCode) => onChange({ qrCode })}
      />

      <details className="disclosure" {...(moreHasError ? { open: true } : {})}>
        <summary>
          <span className="disclosure-title">
            <span>
              More details
              <span className="count-chip">{moreFilled === 0 ? 'none yet' : `${moreFilled} filled`}</span>
            </span>
            <small>Brand, batch, made on, ingredients, directions and all text on the pack</small>
          </span>
        </summary>
        <div className="grid-2">
          {MORE_SHORT_FIELDS.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              value={value[field.key]}
              placeholder={field.placeholder}
              error={errors[field.key]}
              onChange={(text) => onChange({ [field.key]: text })}
            />
          ))}
        </div>
        {MORE_LONG_FIELDS.map((field) => (
          <TextAreaField
            key={field.key}
            label={field.label}
            value={value[field.key]}
            rows={field.rows}
            hint={field.hint}
            onChange={(text) => onChange({ [field.key]: text })}
          />
        ))}
      </details>
    </>
  );
}
