import { DETAIL_KEYS, type DetailKey, type ProductDetails } from '../api/contract';

export function emptyDetails(): ProductDetails {
  return Object.fromEntries(DETAIL_KEYS.map((key) => [key, ''])) as ProductDetails;
}

/** The detail fields of a larger object, such as a product or one item of Claude's answer. */
export function pickDetails(source: ProductDetails): ProductDetails {
  return Object.fromEntries(DETAIL_KEYS.map((key) => [key, source[key]])) as ProductDetails;
}

export function trimDetails(details: ProductDetails): ProductDetails {
  return Object.fromEntries(DETAIL_KEYS.map((key) => [key, details[key].trim()])) as ProductDetails;
}

export function filledCount(details: ProductDetails, keys: readonly DetailKey[]): number {
  return keys.filter((key) => details[key].trim() !== '').length;
}

/** The same limit the server applies to what a QR code holds. */
const QR_CODE_MAX = 2000;

const DAY_OR_MONTH = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

export type DetailErrors = Partial<Record<DetailKey, string>>;

/** What the server would refuse, by the field it is about, in words the person filling the form can act on. */
export function detailErrors(details: ProductDetails): DetailErrors {
  const errors: DetailErrors = {};
  if (details.name.trim() === '') errors.name = 'Enter the product name.';
  if (!/^\d*$/.test(details.barcode.trim())) errors.barcode = 'The barcode must be digits only.';
  if (details.qrCode.trim().length > QR_CODE_MAX) errors.qrCode = `The QR code text is too long (max ${QR_CODE_MAX} characters).`;
  if (details.expiry.trim() !== '' && !DAY_OR_MONTH.test(details.expiry.trim())) errors.expiry = 'Write the expiry as YYYY-MM-DD or YYYY-MM.';
  if (details.manufactureDate.trim() !== '' && !DAY_OR_MONTH.test(details.manufactureDate.trim())) {
    errors.manufactureDate = 'Write the manufacture date as YYYY-MM-DD or YYYY-MM.';
  }
  return errors;
}

/** The same checks as one list, for a summary. */
export function detailProblems(details: ProductDetails): string[] {
  return Object.values(detailErrors(details)).filter((error): error is string => !!error);
}

type DetailField = { key: DetailKey; label: string; placeholder?: string; numeric?: boolean };

/** Shown straight away: the details needed to tell products apart and to watch expiry. */
export const MAIN_FIELDS: readonly DetailField[] = [
  { key: 'size', label: 'Size', placeholder: '500ml' },
  { key: 'category', label: 'Category', placeholder: 'Body lotion' },
  { key: 'barcode', label: 'Barcode', numeric: true },
  { key: 'expiry', label: 'Expiry', placeholder: 'YYYY-MM-DD' },
];

/** Everything else Claude reads off the pack. Kept one tap away so the form stays short. */
export const MORE_SHORT_FIELDS: readonly DetailField[] = [
  { key: 'brand', label: 'Brand' },
  { key: 'variant', label: 'Variant' },
  { key: 'batchNumber', label: 'Batch number' },
  { key: 'manufactureDate', label: 'Made on', placeholder: 'YYYY-MM-DD' },
  { key: 'countryOfOrigin', label: 'Country of origin' },
  { key: 'manufacturer', label: 'Manufacturer' },
];

export const MORE_LONG_FIELDS: readonly (DetailField & { rows: number; hint?: string })[] = [
  { key: 'description', label: 'Description', rows: 2 },
  { key: 'ingredients', label: 'Ingredients', rows: 3 },
  { key: 'directions', label: 'Directions', rows: 2 },
  { key: 'otherDetails', label: 'Other details', rows: 3, hint: 'One per line, for example "Claim: Alcohol free".' },
  { key: 'labelText', label: 'All text on the pack', rows: 4 },
];

/** How each detail is named on screen. */
export const DETAIL_LABELS: Record<DetailKey, string> = {
  ...(Object.fromEntries([...MAIN_FIELDS, ...MORE_SHORT_FIELDS, ...MORE_LONG_FIELDS].map((field) => [field.key, field.label])) as Record<DetailKey, string>),
  name: 'Name',
  qrCode: 'QR code',
};

export const MORE_KEYS: readonly DetailKey[] = [...MORE_SHORT_FIELDS, ...MORE_LONG_FIELDS].map((field) => field.key);
