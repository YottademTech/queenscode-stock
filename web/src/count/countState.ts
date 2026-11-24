import { DETAIL_KEYS, type Confidence, type CountAnalysis, type CountRowInput, type DetailKey, type EncodedImage, type Product, type ProductDetails } from '../api/contract';
import type { PreparedPhoto } from '../lib/image';
import { detailProblems, emptyDetails, pickDetails, trimDetails } from '../products/details';
import type { Container } from './containers';

export type PhotoStatus =
  /** An open photo set: the counter is still adding detail photos, so it is not sent to Claude yet. */
  | { kind: 'collecting' }
  | { kind: 'waiting' }
  | { kind: 'reading' }
  | { kind: 'done'; note: string }
  /** `retryable` failures (no signal, server busy) are tried again without the counter doing anything. */
  | { kind: 'failed'; message: string; retryable: boolean };

export type Photo = {
  id: string;
  previewUrl: string;
  image: EncodedImage;
  /** Close-ups of the same stock (front, back, markings). Claude reads them with the photo, in one request, and counts only the photo. */
  details: readonly PreparedPhoto[];
  /** The place chosen when the photo was taken. It stays with the photo when the counter moves on. */
  location: string;
  /** How many times Claude has been asked to read it and failed. */
  failures: number;
  status: PhotoStatus;
};

export type CountRow = {
  id: string;
  /** The photo this row came from, or null for a row the counter added by hand. */
  photoId: string | null;
  location: string;
  /** null means a product that is not in the Sheet yet; `newProduct` then describes it. */
  productCode: string | null;
  /** What was read from the photos. For a listed product it fills the details the Sheet does not have yet. */
  newProduct: ProductDetails;
  fullCartons: number;
  packSize: number | null;
  loosePieces: number;
  confidence: Confidence;
  note: string;
  /** True while the row is on its way to the Sheet; it is then not shown for review. */
  saving: boolean;
};

/** One line of the "Saved" list, kept so the counter can see what went to the Sheet. */
export type SavedCount = { id: string; name: string; pieces: number; location: string; confidence: Confidence; waitingForSignal: boolean };

export type CountState = { photos: readonly Photo[]; rows: readonly CountRow[]; saved: readonly SavedCount[] };

export type Quantities = Pick<CountRow, 'fullCartons' | 'packSize' | 'loosePieces'>;
export type RowDetails = Pick<CountRow, 'productCode' | 'newProduct' | 'confidence' | 'note'>;

export type CountAction =
  | { type: 'photoAdded'; photo: Photo }
  /** A photo taken while photo sets are on: it starts a set, or joins the open one as a detail photo. */
  | { type: 'setPhotoAdded'; photo: Photo; limit: number }
  | { type: 'detailPhotoRemoved'; photoId: string; index: number }
  | { type: 'openSetClosed' }
  | { type: 'readingStarted'; photoId: string }
  | { type: 'readingSucceeded'; photoId: string; note: string; rows: readonly CountRow[] }
  | { type: 'readingFailed'; photoId: string; message: string; retryable: boolean }
  | { type: 'photoRetried'; photoId: string }
  | { type: 'photoRemoved'; photoId: string }
  | { type: 'rowAdded'; rowId: string; location: string }
  | { type: 'rowDetailsChanged'; rowId: string; change: Partial<RowDetails> }
  | { type: 'rowQuantitiesChanged'; rowId: string; change: Partial<Quantities> }
  | { type: 'rowRemoved'; rowId: string }
  | { type: 'savingStarted'; rowIds: readonly string[] }
  | { type: 'rowsSaved'; rowIds: readonly string[]; saved: readonly SavedCount[] }
  | { type: 'savingFailed'; rowIds: readonly string[] };

export const emptyCount: CountState = { photos: [], rows: [], saved: [] };

const SAVED_LIST_LENGTH = 40;

export function countReducer(state: CountState, action: CountAction): CountState {
  switch (action.type) {
    case 'photoAdded':
      return { ...state, photos: [...state.photos, action.photo] };

    case 'setPhotoAdded': {
      const open = state.photos.find((photo) => photo.status.kind === 'collecting');
      if (!open) return { ...state, photos: [...state.photos, { ...action.photo, details: [], status: { kind: 'collecting' } }] };
      // The screen stops the counter before a set is full; a shot that slips past is not counted as a new set.
      if (1 + open.details.length >= action.limit) return state;
      const detail = { image: action.photo.image, previewUrl: action.photo.previewUrl };
      return withPhoto(state, open.id, (photo) => ({ ...photo, details: [...photo.details, detail] }));
    }

    case 'detailPhotoRemoved':
      return withPhoto(state, action.photoId, (photo) => ({ ...photo, details: photo.details.filter((_, index) => index !== action.index) }));

    case 'openSetClosed':
      return { ...state, photos: state.photos.map((photo) => (photo.status.kind === 'collecting' ? { ...photo, status: { kind: 'waiting' } } : photo)) };

    case 'readingStarted':
      return withPhoto(state, action.photoId, (photo) => ({ ...photo, status: { kind: 'reading' } }));

    case 'readingSucceeded':
      // The counter may have removed the photo while Claude was still reading it.
      if (!state.photos.some((photo) => photo.id === action.photoId)) return state;
      return {
        ...withPhoto(state, action.photoId, (photo) => ({ ...photo, status: { kind: 'done', note: action.note } })),
        rows: [...state.rows, ...action.rows],
      };

    case 'readingFailed':
      return withPhoto(state, action.photoId, (photo) => ({
        ...photo,
        failures: photo.failures + 1,
        status: { kind: 'failed', message: action.message, retryable: action.retryable },
      }));

    case 'photoRetried':
      return withPhoto(state, action.photoId, (photo) => ({ ...photo, status: { kind: 'waiting' } }));

    case 'photoRemoved':
      return {
        ...state,
        photos: state.photos.filter((photo) => photo.id !== action.photoId),
        rows: state.rows.filter((row) => row.photoId !== action.photoId),
      };

    case 'rowAdded':
      return {
        ...state,
        rows: [
          ...state.rows,
          {
            id: action.rowId, photoId: null, location: action.location, productCode: null, newProduct: emptyDetails(),
            fullCartons: 0, packSize: null, loosePieces: 0, confidence: 'High', note: '', saving: false,
          },
        ],
      };

    case 'rowDetailsChanged':
      return withRows(state, [action.rowId], (row) => ({ ...row, ...action.change }));

    case 'rowQuantitiesChanged':
      // A person who changes a number has counted it themselves, so the row no longer needs a recheck.
      return withRows(state, [action.rowId], (row) => ({ ...row, ...action.change, confidence: 'High' }));

    case 'rowRemoved':
      return { ...state, rows: state.rows.filter((row) => row.id !== action.rowId) };

    case 'savingStarted':
      return withRows(state, action.rowIds, (row) => ({ ...row, saving: true }));

    case 'savingFailed':
      return withRows(state, action.rowIds, (row) => ({ ...row, saving: false }));

    case 'rowsSaved': {
      const savedPhotoIds = new Set(state.rows.filter((row) => action.rowIds.includes(row.id)).map((row) => row.photoId));
      const rows = state.rows.filter((row) => !action.rowIds.includes(row.id));
      // A photo leaves the screen once everything read from it is in the Sheet.
      const photos = state.photos.filter((photo) => !savedPhotoIds.has(photo.id) || rows.some((row) => row.photoId === photo.id));
      return { photos, rows, saved: [...action.saved, ...state.saved].slice(0, SAVED_LIST_LENGTH) };
    }

    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

function withPhoto(state: CountState, photoId: string, change: (photo: Photo) => Photo): CountState {
  return { ...state, photos: state.photos.map((photo) => (photo.id === photoId ? change(photo) : photo)) };
}

function withRows(state: CountState, rowIds: readonly string[], change: (row: CountRow) => CountRow): CountState {
  return { ...state, rows: state.rows.map((row) => (rowIds.includes(row.id) ? change(row) : row)) };
}

// --- What a row means ------------------------------------------------------

/** Claude's reading of one photo, as rows for the place where the photo was taken. */
export function rowsFromAnalysis(photo: Photo, analysis: CountAnalysis, nextId: () => string): CountRow[] {
  return analysis.items.map((item) => ({
    id: nextId(),
    photoId: photo.id,
    location: photo.location,
    productCode: item.productCode,
    newProduct: pickDetails(item),
    fullCartons: item.fullCartons,
    packSize: item.packSize,
    loosePieces: item.loosePieces,
    confidence: item.confidence,
    note: item.note,
    saving: false,
  }));
}

export function findProduct(products: readonly Product[], code: string | null): Product | null {
  return products.find((product) => product.code === code) ?? null;
}

/** Pieces per bag, sack or carton: the row's own value wins, otherwise the one recorded for the product. */
export function packSizeFor(quantities: Quantities, product: Product | null): number | null {
  return quantities.packSize ?? product?.packSize ?? null;
}

export function totalPieces(quantities: Quantities, product: Product | null): number {
  return quantities.fullCartons * (packSizeFor(quantities, product) ?? 0) + quantities.loosePieces;
}

/** Everything that would make the server refuse this row, in words the counter can act on. */
export function rowProblems(row: CountRow, products: readonly Product[], unit: Container): string[] {
  const product = findProduct(products, row.productCode);
  const problems = row.productCode === null ? detailProblems(row.newProduct) : [];
  if (row.productCode !== null && !product) problems.push('This product is no longer in the Sheet. Choose it again.');
  if (row.fullCartons > 0 && !packSizeFor(row, product)) problems.push(`Enter the pieces per ${unit.one}.`);
  return problems;
}

/**
 * Whether a row Claude just returned can go to the Sheet without a person. It cannot when only a
 * person knows the missing fact: how many pieces are in a closed bag or sack, or what a product is.
 * A product code is trusted here even if this phone's product list is a moment out of date,
 * because the server chose it and checks it again on save.
 */
export function canSaveUnattended(row: CountRow, products: readonly Product[]): boolean {
  const knowsPackSize = row.fullCartons === 0 || packSizeFor(row, findProduct(products, row.productCode)) !== null;
  const knowsProduct = row.productCode !== null || detailProblems(row.newProduct).length === 0;
  return knowsPackSize && knowsProduct;
}

export function savedCount(row: CountRow, products: readonly Product[], waitingForSignal: boolean): SavedCount {
  const product = findProduct(products, row.productCode);
  return {
    id: row.id,
    name: product?.name ?? (row.newProduct.name.trim() || row.productCode || 'Product'),
    pieces: totalPieces(row, product),
    location: row.location,
    confidence: row.confidence,
    waitingForSignal,
  };
}

/** How many photos this entry sends to Claude: the count photo plus its detail photos. */
export function photoCount(photo: Photo): number {
  return 1 + photo.details.length;
}

/**
 * The details of a listed product that saving this row will fill in: those read from the photos
 * that the Sheet does not have yet. The server applies the same rule, and it is the one that
 * decides. A Low-confidence row fills nothing, because Claude may have the wrong product.
 */
export function detailsToFill(row: CountRow, product: Product | null): DetailKey[] {
  if (!product || row.confidence === 'Low' || readDetails(row) === null) return [];
  return DETAIL_KEYS.filter((key) => key !== 'name' && product[key] === '' && row.newProduct[key].trim() !== '');
}

/** What was read from the photos, when there is anything the server would accept. */
function readDetails(row: CountRow): ProductDetails | null {
  const details = trimDetails(row.newProduct);
  const hasAny = DETAIL_KEYS.some((key) => key !== 'name' && details[key] !== '');
  // The name is not checked: a listed product keeps its own.
  return hasAny && detailProblems({ ...details, name: 'listed' }).length === 0 ? details : null;
}

export function toCountRowInput(row: CountRow): CountRowInput {
  const isNew = row.productCode === null;
  return {
    productCode: row.productCode,
    newProduct: isNew ? trimDetails(row.newProduct) : null,
    details: isNew ? null : readDetails(row),
    fullCartons: row.fullCartons,
    packSize: row.packSize,
    loosePieces: row.loosePieces,
    confidence: row.confidence,
    note: row.note.trim(),
  };
}

/** How many rows name the same listed product at the same place: more than one means their totals add up. */
export function rowsPerProduct(rows: readonly CountRow[]): (row: CountRow) => number {
  const key = (row: CountRow) => JSON.stringify([row.productCode, row.location]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.productCode !== null) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  }
  return (row) => (row.productCode === null ? 1 : counts.get(key(row)) ?? 1);
}

export function groupByLocation(rows: readonly CountRow[]): Map<string, CountRow[]> {
  const groups = new Map<string, CountRow[]>();
  for (const row of rows) groups.set(row.location, [...(groups.get(row.location) ?? []), row]);
  return groups;
}
