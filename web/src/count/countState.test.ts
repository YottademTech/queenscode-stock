import { describe, expect, it } from 'vitest';
import type { CountAnalysis, Product } from '../api/contract';
import { emptyDetails } from '../products/details';
import {
  canSaveUnattended, countReducer, emptyCount, groupByLocation, rowProblems, rowsFromAnalysis, rowsPerProduct, savedCount,
  toCountRowInput, totalPieces, type CountRow, type CountState, type Photo,
} from './countState';

const photo = (id: string, location = 'Warehouse sacks'): Photo => ({
  id, previewUrl: 'data:', image: { data: 'AAAA', mediaType: 'image/jpeg' }, location, failures: 0, status: { kind: 'waiting' },
});

const product = (overrides: Partial<Product> = {}): Product => ({
  ...emptyDetails(), code: 'RG-YEL', name: 'Rich Glow Yellow Tone Lotion', packSize: 12, reorderLevel: null, imageUrl: '', ...overrides,
});

const analysis: CountAnalysis = {
  photoNote: 'Two products.',
  items: [
    { ...emptyDetails(), productCode: 'RG-YEL', fullCartons: 2, packSize: null, loosePieces: 3, confidence: 'Low', note: 'Back row hidden.' },
    { ...emptyDetails(), productCode: null, name: 'QBH Carrot Oil', size: '100ml', category: 'Hair oil', expiry: '2030-08', brand: 'QBH', labelText: 'QBH\nCARROT OIL', fullCartons: 0, packSize: null, loosePieces: 5, confidence: 'Medium', note: '' },
  ],
};

const sack = { one: 'sack', many: 'sacks' };

function rowsOf(photoId: string, ids: string[], location?: string): CountRow[] {
  const remaining = [...ids];
  return rowsFromAnalysis(photo(photoId, location), analysis, () => remaining.shift() ?? 'extra');
}

function reviewed(): CountState {
  let state = countReducer(emptyCount, { type: 'photoAdded', photo: photo('p1') });
  state = countReducer(state, { type: 'readingStarted', photoId: 'p1' });
  return countReducer(state, { type: 'readingSucceeded', photoId: 'p1', note: analysis.photoNote, rows: rowsOf('p1', ['r1', 'r2']) });
}

describe('counting from photos', () => {
  it("turns Claude's reading of a photo into rows for the place where the photo was taken", () => {
    const state = reviewed();
    expect(state.photos[0]?.status).toEqual({ kind: 'done', note: 'Two products.' });
    expect(state.rows.map((row) => [row.id, row.photoId, row.location, row.productCode, row.confidence])).toEqual([
      ['r1', 'p1', 'Warehouse sacks', 'RG-YEL', 'Low'],
      ['r2', 'p1', 'Warehouse sacks', null, 'Medium'],
    ]);
  });

  it('marks a row as checked once a person changes its numbers, but not when they change other details', () => {
    const noted = countReducer(reviewed(), { type: 'rowDetailsChanged', rowId: 'r1', change: { note: 'looked again' } });
    expect(noted.rows[0]?.confidence).toBe('Low');

    const recounted = countReducer(noted, { type: 'rowQuantitiesChanged', rowId: 'r1', change: { loosePieces: 4 } });
    expect(recounted.rows[0]).toMatchObject({ loosePieces: 4, confidence: 'High', note: 'looked again' });
    expect(recounted.rows[1]?.confidence).toBe('Medium');
  });

  it('removes a photo together with the rows read from it, and ignores a late answer for it', () => {
    let state = countReducer(reviewed(), { type: 'rowAdded', rowId: 'manual', location: 'Shop shelf' });
    state = countReducer(state, { type: 'photoRemoved', photoId: 'p1' });
    expect(state.photos).toEqual([]);
    expect(state.rows.map((row) => [row.id, row.location])).toEqual([['manual', 'Shop shelf']]);

    const late = countReducer(state, { type: 'readingSucceeded', photoId: 'p1', note: '', rows: rowsOf('p1', ['x', 'y']) });
    expect(late).toBe(state);
  });

  it('counts each failed attempt and lets the photo be tried again', () => {
    let state = countReducer(emptyCount, { type: 'photoAdded', photo: photo('p1') });
    state = countReducer(state, { type: 'readingFailed', photoId: 'p1', message: 'No connection.', retryable: true });
    expect(state.photos[0]).toMatchObject({ failures: 1, status: { kind: 'failed', message: 'No connection.', retryable: true } });

    state = countReducer(state, { type: 'photoRetried', photoId: 'p1' });
    expect(state.photos[0]).toMatchObject({ failures: 1, status: { kind: 'waiting' } });
  });

  it('counts full sacks with the pieces on the row, else the number recorded for the product', () => {
    const [sackRow] = reviewed().rows;
    expect(totalPieces(sackRow!, product())).toBe(2 * 12 + 3);
    expect(totalPieces({ ...sackRow!, packSize: 24 }, product())).toBe(2 * 24 + 3);
    expect(totalPieces(sackRow!, product({ packSize: null }))).toBe(3);
  });

  it('blocks rows the Sheet could not count correctly', () => {
    const [sackRow, newRow] = reviewed().rows;
    expect(rowProblems(sackRow!, [product()], sack)).toEqual([]);
    expect(rowProblems(sackRow!, [product({ packSize: null })], sack)).toEqual(['Enter the pieces per sack.']);
    expect(rowProblems(sackRow!, [], sack)).toContain('This product is no longer in the Sheet. Choose it again.');

    expect(rowProblems(newRow!, [], sack)).toEqual([]);
    const broken = { ...newRow!, newProduct: { ...newRow!.newProduct, name: ' ', barcode: '12a', qrCode: 'x'.repeat(2001), expiry: '06-08-2030', manufactureDate: 'Aug 2025' } };
    expect(rowProblems(broken, [], sack)).toEqual([
      'Enter the product name.',
      'The barcode must be digits only.',
      'The QR code text is too long (max 2000 characters).',
      'Write the expiry as YYYY-MM-DD or YYYY-MM.',
      'Write the manufacture date as YYYY-MM-DD or YYYY-MM.',
    ]);
  });

  it('sends new-product details only for products that are not in the list', () => {
    const [listed, unlisted] = reviewed().rows.map(toCountRowInput);
    expect(listed).toMatchObject({ productCode: 'RG-YEL', newProduct: null, fullCartons: 2, loosePieces: 3 });
    // Every detail Claude read travels with the row, not only the ones shown first.
    expect(unlisted?.newProduct).toEqual({ ...emptyDetails(), name: 'QBH Carrot Oil', size: '100ml', category: 'Hair oil', expiry: '2030-08', brand: 'QBH', labelText: 'QBH\nCARROT OIL' });
  });

  it('spots a product counted twice at one place, but not the same product at two places', () => {
    const rows = [...rowsOf('p1', ['r1', 'r2']), ...rowsOf('p2', ['r3', 'r4']), ...rowsOf('p3', ['r5', 'r6'], 'Shop shelf')];
    const sameProductRows = rowsPerProduct(rows);
    expect(rows.map(sameProductRows)).toEqual([2, 1, 2, 1, 1, 1]);
    expect([...groupByLocation(rows)].map(([location, group]) => [location, group.map((row) => row.id)])).toEqual([
      ['Warehouse sacks', ['r1', 'r2', 'r3', 'r4']],
      ['Shop shelf', ['r5', 'r6']],
    ]);
  });
});

describe('saving without the counter waiting', () => {
  it('saves a row unattended only when nothing is missing that a person has to supply', () => {
    const [sackRow, newRow] = reviewed().rows;

    expect(canSaveUnattended(newRow!, [])).toBe(true);
    expect(canSaveUnattended({ ...newRow!, newProduct: emptyDetails() }, [])).toBe(false);

    // Two full sacks: only countable when the pieces per sack are known.
    expect(canSaveUnattended(sackRow!, [product()])).toBe(true);
    expect(canSaveUnattended(sackRow!, [product({ packSize: null })])).toBe(false);
    expect(canSaveUnattended({ ...sackRow!, packSize: 50 }, [product({ packSize: null })])).toBe(true);

    // A code the server just returned is trusted even if this phone has not reloaded its list yet.
    expect(canSaveUnattended({ ...sackRow!, fullCartons: 0 }, [])).toBe(true);
    expect(canSaveUnattended(sackRow!, [])).toBe(false);
  });

  it('hides rows while they are being saved and brings them back for the counter if the save is refused', () => {
    let state = countReducer(reviewed(), { type: 'savingStarted', rowIds: ['r1'] });
    expect(state.rows.map((row) => row.saving)).toEqual([true, false]);

    state = countReducer(state, { type: 'savingFailed', rowIds: ['r1'] });
    expect(state.rows.map((row) => row.saving)).toEqual([false, false]);
  });

  it('moves saved rows to the saved list and clears a photo only when all its rows are saved', () => {
    const [first, second] = reviewed().rows;
    const entry = savedCount(first!, [product()], false);
    expect(entry).toEqual({ id: 'r1', name: 'Rich Glow Yellow Tone Lotion', pieces: 27, location: 'Warehouse sacks', confidence: 'Low', waitingForSignal: false });

    let state = countReducer(reviewed(), { type: 'rowsSaved', rowIds: ['r1'], saved: [entry] });
    expect(state.rows.map((row) => row.id)).toEqual(['r2']);
    expect(state.photos.map((item) => item.id)).toEqual(['p1']);

    const queued = savedCount(second!, [], true);
    expect(queued).toMatchObject({ name: 'QBH Carrot Oil', pieces: 5, waitingForSignal: true });
    state = countReducer(state, { type: 'rowsSaved', rowIds: ['r2'], saved: [queued] });
    expect(state.rows).toEqual([]);
    expect(state.photos).toEqual([]);
    expect(state.saved.map((item) => item.id)).toEqual(['r2', 'r1']);
  });

  it('keeps a photo with nothing countable on screen, so its note is seen', () => {
    let state = countReducer(emptyCount, { type: 'photoAdded', photo: photo('empty') });
    state = countReducer(state, { type: 'readingSucceeded', photoId: 'empty', note: 'Nothing to count here.', rows: [] });
    state = countReducer(state, { type: 'rowsSaved', rowIds: [], saved: [] });
    expect(state.photos[0]?.status).toEqual({ kind: 'done', note: 'Nothing to count here.' });
  });
});
