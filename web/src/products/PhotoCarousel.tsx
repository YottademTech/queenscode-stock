import { useEffect, useRef, useState } from 'react';
import { Icon } from '../shared/Icon';

export type CarouselPhoto = {
  key: string;
  src: string;
  alt: string;
  /** True for a Drive photo, which is shown without sending this page's address to Google. */
  remote: boolean;
  /** Given, the photo has an X in its top right corner that calls this. */
  onRemove?: () => void;
};

type PhotoCarouselProps = {
  photos: readonly CarouselPhoto[];
  /** Tells the form which photo is in view, for "Read all details from this photo". */
  onShowing?: (index: number) => void;
  /** Changed by the form to bring a photo into view, for example one just added. */
  showIndex?: number;
};

/** A product's photos, one at a time across the full width, moved by a swipe, the arrows or the dots. */
export function PhotoCarousel({ photos, onShowing, showIndex }: PhotoCarouselProps) {
  const strip = useRef<HTMLUListElement>(null);
  const [showing, setShowing] = useState(0);
  const shown = Math.min(showing, Math.max(photos.length - 1, 0));

  const goTo = (index: number) => {
    const list = strip.current;
    if (list) list.scrollTo({ left: index * list.clientWidth });
  };

  useEffect(() => {
    if (showIndex !== undefined) goTo(showIndex);
  }, [showIndex]);

  useEffect(() => {
    onShowing?.(shown);
  }, [shown, onShowing]);

  if (photos.length === 0) {
    return <p className="carousel-empty">No photos yet. Add the front, sides, top or base with the camera or upload button at the bottom right.</p>;
  }

  return (
    <div className="photo-carousel" role="group" aria-roledescription="carousel" aria-label="Product photos">
      <ul
        ref={strip}
        className="carousel-strip"
        onScroll={(event) => {
          const list = event.currentTarget;
          if (list.clientWidth > 0) setShowing(Math.round(list.scrollLeft / list.clientWidth));
        }}
      >
        {photos.map((photo, index) => (
          <li key={photo.key} className="carousel-slide" aria-label={`Photo ${index + 1} of ${photos.length}`}>
            <img src={photo.src} alt={photo.alt} referrerPolicy={photo.remote ? 'no-referrer' : undefined} loading={index === 0 ? undefined : 'lazy'} />
            {photo.onRemove && (
              <button type="button" className="carousel-remove" aria-label={`Remove photo ${index + 1}`} onClick={photo.onRemove}>
                <Icon name="close" size={20} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {photos.length > 1 && (
        <div className="carousel-controls">
          <button type="button" className="slide-button" aria-label="Previous photo" disabled={shown === 0} onClick={() => goTo(shown - 1)}>
            <Icon name="back" />
          </button>
          <div className="carousel-dots">
            {photos.map((photo, index) => (
              <button
                key={photo.key}
                type="button"
                className="carousel-dot"
                aria-label={`Show photo ${index + 1}`}
                aria-current={index === shown ? 'true' : undefined}
                onClick={() => goTo(index)}
              />
            ))}
          </div>
          <button type="button" className="slide-button" aria-label="Next photo" disabled={shown === photos.length - 1} onClick={() => goTo(shown + 1)}>
            <Icon name="forward" />
          </button>
        </div>
      )}
      <p className="carousel-count" role="status" aria-live="polite">
        Photo {shown + 1} of {photos.length}
      </p>
    </div>
  );
}
