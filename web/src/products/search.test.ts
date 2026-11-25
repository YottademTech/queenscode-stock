import { describe, expect, it } from 'vitest';
import type { Product } from '../api/contract';
import { emptyDetails } from './details';
import { matchesSearch } from './search';

const product = (overrides: Partial<Product> = {}): Product => ({
  ...emptyDetails(),
  code: 'LGCFF', name: 'Lovillea Gelly Cologne Fruity Floral', size: '100 ml', barcode: '4902806012538', brand: 'Mandom', category: 'Body cologne',
  packSize: null, reorderLevel: null, imageUrl: '', imageUrls: [],
  ...overrides,
});

describe('product search', () => {
  it('matches every typed word anywhere in the name, size, code, barcode, brand or category, in any case', () => {
    expect(matchesSearch(product(), '')).toBe(true);
    expect(matchesSearch(product(), 'lovillea')).toBe(true);
    expect(matchesSearch(product(), 'FRUITY  cologne')).toBe(true);
    expect(matchesSearch(product(), '100 ml')).toBe(true);
    expect(matchesSearch(product(), '4902806')).toBe(true);
    expect(matchesSearch(product(), 'mandom')).toBe(true);
    expect(matchesSearch(product(), 'lgcff')).toBe(true);
  });

  it('leaves out a product missing any of the words', () => {
    expect(matchesSearch(product(), 'lovillea musk')).toBe(false);
    expect(matchesSearch(product(), 'cussons')).toBe(false);
  });
});
