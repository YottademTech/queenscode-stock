import { z } from 'zod';
import type { ApiError, ApiResult } from '../api/client';
import { adjustmentInputSchema, saveCountsInputSchema } from '../api/contract';

const errorSchema = z.object({ code: z.string(), message: z.string() }).nullable();

const queuedSaveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('counts'), id: z.string(), label: z.string(), payload: saveCountsInputSchema, lastError: errorSchema }),
  z.object({ kind: z.literal('adjustment'), id: z.string(), label: z.string(), payload: adjustmentInputSchema, lastError: errorSchema }),
]);

/** A confirmed save waiting to reach the Sheet. `id` is the request ID the server deduplicates on. */
export type QueuedSave = z.infer<typeof queuedSaveSchema>;
export type SendSave = (save: QueuedSave) => Promise<ApiResult<unknown>>;
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'stock.outbox';
const UNREADABLE_KEY = 'stock.outbox.unreadable';

/**
 * Keeps confirmed saves on the phone until the server has them, so a count is not lost when the
 * signal drops in the warehouse. Sending twice is safe: the server ignores a request ID it has seen.
 */
export function createOutbox(storage: SaveStorage, send: SendSave) {
  let saves: readonly QueuedSave[] = load(storage);
  let flushing: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function persist(next: readonly QueuedSave[]): boolean {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }

  function replace(next: readonly QueuedSave[]): void {
    saves = next;
    persist(next);
    listeners.forEach((listener) => listener());
  }

  async function sendWaiting(): Promise<void> {
    const attempted = new Set<string>();
    for (;;) {
      const next = saves.find((save) => !attempted.has(save.id));
      if (!next) return;
      attempted.add(next.id);

      const result = await send(next);
      if (result.ok) {
        replace(saves.filter((save) => save.id !== next.id));
        continue;
      }
      const lastError: ApiError = result.error;
      replace(saves.map((save) => (save.id === next.id ? { ...save, lastError } : save)));
      // With no connection the remaining saves would fail the same way.
      if (lastError.code === 'network') return;
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: (): readonly QueuedSave[] => saves,

    /** Returns false when the phone refused to store the save; the caller must then send it directly. */
    add(save: QueuedSave): boolean {
      const next = [...saves, save];
      if (!persist(next)) return false;
      saves = next;
      listeners.forEach((listener) => listener());
      return true;
    },

    discard(id: string): void {
      replace(saves.filter((save) => save.id !== id));
    },

    /** Tries every waiting save once, in order. Concurrent calls share one pass. */
    flush(): Promise<void> {
      flushing ??= sendWaiting().finally(() => {
        flushing = null;
      });
      return flushing;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;

function load(storage: SaveStorage): readonly QueuedSave[] {
  let stored: string | null;
  try {
    stored = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (stored === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    parsed = null;
  }
  const saves = z.array(queuedSaveSchema).safeParse(parsed);
  if (saves.success) return saves.data;

  // Never drop saves this version cannot read: set them aside where they can be recovered.
  try {
    storage.setItem(UNREADABLE_KEY, stored);
  } catch {
    // Nothing more can be done without storage.
  }
  return [];
}
