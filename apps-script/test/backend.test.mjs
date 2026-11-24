import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDED_HEADERS, COUNT_DATE, FakeSheet, SECRET, claudeAnswer, loadBackend, makeWorkbook } from './fakes.mjs';

const PHOTO = { data: Buffer.from('fake jpeg bytes').toString('base64'), mediaType: 'image/jpeg' };

const countRow = (overrides = {}) => ({
  productCode: 'RG-BLK-500', newProduct: null, fullCartons: 0, packSize: null, loosePieces: 5,
  confidence: 'High', note: 'Clear single row.', ...overrides,
});
const newProduct = (overrides = {}) => ({
  name: 'QBH Carrot Oil', size: '100ml', category: 'Hair oil', barcode: '6034000123456', expiry: '2030-08-06', ...overrides,
});
const saveCounts = (rows, overrides = {}) => ({
  action: 'saveCounts', requestId: 'request-0001', location: 'Shop shelf', counter: 'Ama', rows, ...overrides,
});
// Product details as the app stores them: every field is text.
const noDetails = {
  name: '', size: '', barcode: '', category: '', expiry: '', brand: '', variant: '', description: '', batchNumber: '',
  manufactureDate: '', manufacturer: '', countryOfOrigin: '', ingredients: '', directions: '', otherDetails: '', labelText: '',
  qrCode: '',
};
// Claude is asked for every detail except what a QR code holds, which a person enters.
const detailsAskedOfClaude = Object.keys(noDetails).filter((key) => key !== 'qrCode');
// One item of Claude's answer: the same fields, except otherDetails is a list of label and value pairs.
const countedItem = (overrides = {}) => ({
  ...noDetails, otherDetails: [], productCode: 'RG-BLK-500',
  fullCartons: 0, packSize: 0, loosePieces: 11, confidence: 'Low', note: 'Back row hidden; 10 to 12.', ...overrides,
});

const sameDay = (value) => value.getTime() === COUNT_DATE.getTime();
const productRows = (workbook) => {
  const sheet = workbook.get('Products');
  return [2, 3, 4, 5, 6].map((row) => sheet.rowValues(row, 9)).filter((cells) => cells[0] !== '');
};

// --- Trust boundary --------------------------------------------------------

test('a request without the right secret is refused and writes nothing', () => {
  const backend = loadBackend();
  const before = backend.workbook.get('Claude_Counts').getLastRow();

  for (const secret of ['wrong-secret-0123456789', '', undefined, 42]) {
    const reply = backend.post({ ...saveCounts([countRow()]), secret });
    assert.equal(reply.ok, false);
    assert.equal(reply.error.code, 'unauthorized');
  }
  assert.equal(backend.workbook.get('Claude_Counts').rowValues(3, 1)[0], '');
  assert.equal(backend.workbook.get('Claude_Counts').getLastRow(), before);
  assert.equal(backend.recorded.claudeRequests.length, 0);
});

test('a server with no usable secret refuses every request instead of allowing them', () => {
  for (const APP_SECRET of [null, 'short']) {
    const backend = loadBackend({ properties: { APP_SECRET } });
    const reply = backend.post({ action: 'bootstrap', secret: APP_SECRET ?? '' });
    assert.equal(reply.error.code, 'not_configured');
  }
});

test('an unknown action and a malformed body are rejected as invalid requests', () => {
  const backend = loadBackend();
  assert.equal(backend.post({ action: 'constructor' }).error.code, 'invalid_request');
  assert.equal(JSON.parse(backend.context.doPost({ postData: { contents: 'not json' } }).text).error.code, 'invalid_request');
  assert.equal(JSON.parse(backend.context.doPost({}).text).error.code, 'invalid_request');
});

test('an unexpected failure is reported without leaking details or the request body', () => {
  const workbook = makeWorkbook();
  workbook.get('Stock').getRange = () => { throw new Error('boom ' + SECRET); };
  const backend = loadBackend({ workbook });

  const reply = backend.post({ action: 'stock' });
  assert.deepEqual(reply, { ok: false, error: { code: 'internal', message: 'Something went wrong on the server. Try again.' } });
  assert.equal(backend.recorded.errors.length, 1);
});

// --- Reads -----------------------------------------------------------------

test('bootstrap returns the stocktake, products and what is already counted', () => {
  const { data } = loadBackend().post({ action: 'bootstrap' });

  assert.equal(data.countDate, '2026-11-23');
  assert.deepEqual(data.locations, ['Shop shelf', 'Warehouse bags', 'Warehouse sacks']);
  assert.deepEqual(data.adjustmentTypes, { correct: 'Correct the count', add: 'Add stock', remove: 'Remove stock' });
  assert.deepEqual(data.products.map((product) => [product.code, product.packSize]), [['RG-BLK-500', null], ['RG-YEL', 12]]);
  assert.deepEqual(data.counted, [{ code: 'RG-YEL', location: 'Shop shelf', pieces: 8 }]);
});

test('reads explain that setup() is needed when the sheet has not been prepared', () => {
  const reply = loadBackend({ workbook: makeWorkbook({ prepared: false }) }).post({ action: 'bootstrap' });
  assert.equal(reply.error.code, 'not_configured');
  assert.match(reply.error.message, /setup\(\)/);
});

test('stock returns each product with its per-location figures and flags', () => {
  const { data } = loadBackend().post({ action: 'stock' });

  assert.equal(data.rows.length, 2);
  assert.deepEqual(data.rows[0].locations[0], { location: 'Shop shelf', photoCount: 11, correction: 12, addRemove: 0, final: 12 });
  assert.deepEqual(data.rows[0].locations[1], { location: 'Warehouse bags', photoCount: 0, correction: null, addRemove: 0, final: 0 });
  assert.equal(data.rows[0].total, 12);
  assert.deepEqual([data.rows[1].status, data.rows[1].review, data.rows[1].reorderLevel], ['REORDER', 'CHECK', 10]);
});

// --- Claude ----------------------------------------------------------------

test('a count photo is sent to Claude with the product list and comes back as unsaved rows', () => {
  const backend = loadBackend({
    claudeReplies: [claudeAnswer({
      photoNote: 'Two products.',
      items: [
        countedItem(),
        countedItem({ productCode: 'unknown', name: 'QBH Carrot Oil', size: '100ml', barcode: '6 034000 123456', expiry: '2030-08-06', packSize: 24, fullCartons: 2, loosePieces: 0 }),
        countedItem({ productCode: 'NOT-IN-SHEET', fullCartons: -3, loosePieces: 2.6, confidence: 'Certain', expiry: 'Aug 2030' }),
      ],
    })],
  });

  const reply = backend.post({ action: 'analyzeCount', location: 'Shop shelf', image: PHOTO });

  assert.equal(reply.ok, true);
  assert.deepEqual(reply.data.items[0], { ...countedItem(), otherDetails: '', packSize: null });
  assert.deepEqual(reply.data.items[1], {
    ...noDetails, productCode: null, name: 'QBH Carrot Oil', size: '100ml', barcode: '6034000123456', expiry: '2030-08-06',
    fullCartons: 2, packSize: 24, loosePieces: 0, confidence: 'Low', note: 'Back row hidden; 10 to 12.',
  });
  // A code that is not in the sheet, a negative count and an unknown confidence are never passed through.
  assert.deepEqual(
    [reply.data.items[2].productCode, reply.data.items[2].fullCartons, reply.data.items[2].loosePieces, reply.data.items[2].confidence, reply.data.items[2].expiry],
    [null, 0, 3, 'Low', ''],
  );
  assert.equal(backend.workbook.get('Claude_Counts').rowValues(3, 1)[0], '', 'analysis must not save');

  const [sent] = backend.recorded.claudeRequests;
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  // Spread: the headers object comes from Code.gs's realm, so its prototype differs.
  assert.deepEqual({ ...sent.headers }, { 'x-api-key': 'sk-test', 'anthropic-version': '2026-10-21' });
  assert.equal(sent.body.model, 'claude-haiku-5-5');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.deepEqual(sent.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PHOTO.data } });
  assert.match(sent.body.messages[0].content[1].text, /Location: Shop shelf/);
  const itemSchema = sent.body.output_config.format.schema.properties.items.items;
  assert.deepEqual(itemSchema.required.slice(0, detailsAskedOfClaude.length), detailsAskedOfClaude);
  assert.equal('qrCode' in itemSchema.properties, false, 'Claude is never asked to decode a QR code');
  assert.match(sent.body.messages[0].content[1].text, /RG-BLK-500 \| Rich Glow Advanced Whitening Lotion \(Black\) \| 500ml/);
});

test('a busy Claude is retried a bounded number of times', () => {
  const overloaded = { status: 529, body: { error: { type: 'overloaded_error', message: 'Overloaded' } } };

  const recovered = loadBackend({ claudeReplies: [overloaded, claudeAnswer({ items: [], photoNote: 'Empty shelf.' })] });
  assert.deepEqual(recovered.post({ action: 'analyzeCount', location: 'Shop shelf', image: PHOTO }).data, { items: [], photoNote: 'Empty shelf.' });
  assert.equal(recovered.recorded.claudeRequests.length, 2);

  const down = loadBackend({ claudeReplies: [overloaded, overloaded, overloaded, claudeAnswer({ items: [], photoNote: '' })] });
  assert.equal(down.post({ action: 'analyzeCount', location: 'Shop shelf', image: PHOTO }).error.code, 'claude_unavailable');
  assert.equal(down.recorded.claudeRequests.length, 3);

  const offline = loadBackend({ claudeReplies: [] });
  assert.equal(offline.post({ action: 'analyzeCount', location: 'Shop shelf', image: PHOTO }).error.code, 'claude_unavailable');
  assert.equal(offline.recorded.claudeRequests.length, 3);
});

test('Claude failures that a retry cannot fix are reported once, by cause', () => {
  const cases = [
    [{ status: 401, body: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, 'not_configured'],
    [{ status: 400, body: { error: { type: 'invalid_request_error', message: 'bad image' } } }, 'claude_unavailable'],
    [claudeAnswer({}, { stop_reason: 'refusal', content: [] }), 'claude_declined'],
    [claudeAnswer({}, { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] }), 'claude_unavailable'],
    [{ status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] } }, 'claude_unavailable'],
    [claudeAnswer({ photoNote: 'no items key' }), 'claude_unavailable'],
  ];
  for (const [reply, expectedCode] of cases) {
    const backend = loadBackend({ claudeReplies: [reply] });
    assert.equal(backend.post({ action: 'analyzeCount', location: 'Shop shelf', image: PHOTO }).error.code, expectedCode);
    assert.equal(backend.recorded.claudeRequests.length, 1);
  }
});

test('bad photos, unknown locations and a missing API key never reach Claude', () => {
  const requests = [
    { location: 'Shop shelf', image: { data: PHOTO.data, mediaType: 'image/gif' } },
    { location: 'Shop shelf', image: { data: 'not base64!', mediaType: 'image/jpeg' } },
    { location: 'Shop shelf' },
    { location: 'Somewhere else', image: PHOTO },
  ];
  for (const request of requests) {
    const backend = loadBackend();
    assert.equal(backend.post({ action: 'analyzeCount', ...request }).error.code, 'invalid_request');
    assert.equal(backend.recorded.claudeRequests.length, 0);
  }

  const unconfigured = loadBackend({ properties: { CLAUDE_API_KEY: null } });
  assert.equal(unconfigured.post({ action: 'readProductLabel', image: PHOTO }).error.code, 'not_configured');
  assert.equal(unconfigured.recorded.claudeRequests.length, 0);
});

test('the daily photo limit stops further Claude calls', () => {
  const today = new Date().toISOString().slice(0, 10);
  const backend = loadBackend({ properties: { CLAUDE_CALLS_DAY: today, CLAUDE_CALLS_COUNT: '1500' } });

  assert.equal(backend.post({ action: 'analyzeCount', location: 'Shop shelf', image: PHOTO }).error.code, 'limit_reached');
  assert.equal(backend.recorded.claudeRequests.length, 0);
  assert.equal(backend.recorded.lockHeld, false);

  const nextDay = loadBackend({
    properties: { CLAUDE_CALLS_DAY: '2000-01-01', CLAUDE_CALLS_COUNT: '1500' },
    claudeReplies: [claudeAnswer({ items: [], photoNote: '' })],
  });
  assert.equal(nextDay.post({ action: 'analyzeCount', location: 'Shop shelf', image: PHOTO }).ok, true);
  assert.equal(nextDay.store.get('CLAUDE_CALLS_COUNT'), '1');
});

const fullLabel = {
  name: 'QBH Rose Water Toner', size: '200ml', barcode: '0603400012345', category: 'Toner', expiry: '2028-10',
  brand: 'QBH', variant: 'Rose water', description: 'Clear pink toner in a tall bottle with a white flip cap.',
  batchNumber: '1E5', manufactureDate: '2025-10', manufacturer: 'QBH Cosmetics Ltd, Accra', countryOfOrigin: 'Ghana',
  ingredients: 'Aqua, Rosa Damascena Flower Water, Glycerin', directions: 'Apply with a cotton pad after cleansing.',
};

test('everything Claude reads off a product photo is returned, with nothing invented for unreadable fields', () => {
  const backend = loadBackend({
    claudeReplies: [claudeAnswer({
      ...fullLabel,
      barcode: '0 603400 012345',
      manufactureDate: 'October 2025',
      otherDetails: [
        { label: 'Claim', value: 'Alcohol free' }, { label: '', value: 'For external use only' },
        { label: 'FDA reg. no.', value: 'FDA/C  19-0123' }, { label: 'Empty', value: ' ' }, 'not a pair',
      ],
      labelText: '  QBH \r\n\r\nROSE WATER   TONER\n200ml  ',
      qrCode: 'https://invented.example/rose-toner',
      note: 'Barcode partly covered.',
    })],
  });
  const reply = backend.post({ action: 'readProductLabel', image: PHOTO });

  assert.deepEqual(reply.data, {
    ...fullLabel,
    manufactureDate: '',
    otherDetails: 'Claim: Alcohol free\nFor external use only\nFDA reg. no.: FDA/C 19-0123',
    labelText: 'QBH\nROSE WATER TONER\n200ml',
    qrCode: '',
    note: 'Barcode partly covered.',
  });
  const [sent] = backend.recorded.claudeRequests;
  assert.equal(sent.body.output_config.effort, 'medium');
  assert.deepEqual(sent.body.output_config.format.schema.required, [...detailsAskedOfClaude, 'note']);
});

// --- Saving counts ---------------------------------------------------------

test('confirmed rows fill the first empty Claude_Counts rows without touching the formula columns', () => {
  const backend = loadBackend();
  const reply = backend.post(saveCounts([
    countRow({ loosePieces: 11, confidence: 'Low', note: 'Back row hidden.' }),
    countRow({ productCode: 'RG-YEL', fullCartons: 3, loosePieces: 4, note: '' }),
  ]));

  assert.deepEqual(reply, { ok: true, data: { duplicate: false } });
  const counts = backend.workbook.get('Claude_Counts');
  const [first, second] = [counts.rowValues(3, 10), counts.rowValues(4, 10)];

  assert.ok(sameDay(first[0]), 'the count date must equal Settings!B3 so the Stock tab picks the row up');
  assert.deepEqual(first.slice(1), ['Shop shelf', 'RG-BLK-500', '=formula', 0, '', 11, '=formula', 'Low', '[Ama] Back row hidden.']);
  assert.deepEqual(second.slice(1), ['Shop shelf', 'RG-YEL', '=formula', 3, '', 4, '=formula', 'High', '[Ama]']);
  assert.equal(counts.rowValues(5, 1)[0], '');
  assert.equal(backend.recorded.lockHeld, false);
});

test('resending a save with the same request ID does not count the stock twice', () => {
  const backend = loadBackend();
  const request = saveCounts([countRow()]);

  assert.deepEqual(backend.post(request).data, { duplicate: false });
  assert.deepEqual(backend.post(request).data, { duplicate: true });
  assert.equal(backend.workbook.get('Claude_Counts').rowValues(4, 1)[0], '');

  assert.deepEqual(backend.post({ ...request, requestId: 'request-0002' }).data, { duplicate: false });
  assert.ok(sameDay(backend.workbook.get('Claude_Counts').rowValues(4, 1)[0]));
});

test('a product Claude did not recognise is added to Products once and counted under its new code', () => {
  const backend = loadBackend();
  const reply = backend.post(saveCounts([
    countRow({ productCode: null, newProduct: newProduct(), fullCartons: 2, packSize: 24, loosePieces: 3 }),
    countRow({ productCode: null, newProduct: newProduct({ name: '  qbh carrot  oil ' }), loosePieces: 7 }),
  ]));

  assert.equal(reply.ok, true);
  assert.deepEqual(productRows(backend.workbook)[2], ['QBHCO-100', 'QBH Carrot Oil', '100ml', '6034000123456', 24, '', 'Hair oil', '2030-08-06', '']);
  assert.equal(productRows(backend.workbook).length, 3);

  const counts = backend.workbook.get('Claude_Counts');
  assert.deepEqual(counts.rowValues(3, 7).slice(2), ['QBHCO-100', '=formula', 2, 24, 3]);
  assert.deepEqual(counts.rowValues(4, 7).slice(2), ['QBHCO-100', '=formula', 0, '', 7]);
});

test('every detail of a new product is stored in the Products tab and comes back when the app loads', () => {
  const backend = loadBackend();
  const details = { ...fullLabel, otherDetails: 'Claim: Alcohol free\n=SUM(1)', labelText: 'QBH\nROSE WATER TONER\n200ml', qrCode: 'https://qbh.example/p/rose-toner?batch=1E5' };

  const reply = backend.post(saveCounts([countRow({ productCode: null, newProduct: details, loosePieces: 6 })]));
  assert.equal(reply.ok, true);

  assert.deepEqual(backend.workbook.get('Products').rowValues(4, 21), [
    'QBHRWT-200', 'QBH Rose Water Toner', '200ml', '0603400012345', '', '', 'Toner', '2028-10', '',
    'QBH', 'Rose water', 'Clear pink toner in a tall bottle with a white flip cap.', '1E5', '2025-10',
    'QBH Cosmetics Ltd, Accra', 'Ghana', 'Aqua, Rosa Damascena Flower Water, Glycerin', 'Apply with a cotton pad after cleansing.',
    'Claim: Alcohol free\n=SUM(1)', 'QBH\nROSE WATER TONER\n200ml', 'https://qbh.example/p/rose-toner?batch=1E5',
  ]);

  const saved = backend.post({ action: 'bootstrap' }).data.products[2];
  assert.deepEqual(saved, { ...details, code: 'QBHRWT-200', packSize: null, reorderLevel: null, imageUrl: '' });

  const tooLong = backend.post(saveCounts([countRow({ productCode: null, newProduct: { name: 'X', labelText: 'a'.repeat(5001) } })], { requestId: 'request-0003' }));
  assert.match(tooLong.error.message, /label text is too long/);
  const badDate = backend.post(saveCounts([countRow({ productCode: null, newProduct: { name: 'X', manufactureDate: '10/2025' } })], { requestId: 'request-0004' }));
  assert.match(badDate.error.message, /manufacture date must be YYYY-MM-DD or YYYY-MM/);
});

test('new products reuse a listed product of the same name and keep names unique across sizes', () => {
  const backend = loadBackend();
  backend.post(saveCounts([
    // Same name as a listed product whose size is blank: it is that product.
    countRow({ productCode: null, newProduct: newProduct({ name: 'rich glow yellow tone lotion', size: '500ml' }) }),
    // Same name as a listed 500ml product but another size: a new product whose name carries the size.
    countRow({ productCode: null, newProduct: newProduct({ name: 'Rich Glow Advanced Whitening Lotion (Black)', size: '250ml', barcode: '' }) }),
  ]));

  const rows = productRows(backend.workbook);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2].slice(0, 3), ['RGAWLB-250', 'Rich Glow Advanced Whitening Lotion (Black) 250ml', '250ml']);
  assert.equal(backend.workbook.get('Claude_Counts').rowValues(3, 3)[2], 'RG-YEL');
});

test('a save that cannot be completed in full writes nothing', () => {
  const invalid = [
    [saveCounts([countRow(), countRow({ fullCartons: 2 })]), /Row 2: enter how many pieces are in each bag, sack or carton/],
    [saveCounts([countRow(), countRow({ productCode: 'GONE' })]), /Row 2: that product is no longer in the Sheet/],
    [saveCounts([countRow({ loosePieces: -1 })]), /loose pieces must be a whole number/],
    [saveCounts([countRow({ loosePieces: 1.5 })]), /loose pieces must be a whole number/],
    [saveCounts([countRow({ confidence: 'Sure' })]), /confidence/],
    [saveCounts([countRow({ productCode: null, newProduct: newProduct({ name: ' ' }) })]), /new product name/],
    [saveCounts([countRow({ productCode: null, newProduct: newProduct({ expiry: '06-08-2030' }) })]), /expiry/],
    [saveCounts([countRow()], { location: 'Car boot' }), /location/],
    [saveCounts([countRow()], { counter: '' }), /counter name/],
    [saveCounts([countRow()], { requestId: 'x' }), /request ID/],
    [saveCounts([]), /no rows/],
  ];
  for (const [request, message] of invalid) {
    const backend = loadBackend();
    const reply = backend.post(request);
    assert.equal(reply.error.code, 'invalid_request');
    assert.match(reply.error.message, message);
    assert.equal(backend.workbook.get('Claude_Counts').rowValues(3, 1)[0], '');
    assert.equal(productRows(backend.workbook).length, 2);
    assert.equal(backend.workbook.get('App_Requests').getLastRow(), 1, 'a refused save must stay retryable');
  }
});

test('a full Claude_Counts tab refuses the save instead of writing outside the formula rows', () => {
  const workbook = makeWorkbook();
  const counts = workbook.get('Claude_Counts');
  for (let row = 3; row <= 500; row++) counts.fill(row, [[COUNT_DATE, 'Shop shelf', 'RG-YEL']]);
  const backend = loadBackend({ workbook });

  const tooMany = backend.post(saveCounts([countRow(), countRow({ productCode: null, newProduct: newProduct() })]));
  assert.equal(tooMany.error.code, 'sheet_full');
  assert.equal(counts.rowValues(501, 1)[0], '');
  assert.equal(productRows(workbook).length, 2, 'no product may be created for a save that was refused');

  assert.equal(backend.post(saveCounts([countRow()], { requestId: 'request-0009' })).ok, true);
  assert.equal(counts.rowValues(501, 3)[2], 'RG-BLK-500');
});

test('text that looks like a formula is stored as plain text', () => {
  const backend = loadBackend();
  backend.post(saveCounts([
    countRow({ productCode: null, newProduct: newProduct({ name: '=IMPORTXML("http://evil","//a")', size: '+1', category: '@x', barcode: '' }), note: 'ok' }),
  ], { counter: '=HYPERLINK("x")' }));

  const product = productRows(backend.workbook)[2];
  assert.deepEqual([product[1], product[2], product[6]], ['\'=IMPORTXML("http://evil","//a")', "'+1", "'@x"]);
  assert.equal(backend.workbook.get('Claude_Counts').rowValues(3, 10)[9], '[=HYPERLINK("x")] ok');
});

// --- Products --------------------------------------------------------------

const saveProduct = (product, overrides = {}) => ({
  action: 'saveProduct', requestId: 'request-0100',
  product: { code: null, name: 'QBH Glycerin Oil', size: '250ml', category: 'Body oil', barcode: '', expiry: '2030-08-19', packSize: 24, reorderLevel: 10, ...product },
  ...overrides,
});

test('a new product is saved with its own photo stored in Drive', () => {
  const backend = loadBackend();
  const reply = backend.post(saveProduct({}, { image: PHOTO }));

  assert.deepEqual(reply, { ok: true, data: { duplicate: false } });
  assert.deepEqual(productRows(backend.workbook)[2], [
    'QBHGO-250', 'QBH Glycerin Oil', '250ml', '', 24, 10, 'Body oil', '2030-08-19', 'https://drive.google.com/file/d/file-1/view',
  ]);
  const [file] = backend.recorded.driveFiles;
  assert.equal(file.folderId, 'folder-1');
  assert.equal(file.mediaType, 'image/jpeg');
  assert.match(file.name, /^QBHGO-250-\d+\.jpg$/);
  assert.equal(Buffer.from(file.bytes).toString(), 'fake jpeg bytes');

  assert.deepEqual(backend.post(saveProduct({}, { image: PHOTO })).data, { duplicate: true });
  assert.equal(backend.recorded.driveFiles.length, 1, 'a resent save must not upload the photo again');
});

test('editing a product fills its details and photo but leaves its code and name alone', () => {
  const backend = loadBackend();
  const reply = backend.post(saveProduct({ code: 'RG-YEL', name: 'Renamed in the app', size: '500ml', barcode: '0123456789012', packSize: 24, reorderLevel: 6 }, { image: PHOTO }));

  assert.equal(reply.ok, true);
  assert.deepEqual(productRows(backend.workbook)[1], [
    'RG-YEL', 'Rich Glow Yellow Tone Lotion', '500ml', '0123456789012', 24, 6, 'Body oil', '2030-08-19', 'https://drive.google.com/file/d/file-1/view',
  ]);

  const withoutPhoto = backend.post(saveProduct({ code: 'RG-YEL', packSize: null, reorderLevel: null, brand: 'Rich Glow', labelText: 'RICH GLOW\nYELLOW TONE', qrCode: '=HYPERLINK("http://evil")' }, { requestId: 'request-0101' }));
  assert.equal(withoutPhoto.ok, true);
  assert.deepEqual(backend.workbook.get('Products').rowValues(3, 21).slice(9), ['Rich Glow', '', '', '', '', '', '', '', '', '', 'RICH GLOW\nYELLOW TONE', '\'=HYPERLINK("http://evil")']);
  assert.deepEqual(productRows(backend.workbook)[1].slice(4), ['', '', 'Body oil', '2030-08-19', 'https://drive.google.com/file/d/file-1/view']);
});

test('a product save is refused for a duplicate name, an unknown code, bad details or a full tab', () => {
  const refused = [
    [saveProduct({ name: 'rich glow yellow tone lotion' }), 'invalid_request'],
    [saveProduct({ code: 'GONE' }), 'invalid_request'],
    [saveProduct({ barcode: '12ab' }), 'invalid_request'],
    [saveProduct({ packSize: 2.5 }), 'invalid_request'],
    [saveProduct({}, { image: { data: PHOTO.data, mediaType: 'application/pdf' } }), 'invalid_request'],
  ];
  for (const [request, code] of refused) {
    const backend = loadBackend();
    assert.equal(backend.post(request).error.code, code);
    assert.equal(productRows(backend.workbook).length, 2);
    assert.equal(backend.recorded.driveFiles.length, 0);
  }

  const workbook = makeWorkbook();
  for (let row = 4; row <= 201; row++) workbook.get('Products').write(row, 1, `P-${row}`);
  const full = loadBackend({ workbook });
  assert.equal(full.post(saveProduct({}, { image: PHOTO })).error.code, 'sheet_full');
  assert.equal(full.recorded.driveFiles.length, 0);
});

// --- Hand counts -----------------------------------------------------------

test('a hand count is appended to the adjustments tab under the product name the Stock tab matches on', () => {
  const backend = loadBackend();
  const request = { action: 'adjust', requestId: 'request-0200', location: 'Warehouse bags', counter: 'Kofi', productCode: 'RG-YEL', type: 'correct', quantity: 30, reason: '2 cartons + 6' };

  assert.deepEqual(backend.post(request).data, { duplicate: false });
  assert.deepEqual(backend.post(request).data, { duplicate: true });

  const sheet = backend.workbook.get('Form_Adjustments');
  assert.equal(sheet.getLastRow(), 3);
  const row = sheet.rowValues(3, 8);
  assert.ok(sameDay(row[2]));
  assert.deepEqual([row[1], ...row.slice(3)], ['Kofi', 'Warehouse bags', 'Rich Glow Yellow Tone Lotion', 'Correct the count', 30, '2 cartons + 6']);

  for (const bad of [{ type: 'delete' }, { quantity: -2 }, { productCode: 'GONE' }, { location: 'Car boot' }]) {
    assert.equal(backend.post({ ...request, requestId: 'request-0201', ...bad }).error.code, 'invalid_request');
  }
  assert.equal(sheet.getLastRow(), 3);
});

// --- Setup -----------------------------------------------------------------

test('setup prepares an untouched workbook and is safe to run again', () => {
  const workbook = makeWorkbook({ prepared: false });
  const backend = loadBackend({ workbook, properties: { IMAGE_FOLDER_ID: null } });

  const summary = backend.context.setup();

  const products = workbook.get('Products');
  assert.deepEqual(products.rowValues(1, 21).slice(6), ADDED_HEADERS);
  // Every detail column except the name is plain text, so Sheets cannot rewrite what was read off a label.
  assert.deepEqual(products.formats.map((entry) => entry.column), [3, 4, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.ok(products.formats.every((entry) => entry.format === '@'));
  assert.equal(workbook.get('App_Requests').hidden, true);
  assert.equal(workbook.get('Form_Adjustments').getLastRow(), 1, 'the EXAMPLE correction must not count as stock');
  assert.equal(backend.store.get('IMAGE_FOLDER_ID'), 'new-folder');
  assert.deepEqual(backend.recorded.folders[0].sharing, ['anyone', 'reader']);
  assert.match(summary, /Product photo folder is ready/);
  assert.match(summary, /Script Properties are set/);
  assert.equal(backend.post({ action: 'bootstrap' }).ok, true);

  workbook.get('Form_Adjustments').appendRow([new Date(), 'Ama', COUNT_DATE, 'Shop shelf', 'Rich Glow Yellow Tone Lotion', 'Add stock', 2, 'real entry']);
  backend.context.setup();
  assert.equal(backend.recorded.folders.length, 1);
  assert.equal(workbook.get('Form_Adjustments').getLastRow(), 2, 'a real entry is never removed');
});

test('a Sheet prepared by the version before the QR code column brings itself up to date on first use', () => {
  const workbook = makeWorkbook();
  const products = workbook.get('Products');
  // As the earlier setup() left it: 20 columns, the last header "Label text".
  products.write(1, 21, '');
  products.maxColumns = 20;
  const backend = loadBackend({ workbook });

  const loaded = backend.post({ action: 'bootstrap' });
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.data.products.map((product) => product.qrCode), ['', '']);
  assert.deepEqual(products.rowValues(1, 21).slice(6), ADDED_HEADERS);
  assert.ok(products.formats.some((entry) => entry.column === 21 && entry.format === '@'));

  // An app from before the field existed sends no qrCode; the save still goes through.
  assert.equal(backend.post(saveProduct({})).ok, true);
  assert.equal(backend.post(saveProduct({ name: 'QBH Shea Butter', qrCode: 'QBH-SHEA-01' }, { requestId: 'request-0102' })).ok, true);
  assert.deepEqual(backend.post({ action: 'bootstrap' }).data.products.map((product) => product.qrCode), ['', '', '', 'QBH-SHEA-01']);

  const tooLong = backend.post(saveProduct({ name: 'QBH Long', qrCode: 'a'.repeat(2001) }, { requestId: 'request-0103' }));
  assert.match(tooLong.error.message, /qr code is too long/);
});

test('a Sheet whose next free header cell the owner has used is not overwritten when the app loads', () => {
  const workbook = makeWorkbook();
  workbook.get('Products').write(1, 21, 'Supplier');
  const reply = loadBackend({ workbook }).post({ action: 'bootstrap' });

  assert.equal(reply.error.code, 'not_configured');
  assert.match(reply.error.message, /already holds other content \("Supplier"\)/);
  assert.equal(workbook.get('Products').read(1, 21), 'Supplier');
});

test('setup refuses to overwrite header cells the owner has used for something else', () => {
  const workbook = makeWorkbook({ prepared: false });
  workbook.get('Products').write(1, 7, 'Supplier');
  const backend = loadBackend({ workbook });

  assert.throws(() => backend.context.setup(), /already holds other content \("Supplier"\)/);
  assert.equal(workbook.get('Products').read(1, 7), 'Supplier');
});

test('setup builds the whole workbook in a blank Google Sheet, ready to count into', () => {
  const workbook = new Map([['Sheet1', new FakeSheet('Sheet1', 1000, 26)]]);
  const backend = loadBackend({ workbook, properties: { IMAGE_FOLDER_ID: null } });

  const summary = backend.context.setup();
  assert.match(summary, /Created tabs: Settings, Products, Claude_Counts, Form_Adjustments, Stock\./);
  assert.deepEqual([...workbook.keys()], ['Sheet1', 'Settings', 'Products', 'Claude_Counts', 'Form_Adjustments', 'Stock', 'App_Requests']);

  const { data } = backend.post({ action: 'bootstrap' });
  assert.equal(data.countDate, data.today, 'a new Sheet starts a stocktake dated today');
  assert.deepEqual(data.locations, ['Shop shelf', 'Warehouse bags', 'Warehouse sacks']);
  assert.deepEqual(data.adjustmentTypes, { correct: 'Correct the count', add: 'Add stock', remove: 'Remove stock' });
  assert.deepEqual([data.products, data.counted], [[], []]);

  // The first photo count and the first hand count both land where the Stock formulas look.
  assert.equal(backend.post(saveCounts([countRow({ productCode: null, newProduct: newProduct(), fullCartons: 2, packSize: 24, loosePieces: 3 })], { location: 'Warehouse sacks' })).ok, true);
  assert.deepEqual(workbook.get('Products').rowValues(2, 8), ['QBHCO-100', 'QBH Carrot Oil', '100ml', '6034000123456', 24, '', 'Hair oil', '2030-08-06']);
  const counted = workbook.get('Claude_Counts').rowValues(2, 10);
  assert.deepEqual([counted[1], counted[2], counted[4], counted[5], counted[6], counted[8]], ['Warehouse sacks', 'QBHCO-100', 2, 24, 3, 'High']);
  assert.match(counted[3], /^=IF\(C2="",/, 'the product-name formula must survive the write');
  assert.match(counted[7], /^=IF\(C2="","",N\(E2\)\*/, 'the total-pieces formula must survive the write');

  assert.equal(backend.post({ action: 'adjust', requestId: 'request-0300', location: 'Shop shelf', counter: 'Ama', productCode: 'QBHCO-100', type: 'add', quantity: 4, reason: '' }).ok, true);
  assert.deepEqual(workbook.get('Form_Adjustments').rowValues(2, 8).slice(3), ['Shop shelf', 'QBH Carrot Oil', 'Add stock', 4, '']);

  const stock = workbook.get('Stock');
  assert.deepEqual([stock.read(1, 3), stock.read(2, 3), stock.read(2, 7), stock.read(2, 11)], ['=Settings!B3', '=Settings!B4', '=Settings!B5', '=Settings!B6']);
  assert.equal(stock.read(4, 1), '=IF(Products!A2="","",Products!A2)');
  assert.equal(stock.read(203, 1), '=IF(Products!A201="","",Products!A201)');
  assert.equal(stock.read(203, 15), '=IF($A203="","",F203+J203+N203)');
  assert.equal(stock.read(204, 1), '', 'no formulas beyond the 200 product rows');

  // Running setup again builds nothing and wipes nothing.
  assert.match(backend.context.setup(), /All tabs were already there\./);
  assert.equal(workbook.get('Claude_Counts').read(2, 3), 'QBHCO-100');
  assert.equal(backend.recorded.folders.length, 1);
});

test('a Drive problem during setup is reported without stopping the Sheet from being prepared', () => {
  const workbook = new Map();
  const backend = loadBackend({ workbook, properties: { IMAGE_FOLDER_ID: null }, driveError: 'Access denied: Drive' });

  const summary = backend.context.setup();
  assert.match(summary, /product photo folder could NOT be created \(Access denied: Drive\)/);
  assert.equal(backend.store.has('IMAGE_FOLDER_ID'), false);

  // Counting works; only saving a product photo is refused, with the reason.
  assert.equal(backend.post({ action: 'bootstrap' }).ok, true);
  assert.equal(backend.post(saveCounts([countRow({ productCode: null, newProduct: newProduct() })])).ok, true);
  const withPhoto = backend.post({ action: 'saveProduct', requestId: 'request-0400', product: { code: 'QBHCO-100', name: 'QBH Carrot Oil' }, image: PHOTO });
  assert.equal(withPhoto.error.code, 'not_configured');
});

test('the script asks Google only for narrow permissions, never all of Drive or all spreadsheets', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../appsscript.json', import.meta.url), 'utf8'));
  const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/script.external_request',
  ]);
  // These calls would need the wider permissions that Google blocks for an unverified script.
  for (const call of ['DriveApp.', 'SpreadsheetApp.open', 'SpreadsheetApp.create', 'getUi(', 'HtmlService', 'MailApp', 'GmailApp']) {
    assert.equal(code.split('\n').filter((line) => !line.trim().startsWith('*') && line.includes(call)).length, 0, `Code.gs must not use ${call}`);
  }
});
