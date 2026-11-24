import { api } from '../api/client';
import { createOutbox, type QueuedSave, type SaveStorage } from './outbox';

function sendSave(save: QueuedSave) {
  return save.kind === 'counts' ? api.saveCounts(save.payload) : api.saveAdjustment(save.payload);
}

// localStorage is reached lazily: in some private-browsing modes merely touching it throws,
// and the outbox already treats a throwing store as "cannot keep saves on this phone".
const phoneStorage: SaveStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

export const outbox = createOutbox(phoneStorage, sendSave);

export type SaveOutcome =
  | { kind: 'sent' }
  /** Stored on the phone; it is sent when the connection or the server recovers. */
  | { kind: 'queued' }
  /** The server refused the content, so the counter has to change it. */
  | { kind: 'rejected'; message: string };

export async function submitSave(save: QueuedSave): Promise<SaveOutcome> {
  if (!outbox.add(save)) {
    const result = await sendSave(save);
    return result.ok ? { kind: 'sent' } : { kind: 'rejected', message: result.error.message };
  }

  await outbox.flush();
  const waiting = outbox.getSnapshot().find((queued) => queued.id === save.id);
  if (!waiting) return { kind: 'sent' };

  if (waiting.lastError?.code === 'invalid_request') {
    outbox.discard(save.id);
    return { kind: 'rejected', message: waiting.lastError.message };
  }
  return { kind: 'queued' };
}
