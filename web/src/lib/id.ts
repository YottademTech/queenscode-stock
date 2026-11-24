/** A random ID. Uses getRandomValues because randomUUID is missing on plain-http test addresses. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Gives an identical retry the same request ID, so the server recognises a resend and does not
 * save it twice. Call reset() once the saves are done so later saves are new even if they look the same.
 */
export function createRequestIds() {
  const ids = new Map<string, string>();
  return {
    for(payload: unknown): string {
      const fingerprint = JSON.stringify(payload);
      const id = ids.get(fingerprint) ?? newId();
      ids.set(fingerprint, id);
      return id;
    },
    reset(): void {
      ids.clear();
    },
  };
}
