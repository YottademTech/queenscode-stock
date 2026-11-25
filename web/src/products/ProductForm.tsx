import { useCallback, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../api/client';
import { DETAIL_KEYS, type Currency, type Product, type ProductDetails } from '../api/contract';
import { createRequestIds } from '../lib/id';
import { newId } from '../lib/id';
import { PRODUCT_PHOTO_EDGE, driveThumbnail, preparePhoto, type PreparedPhoto } from '../lib/image';
import { NoticeBox, NumberField, type Notice } from '../shared/fields';
import { Icon } from '../shared/Icon';
import { detailProblems, emptyDetails, pickDetails, trimDetails } from './details';
import { PhotoCarousel, type CarouselPhoto } from './PhotoCarousel';
import { PriceFields } from './PriceFields';
import { priceDraft, readPrice } from './price';
import { ProductDetailFields } from './ProductDetailFields';

type FormValues = ProductDetails & { packSize: number | null; reorderLevel: number | null };

type Activity = 'idle' | 'reading' | 'saving' | 'deleting';

/** A photo added in this form, not saved yet. */
type NewPhoto = PreparedPhoto & { key: string };

type ProductFormProps = {
  /** The product being edited, or null to add a new one. */
  product: Product | null;
  /** Pieces counted by photo for this product in the current stocktake, named before a delete. */
  countedPieces: number;
  /** False when the deployed Apps Script cannot delete products yet. */
  canDelete: boolean;
  /**
   * How many photos a product can hold. 1 means an Apps Script from before several photos: a new
   * photo then replaces the old one, and a saved photo cannot be removed.
   */
  photoLimit: number;
  /** The currencies a price can be in; none when the Apps Script predates prices, and then no price is shown. */
  currencies: readonly Currency[];
  /** Called with a message for the list once the product is saved or deleted. */
  onDone: (message: string) => void;
  onCancel: () => void;
};

export function ProductForm({ product, countedPieces, canDelete, photoLimit, currencies, onDone, onCancel }: ProductFormProps) {
  const [values, setValues] = useState<FormValues>({
    ...(product ? pickDetails(product) : emptyDetails()),
    packSize: product?.packSize ?? null,
    reorderLevel: product?.reorderLevel ?? null,
  });
  // The saved photos still kept, in order, then the photos added here. Saving sends both lists.
  const [kept, setKept] = useState<readonly string[]>(product?.imageUrls ?? []);
  const [added, setAdded] = useState<readonly NewPhoto[]>([]);
  const [showing, setShowing] = useState(0);
  const [jumpTo, setJumpTo] = useState<number | undefined>(undefined);
  const onePhotoOnly = photoLimit === 1;
  // The selling price is for the person reviewing the product to set; nothing reads it off a photo.
  const [price, setPrice] = useState(() => priceDraft(product?.price ?? null, product?.currency ?? '', currencies));
  const hasPrices = currencies.length > 0;
  const priceRead = readPrice(price, currencies);
  const [activity, setActivity] = useState<Activity>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const requestIds = useRef(createRequestIds()).current;
  const photoSection = useRef<HTMLFieldSetElement>(null);
  const isWriting = activity === 'saving' || activity === 'deleting';

  const problems = [...detailProblems(values), ...(hasPrices && !priceRead.ok ? [priceRead.error] : [])];
  const change = (patch: Partial<FormValues>) => setValues((current) => ({ ...current, ...patch }));

  // With one photo per product, a new photo is shown in place of the saved one it will replace.
  const shownKept = onePhotoOnly && added.length > 0 ? [] : kept;
  const photos: CarouselPhoto[] = [
    ...shownKept.map((url, index) => ({
      key: url,
      src: driveThumbnail(url, 1000) ?? url,
      alt: `Saved photo ${index + 1} of ${product?.name ?? 'the product'}`,
      remote: true,
      onRemove: onePhotoOnly ? undefined : () => setKept((current) => current.filter((keptUrl) => keptUrl !== url)),
    })),
    ...added.map((photo, index) => ({
      key: photo.key,
      src: photo.previewUrl,
      alt: `New photo ${index + 1}, not saved yet`,
      remote: false,
      onRemove: () => setAdded((current) => current.filter((addedPhoto) => addedPhoto.key !== photo.key)),
    })),
  ];
  // Only a photo added here can be read by Claude: a saved one is in Drive, not on this phone.
  const photoInView = showing >= shownKept.length ? added[showing - shownKept.length] ?? null : null;
  const handleShowing = useCallback((index: number) => setShowing(index), []);

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Clearing the input lets the same photo be picked again.
    event.target.value = '';
    if (files.length === 0) return;

    const room = onePhotoOnly ? 1 : photoLimit - kept.length - added.length;
    if (room <= 0) {
      setNotice({ tone: 'error', text: `A product can have up to ${photoLimit} photos. Remove one with its X before adding another.` });
      return;
    }
    const prepared: NewPhoto[] = [];
    for (const file of files.slice(0, room)) {
      try {
        prepared.push({ ...(await preparePhoto(file, PRODUCT_PHOTO_EDGE)), key: newId() });
      } catch {
        setNotice({ tone: 'error', text: 'A file could not be opened as a photo.' });
      }
    }
    if (prepared.length === 0) return;
    const nextAdded = onePhotoOnly ? prepared.slice(-1) : [...added, ...prepared];
    setAdded(nextAdded);
    setNotice(
      files.length > room
        ? { tone: 'error', text: `Only ${room} more ${room === 1 ? 'photo fits' : 'photos fit'}: a product can have up to ${photoLimit}.` }
        : null,
    );
    // Shows the first new photo, and brings the photos into view wherever the form was scrolled to.
    setJumpTo((onePhotoOnly ? 0 : kept.length) + nextAdded.length - prepared.length);
    photoSection.current?.scrollIntoView({ block: 'start' });
  };

  const handleReadPhoto = async () => {
    const photo = photoInView;
    if (!photo) return;
    setActivity('reading');
    setNotice(null);
    const result = await api.readProductLabel(photo.image);
    setActivity('idle');

    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error.message });
      return;
    }
    // Claude only fills what is still empty, so it never overwrites what a person typed.
    const read = result.data;
    setValues((current) => {
      const filled = { ...current };
      for (const key of DETAIL_KEYS) {
        if (current[key].trim() === '') filled[key] = read[key];
      }
      return filled;
    });
    setNotice({ tone: 'info', text: read.note || 'Everything that could be read is filled in, including under More details. Check it before saving.' });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (problems.length > 0) return;

    const content = {
      product: {
        ...trimDetails(pickDetails(values)),
        code: product?.code ?? null,
        packSize: values.packSize,
        reorderLevel: values.reorderLevel,
        // Only sent where the Apps Script keeps prices; an older one would refuse nothing but store nothing.
        ...(hasPrices && priceRead.ok ? priceRead.value : {}),
      },
      ...(onePhotoOnly
        ? { image: added[0]?.image ?? null }
        : { keepImageUrls: [...kept], images: added.map((photo) => photo.image) }),
    };

    setActivity('saving');
    setNotice(null);
    const result = await api.saveProduct({ requestId: requestIds.for(content), ...content });
    setActivity('idle');

    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error.message });
      return;
    }
    requestIds.reset();
    onDone(`Saved ${content.product.name}.`);
  };

  const handleDelete = async () => {
    if (!product) return;
    setActivity('deleting');
    setNotice(null);
    const result = await api.deleteProduct({ requestId: requestIds.for({ delete: product.code }), productCode: product.code });
    setActivity('idle');

    if (!result.ok) {
      setConfirmingDelete(false);
      setNotice({ tone: 'error', text: result.error.message });
      return;
    }
    requestIds.reset();
    onDone(`Deleted ${product.name}.`);
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <button type="button" className="back-button" aria-label="Back to products" disabled={isWriting} onClick={onCancel}>
        <Icon name="back" size={24} />
      </button>
      {/* The product photo is taken or picked here, in reach wherever the form is scrolled to. */}
      <div className={`photo-floats${activity !== 'idle' ? ' disabled' : ''}`}>
        <label className="float-button" title="Upload a photo">
          <Icon name="image" size={24} />
          <span className="visually-hidden">Upload a product photo</span>
          <input type="file" accept="image/*" multiple={!onePhotoOnly} className="visually-hidden" disabled={activity !== 'idle'} onChange={handlePhoto} />
        </label>
        <label className="float-button primary" title="Take a photo">
          <Icon name="camera" size={24} />
          <span className="visually-hidden">Take a product photo</span>
          <input type="file" accept="image/*" capture="environment" className="visually-hidden" disabled={activity !== 'idle'} onChange={handlePhoto} />
        </label>
      </div>
      <h3>{product ? `Edit ${product.name}` : 'Add a product'}</h3>

      <fieldset className="product-photo" ref={photoSection}>
        <legend>{onePhotoOnly ? 'Product photo' : 'Product photos'}</legend>
        <p className="hint">
          {onePhotoOnly
            ? 'A clean photo of one item, front label showing. Use the camera or upload button at the bottom right.'
            : `Up to ${photoLimit}: the front, sides, top, base or anything else worth checking. Add them with the camera or upload button at the bottom right; the X removes one.`}{' '}
          Stored in Google Drive, separately from count photos.
        </p>
        <PhotoCarousel photos={photos} onShowing={handleShowing} showIndex={jumpTo} />
        {(kept.length !== (product?.imageUrls.length ?? 0) || added.length > 0) && (
          <p className="hint warn">Photo changes are kept when you tap Save product.</p>
        )}
        {photoInView && (
          <button type="button" className="button" disabled={activity !== 'idle'} onClick={handleReadPhoto}>
            <Icon name="sparkle" />
            {activity === 'reading' ? 'Processing…' : 'Read all details from this photo'}
          </button>
        )}
      </fieldset>

      <ProductDetailFields
        value={values}
        nameReadOnly={product !== null}
        nameHint={product ? 'Rename products in the Sheet: the Stock tab matches hand counts by this name.' : undefined}
        onChange={change}
      />
      <div className="grid-2">
        <NumberField label="Pieces per bag, sack or carton" value={values.packSize} onChange={(packSize) => change({ packSize })} />
        <NumberField label="Reorder level (pieces)" value={values.reorderLevel} onChange={(reorderLevel) => change({ reorderLevel })} />
      </div>
      {hasPrices && (
        <PriceFields
          value={price}
          currencies={currencies}
          error={priceRead.ok ? undefined : priceRead.error}
          hint="Optional. Leave it empty if the price is not decided yet."
          onChange={setPrice}
        />
      )}

      {problems.length > 0 && (
        <ul className="problems" id="product-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <NoticeBox notice={notice} />
      <div className="button-row">
        <button type="submit" className="button primary" disabled={problems.length > 0 || activity !== 'idle'} aria-describedby={problems.length > 0 ? 'product-problems' : undefined}>
          <Icon name="check" />
          {activity === 'saving' ? 'Saving…' : 'Save product'}
        </button>
        <button type="button" className="button quiet" disabled={isWriting} onClick={onCancel}>
          <Icon name="close" />
          Cancel
        </button>
      </div>

      {product && canDelete && (
        <div className="delete-product">
          {confirmingDelete ? (
            <div className="notice error" role="group" aria-label="Delete this product">
              <p id="delete-warning">
                Delete {product.name}? It is removed from the Sheet with its photo counts and hand counts
                {countedPieces > 0 && ` (${countedPieces} ${countedPieces === 1 ? 'piece' : 'pieces'} counted by photo in this stocktake)`}.
                This cannot be undone in the app.
              </p>
              <div className="button-row">
                <button type="button" className="button danger filled" disabled={activity !== 'idle'} aria-describedby="delete-warning" onClick={handleDelete}>
                  <Icon name="trash" />
                  {activity === 'deleting' ? 'Deleting…' : 'Delete it'}
                </button>
                {/* Focus lands on the safe answer. */}
                <button type="button" className="button" autoFocus disabled={activity !== 'idle'} onClick={() => setConfirmingDelete(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="button danger" disabled={activity !== 'idle'} onClick={() => setConfirmingDelete(true)}>
              <Icon name="trash" />
              Delete product
            </button>
          )}
        </div>
      )}
    </form>
  );
}
