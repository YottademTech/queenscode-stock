import { z } from 'zod';
import {
  bootstrapSchema,
  countAnalysisSchema,
  labelReadingSchema,
  saveResultSchema,
  stockSchema,
  type AdjustmentInput,
  type DeleteProductInput,
  type EncodedImage,
  type SaveCountsInput,
  type SaveProductInput,
  type SetPriceInput,
} from './contract';

/**
 * `network` and `service_unavailable` are raised by this adapter; every other code comes from
 * the backend (unauthorized, invalid_request, sheet_full, busy, claude_unavailable, ...).
 */
export type ApiError = { code: string; message: string };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const API_URL: string = import.meta.env.VITE_API_URL ?? '';
const APP_SECRET: string = import.meta.env.VITE_APP_SECRET ?? '';

export const isConfigured = API_URL !== '' && APP_SECRET !== '';

const replySchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

const QUICK_TIMEOUT_MS = 45_000;
// Reading a photo can take Claude well over half a minute, plus the upload on a slow connection.
const PHOTO_TIMEOUT_MS = 150_000;

const unavailable: ApiError = {
  code: 'service_unavailable',
  message: 'The server sent a reply the app could not read. Check that the server address is right and the server is running.',
};

async function call<T>(action: string, payload: object, dataSchema: z.ZodType<T>, timeoutMs: number): Promise<ApiResult<T>> {
  let replyText: string;
  // fetch and timeouts throw; this is the one place those become explicit failures.
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      // text/plain keeps this a "simple" request: Apps Script cannot answer a CORS preflight.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action, secret: APP_SECRET }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Some hosts refuse a large request themselves, with a page of their own that is not our JSON.
    if (response.status === 413) {
      return { ok: false, error: { code: 'invalid_request', message: 'These photos are too large to send together. Use fewer photos, or save some first and then add the rest.' } };
    }
    replyText = await response.text();
  } catch {
    return { ok: false, error: { code: 'network', message: 'No connection to the server. Check your signal and try again.' } };
  }

  let replyJson: unknown;
  try {
    replyJson = JSON.parse(replyText);
  } catch {
    return { ok: false, error: unavailable };
  }

  const reply = replySchema.safeParse(replyJson);
  if (!reply.success) return { ok: false, error: unavailable };
  if (!reply.data.ok) return { ok: false, error: reply.data.error };

  const data = dataSchema.safeParse(reply.data.data);
  return data.success ? { ok: true, data: data.data } : { ok: false, error: unavailable };
}

export const api = {
  bootstrap: () => call('bootstrap', {}, bootstrapSchema, QUICK_TIMEOUT_MS),
  stock: () => call('stock', {}, stockSchema, QUICK_TIMEOUT_MS),
  /**
   * The first `countViews` images show the stock to count: one photo, or several views of the same
   * stock from a video taken around it. Any after them are detail photos read in the same request.
   */
  analyzeCount: (location: string, images: readonly EncodedImage[], countViews = 1) =>
    call(
      'analyzeCount',
      // A lone photo keeps the form every version of the backend understands.
      images.length === 1 ? { location, image: images[0] } : { location, images, ...(countViews > 1 ? { countViews } : {}) },
      countAnalysisSchema,
      PHOTO_TIMEOUT_MS,
    ),
  readProductLabel: (image: EncodedImage) => call('readProductLabel', { image }, labelReadingSchema, PHOTO_TIMEOUT_MS),
  saveCounts: (input: SaveCountsInput) => call('saveCounts', input, saveResultSchema, QUICK_TIMEOUT_MS),
  saveAdjustment: (input: AdjustmentInput) => call('adjust', input, saveResultSchema, QUICK_TIMEOUT_MS),
  saveProduct: (input: SaveProductInput) => call('saveProduct', input, saveResultSchema, PHOTO_TIMEOUT_MS),
  deleteProduct: (input: DeleteProductInput) => call('deleteProduct', input, saveResultSchema, QUICK_TIMEOUT_MS),
  setPrice: (input: SetPriceInput) => call('setPrice', input, saveResultSchema, QUICK_TIMEOUT_MS),
};
