import { useEffect, useReducer, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Bootstrap } from '../api/contract';
import { rememberChoice, rememberedChoice } from '../lib/choices';
import { createRequestIds, newId } from '../lib/id';
import { COUNT_PHOTO_EDGE, preparePhoto, type PreparedPhoto } from '../lib/image';
import { submitSave } from '../lib/saves';
import { unlockSounds } from '../lib/sounds';
import { NoticeBox, PhotoButtons, SelectField, SwitchField, type Notice } from '../shared/fields';
import { Icon } from '../shared/Icon';
import { CameraSheet, canUseCamera, type CameraCount, type CaptureMode } from './CameraSheet';
import { viewsThatFit } from './videoViews';
import { CountRowCard } from './CountRowCard';
import { ANY_PACK, containerAt, countingHint } from './containers';
import {
  awaitsFirstLook, countReducer, countSummary, handRow, rowErrors, emptyCount, groupByLocation, photoCount, rowProblems, rowsFromAnalysis, rowsPerProduct, savedCount,
  toCountRowInput, viewCount, type CountRow, type Photo,
} from './countState';

/** Claude takes a few seconds per photo, so several are read side by side. */
const PHOTOS_READ_AT_ONCE = 4;
const AUTO_RETRY_LIMIT = 5;
const AUTO_RETRY_MS = 15_000;
/** Failures that pass on their own: no signal, a busy server, Claude overloaded. */
const PASSING_FAILURES = new Set(['network', 'busy', 'claude_unavailable', 'service_unavailable']);

// A new key: photo sets became the default, and a choice of "off" saved before that should not keep
// phones counting each photo of a product as a product of its own.
const PHOTO_SETS_KEY = 'stock.photosets.v2';
/** Whether a set's stock is taken as a video around it, not as one photo. Off until the counter chooses it. */
const VIDEO_COUNT_KEY = 'stock.videocount';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type CountFlowProps = { bootstrap: Bootstrap; counter: string; onSaved: () => void };

export function CountFlow({ bootstrap, counter, onSaved }: CountFlowProps) {
  const [state, dispatch] = useReducer(countReducer, emptyCount);
  const [location, setLocation] = useState(bootstrap.locations[0] ?? '');
  // On unless the counter chose "One by one": photos taken together are one product's stock, front and back.
  const [photoSets, setPhotoSets] = useState(() => rememberedChoice(PHOTO_SETS_KEY, true));
  const [videoCount, setVideoCount] = useState(() => rememberedChoice(VIDEO_COUNT_KEY, false));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The row being filled in by hand, in the panel on the right. It joins the list only when added.
  const [handDraft, setHandDraft] = useState<CountRow | null>(null);
  const handPanel = useRef<HTMLDialogElement>(null);
  // Errors in the panel show under their fields once Add has been tapped, then follow the typing.
  const [showHandErrors, setShowHandErrors] = useState(false);
  const startedPhotoIds = useRef(new Set<string>());
  const startedFirstLooks = useRef(new Set<string>());
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
    // A set closed without detail photos, whose first look is still on its way, needs no request of its own.
    const next = state.photos.find((photo) => photo.status.kind === 'waiting' && !awaitsFirstLook(photo) && !startedPhotoIds.current.has(photo.id));
    if (!next || readingNow >= PHOTOS_READ_AT_ONCE) return;

    startedPhotoIds.current.add(next.id);
    dispatch({ type: 'readingStarted', photoId: next.id });
    // With detail photos added, a video's views may no longer all fit in one request: then fewer go.
    const details = next.details.map((detail) => detail.image);
    const views = viewsThatFit([next.image, ...next.views.map((view) => view.image)], details, bootstrap.requestLimit);
    void api.analyzeCount(next.location, [...views, ...details], views.length).then((result) => {
      startedPhotoIds.current.delete(next.id);
      if (!result.ok) {
        dispatch({ type: 'readingFailed', photoId: next.id, message: result.error.message, retryable: PASSING_FAILURES.has(result.error.code) });
        return;
      }

      // Every row waits for the counter to check it and tap Save.
      dispatch({ type: 'readingSucceeded', photoId: next.id, note: result.data.photoNote, rows: rowsFromAnalysis(next, result.data, newId) });
    });
  }, [state.photos]);

  // The stock taken in the camera, as a photo or as the views from a video, is counted on its own
  // straight away, so the number shows in the camera while the counter takes the front and back.
  // The whole set is still read on "Next".
  useEffect(() => {
    const wanted = state.photos.find((photo) => photo.firstLook?.kind === 'wanted' && !startedFirstLooks.current.has(photo.id));
    if (!wanted) return;

    startedFirstLooks.current.add(wanted.id);
    dispatch({ type: 'firstLookStarted', photoId: wanted.id });
    void api.analyzeCount(wanted.location, [wanted.image, ...wanted.views.map((view) => view.image)], viewCount(wanted)).then((result) => {
      if (!result.ok) {
        dispatch({ type: 'firstLookFailed', photoId: wanted.id });
        return;
      }
      dispatch({ type: 'firstLookSucceeded', photoId: wanted.id, note: result.data.photoNote, rows: rowsFromAnalysis(wanted, result.data, newId) });
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
  // Counting from a video needs a backend that takes several views, and the in-app camera.
  const viewLimit = canUseCamera && setLimit > 1 ? bootstrap.countViewLimit : 1;
  const captureMode: CaptureMode = !usingSets ? 'single' : videoCount && viewLimit > 1 ? 'video' : 'set';
  const openSet = state.photos.find((photo) => photo.status.kind === 'collecting') ?? null;
  const openSetSize = openSet ? photoCount(openSet) : 0;
  const openSetHolds = !openSet ? ''
    : openSet.views.length === 0 ? plural(openSetSize, 'photo', 'photos')
      : openSet.details.length === 0 ? 'a video' : `a video and ${plural(openSet.details.length, 'photo', 'photos')}`;

  const progress = [
    openSet && `1 set open (${openSetHolds})`,
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

  // `views` are the other views of the same stock, when it was taken as a video around it.
  const addPhoto = (prepared: PreparedPhoto, fromCamera = false, views: readonly PreparedPhoto[] = []) => {
    const photo: Photo = { id: newId(), ...prepared, views, details: [], location, failures: 0, status: { kind: 'waiting' } };
    dispatch(usingSets ? { type: 'setPhotoAdded', photo, limit: setLimit, firstLook: fromCamera } : { type: 'photoAdded', photo });
  };

  // The first view stands for the video on this screen; all of them are counted together.
  const addVideo = ([first, ...others]: PreparedPhoto[]) => {
    if (first) addPhoto(first, true, others);
  };

  // "7 pieces", or "2 full sacks + 3 pieces" where the pieces in a full sack are not known yet.
  const cameraHeadline = (rows: readonly CountRow[]): CameraCount => {
    const summary = countSummary(rows, bootstrap.products);
    const unit = containerAt(openSet?.location ?? location) ?? ANY_PACK;
    const parts = [
      summary.unsizedPacks > 0 && `${summary.unsizedPacks} full ${summary.unsizedPacks === 1 ? unit.one : unit.many}`,
      (summary.pieces > 0 || summary.unsizedPacks === 0) && plural(summary.pieces, 'piece', 'pieces'),
    ].filter(Boolean);
    return { kind: 'done', headline: parts.join(' + '), label: summary.label, nothing: rows.length === 0 };
  };

  // What the camera shows for the open set's stock photo: still counting, the count, or nothing yet.
  const firstLook = openSet?.firstLook;
  const cameraCount: CameraCount | null = !firstLook
    ? null
    : firstLook.kind === 'done'
      ? cameraHeadline(firstLook.rows)
      : firstLook.kind === 'failed' ? { kind: 'failed' } : { kind: 'counting' };

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

  const handleVideoCountChange = (enabled: boolean) => {
    setVideoCount(enabled);
    rememberChoice(VIDEO_COUNT_KEY, enabled);
  };

  const handleModeChange = (mode: CaptureMode) => {
    handlePhotoSetsChange(mode !== 'single');
    if (mode !== 'single') handleVideoCountChange(mode === 'video');
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
          hint={`The first photo is counted. Up to ${setLimit - 1} more of the same product, such as its front and back, fill in its details in the same request.`}
          checked={photoSets}
          onChange={handlePhotoSetsChange}
        />
      )}
      {usingSets && viewLimit > 1 && (
        <SwitchField
          label="Count from a video"
          hint={`In the camera, move the phone slowly around the stock instead of taking one photo. Up to ${viewLimit} views from different angles are counted together, so stock behind the front row can be seen.`}
          checked={videoCount}
          onChange={handleVideoCountChange}
        />
      )}

      <details className="tips">
        <summary>How to take a photo that can be counted</summary>
        <ul>
          <li>One product per photo is counted in a few seconds. A whole shelf of different products takes about half a minute.</li>
          <li>Straight on or from above, with a single layer visible. Stand bottles upright.</li>
          <li>Bags and sacks: step back so every one in the pile shows. The full ones are counted; you enter the pieces in each.</li>
          <li>Open bags and sacks are not full ones. Count what is left inside as loose pieces.</li>
          <li>Keep variants apart. Rich Glow black and Rich Glow yellow are different products.</li>
          {setLimit > 1 && <li>With front and back photos on: take the stock first, then close-ups of one item, label filling the frame, and the barcode close enough to read its digits. Only the first photo is counted.</li>}
          {viewLimit > 1 && <li>Counting from a video: one product at a time. Move slowly, a few seconds, from the front, from above and from the sides, so every piece shows in at least one view. Pause a moment at each angle: a still view is a sharp one.</li>}
        </ul>
      </details>

      <PhotoButtons multiple onFiles={handleFiles} onOpenCamera={canUseCamera ? () => { unlockSounds(); setCameraOpen(true); } : undefined} />
      <NoticeBox notice={notice} />

      <p className="progress" role="status" aria-live="polite">{progress}</p>

      {state.photos.length > 0 && (
        <ul className="photo-strip" aria-label="Photos">
          {state.photos.map((photo, index) => (
            <li key={photo.id} className={`photo${photo.status.kind === 'collecting' ? ' open-set' : ''}`}>
              <img src={photo.previewUrl} alt={`${photo.views.length > 0 ? 'Video' : 'Photo'} ${index + 1}, ${photo.location}`} />
              {photo.views.length > 0 && <span className="views-badge">Video · {plural(viewCount(photo), 'view', 'views')}</span>}
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
                  ? `This ${photo.views.length > 0 ? 'video' : 'photo'} is counted. Add the front and back of the product, then count the set.`
                  : `Counted ${photo.views.length > 0 ? 'video' : 'photo'} plus ${plural(photo.details.length, 'detail photo', 'detail photos')}. Tap a detail photo to remove it.`)}
                {photo.status.kind === 'waiting' && (awaitsFirstLook(photo) ? 'Processing…' : 'Waiting its turn')}
                {photo.status.kind === 'reading' && 'Processing…'}
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
          sets={setLimit > 1 ? {
            mode: captureMode, onModeChange: handleModeChange, viewLimit, requestLimit: bootstrap.requestLimit,
            taken: openSetSize, limit: setLimit, onNext: closeOpenSet,
            count: cameraCount,
            onRetake: () => { if (openSet) dispatch({ type: 'photoRemoved', photoId: openSet.id }); },
          } : undefined}
          onShot={(photo) => addPhoto(photo, true)}
          onVideo={addVideo}
          onClose={handleCameraClose}
        />
      )}
    </section>
  );
}
