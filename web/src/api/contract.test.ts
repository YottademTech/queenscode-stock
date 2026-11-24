import { describe, expect, it } from 'vitest';
import { DETAIL_KEYS, bootstrapSchema, productSchema, saveCountsInputSchema } from './contract';

const product = (details: Record<string, string>) => ({ ...details, code: 'QBH-1', packSize: null, reorderLevel: null, imageUrl: '' });
const allDetails = Object.fromEntries(DETAIL_KEYS.map((key) => [key, key === 'name' ? 'QBH Carrot Oil' : '']));

describe('productSchema', () => {
  it('keeps what a QR code holds', () => {
    expect(productSchema.parse(product({ ...allDetails, qrCode: 'https://qbh.example/p/1' })).qrCode).toBe('https://qbh.example/p/1');
  });

  it('accepts a product from an Apps Script that predates the QR code field', () => {
    const { qrCode: _left_out, ...older } = allDetails;
    expect(productSchema.parse(product(older)).qrCode).toBe('');
  });

  it('still refuses a product that lacks any other detail', () => {
    const { barcode: _left_out, ...broken } = allDetails;
    expect(productSchema.safeParse(product(broken)).success).toBe(false);
  });
});

describe('photo sets', () => {
  const bootstrap = { countDate: '2026-11-24', today: '2026-11-24', locations: ['Shop shelf'], adjustmentTypes: { correct: 'a', add: 'b', remove: 'c' }, products: [], counted: [] };

  it('reads how many photos one count request may hold, and assumes one for an older Apps Script', () => {
    expect(bootstrapSchema.parse({ ...bootstrap, photoSetLimit: 4 }).photoSetLimit).toBe(4);
    expect(bootstrapSchema.parse(bootstrap).photoSetLimit).toBe(1);
  });

  it('still accepts a save kept on the phone from before rows carried read details', () => {
    const older = { requestId: 'r-1', location: 'Shop shelf', counter: 'Ama', rows: [{ productCode: 'QBH-1', newProduct: null, fullCartons: 0, packSize: null, loosePieces: 3, confidence: 'High', note: '' }] };
    expect(saveCountsInputSchema.parse(older).rows[0]?.details).toBeNull();
  });
});
