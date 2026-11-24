import { describe, expect, it } from 'vitest';
import type { ApiResult } from '../api/client';
import { createOutbox, type QueuedSave, type SaveStorage } from './outbox';

function memoryStorage(initial: Record<string, string> = {}, { full = false } = {}) {
  const items = new Map(Object.entries(initial));
  const storage: SaveStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (full) throw new Error('QuotaExceededError');
      items.set(key, value);
    },
  };
  return { storage, items };
}

function countSave(id: string): QueuedSave {
  return {
    kind: 'counts',
    id,
    label: `save ${id}`,
    lastError: null,
    payload: {
      requestId: id,
      location: 'Shop shelf',
      counter: 'Ama',
      rows: [{ productCode: 'RG-YEL', newProduct: null, fullCartons: 0, packSize: null, loosePieces: 8, confidence: 'High', note: '' }],
    },
  };
}

const ok: ApiResult<unknown> = { ok: true, data: { duplicate: false } };
const failed = (code: string): ApiResult<unknown> => ({ ok: false, error: { code, message: `${code} happened` } });

describe('outbox', () => {
  it('keeps a save across an app restart until the server has it', async () => {
    const { storage } = memoryStorage();
    const offline = createOutbox(storage, async () => failed('network'));
    expect(offline.add(countSave('a'))).toBe(true);
    await offline.flush();

    const sent: string[] = [];
    const restarted = createOutbox(storage, async (save) => {
      sent.push(save.payload.requestId);
      return ok;
    });
    expect(restarted.getSnapshot().map((save) => [save.id, save.lastError?.code])).toEqual([['a', 'network']]);

    await restarted.flush();
    expect(sent).toEqual(['a']);
    expect(restarted.getSnapshot()).toEqual([]);
    expect(createOutbox(storage, async () => ok).getSnapshot()).toEqual([]);
  });

  it('stops at the first save when there is no connection, and keeps the order', async () => {
    const attempts: string[] = [];
    const outbox = createOutbox(memoryStorage().storage, async (save) => {
      attempts.push(save.id);
      return failed('network');
    });
    outbox.add(countSave('a'));
    outbox.add(countSave('b'));

    await outbox.flush();
    expect(attempts).toEqual(['a']);
    expect(outbox.getSnapshot().map((save) => save.id)).toEqual(['a', 'b']);
  });

  it('keeps a save the server refused and still sends the ones behind it', async () => {
    const outbox = createOutbox(memoryStorage().storage, async (save) => (save.id === 'a' ? failed('sheet_full') : ok));
    outbox.add(countSave('a'));
    outbox.add(countSave('b'));

    await outbox.flush();
    expect(outbox.getSnapshot().map((save) => [save.id, save.lastError])).toEqual([
      ['a', { code: 'sheet_full', message: 'sheet_full happened' }],
    ]);
  });

  it('sends a save that was added while another was being sent', async () => {
    const sent: string[] = [];
    let release: () => void = () => {};
    const firstSendStarted = new Promise<void>((started) => {
      release = started;
    });
    const outbox = createOutbox(memoryStorage().storage, async (save) => {
      sent.push(save.id);
      release();
      await Promise.resolve();
      return ok;
    });

    outbox.add(countSave('a'));
    const firstFlush = outbox.flush();
    await firstSendStarted;
    outbox.add(countSave('b'));
    await Promise.all([firstFlush, outbox.flush()]);

    expect(sent).toEqual(['a', 'b']);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it('reports when the phone cannot store a save, so the caller sends it directly', () => {
    const outbox = createOutbox(memoryStorage({}, { full: true }).storage, async () => ok);
    expect(outbox.add(countSave('a'))).toBe(false);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it('tells subscribers about every change and lets a stuck save be discarded', async () => {
    const outbox = createOutbox(memoryStorage().storage, async () => failed('unauthorized'));
    let changes = 0;
    const unsubscribe = outbox.subscribe(() => changes++);

    outbox.add(countSave('a'));
    await outbox.flush();
    outbox.discard('a');
    unsubscribe();
    outbox.add(countSave('b'));

    expect(changes).toBe(3);
    expect(outbox.getSnapshot().map((save) => save.id)).toEqual(['b']);
  });

  it('sets aside stored saves it cannot read instead of deleting them', () => {
    const { storage, items } = memoryStorage({ 'stock.outbox': '[{"kind":"older-format"}]' });
    const outbox = createOutbox(storage, async () => ok);

    expect(outbox.getSnapshot()).toEqual([]);
    expect(items.get('stock.outbox.unreadable')).toBe('[{"kind":"older-format"}]');
  });
});
