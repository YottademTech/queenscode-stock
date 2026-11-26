import type { EncodedImage } from '../api/contract';

export type PreparedPhoto = { image: EncodedImage; previewUrl: string };

/** Long edge for count photos: large enough to tell bottles apart, small enough for a weak signal. */
export const COUNT_PHOTO_EDGE = 1600;
export const PRODUCT_PHOTO_EDGE = 1200;

/**
 * Shrinks a phone photo and re-encodes it as JPEG in the browser. Drawing through an <img>
 * also applies the camera's rotation, so Claude sees the photo the right way up.
 */
export async function preparePhoto(file: File, longEdge: number): Promise<PreparedPhoto> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const picture = new Image();
    picture.src = sourceUrl;
    await picture.decode();
    return toJpeg(picture, picture.naturalWidth, picture.naturalHeight, longEdge);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/**
 * Long edge and JPEG quality for the views kept from a video taken around the stock. Smaller than a
 * count photo: several are sent together, and the whole request has to stay a size a phone can send.
 */
export const VIDEO_VIEW_EDGE = 1280;
export const VIDEO_VIEW_QUALITY = 0.75;

/** Takes the frame the in-app camera is showing right now. */
export function captureFrame(video: HTMLVideoElement, longEdge: number, quality = PHOTO_QUALITY): PreparedPhoto {
  if (video.videoWidth === 0) throw new Error('The camera is not ready yet.');
  return toJpeg(video, video.videoWidth, video.videoHeight, longEdge, quality);
}

const PHOTO_QUALITY = 0.82;

function toJpeg(source: CanvasImageSource, width: number, height: number, longEdge: number, quality = PHOTO_QUALITY): PreparedPhoto {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('This browser cannot resize photos.');
  drawing.drawImage(source, 0, 0, canvas.width, canvas.height);

  const previewUrl = canvas.toDataURL('image/jpeg', quality);
  const data = previewUrl.slice(previewUrl.indexOf(',') + 1);
  if (data === '') throw new Error('The photo could not be converted.');
  return { image: { data, mediaType: 'image/jpeg' }, previewUrl };
}

/**
 * Turns the Drive link stored in the Sheet into a small image the app can show. The <img> that
 * uses it must set referrerPolicy="no-referrer": Google refuses the image (429) when the request
 * names the page it is embedded in.
 */
export function driveThumbnail(imageUrl: string, width: number): string | null {
  const fileId = /\/d\/([\w-]+)/.exec(imageUrl)?.[1] ?? /[?&]id=([\w-]+)/.exec(imageUrl)?.[1];
  return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}` : null;
}
