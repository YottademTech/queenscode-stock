import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../api/client';
import { DETAIL_KEYS, type Product, type ProductDetails } from '../api/contract';
import { createRequestIds } from '../lib/id';
import { PRODUCT_PHOTO_EDGE, driveThumbnail, preparePhoto, type PreparedPhoto } from '../lib/image';
import { NoticeBox, NumberField, type Notice } from '../shared/fields';
import { Icon } from '../shared/Icon';
import { detailProblems, emptyDetails, pickDetails, trimDetails } from './details';
import { ProductDetailFields } from './ProductDetailFields';

type FormValues = ProductDetails & { packSize: number | null; reorderLevel: number | null };

type Activity = 'idle' | 'reading' | 'saving' | 'deleting';

type ProductFormProps = {
  /** The product being edited, or null to add a new one. */
  product: Product | null;
  /** Pieces counted by photo for this product in the current stocktake, named before a delete. */
  countedPieces: number;
  /** False when the deployed Apps Script cannot delete products yet. */
  canDelete: boolean;
  /** Called with a message for the list once the product is saved or deleted. */
  onDone: (message: string) => void;
  onCancel: () => void;
};

export function ProductForm({ product, countedPieces, canDelete, onDone, onCancel }: ProductFormProps) {
  const [values, setValues] = useState<FormValues>({
    ...(product ? pickDetails(product) : emptyDetails()),
    packSize: product?.packSize ?? null,
    reorderLevel: product?.reorderLevel ?? null,
  });
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [activity, setActivity] = useState<Activity>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const requestIds = useRef(createRequestIds()).current;
  const photoSection = useRef<HTMLFieldSetElement>(null);
  const isWriting = activity === 'saving' || activity === 'deleting';

  const problems = detailProblems(values);
  const savedPhotoUrl = product ? driveThumbnail(product.imageUrl, 400) : null;
  const change = (patch: Partial<FormValues>) => setValues((current) => ({ ...current, ...patch }));

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing the input lets the same photo be picked again.
    event.target.value = '';
    if (!file) return;
    try {
      setPhoto(await preparePhoto(file, PRODUCT_PHOTO_EDGE));
      setNotice(null);
      // The photo buttons float over the form, so bring the new photo into view wherever it was scrolled to.
      photoSection.current?.scrollIntoView({ block: 'start' });
    } catch {
      setNotice({ tone: 'error', text: 'That file could not be opened as a photo.' });
    }
  };

  const handleReadPhoto = async () => {
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
    setNotice({ tone: 'info', text: read.note || 'Everything Claude could read is filled in, including under More details. Check it before saving.' });
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
      },
      image: photo?.image ?? null,
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
          <input type="file" accept="image/*" className="visually-hidden" disabled={activity !== 'idle'} onChange={handlePhoto} />
        </label>
        <label className="float-button primary" title="Take a photo">
          <Icon name="camera" size={24} />
          <span className="visually-hidden">Take a product photo</span>
          <input type="file" accept="image/*" capture="environment" className="visually-hidden" disabled={activity !== 'idle'} onChange={handlePhoto} />
        </label>
      </div>
      <h3>{product ? `Edit ${product.name}` : 'Add a product'}</h3>

      <fieldset className="product-photo" ref={photoSection}>
        <legend>Product photo</legend>
        <p className="hint">A clean photo of one item, front label showing. Use the camera or upload button at the bottom right. It is stored in Google Drive, separately from count photos.</p>
        {photo ? (
          <img src={photo.previewUrl} alt="New product photo" className="product-image" />
        ) : savedPhotoUrl ? (
          <img src={savedPhotoUrl} alt={`Current photo of ${product?.name ?? 'the product'}`} className="product-image" referrerPolicy="no-referrer" />
        ) : (
          <p className="product-image placeholder">No photo yet</p>
        )}
        {photo && (
          <button type="button" className="button" disabled={activity !== 'idle'} onClick={handleReadPhoto}>
            <Icon name="sparkle" />
            {activity === 'reading' ? 'Claude is reading the label…' : 'Read all details from this photo'}
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
