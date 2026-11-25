import type { Currency, PriceInput } from '../api/contract';

/** What a person types for a price, before it is checked: the amount as text and a currency code. */
export type PriceDraft = { amount: string; currency: string };

/** GHS when the Sheet lists it, else the first currency listed. */
export function defaultCurrency(currencies: readonly Currency[]): string {
  return currencies.find((currency) => currency.code === 'GHS')?.code ?? currencies[0]?.code ?? '';
}

export function priceDraft(price: number | null, currency: string, currencies: readonly Currency[]): PriceDraft {
  const known = currencies.find((candidate) => candidate.code === currency);
  return {
    amount: price === null ? '' : price.toFixed(known?.decimals ?? 2),
    currency: known ? known.code : defaultCurrency(currencies),
  };
}

/**
 * The price a draft stands for, or what is wrong with it. An empty amount means no price. Commas
 * are taken as thousands separators, as cedi prices are usually written.
 */
export function readPrice(draft: PriceDraft, currencies: readonly Currency[]): { ok: true; value: PriceInput } | { ok: false; error: string } {
  const text = draft.amount.replace(/,/g, '').trim();
  if (text === '') return { ok: true, value: { price: null, currency: '' } };
  const currency = currencies.find((candidate) => candidate.code === draft.currency);
  if (!currency) return { ok: false, error: 'Choose the currency.' };
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(text)) return { ok: false, error: 'Write the price as a number, for example 25.50.' };
  const decimals = text.split('.')[1]?.length ?? 0;
  if (decimals > currency.decimals) {
    return { ok: false, error: currency.decimals === 0 ? `A price in ${currency.code} has no decimals.` : `A price in ${currency.code} has at most ${currency.decimals} decimals.` };
  }
  const amount = Number(text);
  if (amount > 1_000_000_000) return { ok: false, error: 'That price is too large.' };
  return { ok: true, value: { price: amount, currency: currency.code } };
}

/** A price as a till or a label shows it: "GH₵ 25.50". */
export function formatPrice(price: number | null, currencyCode: string, currencies: readonly Currency[]): string {
  if (price === null) return '';
  const currency = currencies.find((candidate) => candidate.code === currencyCode);
  const decimals = currency?.decimals ?? 2;
  const amount = price.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${currency?.shortName || currencyCode} ${amount}`.trim();
}
