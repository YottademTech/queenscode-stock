# Stock Count App: project brief

Handoff from a planning conversation with Claude. Read this fully before writing code.

## 1. Context

- The owner (David) runs a cosmetics shop in Ghana. Stock sits on shop shelves and in the warehouse in cartons ("boxes") and sacks.
- Products are mostly body lotions. Some have barcodes, some do not.
- Goal: a simple way to take stock, where a phone photo can be counted by Claude, a person can correct it, and a Google Sheet is the database.
- Staff will also count, and they do not have Claude accounts. That is why this is a standalone React app and not a page inside Claude.

## 2. What already exists

- A workbook, `stock_count_system.xlsx`, designed to be uploaded to Google Drive and opened as a Google Sheet. Its tabs and columns are the data contract (section 4).
- A Claude Console organization linked to the owner's Max plan, which includes monthly API credits. An API key named "QueensCode" has been created.
- The API key is NOT in this document and must never be committed, logged, or placed in frontend code.

## 3. Architecture

```
React app (phone browser)
   |  POST JSON as text/plain
   v
Google Apps Script web app (bound to the Google Sheet)
   |-- reads/writes the Sheet (the database)
   |-- calls the Claude API with the photo (API key in Script Properties)
   v
Google Sheet: Products, Claude_Counts, Form_Adjustments, Stock, Sync_Log
```

Decisions already made:

- **Database:** Google Sheets. Small shop scale; appends only, to avoid overwrite conflicts.
- **Backend:** Google Apps Script web app (`doGet` / `doPost`). No separate server.
- **CORS:** send POST bodies with `Content-Type: text/plain` and parse JSON in the script. Apps Script does not answer preflight requests.
- **Secrets:** the Claude API key and a shared app secret live in Apps Script **Script Properties**. The React app sends the shared secret with each request; the script rejects requests without it.
- **Claude usage:** only the photo-counting step calls the Claude API. Hand-entered counts never do.

## 4. Data contract (Google Sheet)

Do not rename tabs or reorder columns. The Stock tab's formulas depend on them.

### Settings
| Cell | Meaning | Current value |
|---|---|---|
| B3 | Count date (the stocktake being worked on) | date |
| B4 | Location 1 | Shop shelf |
| B5 | Location 2 | Warehouse boxes |
| B6 | Location 3 | Warehouse sacks |
| B7 | Name of the tab holding adjustments | Form_Adjustments |
| B9 | Adjustment type: correct | Correct the count |
| B10 | Adjustment type: add | Add stock |
| B11 | Adjustment type: remove | Remove stock |
| B13:B15 | Confidence levels | High, Medium, Low |

### Products (row 1 headers, data from row 2, up to row 201)
A Code | B Product name | C Size | D Barcode number | E Pack size (pieces per carton) | F Reorder level (pieces)

Current rows (pack size, barcode and reorder level are still blank):

| Code | Product name | Size |
|---|---|---|
| RG-BLK-500 | Rich Glow Advanced Whitening Lotion (Black) | 500ml |
| RG-YEL | Rich Glow Yellow Tone Lotion | unknown |
| BP-SWR-500 | Bathel Paris Snow White And Radiant Body Lotion | 500ml |
| BP-FWE-500 | Bathel Paris Flawless White Extra Body Milk | 500ml |
| AP-RET-500 | Advanced Purity Retinol 2% Brightening Lotion | 500ml |

### Claude_Counts (photo counts; one row per product per location per photo)
A Count date | B Location | C Product code | D Product name (formula) | E Full cartons | F Pack size (blank = use Products) | G Loose pieces | H Total pieces (formula) | I Confidence | J Photo / note

- Columns D and H contain formulas down to row 501. Write only A, B, C, E, F, G, I, J.
- Write into the first row where column A is empty. Do not use `appendRow` on this tab, because the pre-filled formulas make it append after row 501.

### Form_Adjustments (manual entries; originally meant for a Google Form)
A Timestamp | B Counter name | C Count date | D Location | E Product (the product NAME, exactly as in Products!B) | F Adjustment type | G Quantity (pieces) | H Reason

- `appendRow` is fine here.
- Row 2 currently holds an EXAMPLE row that is not a real count. Delete it before real use.

### Stock (read only; all formulas)
One row per product from row 4. For each of the three locations: Claude count, Form correction, Add / remove, Final. Then TOTAL STOCK (O), Claude total (P), Difference (Q), Reorder level (R), Status (S), Review (T).

Merging rules implemented by the formulas:

- Only rows whose count date equals Settings!B3 are used.
- A "Correct the count" entry **replaces** Claude's number for that product and location. The latest timestamp wins.
- "Add stock" and "Remove stock" entries are applied on top.
- Review shows `CHECK` when Claude's count was Low confidence and no correction exists.
- Status shows `REORDER` when total stock is at or below the reorder level.

### Sync_Log
A Synced at | B Count date | C Products sent | D Total pieces sent | E Result | F Notes. Reserved for a nightly sync that is not built yet (section 8).

## 5. Backend (Apps Script) to build

Endpoints, all through one web app URL:

- `GET ?action=bootstrap` returns products (code, name, size, pack size), locations, the count date, and adjustment types.
- `GET ?action=stock` returns the Stock tab rows for display.
- `POST {action:"manualCount", ...}` appends a row to Form_Adjustments.
- `POST {action:"photoCount", imageBase64, mediaType, location}` sends the image to Claude, and returns the proposed rows WITHOUT saving.
- `POST {action:"savePhotoCount", rows:[...]}` writes confirmed rows to Claude_Counts.

Requirements:

- Check the shared secret on every request.
- Wrap sheet writes in `LockService` to avoid two phones writing the same row.
- Call the Claude Messages API with `UrlFetchApp`. Check https://docs.claude.com for the current endpoint, headers, image input format and model IDs before coding; do not rely on memory. A small, cheap vision-capable model is enough for counting.
- Ask Claude for strict JSON: for each product seen, the best matching product code from the supplied product list, full cartons, loose pieces, confidence (High, Medium, Low) and a short note. Include the product list in the prompt so it matches existing codes, and allow "unknown" for products not in the list.
- Tell Claude to mark Low confidence when bottles overlap, are stacked in layers, or are dark on a dark background. In testing, photos of mixed or stacked shelves only gave estimates.

## 6. Frontend (React) to build

Mobile first; counters use phones in a shop and warehouse with patchy signal.

Screens:

1. **Count by hand.** Counter name (remembered), location, product (searchable list), full cartons, loose pieces, live total using pack size, adjustment type (default "Correct the count"), reason, submit.
2. **Count by photo.** Take or choose a photo (`<input type="file" accept="image/*" capture="environment">`), pick the location, send, then show Claude's proposed rows in an editable list. Nothing is saved until the counter confirms.
3. **Stock.** Table from the Stock tab with CHECK and REORDER highlighted.

Behaviour:

- Compress photos in the browser before upload (long edge about 1600px, JPEG) to keep requests small and fast.
- If a submit fails for lack of signal, keep it in a local queue and retry. Show the queue count.
- Config through environment variables: the Apps Script URL and the shared secret. No Claude API key anywhere in the frontend.
- Keep it simple: Vite + React, no backend framework, minimal dependencies.

## 7. Counting guidance to show in the app

- One product per photo, straight on or from above, single layer visible.
- Stand bottles upright; do not stack them lying down.
- Cartons: count full cartons and enter pack size; add loose pieces separately.
- Keep variants separate (for example Rich Glow black and Rich Glow yellow are different products).

## 8. Open questions for the owner

- The Google Sheet link has not been provided yet. Ask for it before wiring the backend.
- The "database" for the planned nightly sync was never defined. Until it is, treat the Stock tab as the source of truth and skip the sync.
- Pack sizes, barcodes and reorder levels are not filled in.
- Whether to replace the Google Form entirely with this app (assumed yes).

## 9. Security checklist

- API key only in Apps Script Script Properties.
- `.env` files in `.gitignore`.
- Shared secret required on every request; rotate it if a staff member leaves.
- If the API key is ever exposed, delete it in the Claude Console and create a new one.
