import { describe, expect, it } from 'vitest';
import type { Currency } from '../api/contract';
import { defaultCurrency, formatPrice, priceDraft, readPrice } from './price';

const currencies: Currency[] = [
  { code: 'USD', name: 'US dollar', shortName: 'US$', decimals: 2 },
  { code: 'GHS', name: 'Ghana cedi', shortName: 'GH₵', decimals: 2 },
  { code: 'XOF', name: 'West African CFA franc', shortName: 'CFA', decimals: 0 },
];

describe('prices', () => {
  it('reads a typed price, and an empty one as no price', () => {
    expect(readPrice({ amount: '25.5', currency: 'GHS' }, currencies)).toEqual({ ok: true, value: { price: 25.5, currency: 'GHS' } });
    expect(readPrice({ amount: '1,250.00', currency: 'GHS' }, currencies)).toEqual({ ok: true, value: { price: 1250, currency: 'GHS' } });
    expect(readPrice({ amount: '  ', currency: 'GHS' }, currencies)).toEqual({ ok: true, value: { price: null, currency: '' } });
  });

  it('says what is wrong with a price that cannot be kept', () => {
    expect(readPrice({ amount: 'ten', currency: 'GHS' }, currencies)).toMatchObject({ ok: false, error: expect.stringMatching(/as a number/) });
    expect(readPrice({ amount: '-3', currency: 'GHS' }, currencies)).toMatchObject({ ok: false });
    expect(readPrice({ amount: '2.555', currency: 'GHS' }, currencies)).toMatchObject({ ok: false, error: 'A price in GHS has at most 2 decimals.' });
    expect(readPrice({ amount: '10.5', currency: 'XOF' }, currencies)).toMatchObject({ ok: false, error: 'A price in XOF has no decimals.' });
    expect(readPrice({ amount: '10', currency: 'ABC' }, currencies)).toMatchObject({ ok: false, error: 'Choose the currency.' });
  });

  it('starts on cedis, and shows a price with its short name', () => {
    expect(defaultCurrency(currencies)).toBe('GHS');
    expect(priceDraft(null, '', currencies)).toEqual({ amount: '', currency: 'GHS' });
    expect(priceDraft(1500, 'XOF', currencies)).toEqual({ amount: '1500', currency: 'XOF' });
    expect(formatPrice(1250.5, 'GHS', currencies)).toBe('GH₵ 1,250.50');
    expect(formatPrice(null, 'GHS', currencies)).toBe('');
  });
});
