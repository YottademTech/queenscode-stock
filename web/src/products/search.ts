import type { Product } from '../api/contract';

/** Whether a product matches what was typed: every word must appear in its name, size, code, barcode, brand or category. */
export function matchesSearch(product: Product, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [product.name, product.size, product.code, product.barcode, product.brand, product.category].join(' ').toLowerCase();
  return words.every((word) => text.includes(word));
}

/** How a product is named in a list: its name, with the size when there is one. */
export function productLabel(product: Product): string {
  return product.size ? `${product.name} (${product.size})` : product.name;
}
