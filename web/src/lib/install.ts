import { useEffect, useState } from 'react';

// Installing the app on a phone's home screen. Android's browsers offer it themselves and let the
// page ask at a moment of its choosing; an iPhone only does it through Share > Add to Home Screen.

/** Chrome's install prompt, which it hands to the page instead of showing it at once. */
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** Keeps the app's files on the phone, so it opens fast and opens without a signal. */
export function registerServiceWorker(): void {
  // Not while developing: a kept copy would hide the changes being made.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app works the same without it, only slower to open and not offline.
    });
  });
}

let saved: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Listened for from the start, because the browser offers the prompt only once, early.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    saved = event as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    saved = null;
    notify();
  });
}

const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export type InstallOffer =
  /** The browser can install it: a button asks. */
  | { kind: 'prompt'; install: () => Promise<void> }
  /** An iPhone or iPad, where only the Share menu installs it. */
  | { kind: 'ios' }
  /** Already installed, or this browser cannot install it. */
  | { kind: 'none' };

export function useInstallOffer(): InstallOffer {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  if (isInstalled()) return { kind: 'none' };
  if (saved) {
    const prompt = saved;
    return {
      kind: 'prompt',
      install: async () => {
        await prompt.prompt();
        await prompt.userChoice;
        // The prompt can be used once; the browser offers it again later if it was declined.
        saved = null;
        notify();
      },
    };
  }
  return isIPhone() ? { kind: 'ios' } : { kind: 'none' };
}
