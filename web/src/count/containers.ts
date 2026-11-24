/** What stock is packed in at a place, for example sacks. */
export type Container = { one: string; many: string };

const KNOWN_CONTAINERS: readonly (readonly [RegExp, Container])[] = [
  [/sack/i, { one: 'sack', many: 'sacks' }],
  [/bag/i, { one: 'bag', many: 'bags' }],
  [/carton/i, { one: 'carton', many: 'cartons' }],
  [/box/i, { one: 'box', many: 'boxes' }],
];

/** Used when a row has packs but the place does not say what kind. */
export const ANY_PACK: Container = { one: 'pack', many: 'packs' };

/**
 * Places are named in the Sheet's Settings tab, for example "Shop shelf", "Warehouse bags" and
 * "Warehouse sacks". The name says how stock is kept there: a place named after a container is
 * counted in full containers plus loose pieces, and any other place (a shelf) in single pieces.
 */
export function containerAt(location: string): Container | null {
  return KNOWN_CONTAINERS.find(([pattern]) => pattern.test(location))?.[1] ?? null;
}

export function countingHint(location: string): string {
  const container = containerAt(location);
  return container
    ? `Count the full ${container.many}, enter the pieces per ${container.one}, then add any loose pieces.`
    : '';
}
