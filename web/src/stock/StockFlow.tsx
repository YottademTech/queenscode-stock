import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Stock } from '../api/contract';
import { formatDay } from '../lib/day';
import { Icon } from '../shared/Icon';

type StockLoad = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; stock: Stock };

export function StockFlow({ countDate }: { countDate: string }) {
  const [load, setLoad] = useState<StockLoad>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' });
    const result = await api.stock();
    setLoad(result.ok ? { kind: 'ready', stock: result.data } : { kind: 'failed', message: result.error.message });
  }, []);

  // Loads the Stock tab when the screen opens; the Sheet's formulas are the source of truth.
  useEffect(() => {
    void refresh();
  }, [refresh]);


  return (
    <section aria-labelledby="stock-heading">
      <div className="heading-row">
        <h2 id="stock-heading">Stock for {formatDay(countDate)}</h2>
        <button type="button" className="button small" onClick={refresh} disabled={load.kind === 'loading'}>
          <Icon name="refresh" size={18} />
          Refresh
        </button>
      </div>

      <div role="status" aria-live="polite">
        {load.kind === 'loading' && <p className="hint">Loading the Stock tab…</p>}
      </div>
      {load.kind === 'failed' && <p className="notice error" role="alert">{load.message}</p>}
      {load.kind === 'ready' && load.stock.rows.length === 0 && <p className="hint">No products in the Sheet yet.</p>}

      {load.kind === 'ready' && load.stock.rows.length > 0 && (
        <>
          <p className="hint">
            <span className="badge low">CHECK</span> Claude was unsure and nobody has counted by hand yet.{' '}
            <span className="badge reorder">REORDER</span> stock is at or below the reorder level.
          </p>
          <ul className="stock-list">
            {load.stock.rows.map((row) => (
              <li key={row.code} className={`card stock-card${row.review === 'CHECK' ? ' needs-check' : ''}`}>
                <div className="stock-head">
                  <strong className="stock-name">{row.name}</strong>
                  <p className="stock-total">
                    <strong>{row.total ?? '–'}</strong> <small>in total</small>
                  </p>
                </div>
                <dl className="stock-places">
                  {row.locations.map((entry) => (
                    <div key={entry.location}>
                      <dt>{entry.location}</dt>
                      <dd>{entry.final ?? '–'}</dd>
                    </div>
                  ))}
                </dl>
                {(row.review === 'CHECK' || (row.status !== 'OK' && row.status !== '')) && (
                  <p className="stock-flags">
                    {row.review === 'CHECK' && <span className="badge low">CHECK</span>}
                    {row.status === 'REORDER' && <span className="badge reorder">REORDER</span>}
                    {row.status !== 'REORDER' && row.status !== 'OK' && row.status !== '' && <small>{row.status}</small>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
