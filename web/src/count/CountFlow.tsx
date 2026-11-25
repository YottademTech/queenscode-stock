import { useEffect, useReducer, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Bootstrap } from '../api/contract';
import { createRequestIds, newId } from '../lib/id';
import { COUNT_PHOTO_EDGE, preparePhoto, type PreparedPhoto } from '../lib/image';
import { submitSave } from '../lib/saves';
import { NoticeBox, PhotoButtons, SelectField, SwitchField, type Notice } from '../shared/fields';
import { Icon } from '../shared/Icon';
import { CameraSheet, canUseCamera } from './CameraSheet';
import { CountRowCard } from './CountRowCard';
import { ANY_PACK, containerAt, countingHint } from './containers';
import {
  countReducer, handRow, rowErrors, emptyCount, groupByLocation, photoCount, rowProblems, rowsFromAnalysis, rowsPerProduct, savedCount,
  toCountRowInput, type CountRow, type Photo,
} from './countState';

/** Claude takes a few seconds per photo, so several are read side by side. */
const PHOTOS_READ_AT_ONCE = 4;
const AUTO_RETRY_LIMIT = 5;
const AUTO_RETRY_MS = 15_000;
/** Failures that pass on their own: no signal, a busy server, Claude overloaded. */
const PASSING_FAILURES = new Set(['network', 'busy', 'claude_unavailable', 'service_unavailable']);

const PHOTO_SETS_KEY = 'stock.photosets';

/** An on/off choice the counter made earlier on this phone. */
function rememberedChoice(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === 'on';
  } catch {
    return fallback;
  }
}

function rememberChoice(key: string, enabled: boolean) {
  try {
    window.localStorage.setItem(key, enabled ? 'on' : 'off');
  } catch {
    // The choice still holds until the app is closed.
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type CountFlowProps = { bootstrap: Bootstrap; counter: string; onSaved: () => void };

export function CountFlow({ bootstrap, counter, onSaved }: CountFlowProps) {
  const [state, dispatch] = useReducer(countReducer, emptyCount);
  const [location, setLocation] = useState(bootstrap.locations[0] ?? '');
  const [photoSets, setPhotoSets] = useState(() => rememberedChoice(PHOTO_SETS_KEY, false));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The row being filled in by hand, in the panel on the right. It joins the list only when added.
  const [handDraft, setHandDraft] = useState<CountRow | null>(null);
  const handPanel = useRef<HTMLDialogElement>(null);
  // Errors in the panel show under their fields once Add has been tapped, then follow the typing.
  const [showHandErrors, setShowHandErrors] = useState(false);
  const startedPhotoIds = useRef(new Set<string>());
  const requestIds = useRef(createRequestIds()).current;

  async function saveRows(rows: readonly CountRow[], place: string, requestId: string): Promise<boolean> {
    const rowIds = rows.map((row) => row.id);
    const outcome = await submitSave({
      kind: 'counts',
      id: requestId,
      label: `${plural(rows.length, 'photo count row', 'photo count rows')} for ${place}`,
      payload: { requestId, location: place, counter: counter.trim(), rows: rows.map(toCountRowInput) },
      lastError: null,
    });

    if (outcome.kind === 'rejected') {
      // The rows come back into view so the counter can put right what the server refused.
      dispatch({ type: 'savingFailed', rowIds });
      setNotice({ tone: 'error', text: outcome.message });
      return false;
    }
    dispatch({ type: 'rowsSaved', rowIds, saved: rows.map((row) => savedCount(row, bootstrap.products, outcome.kind === 'queued')) });
    onSaved();
    return true;
  }

  // Sends waiting photos to Claude the moment they are taken, several at a time. The counter
  // never waits for this. The ref stops a photo being sent twice between renders.
  useEffect(() => {
    const readingNow = state.photos.filter((photo) => photo.status.kind === 'reading').length;
    const next = state.photos.find((photo) => photo.status.kind === 'waiting' && !startedPhotoIds.current.has(photo.id));
    if (!next || readingNow >= PHOTOS_READ_AT_ONCE) return;

    startedPhotoIds.current.add(next.id);
    dispatch({ type: 'readingStarted', photoId: next.id });
    void api.analyzeCount(next.location, [next.image, ...next.details.map((detail) => detail.image)]).then((result) => {
      startedPhotoIds.current.delete(next.id);
      if (!result.ok) {
        dispatch({ type: 'readingFailed', photoId: next.id, message: result.error.message, retryable: PASSING_FAILURES.has(result.error.code) });
        return;
      }

      // Every row waits for the counter to check it and tap Save.
      dispatch({ type: 'readingSucceeded', photoId: next.id, note: result.data.photoNote, rows: rowsFromAnalysis(next, result.data, newId) });
    });
  }, [state.photos]);

  // Photos that failed for lack of signal are sent again on their own, so the counter can keep
  // moving: after a pause, or as soon as the phone reports it is back online.
  useEffect(() => {
    const stuck = state.photos.filter((photo) => photo.status.kind === 'failed' && photo.status.retryable && photo.failures < AUTO_RETRY_LIMIT);
    if (stuck.length === 0) return;

    const retry = () => stuck.forEach((photo) => dispatch({ type: 'photoRetried', photoId: photo.id }));
    const timer = window.setTimeout(retry, AUTO_RETRY_MS);
    window.addEventListener('online', retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [state.photos]);

  const reviewRows = state.rows.filter((row) => !row.saving);
  const savingRows = state.rows.length - reviewRows.length;
  const problemsByRow = new Map(reviewRows.map((row) => [row.id, rowProblems(row, bootstrap.products, containerAt(row.location) ?? ANY_PACK)]));
  const rowsWithProblems = [...problemsByRow.values()].filter((problems) => problems.length > 0).length;
  const sameProductRows = rowsPerProduct(reviewRows);
  const countingPhotos = state.photos.filter((photo) => photo.status.kind === 'waiting' || photo.status.kind === 'reading').length;
  const failedPhotos = state.photos.filter((photo) => photo.status.kind === 'failed').length;

  // A set is the count photo plus detail photos of the same stock, read by Claude in one request.
  // The option only exists when the Apps Script can take more than one photo.
  const setLimit = bootstrap.photoSetLimit;
  const usingSets = photoSets && setLimit > 1;
  const openSet = state.photos.find((photo) => photo.status.kind === 'collecting') ?? null;
  const openSetSize = openSet ? photoCount(openSet) : 0;

  const progress = [
    openSet && `1 set open (${plural(openSetSize, 'photo', 'photos')})`,
    countingPhotos > 0 && `${plural(countingPhotos, 'photo', 'photos')} being counted`,
    savingRows > 0 && `${plural(savingRows, 'row', 'rows')} saving`,
    state.saved.length > 0 && `${state.saved.length} saved`,
    reviewRows.length > 0 && `${plural(reviewRows.length, 'row needs', 'rows need')} you`,
    failedPhotos > 0 && `${plural(failedPhotos, 'photo', 'photos')} not read`,
  ].filter(Boolean).join(' · ');

  const blockers: string[] = [];
  if (counter.trim() === '') blockers.push('Sign in again with your name.');
  if (rowsWithProblems > 0) blockers.push(`Fix ${plural(rowsWithProblems, 'row', 'rows')} marked below.`);

  const alreadyCounted = (row: CountRow) =>
    bootstrap.counted.find((entry) => entry.code === row.productCode && entry.location === row.location)?.pieces ?? 0;

  const addPhoto = (prepared: PreparedPhoto) => {
    const photo: Photo = { id: newId(), ...prepared, details: [], location, failures: 0, status: { kind: 'waiting' } };
    dispatch(usingSets ? { type: 'setPhotoAdded', photo, limit: setLimit } : { type: 'photoAdded', photo });
  };

  const handleFiles = async (files: File[]) => {
    setNotice(null);
    const room = setLimit - openSetSize;
    if (usingSets && files.length > room) {
      const text = room === 0
        ? 'This set is full. Count it before adding more photos.'
        : openSet
          ? `This set has room for ${plural(room, 'more photo', 'more photos')}. Pick fewer, or count it first.`
          : `A set holds up to ${setLimit} photos: 1 to count and ${setLimit - 1} for details. Pick fewer.`;
      setNotice({ tone: 'error', text });
      return;
    }
    let unreadable = 0;
    for (const file of files) {
      try {
        addPhoto(await preparePhoto(file, COUNT_PHOTO_EDGE));
      } catch {
        unreadable += 1;
      }
    }
    if (unreadable > 0) {
      setNotice({ tone: 'error', text: `${plural(unreadable, 'file', 'files')} could not be opened as a photo.` });
    } else if (!usingSets && files.length > 1 && files.length <= setLimit) {
      // The same photos would have made one set, so say which way they went.
      setNotice({ tone: 'info', text: `These ${files.length} photos are each counted on their own. For one product's stock, front and back, switch on "Add front and back photos" first.` });
    }
  };

  const closeOpenSet = () => dispatch({ type: 'openSetClosed' });

  const handlePhotoSetsChange = (enabled: boolean) => {
    setPhotoSets(enabled);
    rememberChoice(PHOTO_SETS_KEY, enabled);
    // A set left open would never be counted once the option is off.
    if (!enabled) closeOpenSet();
  };

  // Leaving the camera sends the set in hand, so nothing waits on a button the counter may not see.
  const handleCameraClose = () => {
    closeOpenSet();
    setCameraOpen(false);
  };

  // The panel opens once its row exists, so the form inside it is there to receive the focus.
  useEffect(() => {
    if (handDraft && !handPanel.current?.open) handPanel.current?.showModal();
  }, [handDraft]);

  const closeHandPanel = () => handPanel.current?.close();
  const handDraftProblems = handDraft ? rowProblems(handDraft, bootstrap.products, containerAt(handDraft.location) ?? ANY_PACK) : [];

  const addHandRow = () => {
    if (!handDraft) return;
    if (handDraftProblems.length > 0) {
      setShowHandErrors(true);
      // Takes the counter to the first field that needs them, once its message is on screen.
      window.requestAnimationFrame(() => {
        const field = handPanel.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        field?.focus({ preventScroll: true });
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    dispatch({ type: 'rowAdded', row: handDraft });
    closeHandPanel();
  };

  const handleSave = async () => {
    setNotice(null);
    const groups = [...groupByLocation(reviewRows)];
    dispatch({ type: 'savingStarted', rowIds: reviewRows.map((row) => row.id) });

    const results = await Promise.all(
      groups.map(([place, rows]) => saveRows(rows, place, requestIds.for({ place, counter: counter.trim(), rows: rows.map(toCountRowInput) }))),
    );
    if (results.every(Boolean)) requestIds.reset();
  };

  return (
    <section aria-labelledby="count-heading">
      <h2 id="count-heading">Take Stock By Photo</h2>

      <SelectField label="Where are you counting from?" value={location} options={bootstrap.locations} onChange={setLocation} />
      {countingHint(location) && <p className="hint">{countingHint(location)}</p>}

      {setLimit > 1 && (
        <SwitchField
          label="Add front and back photos"
          hint={`The first photo is counted. Up to ${setLimit - 1} more of the same product, such as its front and back, let Claude fill in its details in the same request.`}
          checked={photoSets}
          onChange={handlePhotoSetsChange}
        />
      )}

      <details className="tips">
        <summary>How to take a photo Claude can count</summary>
        <ul>
          <li>One product per photo is counted in a few seconds. A whole shelf of different products takes Claude about half a minute.</li>
          <li>Straight on or from above, with a single layer visible. Stand bottles upright.</li>
          <li>Bags and sacks: step back so every one in the pile shows. Claude counts the full ones; you enter the pieces in each.</li>
          <li>Open bags and sacks are not full ones. Count what is left inside as loose pieces.</li>
          <li>Keep variants apart. Rich Glow black and Rich Glow yellow are different products.</li>
          {setLimit > 1 && <li>With front and back photos on: take the stock first, then close-ups of one item, label filling the frame. Only the first photo is counted.</li>}
        </ul>
      </details>

      <PhotoButtons multiple onFiles={handleFiles} onOpenCamera={canUseCamera ? () => setCameraOpen(true) : undefined} />
      <NoticeBox notice={notice} />

      <p className="progress" role="status" aria-live="polite">{progress}</p>

      {state.photos.length > 0 && (
        <ul className="photo-strip" aria-label="Photos">
          {state.photos.map((photo, index) => (
            <li key={photo.id} className={`photo${photo.status.kind === 'collecting' ? ' open-set' : ''}`}>
              <img src={photo.previewUrl} alt={`Photo ${index + 1}, ${photo.location}`} />
              {photo.details.length > 0 && (
                <ul className="detail-photos" aria-label={`Detail photos of photo ${index + 1}`}>
                  {photo.details.map((detail, detailIndex) => (
                    <li key={detailIndex}>
                      {photo.status.kind === 'collecting' ? (
                        <button
                          type="button"
                          className="detail-photo"
                          aria-label={`Remove detail photo ${detailIndex + 1}`}
                          onClick={() => dispatch({ type: 'detailPhotoRemoved', photoId: photo.id, index: detailIndex })}
                        >
                          <img src={detail.previewUrl} alt="" />
                          <span className="detail-remove-mark" aria-hidden="true"><Icon name="close" size={12} /></span>
                        </button>
                      ) : (
                        <img src={detail.previewUrl} alt={`Detail photo ${detailIndex + 1}`} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="photo-status">
                {photo.status.kind === 'collecting' && (photo.details.length === 0
                  ? 'This photo is counted. Add the front and back of the product, then count the set.'
                  : `Counted photo plus ${plural(photo.details.length, 'detail photo', 'detail photos')}. Tap a detail photo to remove it.`)}
                {photo.status.kind === 'waiting' && 'Waiting its turn'}
                {photo.status.kind === 'reading' && 'Claude is counting…'}
                {photo.status.kind === 'done' && (photo.status.note || 'Counted')}
                {photo.status.kind === 'failed' && (
                  <span className="error-text">
                    {photo.status.message}
                    {photo.status.retryable && photo.failures < AUTO_RETRY_LIMIT && ' Trying again on its own.'}
                  </span>
                )}
              </p>
              <div className="button-row">
                {photo.status.kind === 'collecting' && (
                  <button type="button" className="button small primary" onClick={closeOpenSet}>
                    <Icon name="check" size={18} />
                    Count this set
                  </button>
                )}
                {photo.status.kind === 'failed' && (
                  <button type="button" className="button small" onClick={() => dispatch({ type: 'photoRetried', photoId: photo.id })}>
                    <Icon name="refresh" size={18} />
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  className="button small quiet"
                  aria-label={`Remove photo ${index + 1} and its rows`}
                  onClick={() => dispatch({ type: 'photoRemoved', photoId: photo.id })}
                >
                  <Icon name="trash" size={18} />
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {reviewRows.length > 0 && (
        <>
          <h3>Check the count before saving</h3>
          <p className="hint">Nothing here is saved yet. Correct any number that is wrong, then save.</p>
          <ul className="row-list">
            {reviewRows.map((row, index) => (
              <CountRowCard
                key={row.id}
                row={row}
                position={index + 1}
                products={bootstrap.products}
                photoPreviewUrl={state.photos.find((photo) => photo.id === row.photoId)?.previewUrl ?? null}
                problems={problemsByRow.get(row.id) ?? []}
                alreadyCounted={alreadyCounted(row)}
                rowsForSameProduct={sameProductRows(row)}
                onDetailsChange={(change) => dispatch({ type: 'rowDetailsChanged', rowId: row.id, change })}
                onQuantitiesChange={(change) => dispatch({ type: 'rowQuantitiesChanged', rowId: row.id, change })}
                onRemove={() => dispatch({ type: 'rowRemoved', rowId: row.id })}
              />
            ))}
          </ul>
        </>
      )}

      <div className="button-row">
        <button
          type="button"
          className="button icon-button"
          aria-label="Add a product by hand"
          title="Add a product by hand"
          aria-haspopup="dialog"
          onClick={() => {
            setShowHandErrors(false);
            setHandDraft(handRow(newId(), location));
          }}
        >
          <Icon name="handPlus" size={28} />
        </button>
      </div>

      {/* Filling in a row by hand happens in a panel from the right, so the list stays as it was until
          the row is added. Closing it any way (X, Escape, a tap beside it) drops the unfinished row. */}
      <dialog
        ref={handPanel}
        className="drawer-right"
        aria-labelledby="hand-panel-title"
        onClose={() => setHandDraft(null)}
        onClick={(event) => { if (event.target === event.currentTarget) closeHandPanel(); }}
      >
        {handDraft && (
          <div className="drawer-panel">
            <div className="drawer-head">
              <h3 id="hand-panel-title">Add a product by hand</h3>
              <button type="button" className="drawer-close" aria-label="Close without adding" onClick={closeHandPanel}>
                <Icon name="close" size={22} />
              </button>
            </div>
            <div className="drawer-body">
            <p className="hint">Choose the product and enter what you counted at {handDraft.location}. The row joins the list on the Photo screen, to be saved with the others.</p>
            <ul className="row-list">
              <CountRowCard
                row={handDraft}
                position={reviewRows.length + 1}
                products={bootstrap.products}
                photoPreviewUrl={null}
                problems={handDraftProblems}
                alreadyCounted={alreadyCounted(handDraft)}
                rowsForSameProduct={rowsPerProduct([...reviewRows, handDraft])(handDraft)}
                onDetailsChange={(change) => setHandDraft((current) => (current ? { ...current, ...change } : current))}
                onQuantitiesChange={(change) => setHandDraft((current) => (current ? { ...current, ...change } : current))}
                onRemove={closeHandPanel}
                showHead={false}
                fieldErrors={showHandErrors ? rowErrors(handDraft, bootstrap.products, containerAt(handDraft.location) ?? ANY_PACK) : { details: {} }}
              />
            </ul>
            </div>
            {/* A footer of its own under the form, so the button never covers a field. */}
            <div className="drawer-foot">
              <button type="button" className="button primary wide" onClick={addHandRow}>
                <Icon name="plus" />
                Add to the list
              </button>
            </div>
          </div>
        )}
      </dialog>

      {reviewRows.length > 0 && (
        <div className="save-bar">
          {blockers.length > 0 && (
            <ul className="problems" id="count-blockers">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="button primary wide"
            disabled={blockers.length > 0}
            aria-describedby={blockers.length > 0 ? 'count-blockers' : undefined}
            onClick={handleSave}
          >
            <Icon name="check" />
            Save {plural(reviewRows.length, 'row', 'rows')} to the Sheet
          </button>
        </div>
      )}

      {state.saved.length > 0 && (
        <>
          <h3>Saved</h3>
          <ul className="saved-list">
            {state.saved.map((entry) => (
              <li key={entry.id}>
                <span className="saved-name">
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.location}
                    {entry.waitingForSignal && ' · on this phone until the signal is back'}
                  </small>
                </span>
                {entry.confidence === 'Low' && <span className="badge low">CHECK</span>}
                <span className="saved-pieces">{entry.pieces}</span>
              </li>
            ))}
          </ul>
          <p className="hint">Rows marked CHECK were counted with low confidence. Count those by hand to correct them.</p>
        </>
      )}

      {cameraOpen && (
        <CameraSheet
          location={location}
          progress={progress}
          sets={setLimit > 1 ? { on: photoSets, onChange: handlePhotoSetsChange, taken: openSetSize, limit: setLimit, onNext: closeOpenSet } : undefined}
          onShot={addPhoto}
          onClose={handleCameraClose}
        />
      )}
    </section>
  );
}
