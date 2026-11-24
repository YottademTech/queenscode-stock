import { describe, expect, it } from 'vitest';
import { containerAt, countingHint } from './containers';

describe('how stock is kept at a place', () => {
  it('reads the container from the place name the owner set in the Sheet', () => {
    expect(containerAt('Warehouse sacks')).toEqual({ one: 'sack', many: 'sacks' });
    expect(containerAt('Warehouse bags')).toEqual({ one: 'bag', many: 'bags' });
    expect(containerAt('WAREHOUSE BOXES')).toEqual({ one: 'box', many: 'boxes' });
    expect(containerAt('Back room cartons')).toEqual({ one: 'carton', many: 'cartons' });
  });

  it('treats any other place as single pieces', () => {
    expect(containerAt('Shop shelf')).toBeNull();
    expect(containerAt('Display counter')).toBeNull();
  });

  it('tells the counter what to count there', () => {
    // A shelf needs no instructions: it is single pieces.
    expect(countingHint('Shop shelf')).toBe('');
    expect(countingHint('Warehouse sacks')).toBe('Count the full sacks, enter the pieces per sack, then add any loose pieces.');
  });
});
