import { FieldError, NumberField } from '../shared/fields';
import { useId } from 'react';
import { ANY_PACK, type Container } from './containers';
import type { Quantities } from './countState';

type QuantityFieldsProps = {
  value: Quantities;
  /** What stock is packed in at the chosen place, or null where it is kept as single pieces. */
  container: Container | null;
  /** The pieces per pack already recorded for the product, shown as the value that will be used. */
  recordedPackSize: number | null;
  onChange: (change: Partial<Quantities>) => void;
  /** What is missing, shown under the box it is about: the pieces per pack, or how many pieces. */
  errors?: { packSize?: string; pieces?: string };
};

/** On a shelf this is one "Pieces" box. In the warehouse it asks for full bags or sacks as well. */
export function QuantityFields({ value, container, recordedPackSize, onChange, errors = {} }: QuantityFieldsProps) {
  const id = useId();
  // Packs already on the row (Claude saw a closed carton on a shelf) are never hidden.
  const showsPacks = container !== null || value.fullCartons > 0 || value.packSize !== null;
  const unit = container ?? ANY_PACK;

  if (!showsPacks) {
    return <NumberField label="Pieces" value={value.loosePieces} error={errors.pieces} onChange={(pieces) => onChange({ loosePieces: pieces ?? 0 })} />;
  }
  return (
    <>
    <div className="grid-3">
      <NumberField label={`Full ${unit.many}`} value={value.fullCartons} onChange={(full) => onChange({ fullCartons: full ?? 0 })} />
      <NumberField
        label={`Pieces per ${unit.one}`}
        value={value.packSize}
        placeholder={recordedPackSize ? String(recordedPackSize) : 'e.g. 24'}
        error={errors.packSize}
        onChange={(pieces) => onChange({ packSize: pieces || null })}
      />
      <NumberField label="Loose pieces" value={value.loosePieces} onChange={(pieces) => onChange({ loosePieces: pieces ?? 0 })} />
    </div>
    {/* Pieces can be full packs, loose ones or both, so this one goes under the three boxes. */}
    <FieldError id={`${id}-pieces`} error={errors.pieces} />
    </>
  );
}
