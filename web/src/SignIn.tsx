import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from './shared/Icon';

/**
 * The code staff type to open the app. It is part of the app that every phone downloads, so it
 * keeps out a passer-by, not someone determined. Change it here and push to change it for everyone:
 * every phone is then asked for the new code.
 */
export const ACCESS_CODE = '4444';
const CODE_LENGTH = ACCESS_CODE.length;

/** The people who count stock, each with a colour so names that look alike are told apart at a glance. */
export const STAFF = [
  { name: 'David Mensah', color: '#e5484d' },
  { name: 'Jonathan', color: '#3e9bff' },
  { name: 'Emmanuel', color: '#30a46c' },
  { name: 'Franklin', color: '#f5a524' },
  { name: 'David Gator', color: '#a875f0' },
  { name: 'Atsu', color: '#14b8b0' },
] as const;
type StaffMember = (typeof STAFF)[number];

const NAME_KEY = 'stock.counter';
const ACCESS_KEY = 'stock.access';

export type SignedIn = { name: string } | null;

/** Who is signed in on this phone, if anyone signed in with the current code. */
export function rememberedSignIn(): SignedIn {
  try {
    const name = window.localStorage.getItem(NAME_KEY) ?? '';
    // A name that is no longer on the list, or a sign-in with an older code, is asked again.
    return STAFF.some((member) => member.name === name) && window.localStorage.getItem(ACCESS_KEY) === ACCESS_CODE ? { name } : null;
  } catch {
    return null;
  }
}

function rememberSignIn(name: string | null) {
  try {
    if (name === null) {
      window.localStorage.removeItem(NAME_KEY);
      window.localStorage.removeItem(ACCESS_KEY);
    } else {
      window.localStorage.setItem(NAME_KEY, name);
      window.localStorage.setItem(ACCESS_KEY, ACCESS_CODE);
    }
  } catch {
    // Without storage the sign-in lasts until the app is closed.
  }
}

export function signOut() {
  rememberSignIn(null);
}

type SignInProps = { logoUrl: string | undefined; onSignIn: (name: string) => void };

/** A black full screen that asks for the counter's name and the code before the app opens. */
export function SignIn({ logoUrl, onSignIn }: SignInProps) {
  const [person, setPerson] = useState<StaffMember | null>(null);
  const [digits, setDigits] = useState<string[]>(() => new Array(CODE_LENGTH).fill(''));
  const [problem, setProblem] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  // Typed or pasted digits fill the boxes from `start` on, and the cursor moves to the next empty one.
  const fill = (start: number, typed: string) => {
    const incoming = typed.replace(/\D/g, '').slice(0, CODE_LENGTH - start).split('');
    if (incoming.length === 0) return;
    setDigits((current) => current.map((digit, index) => (index >= start && index < start + incoming.length ? incoming[index - start] ?? digit : digit)));
    setProblem(null);
    boxes.current[Math.min(start + incoming.length, CODE_LENGTH - 1)]?.focus();
  };

  const handleChange = (index: number, value: string) => {
    if (value === '') {
      setDigits((current) => current.map((digit, at) => (at === index ? '' : digit)));
      return;
    }
    // A box that already held a digit keeps only the one just typed, before or after it.
    // Anything longer is a paste or the phone's autofill, and fills the boxes from here on.
    const old = digits[index] ?? '';
    fill(index, old !== '' && value.length === 2 ? (value[0] === old ? value[1] ?? '' : value[0] ?? '') : value);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && digits[index] === '' && index > 0) {
      // On an empty box, Backspace clears the one before it.
      event.preventDefault();
      setDigits((current) => current.map((digit, at) => (at === index - 1 ? '' : digit)));
      boxes.current[index - 1]?.focus();
    } else if (event.key === 'ArrowLeft' && index > 0) {
      boxes.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      boxes.current[index + 1]?.focus();
    }
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    fill(index, event.clipboardData.getData('text'));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!person) {
      setProblem('Choose your name.');
      return;
    }
    if (digits.join('') !== ACCESS_CODE) {
      setProblem(digits.some((digit) => digit === '') ? `Enter the ${CODE_LENGTH}-digit code.` : 'That code is not right. Try again.');
      setDigits(new Array(CODE_LENGTH).fill(''));
      boxes.current[0]?.focus();
      return;
    }
    rememberSignIn(person.name);
    onSignIn(person.name);
  };

  return (
    <div className="sign-in">
      <form className="sign-in-panel" onSubmit={handleSubmit} noValidate>
        {logoUrl ? <img src={logoUrl} alt="QueensCode Beauty Haven" className="sign-in-logo" /> : <p className="brand-name">QueensCode</p>}
        <h1 className="sign-in-title">Stock Taker</h1>

        <NamePicker
          chosen={person}
          onChoose={(member) => {
            setPerson(member);
            setProblem(null);
            boxes.current[0]?.focus();
          }}
        />

        <fieldset className="sign-in-code">
          <legend>Code</legend>
          <div className="code-boxes">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => { boxes.current[index] = element; }}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                value={digit}
                onChange={(event) => handleChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={(event) => handlePaste(index, event)}
                onFocus={(event) => event.target.select()}
              />
            ))}
          </div>
        </fieldset>

        <p className="sign-in-problem" role="alert">{problem}</p>

        <button type="submit" className="button primary wide">
          <Icon name="forward" />
          Enter
        </button>
      </form>
    </div>
  );
}

type NamePickerProps = { chosen: StaffMember | null; onChoose: (member: StaffMember) => void };

/**
 * A dropdown of the staff names, each with its colour. The list opens below the button, inside the
 * page, so it is never cut off on a small phone. Arrow keys move through it and Escape closes it.
 */
function NamePicker({ chosen, onChoose }: NamePickerProps) {
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);

  // Opening puts the focus on the chosen name, or the first; a tap anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    options.current[Math.max(0, STAFF.findIndex((member) => member === chosen))]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, chosen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = options.current.findIndex((option) => option === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      toggle.current?.focus();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && at !== -1) {
      event.preventDefault();
      options.current[(at + (event.key === 'ArrowDown' ? 1 : STAFF.length - 1)) % STAFF.length]?.focus();
    }
  };

  return (
    <div className="name-picker" ref={picker} onKeyDown={handleKeyDown}>
      <span className="sign-in-label" id="name-picker-label">Your name</span>
      <button
        ref={toggle}
        type="button"
        className="name-toggle"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="name-options"
        aria-labelledby="name-picker-label name-picker-value"
        autoFocus
        onClick={() => setOpen((current) => !current)}
      >
        <span id="name-picker-value" className="name-value">
          {chosen ? (
            <>
              <span className="name-swatch" style={{ background: chosen.color }} aria-hidden="true" />
              {chosen.name}
            </>
          ) : (
            <span className="name-placeholder">Choose your name</span>
          )}
        </span>
        <span className="name-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul id="name-options" className="name-options" aria-label="Staff">
          {STAFF.map((member, index) => (
            <li key={member.name}>
              <button
                ref={(element) => { options.current[index] = element; }}
                type="button"
                className="name-option"
                aria-pressed={member === chosen}
                onClick={() => {
                  setOpen(false);
                  onChoose(member);
                }}
              >
                <span className="name-swatch" style={{ background: member.color }} aria-hidden="true" />
                {member.name}
                {member === chosen && <Icon name="check" size={18} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
