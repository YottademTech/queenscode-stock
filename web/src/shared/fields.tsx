import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Product } from '../api/contract';
import { Icon } from './Icon';

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric';
  readOnly?: boolean;
  hint?: string;
};

export function TextField({ label, value, onChange, placeholder, inputMode = 'text', readOnly = false, hint }: TextFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
    </div>
  );
}

type TextAreaFieldProps = { label: string; value: string; onChange: (value: string) => void; rows: number; hint?: string };

export function TextAreaField({ label, value, onChange, rows, hint }: TextAreaFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value} rows={rows} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.value)} />
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
    </div>
  );
}

type NumberFieldProps = { label: string; value: number | null; onChange: (value: number | null) => void; placeholder?: string };

/** A whole number of zero or more. An empty box is null, so "not entered" stays distinct from 0. */
export function NumberField({ label, value, onChange, placeholder }: NumberFieldProps) {
  const id = useId();
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
    onChange(digits === '' ? null : Number(digits));
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="numeric" value={value ?? ''} placeholder={placeholder} onChange={handleChange} />
    </div>
  );
}

type SelectFieldProps = { label: string; value: string; options: readonly string[]; onChange: (value: string) => void };

export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}

type SwitchFieldProps = { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void };

/** An on/off choice. A native checkbox underneath, announced as a switch. */
export function SwitchField({ label, hint, checked, onChange }: SwitchFieldProps) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

const NEW_PRODUCT = '__new__';

type ProductPickerProps = {
  label: string;
  products: readonly Product[];
  /** The chosen product code. null is "nothing chosen", or "new product" when `allowNew` is set. */
  value: string | null;
  onChange: (code: string | null) => void;
  allowNew: boolean;
};

/** A product list that can be narrowed by typing, built on a native select so it works on any phone. */
export function ProductPicker({ label, products, value, onChange, allowNew }: ProductPickerProps) {
  const id = useId();
  const [search, setSearch] = useState('');

  const wanted = search.trim().toLowerCase();
  const chosen = products.find((product) => product.code === value);
  const matches = products.filter(
    (product) => product.code === value || wanted === '' || `${product.name} ${product.size} ${product.code}`.toLowerCase().includes(wanted),
  );

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {products.length > 8 && (
        <input
          type="search"
          value={search}
          placeholder="Type to narrow the list"
          aria-label={`Search ${label.toLowerCase()}`}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <select id={id} value={value ?? (allowNew ? NEW_PRODUCT : '')} onChange={(event) => onChange(event.target.value === NEW_PRODUCT || event.target.value === '' ? null : event.target.value)}>
        {allowNew ? <option value={NEW_PRODUCT}>New product (not in the list)</option> : <option value="">Choose a product</option>}
        {matches.map((product) => (
          <option key={product.code} value={product.code}>
            {product.name}{product.size ? ` (${product.size})` : ''}
          </option>
        ))}
      </select>
      {/* A phone's select box cuts long names short, hiding the variant at the end. */}
      {chosen && (
        <p className="chosen-product">
          {chosen.name}
          {chosen.size ? ` · ${chosen.size}` : ''}
        </p>
      )}
    </div>
  );
}

type PhotoButtonsProps = {
  multiple: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  /** When given, "Take photos" opens the app's own camera, which stays open between shots. */
  onOpenCamera?: () => void;
};

/** Two square cards: one for the camera, one for the gallery. Without `onOpenCamera` both are plain file inputs. */
export function PhotoButtons({ multiple, disabled = false, onFiles, onOpenCamera }: PhotoButtonsProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Clearing the input lets the same photo be picked again after it was removed.
    event.target.value = '';
    if (files.length > 0) onFiles(files);
  };
  return (
    <div className="photo-cards">
      {onOpenCamera ? (
        <button type="button" className="photo-card primary" disabled={disabled} onClick={onOpenCamera}>
          <span className="photo-card-icon">
            <Icon name="camera" size={30} />
          </span>
          <strong>Take photos</strong>
          <small>Snap and move on</small>
        </button>
      ) : (
        <label className={`photo-card primary${disabled ? ' disabled' : ''}`}>
          <span className="photo-card-icon">
            <Icon name="camera" size={30} />
          </span>
          <strong>Take photo</strong>
          <small>Use the camera</small>
          <input type="file" accept="image/*" capture="environment" className="visually-hidden" disabled={disabled} onChange={handleChange} />
        </label>
      )}
      <label className={`photo-card${disabled ? ' disabled' : ''}`}>
        <span className="photo-card-icon">
          <Icon name="image" size={30} />
        </span>
        <strong>Upload</strong>
        <small>{multiple ? 'Pick one or more' : 'Pick from gallery'}</small>
        <input type="file" accept="image/*" multiple={multiple} className="visually-hidden" disabled={disabled} onChange={handleChange} />
      </label>
    </div>
  );
}

export type Notice = { tone: 'success' | 'error' | 'info'; text: string };

/** Announced to screen readers when it changes. Errors interrupt; other notices wait their turn. */
export function NoticeBox({ notice, children }: { notice: Notice | null; children?: ReactNode }) {
  return (
    <div role={notice?.tone === 'error' ? 'alert' : 'status'} aria-live={notice?.tone === 'error' ? 'assertive' : 'polite'}>
      {notice && (
        <p className={`notice ${notice.tone}`}>
          {notice.text}
          {children}
        </p>
      )}
    </div>
  );
}
