import { z } from 'zod';

// The shapes the Apps Script backend (apps-script/Code.gs) accepts and returns.

export const confidenceSchema = z.enum(['High', 'Medium', 'Low']);
export type Confidence = z.infer<typeof confidenceSchema>;

export const adjustmentKinds = ['correct', 'add', 'remove'] as const;
export type AdjustmentKind = (typeof adjustmentKinds)[number];

/** Every product detail the app keeps, all as text. Mirrors DETAIL_FIELDS in apps-script/Code.gs. */
export const DETAIL_KEYS = [
  'name', 'size', 'barcode', 'category', 'expiry', 'brand', 'variant', 'description', 'batchNumber', 'manufactureDate',
  'manufacturer', 'countryOfOrigin', 'ingredients', 'directions', 'otherDetails', 'labelText', 'qrCode',
] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];
export type ProductDetails = Record<DetailKey, string>;

const productDetailsShape = {
  ...(Object.fromEntries(DETAIL_KEYS.map((key) => [key, z.string()])) as Record<DetailKey, z.ZodString>),
  // Added after the first release. The app and the Apps Script are deployed separately, so a
  // script that has not been updated yet leaves it out; the app must still load.
  qrCode: z.string().default(''),
};

export const productSchema = z
  .object({
    ...productDetailsShape,
    code: z.string(),
    packSize: z.number().nullable(),
    reorderLevel: z.number().nullable(),
    /** The first photo, the one the product list shows. */
    imageUrl: z.string(),
    // Every photo of the product, in order. An Apps Script from before several photos sends only imageUrl.
    imageUrls: z.array(z.string()).optional(),
  })
  .transform((product) => ({ ...product, imageUrls: product.imageUrls ?? (product.imageUrl ? [product.imageUrl] : []) }));
export type Product = z.infer<typeof productSchema>;

export const bootstrapSchema = z.object({
  countDate: z.string(),
  today: z.string(),
  locations: z.array(z.string()).min(1),
  adjustmentTypes: z.object({ correct: z.string(), add: z.string(), remove: z.string() }),
  products: z.array(productSchema),
  counted: z.array(z.object({ code: z.string(), location: z.string(), pieces: z.number() })),
  // How many photos one count request may hold: the count photo plus detail photos. An Apps Script
  // from before photo sets does not say, and reads one photo.
  photoSetLimit: z.number().int().min(1).default(1),
  // How many photos one product can hold. An Apps Script from before several photos keeps one, and
  // replaces it when a new one is sent.
  productPhotoLimit: z.number().int().min(1).default(1),
  // What the deployed Apps Script can do. One from before it said so offers nothing newer.
  actions: z.array(z.string()).default([]),
});
export type Bootstrap = z.infer<typeof bootstrapSchema>;

export const countAnalysisSchema = z.object({
  photoNote: z.string(),
  items: z.array(
    z.object({
      ...productDetailsShape,
      productCode: z.string().nullable(),
      fullCartons: z.number(),
      packSize: z.number().nullable(),
      loosePieces: z.number(),
      confidence: confidenceSchema,
      note: z.string(),
    }),
  ),
});
export type CountAnalysis = z.infer<typeof countAnalysisSchema>;

export const labelReadingSchema = z.object({ ...productDetailsShape, note: z.string() });
export type LabelReading = z.infer<typeof labelReadingSchema>;

export const saveResultSchema = z.object({ duplicate: z.boolean() });
export type SaveResult = z.infer<typeof saveResultSchema>;

export const stockSchema = z.object({
  rows: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      locations: z.array(
        z.object({
          location: z.string(),
          photoCount: z.number().nullable(),
          correction: z.number().nullable(),
          addRemove: z.number().nullable(),
          final: z.number().nullable(),
        }),
      ),
      total: z.number().nullable(),
      photoTotal: z.number().nullable(),
      difference: z.number().nullable(),
      reorderLevel: z.number().nullable(),
      status: z.string(),
      review: z.string(),
    }),
  ),
});
export type Stock = z.infer<typeof stockSchema>;

export type EncodedImage = { data: string; mediaType: 'image/jpeg' };

const productDetailsSchema = z.object(productDetailsShape);

// Saves are also kept in the phone's storage while there is no signal, so they have schemas too.
export const saveCountsInputSchema = z.object({
  requestId: z.string(),
  location: z.string(),
  counter: z.string(),
  rows: z.array(
    z.object({
      productCode: z.string().nullable(),
      newProduct: productDetailsSchema.nullable(),
      // Details read from the photos of a listed product. Saves kept on a phone from before this existed have none.
      details: productDetailsSchema.nullable().default(null),
      fullCartons: z.number(),
      packSize: z.number().nullable(),
      loosePieces: z.number(),
      confidence: confidenceSchema,
      note: z.string(),
    }),
  ),
});
export type SaveCountsInput = z.infer<typeof saveCountsInputSchema>;
export type CountRowInput = SaveCountsInput['rows'][number];

export const adjustmentInputSchema = z.object({
  requestId: z.string(),
  location: z.string(),
  counter: z.string(),
  productCode: z.string(),
  type: z.enum(adjustmentKinds),
  quantity: z.number(),
  reason: z.string(),
});
export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;

export type DeleteProductInput = { requestId: string; productCode: string };

export type SaveProductInput = {
  requestId: string;
  product: ProductDetails & { code: string | null; packSize: number | null; reorderLevel: number | null };
  /** The one new photo, for an Apps Script that keeps one photo per product. */
  image?: EncodedImage | null;
  /** New photos, added after the kept ones. */
  images?: EncodedImage[];
  /** The product's photos to keep, in order; any other photo it had is removed. */
  keepImageUrls?: string[];
};
