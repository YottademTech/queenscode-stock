import { describe, expect, it } from 'vitest';
import type { CountAnalysis, Product } from '../api/contract';
import { emptyDetails } from '../products/details';
import {
  awaitsFirstLook, countReducer, countSummary, flagIfCountsDiffer, handRow, detailsToFill, emptyCount, groupByLocation, photoCount, rowProblems, rowsFromAnalysis, rowsPerProduct,
  savedCount, toCountRowInput, totalPieces, type CountRow, type CountState, type Photo,
} from './countState';

const photo = (id: string, location = 'Warehouse sacks'): Photo => ({
  id, previewUrl: `data:${id}`, image: { data: id, mediaType: 'image/jpeg' }, details: [], location, failures: 0, status: { kind: 'waiting' },
});

const product = (overrides: Partial<Product> = {}): Product => ({
  ...emptyDetails(), code: 'RG-YEL', name: 'Rich Glow Yellow Tone Lotion', packSize: 12, reorderLevel: null, imageUrl: '', imageUrls: [], price: null, currency: '', ...overrides,
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
    let state = countReducer(reviewed(), { type: 'rowAdded', row: handRow('manual', 'Shop shelf') });
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
    expect(listed).toMatchObject({ productCode: 'RG-YEL', newProduct: null, details: null, fullCartons: 2, loosePieces: 3 });
    expect(unlisted?.details).toBeNull();
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

describe('saving', () => {
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

  it('groups photos taken with photo sets on into one set: the first is counted, the rest are details', () => {
    const take = (state: CountState, id: string) => countReducer(state, { type: 'setPhotoAdded', photo: photo(id), limit: 3 });

    let state = take(take(take(emptyCount, 'shelf'), 'front'), 'back');
    expect(state.photos).toHaveLength(1);
    expect(state.photos[0]).toMatchObject({ id: 'shelf', status: { kind: 'collecting' } });
    expect(state.photos[0]?.details.map((detail) => detail.image.data)).toEqual(['front', 'back']);
    expect(photoCount(state.photos[0]!)).toBe(3);

    // A full set takes no more, and does not quietly start another one.
    expect(take(state, 'extra')).toBe(state);

    state = countReducer(state, { type: 'detailPhotoRemoved', photoId: 'shelf', index: 0 });
    expect(state.photos[0]?.details.map((detail) => detail.image.data)).toEqual(['back']);

    // Closing the set hands it to Claude; the next photo then starts a new set.
    state = countReducer(state, { type: 'openSetClosed' });
    expect(state.photos[0]?.status).toEqual({ kind: 'waiting' });
    state = take(state, 'next-shelf');
    expect(state.photos.map((item) => [item.id, item.status.kind, item.details.length])).toEqual([['shelf', 'waiting', 1], ['next-shelf', 'collecting', 0]]);
  });

  it('sends what was read from the photos for a listed product, to fill what the Sheet lacks', () => {
    const read = { ...emptyDetails(), name: 'RICH GLOW yellow', brand: ' Rich Glow ', ingredients: 'Aqua, Glycerin', expiry: '2030-08' };
    const row: CountRow = { ...reviewed().rows[0]!, confidence: 'Medium', newProduct: read };
    const listed = product({ expiry: '2029-01' });

    // Only what the Sheet does not have yet, and never the name.
    expect(detailsToFill(row, listed)).toEqual(['brand', 'ingredients']);
    expect(toCountRowInput(row).details).toEqual({ ...read, brand: 'Rich Glow' });

    // A Low count fills too: the counter confirms the product before saving.
    expect(detailsToFill({ ...row, confidence: 'Low' }, listed)).toEqual(['brand', 'ingredients']);
    expect(detailsToFill(row, null)).toEqual([]);

    // Details the server would refuse are left out, so they cannot block the count itself.
    const malformed = { ...row, newProduct: { ...read, barcode: '12a' } };
    expect(toCountRowInput(malformed).details).toBeNull();
    expect(detailsToFill(malformed, listed)).toEqual([]);
  });

  it('keeps a photo with nothing countable on screen, so its note is seen', () => {
    let state = countReducer(emptyCount, { type: 'photoAdded', photo: photo('empty') });
    state = countReducer(state, { type: 'readingSucceeded', photoId: 'empty', note: 'Nothing to count here.', rows: [] });
    state = countReducer(state, { type: 'rowsSaved', rowIds: [], saved: [] });
    expect(state.photos[0]?.status).toEqual({ kind: 'done', note: 'Nothing to count here.' });
  });
});

describe('the first look: the stock photo counted as soon as it is taken', () => {
  const taken = (firstLook = true): CountState =>
    countReducer(emptyCount, { type: 'setPhotoAdded', photo: photo('p1', 'Shop shelf'), limit: 4, firstLook });
  const counted = (state: CountState, ids = ['a', 'b']) =>
    countReducer(countReducer(state, { type: 'firstLookStarted', photoId: 'p1' }), { type: 'firstLookSucceeded', photoId: 'p1', note: 'Two products.', rows: rowsOf('p1', ids, 'Shop shelf') });

  it('is asked for only when the photo came from the camera', () => {
    expect(taken().photos[0]?.firstLook).toEqual({ kind: 'wanted' });
    expect(taken(false).photos[0]?.firstLook).toBeUndefined();
  });

  it('is the whole answer when no detail photos follow: the set is finished without a second request', () => {
    const state = countReducer(counted(taken()), { type: 'openSetClosed' });
    expect(state.photos[0]?.status).toEqual({ kind: 'done', note: 'Two products.' });
    expect(state.rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('is waited for when the set is closed before it arrives', () => {
    let state = countReducer(taken(), { type: 'firstLookStarted', photoId: 'p1' });
    state = countReducer(state, { type: 'openSetClosed' });
    expect(awaitsFirstLook(state.photos[0]!)).toBe(true);
    expect(state.rows).toEqual([]);

    const arrived = countReducer(state, { type: 'firstLookSucceeded', photoId: 'p1', note: '', rows: rowsOf('p1', ['a', 'b'], 'Shop shelf') });
    expect(arrived.photos[0]?.status.kind).toBe('done');
    expect(arrived.rows).toHaveLength(2);

    // If it fails instead, the set is counted the usual way.
    const failed = countReducer(state, { type: 'firstLookFailed', photoId: 'p1' });
    expect(awaitsFirstLook(failed.photos[0]!)).toBe(false);
    expect(failed.photos[0]?.status.kind).toBe('waiting');
  });

  it('is kept only for comparison when detail photos follow, and the full set is counted', () => {
    let state = countReducer(counted(taken()), { type: 'setPhotoAdded', photo: photo('front'), limit: 4 });
    state = countReducer(state, { type: 'openSetClosed' });
    expect(state.photos[0]?.status.kind).toBe('waiting');
    expect(state.rows).toEqual([]);

    state = countReducer(state, { type: 'readingStarted', photoId: 'p1' });
    const same = countReducer(state, { type: 'readingSucceeded', photoId: 'p1', note: '', rows: rowsOf('p1', ['c', 'd'], 'Shop shelf') });
    expect(same.rows.map((row) => [row.id, row.confidence])).toEqual([['c', 'Low'], ['d', 'Medium']]);
    expect(same.rows[1]?.note).toBe('');
  });

  it('marks the rows for a hand count when the two counts of the photo disagree', () => {
    const first = rowsOf('p1', ['a', 'b']);
    const second = rowsOf('p1', ['c', 'd']).map((row, index) => (index === 1 ? { ...row, loosePieces: 7 } : row));
    const flagged = flagIfCountsDiffer(first, second);
    expect(flagged.map((row) => row.confidence)).toEqual(['Low', 'Low']);
    expect(flagged[1]?.note).toBe('Counted twice with different results: 2 full and 8 loose, then 2 full and 10 loose. Count by hand.');
    expect(flagged[0]?.note.length).toBeLessThanOrEqual(300);
    expect(flagIfCountsDiffer(first, rowsOf('p1', ['c', 'd']))[1]?.confidence).toBe('Medium');
  });

  it('is ignored when it arrives for a photo that was removed', () => {
    const removed = countReducer(countReducer(taken(), { type: 'firstLookStarted', photoId: 'p1' }), { type: 'photoRemoved', photoId: 'p1' });
    expect(countReducer(removed, { type: 'firstLookSucceeded', photoId: 'p1', note: '', rows: rowsOf('p1', ['a', 'b']) })).toBe(removed);
  });

  it('sums up a count for the camera: the pieces, and the product or how many products', () => {
    const rows = rowsOf('p1', ['a', 'b']);
    expect(countSummary(rows, [product()])).toEqual({ pieces: 2 * 12 + 3 + 5, unsizedPacks: 0, label: '2 products' });
    expect(countSummary(rows.slice(0, 1), [product()])).toEqual({ pieces: 27, unsizedPacks: 0, label: 'Rich Glow Yellow Tone Lotion' });
    expect(countSummary(rows.slice(1), [])).toEqual({ pieces: 5, unsizedPacks: 0, label: 'QBH Carrot Oil' });
    // Two full sacks of unknown size cannot be turned into pieces, so they are named as sacks.
    expect(countSummary(rows.slice(0, 1), [product({ packSize: null })])).toEqual({ pieces: 3, unsizedPacks: 2, label: 'Rich Glow Yellow Tone Lotion' });
    expect(countSummary([], [])).toEqual({ pieces: 0, unsizedPacks: 0, label: '' });
  });
});
