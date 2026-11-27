import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { rememberChoice, rememberedChoice } from '../lib/choices';
import { COUNT_PHOTO_EDGE, VIDEO_VIEW_QUALITY, captureFrame, type PreparedPhoto } from '../lib/image';
import { playCounted, playSnap } from '../lib/sounds';
import { Icon } from '../shared/Icon';
import { FRAME_SIDE, createSteadyWatcher, toGrey, type Watch } from './autoSnap';
import { VIDEO_LOOK_EVERY_MS, VIDEO_MAX_MS, createViewPicker, viewSizes } from './videoViews';

const AUTO_SNAP_KEY = 'stock.autosnap';
/** How often the picture is checked for steadiness, in milliseconds. */
const LOOK_EVERY_MS = 160;
/** How long the button ignores taps after a video ends. */
const VIDEO_END_GRACE_MS = 700;
/** The close-ups asked for after the video of the stock, one by one, in this order. */
const VIDEO_DETAIL_SHOTS = ['the front', 'the back', 'the barcode'] as const;

/** The count of the open set's stock photo, shown in the camera once it arrives. */
export type CameraCount =
  | { kind: 'counting' }
  /** `headline` is the number to read at a glance ("7 pieces"); `label` says what was counted. */
  | { kind: 'done'; headline: string; label: string; nothing: boolean }
  | { kind: 'failed' };

type CameraState = { kind: 'starting' } | { kind: 'live' } | { kind: 'failed'; message: string };

/**
 * How the photos taken here are used. `single`: every photo is counted on its own. `set`: a
 * product's stock in one photo, then its front and back. `video`: the stock in a video taken
 * around it, then its front and back.
 */
export type CaptureMode = 'single' | 'set' | 'video';

/** A video being taken: how long it has run, in whole seconds, and how many views are kept so far. */
type Recording = { seconds: number; views: number };

type CameraSheetProps = {
  /** Shown at the top so the counter knows which place the shots are filed under. */
  location: string;
  /** What is happening to the shots already taken, for example "2 being counted, 5 saved". */
  progress: string;
  /**
   * Given when the server can read photo sets. `mode` is the counter's choice of how the photos
   * are used, and can be changed here, where they are taken. `viewLimit` is how many views of the
   * stock one count may hold: above 1, counting from a video is offered. The rest describes the
   * open set: how many it holds (its stock, as a photo or a video, counts as one), how many it can
   * hold, and what to do when the counter moves to the next product.
   */
  sets?: {
    mode: CaptureMode; onModeChange: (mode: CaptureMode) => void; viewLimit: number;
    /** How much photo data one request to the backend may carry, when the backend says. */
    requestLimit: number | undefined;
    taken: number; limit: number; onNext: () => void;
    /** The count of the stock photo just taken, or null when there is none to show. */
    count: CameraCount | null;
    /** Throws away the open set's photos, to take the stock photo again. */
    onRetake: () => void;
  };
  onShot: (photo: PreparedPhoto) => void;
  /** The views kept from a video taken around the stock, in the order they were taken. */
  onVideo: (views: PreparedPhoto[]) => void;
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

/** How many close-ups a video set asks for: the front, back and barcode, as far as the set has room. */
function detailTarget(setLimit: number): number {
  return Math.max(1, Math.min(VIDEO_DETAIL_SHOTS.length, setLimit - 1));
}

/** Whether this browser lets a page open the camera. It needs https (or localhost). */
export const canUseCamera = typeof navigator !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

/**
 * A full-screen camera that stays open between shots: tap, move to the next shelf, tap again.
 * Each shot is handed straight to the caller, which counts it in the background.
 *
 * In a photo set the stock photo can take itself: with Auto on, the camera watches the picture and
 * takes the photo once it has been steady for a moment, with a beep. The count then shows here,
 * with a second sound, while the counter takes the front and back by hand.
 *
 * In a video set the stock is not one photo but a video: the counter taps, moves the phone slowly
 * around the stock, and taps again. No video file is kept. While it runs, the camera keeps the
 * stillest look from each angle, and those views are counted together. The camera then asks for
 * the front, back and barcode of one item, one at a time, and closes the product by itself after
 * the last, ready for the next product's video. The counter can finish early, or cancel the product.
 */
export function CameraSheet({ location, progress, sets, onShot, onVideo, onClose }: CameraSheetProps) {
  const set = sets && sets.mode !== 'single' ? sets : undefined;
  const usesVideo = set?.mode === 'video';
  const videoRef = useRef<HTMLVideoElement>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const [camera, setCamera] = useState<CameraState>({ kind: 'starting' });
  const [shots, setShots] = useState(0);
  const [flash, setFlash] = useState(false);
  const [autoOn, setAutoOn] = useState(() => rememberedChoice(AUTO_SNAP_KEY, true));
  const [watch, setWatch] = useState<Watch | null>(null);
  const watcher = useRef<ReturnType<typeof createSteadyWatcher> | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [videoProblem, setVideoProblem] = useState<string | null>(null);
  // A video set was just closed: said until the next video starts, so the counter knows it went.
  const [videoSetSent, setVideoSetSent] = useState(false);
  const picker = useRef<ReturnType<typeof createViewPicker> | null>(null);
  const videoEndedAt = useRef(-Infinity);
  // How large a view may be depends on what the backend accepts in one request.
  const viewEdge = useRef(viewSizes(sets?.requestLimit).edge);
  viewEdge.current = viewSizes(sets?.requestLimit).edge;

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

  // Lets a keyboard user leave the camera with Escape, as with any dialog. Not while a video
  // runs: like the Done button, it waits until the video has been stopped, so the video is not lost.
  const videoRunning = recording !== null;
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !videoRunning) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, videoRunning]);

  const startVideo = (viewLimit: number) => {
    picker.current = createViewPicker(viewLimit);
    setVideoProblem(null);
    setVideoSetSent(false);
    setRecording({ seconds: 0, views: 0 });
    playSnap();
  };

  /** Ends the video and hands over the views kept from it. */
  const finishVideo = () => {
    // Already ended: it stopped by itself in the same moment as the tap.
    if (!picker.current) return;
    const views = picker.current.views(viewSizes(sets?.requestLimit).budget);
    picker.current = null;
    videoEndedAt.current = performance.now();
    setRecording(null);
    if (views.length === 0) {
      setVideoProblem('Nothing could be seen in the video. Add light, hold the phone on the stock, and try again.');
      return;
    }
    onVideo(views);
    // The stock now has its pictures: the next thing Auto takes is the next product's.
    watcher.current?.hold();
    playSnap();
    setShots((count) => count + 1);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
  };

  /** Closes the open set and sends it to be counted. In a video set, back to the next product's video. */
  const finishSet = () => {
    if (!set) return;
    set.onNext();
    if (usesVideo) setVideoSetSent(true);
  };

  /** Throws away the open set: in a video set, its video and photos, back to the start. */
  const cancelSet = () => {
    if (!set) return;
    set.onRetake();
    setVideoSetSent(false);
  };

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video || camera.kind !== 'live') return;
    // A tap meant to stop a video that had just stopped by itself must not take a detail photo.
    if (performance.now() - videoEndedAt.current < VIDEO_END_GRACE_MS) return;
    // In a video set the button starts and stops the video of the stock; after that it takes detail photos.
    if (set && usesVideo && set.taken === 0) {
      if (recording) finishVideo();
      else startVideo(set.viewLimit);
      return;
    }
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
    // The last close-up after a video: the product is done, and the next one's video is next.
    // `set.taken` is still the count from before this photo, and the video is one of them, so it
    // is also the number of close-ups now taken.
    if (set && usesVideo && set.taken >= detailTarget(set.limit)) finishSet();
  };

  // Auto only ever takes the stock photo, the first of a set. Detail photos are close-ups the
  // counter frames by hand, and in "One by one" a photo taken twice would be counted twice.
  const awaitingStockPhoto = set !== undefined && set.taken === 0;
  // A video is started and stopped by hand, so nothing is taken by itself in a video set.
  const watching = camera.kind === 'live' && set !== undefined && autoOn && !usesVideo;
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

  // While a video runs, looks at the picture several times a second and lets the picker keep the
  // views worth counting from. It stops by itself at the longest length.
  const isRecording = recording !== null;
  const endVideo = useRef(finishVideo);
  endVideo.current = finishVideo;
  useEffect(() => {
    if (!isRecording) return;
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_SIDE;
    canvas.height = FRAME_SIDE;
    const drawing = canvas.getContext('2d', { willReadFrequently: true });
    if (!drawing) return;
    const startedAt = performance.now();

    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const views = picker.current;
      if (!video || !views || video.videoWidth === 0) return;
      const now = performance.now();
      try {
        drawing.drawImage(video, 0, 0, FRAME_SIDE, FRAME_SIDE);
        views.offer(toGrey(drawing.getImageData(0, 0, FRAME_SIDE, FRAME_SIDE).data), now, () => captureFrame(video, viewEdge.current, VIDEO_VIEW_QUALITY));
      } catch {
        // A frame that could not be taken is skipped; the video goes on with the others.
      }
      if (now - startedAt >= VIDEO_MAX_MS) {
        endVideo.current();
        return;
      }
      // Only a visible change redraws the screen: a new second, or another view kept.
      const next: Recording = { seconds: Math.floor((now - startedAt) / 1000), views: views.count() };
      setRecording((current) => (current && (current.seconds !== next.seconds || current.views !== next.views) ? next : current));
    }, VIDEO_LOOK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  // A video is given up when its set goes away under it: the mode was changed, or the set was removed.
  useEffect(() => {
    if (!usesVideo || !awaitingStockPhoto) {
      picker.current = null;
      setRecording(null);
    }
    setVideoProblem(null);
  }, [usesVideo, awaitingStockPhoto]);

  // "Sent" belongs to the video set just closed, not to a set taken another way.
  useEffect(() => {
    if (!usesVideo) setVideoSetSent(false);
  }, [usesVideo]);

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
  // A video set's second step: the close-ups, after the video (which counts as the set's first).
  const takingDetails = set !== undefined && usesVideo && set.taken > 0;
  const detailsTaken = set ? set.taken - 1 : 0;
  const detailsWanted = set ? detailTarget(set.limit) : 0;
  const nextDetail = VIDEO_DETAIL_SHOTS[Math.min(detailsTaken, VIDEO_DETAIL_SHOTS.length - 1)];
  // While a video set is under way, the way of taking photos stays as it is: changing it would lose the set.
  const inVideoSet = usesVideo && (isRecording || takingDetails);
  const videoStep = !usesVideo ? null
    : takingDetails ? `Step 2 of 2 · Photo ${detailsTaken + 1} of ${detailsWanted}: ${nextDetail}`
      : 'Step 1 of 2 · Video of the stock';
  const secondsLeft = recording ? Math.max(0, Math.ceil(VIDEO_MAX_MS / 1000) - recording.seconds) : 0;
  const stockGuidance = usesVideo
    ? recording
      ? `Recording. Move slowly around the stock: front, above, sides. ${recording.views} ${recording.views === 1 ? 'view' : 'views'} kept, ${secondsLeft} s left. Tap to stop.`
      : videoProblem ?? (videoSetSent
        ? 'Sent for counting. Tap to record the next product: move slowly around it, then tap again.'
        : 'Tap, then move the phone slowly around the stock: front, above, sides. Tap again to stop.')
    : !autoOn ? 'Photo 1: the stock to count.'
      : watch?.kind === 'same-view' ? 'Move to the next product. Its photo is taken once the picture is steady.'
        : watch?.kind === 'dark' ? 'Too dark to see the stock. Add light, or tap the button.'
          : 'Hold the phone steady over the stock. The photo is taken for you.';
  const guidance = !set
    ? shots > 0 ? `${shots} taken. ${progress}`
      : sets ? 'Every photo is counted on its own. Keep going: counting happens in the background.'
        : 'Tap to take a photo. Keep going: counting happens in the background.'
    : set.taken === 0
      ? stockGuidance
      : takingDetails
        ? `Take ${nextDetail} of one item, up close and sharp. Cancel to drop this product, or Finish to send it now.`
      : setIsFull
        ? 'This set is full. Tap Next for the next product.'
        : `Now the front, back and barcode of one item up close (${set.taken} of ${set.limit} taken). Tap Next when done.`;
  const ringFill = recording ? Math.min(1, (recording.seconds * 1000) / VIDEO_MAX_MS)
    : awaitingStockPhoto && watch?.kind === 'steadying' ? watch.progress : 0;
  const offersVideo = sets !== undefined && sets.viewLimit > 1;
  const modes: readonly { mode: CaptureMode; label: string }[] = offersVideo
    ? [{ mode: 'single', label: 'One by one' }, { mode: 'set', label: 'Photo set' }, { mode: 'video', label: 'Video set' }]
    : [{ mode: 'single', label: 'One by one' }, { mode: 'set', label: 'Stock, front, back' }];
  const shutterLabel = !set ? 'Take photo'
    : takingDetails ? `Take photo ${detailsTaken + 1} of ${detailsWanted}: ${nextDetail}`
    : set.taken > 0 ? 'Take a detail photo'
      : !usesVideo ? 'Take the count photo'
        : recording ? 'Stop the video' : 'Start the video of the stock';

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Camera">
      <video ref={videoRef} className="camera-view" playsInline muted />
      {flash && <div className="camera-flash" aria-hidden="true" />}

      <div className="camera-top">
        <button type="button" className="camera-close" disabled={isRecording} onClick={onClose}>
          <Icon name="close" />
          Done
        </button>
        <p className="camera-place">{location}</p>
      </div>

      <div className="camera-bottom">
        {sets && !inVideoSet && (
          <fieldset className={`camera-mode${offersVideo ? ' three' : ''}`}>
            <legend className="visually-hidden">How the photos are used</legend>
            {modes.map(({ mode, label }) => (
              <label key={mode}>
                <input type="radio" name="camera-mode" className="visually-hidden" checked={sets.mode === mode} onChange={() => sets.onModeChange(mode)} />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {videoStep && camera.kind === 'live' && (
          <div className="camera-step">
            <p>{videoStep}</p>
            {takingDetails && (
              <ol className="camera-pips" aria-hidden="true">
                {Array.from({ length: detailsWanted }, (_, index) => (
                  <li key={index} className={index < detailsTaken ? 'done' : index === detailsTaken ? 'now' : undefined} />
                ))}
              </ol>
            )}
          </div>
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
          {set && set.taken === 0 && !usesVideo && (
            <button type="button" className="camera-side camera-auto" aria-pressed={autoOn} title="Take the stock photo by itself once the picture is steady" onClick={handleAutoChange}>
              Auto {autoOn ? 'on' : 'off'}
            </button>
          )}
          {set && set.taken > 0 && (takingDetails ? (
            <button type="button" className="camera-side" aria-label="Cancel this product: drop its video and photos" onClick={cancelSet}>
              <Icon name="close" size={18} />
              Cancel
            </button>
          ) : (
            <button type="button" className="camera-side" onClick={cancelSet}>
              <Icon name="refresh" size={18} />
              Retake
            </button>
          ))}
          {/* The ring fills while the picture stays steady, and the photo is taken when it closes.
              During a video it fills with the time used. */}
          <span className="camera-shutter-ring" style={{ '--steady': ringFill } as CSSProperties}>
            <button
              ref={shutterRef}
              type="button"
              className={`camera-shutter${usesVideo && awaitingStockPhoto ? (recording ? ' recording' : ' video') : ''}`}
              disabled={camera.kind !== 'live' || setIsFull}
              aria-label={shutterLabel}
              aria-pressed={usesVideo && awaitingStockPhoto ? isRecording : undefined}
              onClick={handleShutter}
            />
          </span>
          {/* In a video set there is nothing to finish until the video is in, and the button only finishes early. */}
          {set && (!usesVideo || takingDetails) && (
            <button type="button" className="camera-next" disabled={set.taken === 0} onClick={finishSet}>
              <Icon name="check" size={18} />
              {takingDetails ? 'Finish' : 'Next'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
