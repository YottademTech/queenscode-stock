// Decides when the camera's picture is steady and sharp enough to take the count photo by itself.
// It works on small grey copies of the picture (FRAME_SIDE x FRAME_SIDE), a few times a second,
// and holds no camera or screen code, so it can be tested with made-up frames.

export const FRAME_SIDE = 64;

// Brightness and differences are on the 0 to 255 scale of a grey pixel. The limits were chosen on
// simulated footage, not measured on phones, so they are kept together here to be tuned.
/** Darker than this on average, the stock cannot be seen. */
const DARK_BELOW = 28;
/** Two looks this alike mean the phone is being held still. */
const STEADY_BELOW = 6;
/** Less edge than this means a blank wall, a covered lens or a blur. */
const SHARP_ABOVE = 2.5;
/** A look this different from the last photo means the phone has moved on to something else. */
const MOVED_ABOVE = 18;
/** How long the picture must stay steady before the photo is taken. */
const HOLD_MS = 800;
/** A pause after the camera opens, so the counter sees it before it acts. */
const ARMING_MS = 1000;

export type Watch =
  /** `progress` runs from 0 to 1 while the picture stays steady. */
  | { kind: 'steadying'; progress: number }
  | { kind: 'moving' }
  | { kind: 'dark' }
  /** A photo was just taken of this view: nothing happens until the phone moves on. */
  | { kind: 'same-view' };

export type Look = { snap: boolean; watch: Watch };

type Grey = Uint8Array | Uint8ClampedArray;

/** How different two looks are: the average change of a pixel. */
export function difference(a: Grey, b: Grey): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return total / a.length;
}

export function brightness(grey: Grey): number {
  let total = 0;
  for (let i = 0; i < grey.length; i++) total += grey[i] ?? 0;
  return total / grey.length;
}

/** How much edge the picture holds: the average step between neighbouring pixels. Blur lowers it. */
export function sharpness(grey: Grey, side = FRAME_SIDE): number {
  let total = 0;
  for (let y = 0; y < side - 1; y++) {
    for (let x = 0; x < side - 1; x++) {
      const here = grey[y * side + x] ?? 0;
      total += Math.abs(here - (grey[y * side + x + 1] ?? 0)) + Math.abs(here - (grey[(y + 1) * side + x] ?? 0));
    }
  }
  return total / ((side - 1) * (side - 1) * 2);
}

/** Turns the red, green, blue, alpha bytes of a canvas into one grey byte per pixel. */
export function toGrey(rgba: Uint8ClampedArray): Uint8Array {
  const grey = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = ((rgba[i * 4] ?? 0) * 3 + (rgba[i * 4 + 1] ?? 0) * 4 + (rgba[i * 4 + 2] ?? 0)) >> 3;
  }
  return grey;
}

/**
 * Watches the camera from the moment it opens (`startedAt`, in milliseconds). Give it each look
 * with look(); it answers snap once when the photo should be taken. After any photo of a view,
 * call hold() so the same view is not taken again.
 */
export function createSteadyWatcher(startedAt: number) {
  let previous: Uint8Array | null = null;
  let lastPhotoView: Uint8Array | null = null;
  let steadySince: number | null = null;
  let recentSharpness: number[] = [];

  const forgetSteadiness = () => {
    steadySince = null;
    recentSharpness = [];
  };

  return {
    look(grey: Grey, now: number): Look {
      const motion = previous ? difference(previous, grey) : Infinity;
      previous = Uint8Array.from(grey);

      if (brightness(grey) < DARK_BELOW) {
        forgetSteadiness();
        return { snap: false, watch: { kind: 'dark' } };
      }
      if (lastPhotoView) {
        if (difference(lastPhotoView, grey) < MOVED_ABOVE) return { snap: false, watch: { kind: 'same-view' } };
        lastPhotoView = null;
        forgetSteadiness();
      }

      const sharp = sharpness(grey);
      if (motion >= STEADY_BELOW || sharp < SHARP_ABOVE) {
        forgetSteadiness();
        return { snap: false, watch: { kind: 'moving' } };
      }

      steadySince ??= now;
      recentSharpness = [...recentSharpness, sharp].slice(-5);
      // While the camera is still focusing, each look is sharper than the last: wait for that to stop.
      const focused = sharp >= 0.85 * Math.max(...recentSharpness);
      const progress = Math.min(1, (now - steadySince) / HOLD_MS);
      if (progress >= 1 && focused && now - startedAt >= ARMING_MS) {
        lastPhotoView = previous;
        forgetSteadiness();
        return { snap: true, watch: { kind: 'same-view' } };
      }
      return { snap: false, watch: { kind: 'steadying', progress } };
    },

    /** A photo of the current view exists (or was discarded): wait for the phone to move on. */
    hold() {
      lastPhotoView = previous;
      forgetSteadiness();
    },
  };
}
