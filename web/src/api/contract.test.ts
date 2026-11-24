import { describe, expect, it } from 'vitest';
import { DETAIL_KEYS, productSchema } from './contract';

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
