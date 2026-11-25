import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { rememberChoice, rememberedChoice } from '../lib/choices';
import { COUNT_PHOTO_EDGE, captureFrame, type PreparedPhoto } from '../lib/image';
import { playCounted, playSnap } from '../lib/sounds';
import { Icon } from '../shared/Icon';
import { FRAME_SIDE, createSteadyWatcher, toGrey, type Watch } from './autoSnap';

const AUTO_SNAP_KEY = 'stock.autosnap';
/** How often the picture is checked for steadiness, in milliseconds. */
const LOOK_EVERY_MS = 160;

/** The count of the open set's stock photo, shown in the camera once it arrives. */
export type CameraCount =
  | { kind: 'counting' }
  /** `headline` is the number to read at a glance ("7 pieces"); `label` says what was counted. */
  | { kind: 'done'; headline: string; label: string; nothing: boolean }
  | { kind: 'failed' };

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
  sets?: {
    on: boolean; onChange: (on: boolean) => void; taken: number; limit: number; onNext: () => void;
    /** The count of the stock photo just taken, or null when there is none to show. */
    count: CameraCount | null;
    /** Throws away the open set's photos, to take the stock photo again. */
    onRetake: () => void;
  };
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
 *
 * In "Stock, front, back" the stock photo can take itself: with Auto on, the camera watches the
 * picture and takes the photo once it has been steady for a moment, with a beep. The count then
 * shows here, with a second sound, while the counter takes the front and back by hand.
 */
export function CameraSheet({ location, progress, sets, onShot, onClose }: CameraSheetProps) {
  const set = sets?.on ? sets : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const [camera, setCamera] = useState<CameraState>({ kind: 'starting' });
  const [shots, setShots] = useState(0);
  const [flash, setFlash] = useState(false);
  const [autoOn, setAutoOn] = useState(() => rememberedChoice(AUTO_SNAP_KEY, true));
  const [watch, setWatch] = useState<Watch | null>(null);
  const watcher = useRef<ReturnType<typeof createSteadyWatcher> | null>(null);

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
        watcher.current = createSteadyWatcher(performance.now());
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
    // This view now has its photo, however it was taken: it is not taken again by itself.
    watcher.current?.hold();
    playSnap();
    setShots((count) => count + 1);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
  };

  // Auto only ever takes the stock photo, the first of a set. Detail photos are close-ups the
  // counter frames by hand, and in "One by one" a photo taken twice would be counted twice.
  const awaitingStockPhoto = set !== undefined && set.taken === 0;
  const watching = camera.kind === 'live' && set !== undefined && autoOn;
  const takeShot = useRef(handleShutter);
  takeShot.current = handleShutter;
  const mayAutoSnap = useRef(awaitingStockPhoto);
  mayAutoSnap.current = awaitingStockPhoto;

  // Looks at the picture a few times a second. It keeps looking while detail photos are taken, so
  // that after "Next" it knows what the phone was pointing at and waits for it to move on.
  useEffect(() => {
    if (!watching) {
      setWatch(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_SIDE;
    canvas.height = FRAME_SIDE;
    const drawing = canvas.getContext('2d', { willReadFrequently: true });
    if (!drawing) return;

    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || !watcher.current) return;
      drawing.drawImage(video, 0, 0, FRAME_SIDE, FRAME_SIDE);
      const look = watcher.current.look(toGrey(drawing.getImageData(0, 0, FRAME_SIDE, FRAME_SIDE).data), performance.now());
      if (!mayAutoSnap.current) return;
      if (look.snap) takeShot.current();
      // Only a visible change redraws the screen: the ring moves in eighths.
      const step = (next: Watch) => (next.kind === 'steadying' ? `steadying ${Math.round(next.progress * 8)}` : next.kind);
      setWatch((current) => (current && step(current) === step(look.watch) ? current : look.watch));
    }, LOOK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [watching]);

  // Back to waiting for a stock photo (after Next or Retake): whatever the phone points at now is
  // not it, so wait for the phone to move on.
  useEffect(() => {
    if (awaitingStockPhoto) watcher.current?.hold();
    setWatch(null);
  }, [awaitingStockPhoto]);

  // The second sound: the count of the stock photo has arrived.
  const count = set?.count ?? null;
  const countArrived = count?.kind === 'done' ? count.headline : null;
  useEffect(() => {
    if (countArrived !== null) playCounted();
  }, [countArrived]);

  const handleAutoChange = () => {
    setAutoOn((current) => {
      rememberChoice(AUTO_SNAP_KEY, !current);
      return !current;
    });
  };

  const setIsFull = set !== undefined && set.taken >= set.limit;
  const guidance = !set
    ? shots > 0 ? `${shots} taken. ${progress}`
      : sets ? 'Every photo is counted on its own. Keep going: counting happens in the background.'
        : 'Tap to take a photo. Keep going: counting happens in the background.'
    : set.taken === 0
      ? !autoOn ? 'Photo 1: the stock to count.'
        : watch?.kind === 'same-view' ? 'Move to the next product. Its photo is taken once the picture is steady.'
          : watch?.kind === 'dark' ? 'Too dark to see the stock. Add light, or tap the button.'
            : 'Hold the phone steady over the stock. The photo is taken for you.'
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
        {set && count && set.taken > 0 && (
          <p className={`camera-count ${count.kind}`} role="status" aria-live="polite">
            {count.kind === 'counting' && 'Counting…'}
            {count.kind === 'failed' && 'Not counted yet. It is counted when you tap Next.'}
            {count.kind === 'done' && (count.nothing ? 'Nothing to count was seen. Tap Retake to try again.' : (
              <>
                <strong>{count.headline}</strong>
                {count.label && <small>{count.label}</small>}
              </>
            ))}
          </p>
        )}
        {set && <p className="camera-status">{progress}</p>}
        <div className="camera-controls">
          {set && set.taken === 0 && (
            <button type="button" className="camera-side camera-auto" aria-pressed={autoOn} title="Take the stock photo by itself once the picture is steady" onClick={handleAutoChange}>
              Auto {autoOn ? 'on' : 'off'}
            </button>
          )}
          {set && set.taken > 0 && (
            <button type="button" className="camera-side" onClick={set.onRetake}>
              <Icon name="refresh" size={18} />
              Retake
            </button>
          )}
          {/* The ring fills while the picture stays steady; when it closes, the photo is taken. */}
          <span className="camera-shutter-ring" style={{ '--steady': awaitingStockPhoto && watch?.kind === 'steadying' ? watch.progress : 0 } as CSSProperties}>
            <button
              ref={shutterRef}
              type="button"
              className="camera-shutter"
              disabled={camera.kind !== 'live' || setIsFull}
              aria-label={!set ? 'Take photo' : set.taken === 0 ? 'Take the count photo' : 'Take a detail photo'}
              onClick={handleShutter}
            />
          </span>
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
