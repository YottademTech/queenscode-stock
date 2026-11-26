// In-memory stand-ins for the Apps Script services Code.gs uses, so its real request
// handlers can run under Node. They model only what the backend calls.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE_PATH = new URL('../Code.gs', import.meta.url);

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }
  getValues() {
    return Array.from({ length: this.rowCount }, (_, r) =>
      Array.from({ length: this.columnCount }, (_, c) => this.sheet.read(this.row + r, this.column + c)));
  }
  getValue() {
    return this.sheet.read(this.row, this.column);
  }
  setValues(values) {
    if (values.length !== this.rowCount || values.some((cells) => cells.length !== this.columnCount)) {
      throw new Error('setValues size does not match the range');
    }
    values.forEach((cells, r) => cells.forEach((value, c) => this.sheet.write(this.row + r, this.column + c, value)));
    return this;
  }
  setValue(value) {
    this.sheet.write(this.row, this.column, value);
    return this;
  }
  clearContent() {
    return this.setValues(this.getValues().map((cells) => cells.map(() => '')));
  }
  // The fakes do not calculate: a formula is kept as its text, which is what the tests inspect.
  setFormula(formula) {
    return this.setValue(formula);
  }
  setFormulas(formulas) {
    return this.setValues(formulas);
  }
  setNumberFormat(format) {
    this.sheet.formats.push({ row: this.row, column: this.column, format });
    return this;
  }
  setDataValidation(rule) {
    this.sheet.validations.push({ row: this.row, column: this.column, rule });
    return this;
  }
}

export class FakeSheet {
  constructor(name, maxRows, maxColumns) {
    Object.assign(this, { name, maxRows, maxColumns, cells: new Map(), formats: [], validations: [], hidden: false, parent: null });
  }
  // Code.gs runs in its own realm, where a Date made by the tests would fail `instanceof Date`.
  static DateClass = Date;
  read(row, column) {
    const value = this.cells.has(`${row}:${column}`) ? this.cells.get(`${row}:${column}`) : '';
    return value instanceof Date ? new FakeSheet.DateClass(value.getTime()) : value;
  }
  write(row, column, value) {
    if (row > this.maxRows || column > this.maxColumns) throw new Error(`${this.name}: cell ${row}:${column} is outside the sheet`);
    if (value === '') this.cells.delete(`${row}:${column}`);
    else this.cells.set(`${row}:${column}`, value);
  }
  fill(firstRow, rows) {
    rows.forEach((cells, r) => cells.forEach((value, c) => this.write(firstRow + r, c + 1, value)));
    return this;
  }
  rowValues(row, columnCount) {
    return Array.from({ length: columnCount }, (_, c) => this.read(row, c + 1));
  }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    if (row + rowCount - 1 > this.maxRows || column + columnCount - 1 > this.maxColumns) {
      throw new Error(`${this.name}: range is outside the sheet`);
    }
    return new FakeRange(this, row, column, rowCount, columnCount);
  }
  getLastRow() {
    return Math.max(0, ...[...this.cells.keys()].map((key) => Number(key.split(':')[0])));
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  insertColumnsAfter(_after, count) { this.maxColumns += count; }
  appendRow(cells) { this.fill(this.getLastRow() + 1, [cells]); }
  deleteRow(row) {
    const kept = new Map();
    for (const [key, value] of this.cells) {
      const [r, c] = key.split(':').map(Number);
      if (r !== row) kept.set(`${r > row ? r - 1 : r}:${c}`, value);
    }
    this.cells = kept;
  }
  hideSheet() { this.hidden = true; }
  getParent() { return this.parent; }
}

// Products G to U, as setup() writes them.
export const ADDED_HEADERS = [
  'Category', 'Expiry date', 'Product image', 'Brand', 'Variant', 'Description', 'Batch number', 'Manufacture date',
  'Manufacturer', 'Country of origin', 'Ingredients', 'Directions', 'Other details', 'Label text', 'QR code',
  'Price', 'Currency',
];

export const COUNT_DATE = new Date(Date.UTC(2026, 10, 23));

/** A workbook shaped like stock_count_system.xlsx. `prepared` adds what setup() would add. */
export function makeWorkbook({ prepared = true } = {}) {
  const settings = new FakeSheet('Settings', 20, 3).fill(3, [
    ['Count date', COUNT_DATE], ['Location 1', 'Shop shelf'], ['Location 2', 'Warehouse bags'],
    ['Location 3', 'Warehouse sacks'], ['Form responses tab name', 'Form_Adjustments'], [],
    ['Adjustment type: correct', 'Correct the count'], ['Adjustment type: add', 'Add stock'],
    ['Adjustment type: remove', 'Remove stock'],
  ]);
  const products = new FakeSheet('Products', 201, prepared ? 23 : 8).fill(1, [
    ['Code', 'Product name', 'Size', 'Barcode number', 'Pack size (pieces per carton)', 'Reorder level (pieces)',
      ...(prepared ? ADDED_HEADERS : ['', 'Names and sizes read from the shelf photos.'])],
    ['RG-BLK-500', 'Rich Glow Advanced Whitening Lotion (Black)', '500ml'],
    ['RG-YEL', 'Rich Glow Yellow Tone Lotion', '', '', 12],
  ]);
  const counts = new FakeSheet('Claude_Counts', 501, 10).fill(1, [
    ['Count date', 'Location', 'Product code', 'Product name', 'Full cartons', 'Pack size', 'Loose pieces', 'Total pieces', 'Confidence', 'Photo / note'],
    [COUNT_DATE, 'Shop shelf', 'RG-YEL', 'Rich Glow Yellow Tone Lotion', 0, '', 8, 8, 'Medium', 'Photo 18:49.'],
  ]);
  // Rows without a count still carry the workbook's formula results in D and H.
  for (let row = 3; row <= 501; row++) {
    counts.write(row, 4, '=formula');
    counts.write(row, 8, '=formula');
  }
  const adjustments = new FakeSheet('Form_Adjustments', 1000, 8).fill(1, [
    ['Timestamp', 'Counter name', 'Count date', 'Location', 'Product', 'Adjustment type', 'Quantity (pieces)', 'Reason'],
    [new Date(), 'Example', COUNT_DATE, 'Shop shelf', 'Rich Glow Advanced Whitening Lotion (Black)', 'Correct the count', 12, 'EXAMPLE ROW, not a real count.'],
  ]);
  const stock = new FakeSheet('Stock', 203, 22).fill(4, [
    ['RG-BLK-500', 'Rich Glow Advanced Whitening Lotion (Black)', 11, 12, 0, 12, 0, '', 0, 0, 0, '', 0, 0, 12, 11, 1, '', 'Set reorder level', ''],
    ['RG-YEL', 'Rich Glow Yellow Tone Lotion', 8, '', 0, 8, 0, '', 0, 0, 0, '', 0, 0, 8, 8, 0, 10, 'REORDER', 'CHECK'],
  ]);

  const sheets = new Map([settings, products, counts, adjustments, stock].map((sheet) => [sheet.name, sheet]));
  if (prepared) {
    sheets.set('App_Requests', new FakeSheet('App_Requests', 1000, 3).fill(1, [['Request ID', 'Handled at', 'Action']]));
  }
  return sheets;
}

// A made-up value for the automated tests only. The running app's secret comes from .env.
export const SECRET = 'test-secret-0123456789';
// What the stock server sends. It is not the app's secret: the server's actions refuse that one.
export const SERVER_SECRET = 'server-only-secret-0123456789';

/** Loads Code.gs into a fresh context wired to fakes. Returns the context plus what the fakes recorded. */
export function loadBackend({ workbook = makeWorkbook(), properties = {}, claudeReplies = [], recordRequests = true, driveError = null } = {}) {
  const store = new Map(Object.entries({
    APP_SECRET: SECRET, SERVER_SECRET, CLAUDE_API_KEY: 'sk-test', IMAGE_FOLDER_ID: 'folder-1', ...properties,
  }).filter(([, value]) => value !== null));
  // A test sets `lockBusy` to stand for another save holding the lock, and `whileUploading` to a
  // function run during each photo upload, to stand for another phone's save landing meanwhile.
  const recorded = {
    claudeRequests: [], driveFiles: [], driveUpdates: [], folders: [], lockHeld: false, errors: [],
    lockBusy: false, driveCallsUnderLock: 0, whileUploading: null,
  };

  const spreadsheet = {
    getSheetByName: (name) => workbook.get(name) ?? null,
    getSpreadsheetTimeZone: () => 'UTC',
    insertSheet: (name) => {
      const sheet = new FakeSheet(name, 1000, 26);
      sheet.parent = spreadsheet;
      workbook.set(name, sheet);
      return sheet;
    },
  };
  for (const sheet of workbook.values()) sheet.parent = spreadsheet;

  const context = vm.createContext({
    console: { log() {}, error: (message) => recorded.errors.push(String(message)) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush() {},
      // Records the rule a range is given; the fakes do not enforce it.
      newDataValidation: () => {
        const rule = {};
        const builder = {
          requireValueInRange: (range, showDropdown) => Object.assign(rule, { listFrom: `${range.sheet.name}!${range.row}:${range.column}`, showDropdown }) && builder,
          setAllowInvalid: (allow) => Object.assign(rule, { allowInvalid: allow }) && builder,
          setHelpText: (text) => Object.assign(rule, { helpText: text }) && builder,
          build: () => rule,
        };
        return builder;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => store.get(name) ?? null,
        setProperty: (name, value) => { store.set(name, String(value)); },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (recorded.lockBusy) return false;
          recorded.lockHeld = true;
          return true;
        },
        releaseLock: () => { recorded.lockHeld = false; },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_algorithm, value) => [...createHash('sha256').update(value).digest()],
      formatDate: (date) => date.toISOString().slice(0, 10),
      parseDate: (text) => new Date(`${text}T00:00:00Z`),
      base64Decode: (data) => [...Buffer.from(data, 'base64')],
      newBlob: (bytes, mediaType, name) => ({ bytes, mediaType, name }),
      sleep() {},
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    // The Drive advanced service (v3), limited by the manifest to files this script creates.
    Drive: {
      Files: {
        create: (resource, blob) => {
          if (driveError) throw new Error(driveError);
          if (resource.mimeType === 'application/vnd.google-apps.folder') {
            recorded.folders.push({ id: 'new-folder', name: resource.name, sharing: null });
            return { id: 'new-folder' };
          }
          if (recorded.lockHeld) recorded.driveCallsUnderLock++;
          if (recorded.whileUploading) recorded.whileUploading();
          recorded.driveFiles.push({ folderId: resource.parents[0], name: resource.name, mediaType: blob.mediaType, bytes: blob.bytes });
          return { id: `file-${recorded.driveFiles.length}` };
        },
        update: (resource, fileId) => {
          if (recorded.lockHeld) recorded.driveCallsUnderLock++;
          recorded.driveUpdates.push({ fileId, ...resource });
          return { id: fileId };
        },
      },
      Permissions: {
        create: (resource, fileId) => {
          recorded.folders.filter((folder) => folder.id === fileId).forEach((folder) => { folder.sharing = [resource.type, resource.role]; });
        },
      },
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        const body = JSON.parse(options.payload);
        // A long-running local backend must not pile up photos and API keys in memory.
        if (recordRequests) recorded.claudeRequests.push({ url, headers: options.headers, body });
        const reply = typeof claudeReplies === 'function' ? claudeReplies(body, { url, options }) : claudeReplies.shift();
        if (!reply) throw new Error('network down');
        return {
          getResponseCode: () => reply.status,
          getContentText: () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
        };
      },
    },
  });
  FakeSheet.DateClass = vm.runInContext('Date', context);
  vm.runInContext(readFileSync(CODE_PATH, 'utf8'), context, { filename: 'Code.gs' });

  const post = (request) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ secret: SECRET, ...request }) } }).text);
  return { context, workbook, store, recorded, post };
}

export function claudeAnswer(answer, overrides = {}) {
  return {
    status: 200,
    body: {
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: JSON.stringify(answer) }],
      ...overrides,
    },
  };
}
