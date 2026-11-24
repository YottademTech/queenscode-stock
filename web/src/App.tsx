import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, isConfigured } from './api/client';
import type { Bootstrap } from './api/contract';
import { CountFlow } from './count/CountFlow';
import { HandCountFlow } from './handcount/HandCountFlow';
import { formatDay } from './lib/day';
import { outbox } from './lib/saves';
import { ProductsFlow } from './products/ProductsFlow';
import { StockFlow } from './stock/StockFlow';
import { Icon } from './shared/Icon';

type Load = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; bootstrap: Bootstrap };

const SCREENS = [
  { id: 'photo', label: 'Photo', icon: 'camera' },
  { id: 'hand', label: 'By hand', icon: 'pencil' },
  { id: 'products', label: 'Products', icon: 'box' },
  { id: 'stock', label: 'Stock', icon: 'chart' },
] as const;
type ScreenId = (typeof SCREENS)[number]['id'];

// The logo is optional: drop the file in src/assets as logo.png (or .jpg, .webp, .svg) and it appears.
const logoFiles = import.meta.glob<string>('./assets/logo.{png,jpg,jpeg,webp,svg}', { eager: true, import: 'default' });
const logoUrl: string | undefined = Object.values(logoFiles)[0];

const COUNTER_KEY = 'stock.counter';

function rememberedCounter(): string {
  try {
    return window.localStorage.getItem(COUNTER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [screen, setScreen] = useState<ScreenId>('photo');
  const [counter, setCounter] = useState(rememberedCounter);
  const [isSending, setIsSending] = useState(false);
  const waitingSaves = useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);

  const reload = useCallback(async () => {
    const result = await api.bootstrap();
    setLoad((current) => {
      if (result.ok) return { kind: 'ready', bootstrap: result.data };
      // A failed refresh keeps what is already on screen; only the first load shows the error.
      return current.kind === 'ready' ? current : { kind: 'failed', message: result.error.message };
    });
  }, []);

  const sendWaitingSaves = useCallback(async () => {
    setIsSending(true);
    await outbox.flush();
    setIsSending(false);
    await reload();
  }, [reload]);

  // On start, and whenever the phone regains a connection, send saves kept from an earlier
  // attempt and load the product list.
  useEffect(() => {
    if (!isConfigured) return;
    void sendWaitingSaves();
    window.addEventListener('online', sendWaitingSaves);
    return () => window.removeEventListener('online', sendWaitingSaves);
  }, [sendWaitingSaves]);

  const handleCounterChange = (name: string) => {
    setCounter(name);
    try {
      window.localStorage.setItem(COUNTER_KEY, name);
    } catch {
      // The name is still kept for this session.
    }
  };

  const handleScreenChange = (next: ScreenId) => {
    setScreen(next);
    // Each screen starts at its top, as it would in an app.
    window.scrollTo({ top: 0 });
  };

  const handleDiscard = (id: string, label: string) => {
    if (window.confirm(`Delete this unsent save for good?\n\n${label}`)) outbox.discard(id);
  };

  if (!isConfigured) {
    return (
      <div className="app">
        <header className="app-bar">
          <h1>QueensCode</h1>
        </header>
        <div className="page">
          <p className="notice error" role="alert">
            The app is not connected to a Sheet yet. Set VITE_API_URL and VITE_APP_SECRET in the project's .env file, then restart.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand">
          {logoUrl && <img src={logoUrl} alt="" className="brand-logo" />}
          <div>
            <h1>QueensCode</h1>
            <p className="stocktake">
              {load.kind === 'ready' ? (
                <>
                  Stocktake <strong>{formatDay(load.bootstrap.countDate)}</strong>
                </>
              ) : (
                'Stock count'
              )}
            </p>
          </div>
        </div>
        <div className="counter">
          <label htmlFor="counter-name" className="visually-hidden">Your name</label>
          <input
            id="counter-name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            value={counter}
            maxLength={40}
            onChange={(event) => handleCounterChange(event.target.value)}
          />
        </div>
      </header>

      <div className="page">
        {load.kind === 'ready' && load.bootstrap.countDate !== load.bootstrap.today && (
          <p className="notice info" role="status">
            Counts are filed under {formatDay(load.bootstrap.countDate)}, not today. To start a new stocktake, change the count date
            on the Sheet's Settings tab.
          </p>
        )}

        {waitingSaves.length > 0 && (
          <section className="notice info" aria-label="Saves waiting to be sent">
            <p>
              <strong>
                {waitingSaves.length} save{waitingSaves.length === 1 ? ' is' : 's are'} waiting on this phone.
              </strong>{' '}
              Do not clear the browser data until they are sent.
            </p>
            <ul className="waiting-saves">
              {waitingSaves.map((save) => (
                <li key={save.id}>
                  {save.label}
                  {save.lastError && <span className="error-text"> — {save.lastError.message}</span>}
                  <button type="button" className="button small quiet" onClick={() => handleDiscard(save.id, save.label)}>
                    <Icon name="trash" size={18} />
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="button small" disabled={isSending} onClick={sendWaitingSaves}>
              <Icon name="send" size={18} />
              {isSending ? 'Sending…' : 'Send now'}
            </button>
          </section>
        )}

        <main>
          {load.kind === 'loading' && <p className="hint" role="status">Loading products from the Sheet…</p>}
          {load.kind === 'failed' && (
            <div className="notice error" role="alert">
              <p>{load.message}</p>
              <button type="button" className="button small" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>
                <Icon name="refresh" size={18} />
                Try again
              </button>
            </div>
          )}
          {load.kind === 'ready' && (
            <>
              {/* Screens stay mounted so a half-finished count survives a look at another screen. */}
              <div hidden={screen !== 'photo'}><CountFlow bootstrap={load.bootstrap} counter={counter} onSaved={reload} /></div>
              <div hidden={screen !== 'hand'}><HandCountFlow bootstrap={load.bootstrap} counter={counter} onSaved={reload} /></div>
              <div hidden={screen !== 'products'}><ProductsFlow bootstrap={load.bootstrap} onSaved={reload} /></div>
              {screen === 'stock' && <StockFlow countDate={load.bootstrap.countDate} />}
            </>
          )}
        </main>
      </div>

      <nav aria-label="Screens" className="bottom-nav">
        {SCREENS.map((entry) => (
          <button key={entry.id} type="button" className="nav-item" aria-current={screen === entry.id ? 'page' : undefined} onClick={() => handleScreenChange(entry.id)}>
            <span className="nav-icon">
              <Icon name={entry.icon} size={22} />
            </span>
            {entry.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
