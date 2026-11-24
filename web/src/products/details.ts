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

const DAY_OR_MONTH = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

/** What the server would refuse, in words the person filling the form can act on. */
export function detailProblems(details: ProductDetails): string[] {
  const problems: string[] = [];
  if (details.name.trim() === '') problems.push('Enter the product name.');
  if (!/^\d*$/.test(details.barcode.trim())) problems.push('The barcode must be digits only.');
  if (details.expiry.trim() !== '' && !DAY_OR_MONTH.test(details.expiry.trim())) {
    problems.push('Write the expiry as YYYY-MM-DD or YYYY-MM.');
  }
  if (details.manufactureDate.trim() !== '' && !DAY_OR_MONTH.test(details.manufactureDate.trim())) {
    problems.push('Write the manufacture date as YYYY-MM-DD or YYYY-MM.');
  }
  return problems;
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

export const MORE_KEYS: readonly DetailKey[] = [...MORE_SHORT_FIELDS, ...MORE_LONG_FIELDS].map((field) => field.key);
