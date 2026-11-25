import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Product } from '../api/contract';
import { matchesSearch, productLabel } from '../products/search';
import { Icon } from './Icon';

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric';
  readOnly?: boolean;
  hint?: string;
  error?: string;
};

export function TextField({ label, value, onChange, placeholder, inputMode = 'text', readOnly = false, hint, error }: TextFieldProps) {
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
        aria-invalid={error ? true : undefined}
        aria-describedby={[error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={`${id}-error`} error={error} />
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

type NumberFieldProps = { label: string; value: number | null; onChange: (value: number | null) => void; placeholder?: string; error?: string };

/** What is wrong with a field, shown under it and read out with it. */
export function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? <p id={id} className="field-error">{error}</p> : null;
}

/** A whole number of zero or more. An empty box is null, so "not entered" stays distinct from 0. */
export function NumberField({ label, value, onChange, placeholder, error }: NumberFieldProps) {
  const id = useId();
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
    onChange(digits === '' ? null : Number(digits));
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value ?? ''}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={handleChange}
      />
      <FieldError id={`${id}-error`} error={error} />
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


type ProductPickerProps = {
  label: string;
  products: readonly Product[];
  /** The chosen product code. null is "nothing chosen", or "new product" when `allowNew` is set. */
  value: string | null;
  onChange: (code: string | null) => void;
  allowNew: boolean;
  error?: string;
};

/** A product list that can be narrowed by typing, built on a native select so it works on any phone. */
/**
 * A searchable dropdown of the products: typing in the field narrows the list under it, and a tap or
 * Enter chooses one. It follows the ARIA combobox pattern, so arrow keys move through the list and
 * Escape closes it. With `allowNew`, the first choice is "New product".
 */
export function ProductPicker({ label, products, value, onChange, allowNew, error }: ProductPickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const chosen = products.find((product) => product.code === value) ?? null;
  const NEW = { code: null, label: 'New product (not in the list)' } as const;
  const options = [
    ...(allowNew ? [NEW] : []),
    ...products.filter((product) => matchesSearch(product, query)).map((product) => ({ code: product.code, label: productLabel(product) })),
  ];
  const shownText = chosen ? productLabel(chosen) : allowNew ? NEW.label : '';

  const openList = () => {
    // The list opens showing everything, with the current choice highlighted.
    const at = value === null ? (allowNew ? 0 : -1) : products.findIndex((product) => product.code === value);
    setQuery('');
    setActive(Math.max(0, at === -1 ? 0 : at + (allowNew && value !== null ? 1 : 0)));
    setOpen(true);
  };
  // The highlighted choice is scrolled into view when the list opens.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
    // Only on opening: while open, the arrow keys scroll it themselves.
  }, [open]);
  const choose = (code: string | null) => {
    onChange(code);
    setOpen(false);
  };
  const moveTo = (index: number) => {
    setActive(index);
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openList();
      if (options.length > 0) moveTo((active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option.code);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="field product-picker">
      <label htmlFor={id}>{label}</label>
      <div className="picker-box">
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          placeholder={open ? 'Type to search' : 'Choose a product'}
          value={open ? query : shownText}
          // Opens on a tap, typing or the down arrow, not on focus alone: the form moves the focus here to
          // show an error, and an open list would cover the message.
          onClick={() => { if (!open) openList(); }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="picker-chevron" aria-hidden="true" />
        {open && (
          <ul ref={list} id={listId} role="listbox" aria-label={label} className="picker-list">
            {options.map((option, index) => (
              <li
                key={option.code ?? 'new'}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.code === value}
                className={`picker-option${index === active ? ' active' : ''}${option.code === null ? ' new' : ''}`}
                // Chosen on press, before the field loses focus and closes the list.
                onMouseDown={(event) => { event.preventDefault(); choose(option.code); }}
                onMouseEnter={() => setActive(index)}
              >
                {option.label}
              </li>
            ))}
            {options.length === (allowNew ? 1 : 0) && <li className="picker-empty" role="presentation">No product matches "{query.trim()}".</li>}
          </ul>
        )}
      </div>
      <FieldError id={`${id}-error`} error={error} />
      {/* The field cuts long names short, hiding the variant at the end. */}
      {chosen && !open && (
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
