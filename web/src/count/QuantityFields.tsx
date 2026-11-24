import { NumberField } from '../shared/fields';
import { ANY_PACK, type Container } from './containers';
import type { Quantities } from './countState';

type QuantityFieldsProps = {
  value: Quantities;
  /** What stock is packed in at the chosen place, or null where it is kept as single pieces. */
  container: Container | null;
  /** The pieces per pack already recorded for the product, shown as the value that will be used. */
  recordedPackSize: number | null;
  onChange: (change: Partial<Quantities>) => void;
};

/** On a shelf this is one "Pieces" box. In the warehouse it asks for full bags or sacks as well. */
export function QuantityFields({ value, container, recordedPackSize, onChange }: QuantityFieldsProps) {
  // Packs already on the row (Claude saw a closed carton on a shelf) are never hidden.
  const showsPacks = container !== null || value.fullCartons > 0 || value.packSize !== null;
  const unit = container ?? ANY_PACK;

  if (!showsPacks) {
    return <NumberField label="Pieces" value={value.loosePieces} onChange={(pieces) => onChange({ loosePieces: pieces ?? 0 })} />;
  }
  return (
    <div className="grid-3">
      <NumberField label={`Full ${unit.many}`} value={value.fullCartons} onChange={(full) => onChange({ fullCartons: full ?? 0 })} />
      <NumberField
        label={`Pieces per ${unit.one}`}
        value={value.packSize}
        placeholder={recordedPackSize ? String(recordedPackSize) : 'e.g. 24'}
        onChange={(pieces) => onChange({ packSize: pieces || null })}
      />
      <NumberField label="Loose pieces" value={value.loosePieces} onChange={(pieces) => onChange({ loosePieces: pieces ?? 0 })} />
    </div>
  );
}
