import { confidenceSchema, type Confidence, type Product, type ProductDetails } from '../api/contract';
import { DETAIL_LABELS } from '../products/details';
import { ProductDetailFields } from '../products/ProductDetailFields';
import { ProductPicker, SelectField } from '../shared/fields';
import { Icon } from '../shared/Icon';
import { ANY_PACK, containerAt } from './containers';
import { QuantityFields } from './QuantityFields';
import { detailsToFill, findProduct, packSizeFor, totalPieces, type CountRow, type Quantities, type RowDetails, type RowErrors } from './countState';

type CountRowCardProps = {
  row: CountRow;
  position: number;
  products: readonly Product[];
  photoPreviewUrl: string | null;
  problems: readonly string[];
  /** Pieces of this product already saved at this row's place in the current stocktake. */
  alreadyCounted: number;
  /** How many rows waiting here name the same product at the same place. */
  rowsForSameProduct: number;
  onDetailsChange: (change: Partial<RowDetails>) => void;
  onQuantitiesChange: (change: Partial<Quantities>) => void;
  onRemove: () => void;
  /** False inside the hand-count panel, which has its own title and close button. */
  showHead?: boolean;
  /** Given, each problem shows under its own field instead of in the list at the end of the card. */
  fieldErrors?: RowErrors;
};

export function CountRowCard(props: CountRowCardProps) {
  const { row, position, products, photoPreviewUrl, problems, alreadyCounted, rowsForSameProduct } = props;
  const product = findProduct(products, row.productCode);
  const container = containerAt(row.location);
  const unit = container ?? ANY_PACK;
  const filling = detailsToFill(row, product);

  const changeNewProduct = (change: Partial<ProductDetails>) =>
    props.onDetailsChange({ newProduct: { ...row.newProduct, ...change } });

  return (
    <li className={`card row-card confidence-${row.confidence.toLowerCase()}${props.showHead === false ? ' bare' : ''}`}>
      {props.showHead !== false && <div className="row-head">
        {photoPreviewUrl ? <img src={photoPreviewUrl} alt="" className="thumb" /> : <span className="thumb placeholder" aria-hidden="true">✎</span>}
        <div className="row-title">
          <strong>Row {position}</strong>
          <small>{row.location}</small>
          <span className={`badge ${row.confidence.toLowerCase()}`}>{row.confidence} confidence</span>
        </div>
        <button type="button" className="button small quiet" onClick={props.onRemove} aria-label={`Remove row ${position}`}>
          <Icon name="trash" size={18} />
          Remove
        </button>
      </div>}

      {row.note && <p className="row-note">{row.note}</p>}

      <ProductPicker label="Product" products={products} value={row.productCode} allowNew error={props.fieldErrors?.product} onChange={(code) => props.onDetailsChange({ productCode: code })} />

      {row.productCode === null && (
        <fieldset className="new-product">
          <legend>New product details (added to the Products tab)</legend>
          <ProductDetailFields value={row.newProduct} errors={props.fieldErrors?.details} onChange={changeNewProduct} />
        </fieldset>
      )}

      {filling.length > 0 && (
        <p className="hint">
          Read from the photos and added to this product, where the Sheet has nothing yet: {filling.map((key) => DETAIL_LABELS[key].toLowerCase()).join(', ')}.
        </p>
      )}

      <QuantityFields
        value={row}
        container={container}
        recordedPackSize={product?.packSize ?? null}
        errors={props.fieldErrors ? { packSize: props.fieldErrors.packSize } : {}}
        onChange={props.onQuantitiesChange}
      />

      <div className="row-foot">
        <p className="total">
          Total <strong>{totalPieces(row, product)}</strong> pieces
          {row.fullCartons > 0 && packSizeFor(row, product) && (
            <small>
              {row.fullCartons} {row.fullCartons === 1 ? unit.one : unit.many} × {packSizeFor(row, product)} + {row.loosePieces} loose
            </small>
          )}
        </p>
        <SelectField
          label="Confidence"
          value={row.confidence}
          options={confidenceSchema.options}
          onChange={(confidence) => props.onDetailsChange({ confidence: confidence as Confidence })}
        />
      </div>

      {rowsForSameProduct > 1 && (
        <p className="hint warn">This product is in {rowsForSameProduct} rows for this place. Their totals are added together, so remove one if it is the same stock twice.</p>
      )}
      {alreadyCounted > 0 && (
        <p className="hint warn">{alreadyCounted} pieces are already saved here for this stocktake. Saving adds this row on top.</p>
      )}
      {problems.length > 0 && !props.fieldErrors && (
        <ul className="problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
