// Counting from a video: the counter moves the phone around the stock, and this keeps the moments
// worth counting from. Claude reads pictures, not video, so what is sent is a handful of views:
// each from a different angle, each the stillest look the phone had at that angle.
//
// Like autoSnap.ts it works on small grey copies of the picture and holds no camera or screen
// code, so it can be tested with made-up frames.
import type { EncodedImage } from '../api/contract';
import { VIDEO_VIEW_EDGE, type PreparedPhoto } from '../lib/image';
import { DARK_BELOW, SHARP_ABOVE, brightness, difference, sharpness, type Grey } from './autoSnap';

/** The longest a video runs before it stops by itself. */
export const VIDEO_MAX_MS = 15_000;
/** How often the picture is looked at while the video runs, in milliseconds. */
export const VIDEO_LOOK_EVERY_MS = 120;
/**
 * The most image data the views may hold together, in base64 characters. It leaves room for three
 * detail photos in the same request on every backend, and keeps the upload a size a weak signal can send.
 */
export const VIDEO_DATA_BUDGET = 3_000_000;

/** Room kept in a request for the three detail photos that follow a video. */
const DETAIL_PHOTOS_ROOM = 2_100_000;
/** A video is still worth sending with this much room, even if little else fits. */
const SMALLEST_BUDGET = 600_000;
/** The long edge of a view where the backend takes little: smaller pictures, so more of them fit. */
const SMALL_VIEW_EDGE = 1024;

/**
 * How large a video's views may be for this backend. `requestLimit` is what one request may carry,
 * as the backend says when the app opens; an older backend does not say, and takes the usual sizes.
 */
export function viewSizes(requestLimit: number | undefined): { budget: number; edge: number } {
  const room = (requestLimit ?? Infinity) - DETAIL_PHOTOS_ROOM;
  if (room >= VIDEO_DATA_BUDGET) return { budget: VIDEO_DATA_BUDGET, edge: VIDEO_VIEW_EDGE };
  return { budget: Math.max(SMALLEST_BUDGET, room), edge: SMALL_VIEW_EDGE };
}

/**
 * The views that can go in one request together with the detail photos. When everything does not
 * fit, views are left out, evenly across the video, and the first always stays: the count is then
 * made from fewer angles, which is better than a request the backend refuses.
 */
export function viewsThatFit(views: readonly EncodedImage[], details: readonly EncodedImage[], requestLimit: number | undefined): EncodedImage[] {
  const size = (images: readonly EncodedImage[]) => images.reduce((sum, image) => sum + image.data.length, 0);
  const room = (requestLimit ?? Infinity) - size(details);
  for (let keep = views.length; keep > 1; keep--) {
    const chosen = Array.from({ length: keep }, (_, index) => views[Math.round((index * (views.length - 1)) / (keep - 1))] as EncodedImage);
    if (size(chosen) <= room) return chosen;
  }
  return views.slice(0, 1);
}

// On the 0 to 255 scale of a grey pixel. Chosen on simulated footage, not measured on phones, so
// they are kept together here to be tuned.
/** A look this different from the last view kept shows the stock from a new angle. */
const NEW_VIEW_ABOVE = 12;
/** For stock so even that the picture hardly changes: a slightly different look is a new view after this long. */
const NEW_VIEW_AFTER_MS = 1500;
const SLIGHTLY_DIFFERENT = NEW_VIEW_ABOVE / 3;
/** A later look at the same angle replaces the view when the phone was moving this much less. */
const STILLER_BY = 0.75;
/** Two looks this alike mean the phone is, for this moment, being held still. */
const STILL_BELOW = 6;
/** A new angle is not kept while the phone is still moving, unless it has kept moving for this long. */
const WAIT_FOR_STILL_MS = 500;

type KeptView = {
  photo: PreparedPhoto;
  grey: Uint8Array;
  /** How far the picture had moved since the look before: the less, the less blurred the view. */
  motion: number;
  at: number;
};

/**
 * Give it each look at the camera with offer(); it keeps at most `limit` views. `capture` takes
 * the full-size picture and is only called for a look that is kept.
 */
export function createViewPicker(limit: number) {
  let kept: KeptView[] = [];
  let previous: Uint8Array | null = null;
  /** When the phone reached an angle not kept yet, while still moving. */
  let movingSince: number | null = null;

  /** Of the two neighbouring views that look most alike, the shakier one goes: it adds the least. */
  const dropMostAlike = () => {
    let pair = 0;
    let least = Infinity;
    for (let i = 0; i + 1 < kept.length; i++) {
      const alike = difference((kept[i] as KeptView).grey, (kept[i + 1] as KeptView).grey);
      if (alike < least) {
        least = alike;
        pair = i;
      }
    }
    const drop = (kept[pair] as KeptView).motion > (kept[pair + 1] as KeptView).motion ? pair : pair + 1;
    kept = kept.filter((_, index) => index !== drop);
  };

  return {
    offer(grey: Grey, now: number, capture: () => PreparedPhoto): void {
      // The very first look has nothing before it, so how still it was is not known.
      const motion = previous ? difference(previous, grey) : Infinity;
      const look = Uint8Array.from(grey);
      previous = look;
      // A dark picture, a covered lens or a blank wall shows no stock.
      if (brightness(grey) < DARK_BELOW || sharpness(grey) < SHARP_ABOVE) return;

      const last = kept.at(-1);
      const changed = last ? difference(last.grey, grey) : Infinity;
      const newAngle = !last || changed >= NEW_VIEW_ABOVE || (now - last.at >= NEW_VIEW_AFTER_MS && changed >= SLIGHTLY_DIFFERENT);
      // The wait for a pause starts over only when the phone is back at an angle already kept.
      if (!newAngle) movingSince = null;
      if (newAngle) {
        // A picture taken while the phone moves is smeared, and taking one costs the phone time. So
        // a new angle waits a moment for the hand to pause, and is kept anyway if it does not.
        movingSince ??= now;
        if (motion >= STILL_BELOW && now - movingSince < WAIT_FOR_STILL_MS) return;
        movingSince = null;
        kept.push({ photo: capture(), grey: look, motion, at: now });
        if (kept.length > limit) dropMostAlike();
      } else if (motion < last.motion * STILLER_BY) {
        // The same angle, held more still: this look is sharper than the one kept.
        kept[kept.length - 1] = { photo: capture(), grey: look, motion, at: last.at };
      }
    },

    count: (): number => kept.length,

    /** The views in the order they were taken, thinned until they fit `maxChars` of image data. */
    views(maxChars: number): PreparedPhoto[] {
      const size = () => kept.reduce((sum, view) => sum + view.photo.image.data.length, 0);
      while (kept.length > 1 && size() > maxChars) dropMostAlike();
      return kept.map((view) => view.photo);
    },
  };
}
