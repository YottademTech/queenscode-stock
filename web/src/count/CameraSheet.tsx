import { useEffect, useRef, useState } from 'react';
import { COUNT_PHOTO_EDGE, captureFrame, type PreparedPhoto } from '../lib/image';
import { Icon } from '../shared/Icon';

type CameraState = { kind: 'starting' } | { kind: 'live' } | { kind: 'failed'; message: string };

type CameraSheetProps = {
  /** Shown at the top so the counter knows which place the shots are filed under. */
  location: string;
  /** What is happening to the shots already taken, for example "2 being counted, 5 saved". */
  progress: string;
  /**
   * Given when the server can read photo sets. `on` is the counter's choice between every photo
   * counted on its own and sets (a product's stock, then its front and back), and can be changed
   * here, where the photos are taken. The rest describes the open set: how many photos it holds,
   * how many it can hold, and what to do when the counter moves to the next product.
   */
  sets?: { on: boolean; onChange: (on: boolean) => void; taken: number; limit: number; onNext: () => void };
  onShot: (photo: PreparedPhoto) => void;
  onClose: () => void;
};

/**
 * Asks the camera to keep refocusing as it moves, where the phone allows it. Close-ups of a back
 * label are otherwise often left out of focus, and a barcode's small digits are then unreadable.
 */
function keepRefocusing(stream: MediaStream) {
  const [track] = stream.getVideoTracks();
  const modes = (track?.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode ?? [];
  if (!track || !modes.includes('continuous')) return;
  // Not every phone takes it; the camera still works without.
  track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
}

/** Whether this browser lets a page open the camera. It needs https (or localhost). */
export const canUseCamera = typeof navigator !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

/**
 * A full-screen camera that stays open between shots: tap, move to the next shelf, tap again.
 * Each shot is handed straight to the caller, which counts it in the background.
 */
export function CameraSheet({ location, progress, sets, onShot, onClose }: CameraSheetProps) {
  const set = sets?.on ? sets : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const [camera, setCamera] = useState<CameraState>({ kind: 'starting' });
  const [shots, setShots] = useState(0);
  const [flash, setFlash] = useState(false);

  // Opens the back camera while the sheet is shown, and turns it off again when it closes.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let closed = false;

    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
      .then(async (opened) => {
        stream = opened;
        const video = videoRef.current;
        if (closed || !video) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = opened;
        await video.play();
        keepRefocusing(opened);
        setCamera({ kind: 'live' });
        shutterRef.current?.focus();
      })
      .catch(() => {
        if (!closed) setCamera({ kind: 'failed', message: 'The camera could not be opened. Allow camera access for this site, or close this and use Upload.' });
      });

    return () => {
      closed = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Lets a keyboard user leave the camera with Escape, as with any dialog.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video || camera.kind !== 'live') return;
    try {
      onShot(captureFrame(video, COUNT_PHOTO_EDGE));
    } catch {
      setCamera({ kind: 'failed', message: 'That shot could not be taken. Close the camera and try again.' });
      return;
    }
    setShots((count) => count + 1);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
  };

  const setIsFull = set !== undefined && set.taken >= set.limit;
  const guidance = !set
    ? shots > 0 ? `${shots} taken. ${progress}`
      : sets ? 'Every photo is counted on its own. Keep going: counting happens in the background.'
        : 'Tap to take a photo. Keep going: counting happens in the background.'
    : set.taken === 0
      ? 'Photo 1: the stock to count.'
      : setIsFull
        ? 'This set is full. Tap Next for the next product.'
        : `Now the front, back and barcode up close (${set.taken} of ${set.limit} taken). Tap Next when done.`;

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Camera">
      <video ref={videoRef} className="camera-view" playsInline muted />
      {flash && <div className="camera-flash" aria-hidden="true" />}

      <div className="camera-top">
        <button type="button" className="camera-close" onClick={onClose}>
          <Icon name="close" />
          Done
        </button>
        <p className="camera-place">{location}</p>
      </div>

      <div className="camera-bottom">
        {sets && (
          <fieldset className="camera-mode">
            <legend className="visually-hidden">How the photos are used</legend>
            <label>
              <input type="radio" name="camera-mode" className="visually-hidden" checked={!sets.on} onChange={() => sets.onChange(false)} />
              One by one
            </label>
            <label>
              <input type="radio" name="camera-mode" className="visually-hidden" checked={sets.on} onChange={() => sets.onChange(true)} />
              Stock, front, back
            </label>
          </fieldset>
        )}
        <p className="camera-progress" role="status" aria-live="polite">
          {camera.kind === 'starting' && 'Opening the camera…'}
          {camera.kind === 'failed' && camera.message}
          {camera.kind === 'live' && guidance}
        </p>
        {set && <p className="camera-status">{progress}</p>}
        <div className="camera-controls">
          <button
            ref={shutterRef}
            type="button"
            className="camera-shutter"
            disabled={camera.kind !== 'live' || setIsFull}
            aria-label={!set ? 'Take photo' : set.taken === 0 ? 'Take the count photo' : 'Take a detail photo'}
            onClick={handleShutter}
          />
          {set && (
            <button type="button" className="camera-next" disabled={set.taken === 0} onClick={set.onNext}>
              <Icon name="check" size={18} />
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
