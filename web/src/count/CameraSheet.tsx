import { useEffect, useRef, useState } from 'react';
import { COUNT_PHOTO_EDGE, captureFrame, type PreparedPhoto } from '../lib/image';
import { Icon } from '../shared/Icon';

type CameraState = { kind: 'starting' } | { kind: 'live' } | { kind: 'failed'; message: string };

type CameraSheetProps = {
  /** Shown at the top so the counter knows which place the shots are filed under. */
  location: string;
  /** What is happening to the shots already taken, for example "2 being counted, 5 saved". */
  progress: string;
  onShot: (photo: PreparedPhoto) => void;
  onClose: () => void;
};

/** Whether this browser lets a page open the camera. It needs https (or localhost). */
export const canUseCamera = typeof navigator !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

/**
 * A full-screen camera that stays open between shots: tap, move to the next shelf, tap again.
 * Each shot is handed straight to the caller, which counts it in the background.
 */
export function CameraSheet({ location, progress, onShot, onClose }: CameraSheetProps) {
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
        <p className="camera-progress" role="status" aria-live="polite">
          {camera.kind === 'starting' && 'Opening the camera…'}
          {camera.kind === 'failed' && camera.message}
          {camera.kind === 'live' && (shots === 0 ? 'Tap to take a photo. Keep going: counting happens in the background.' : `${shots} taken. ${progress}`)}
        </p>
        <button
          ref={shutterRef}
          type="button"
          className="camera-shutter"
          disabled={camera.kind !== 'live'}
          aria-label="Take photo"
          onClick={handleShutter}
        />
      </div>
    </div>
  );
}
