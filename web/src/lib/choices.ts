/** An on/off choice the counter made earlier on this phone. */
export function rememberedChoice(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === 'on';
  } catch {
    return fallback;
  }
}

export function rememberChoice(key: string, enabled: boolean) {
  try {
    window.localStorage.setItem(key, enabled ? 'on' : 'off');
  } catch {
    // The choice still holds until the app is closed.
  }
}
