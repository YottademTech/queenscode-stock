import type { ProductDetails } from '../api/contract';
import { TextAreaField, TextField } from '../shared/fields';
import { MAIN_FIELDS, MORE_KEYS, MORE_LONG_FIELDS, MORE_SHORT_FIELDS, filledCount } from './details';

type ProductDetailFieldsProps = {
  value: ProductDetails;
  onChange: (change: Partial<ProductDetails>) => void;
  nameReadOnly?: boolean;
  nameHint?: string;
};

/** Every product detail, editable. Used when adding a product and when a count finds a new one. */
export function ProductDetailFields({ value, onChange, nameReadOnly = false, nameHint }: ProductDetailFieldsProps) {
  const moreFilled = filledCount(value, MORE_KEYS);

  return (
    <>
      <TextField label="Name" value={value.name} readOnly={nameReadOnly} hint={nameHint} onChange={(name) => onChange({ name })} />
      <div className="grid-2">
        {MAIN_FIELDS.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            value={value[field.key]}
            placeholder={field.placeholder}
            inputMode={field.numeric ? 'numeric' : 'text'}
            onChange={(text) => onChange({ [field.key]: text })}
          />
        ))}
      </div>

      <details className="disclosure">
        <summary>
          More details
          <span className="count-chip">{moreFilled === 0 ? 'none yet' : `${moreFilled} filled`}</span>
        </summary>
        <div className="grid-2">
          {MORE_SHORT_FIELDS.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              value={value[field.key]}
              placeholder={field.placeholder}
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
