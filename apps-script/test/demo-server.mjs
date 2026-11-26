// A local stand-in for the deployed Apps Script, for using the app before the Sheet is set up.
// It runs the real Code.gs against an in-memory copy of the workbook: saves last until this
// process stops, the Stock tab does not recalculate, and product photos are not stored.
//
// Secrets come only from the project's .env: VITE_APP_SECRET (required, the password the app
// sends) and CLAUDE_API_KEY (optional). With the key, photos are read by Claude for real and
// billed; without it, every photo gets the same canned answer.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { claudeAnswer, loadBackend } from './fakes.mjs';

const PORT = 8790;

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env file: the check below explains what is missing.
}
const apiKey = process.env.CLAUDE_API_KEY || null;
const appSecret = process.env.VITE_APP_SECRET || '';
if (appSecret.length < 16) {
  console.error('Set VITE_APP_SECRET (16+ characters) in the project .env. See .env.example.');
  process.exit(1);
}

function cannedClaudeReply(request) {
  const wantsCount = request.output_config.format.schema.required.includes('items');
  if (!wantsCount) {
    return claudeAnswer({ name: 'QBH Rose Water Toner', size: '200ml', category: 'Toner', expiry: '2028-10', brand: 'QBH', variant: 'Rose water', countryOfOrigin: 'Ghana', otherDetails: [{ label: 'Claim', value: 'Alcohol free' }], labelText: 'QBH\nROSE WATER TONER\n200ml', note: 'Demo answer: Claude was not called.' });
  }
  const blank = { name: '', size: '', category: '', barcode: '', expiry: '' };
  const content = request.messages[0].content;
  const photos = content.filter((block) => block.type === 'image').length;
  // Stock taken as a video arrives as several views of it, each named "View n of N".
  const views = content.filter((block) => block.type === 'text' && /^View \d+ of \d+/.test(block.text)).length || 1;
  const details = photos - views;
  const counted = views > 1
    ? { confidence: 'Medium', note: `View 1 shows 2 rows of 4; view ${views} shows 3 more behind. 11.` }
    : { confidence: 'Low', note: 'Back row hidden; 10 to 12.' };
  // With detail photos, the listed product comes back with details read off the close-ups.
  const listed = details === 0
    ? { ...blank, productCode: 'RG-BLK-500', fullCartons: 0, packSize: 0, loosePieces: 11, ...counted }
    : { ...blank, productCode: 'RG-BLK-500', category: 'Body lotion', brand: 'Rich Glow', batchNumber: 'L2291', expiry: '2029-03', ingredients: 'Aqua, Glycerin, Niacinamide', labelText: 'RICH GLOW\nADVANCED WHITENING LOTION', fullCartons: 0, packSize: 0, loosePieces: 11, confidence: 'Medium', note: 'Details read from the close-ups.' };
  const what = views > 1
    ? `a video of ${views} views${details > 0 ? ` and ${details} detail ${details === 1 ? 'photo' : 'photos'}` : ''}`
    : `a set of ${photos} photos`;
  return claudeAnswer({
    photoNote: photos === 1 ? 'Demo answer: Claude was not called.' : `Demo answer for ${what}: Claude was not called.`,
    items: [
      listed,
      { productCode: 'unknown', name: 'QBH Carrot Oil', size: '100ml', category: 'Hair oil', expiry: '2030-08-06', brand: 'QBH', variant: 'Carrot', labelText: 'QBH\nCARROT OIL\n100ml', fullCartons: 2, packSize: 24, loosePieces: 3, confidence: 'Medium', note: 'Two closed cartons marked 24 x 100ml.' },
    ],
  });
}

/** Sends Code.gs's own request to the Claude API, blocking like UrlFetchApp does. */
function realClaudeReply(_request, { url, options }) {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./claude-fetch.mjs', import.meta.url))], {
    input: JSON.stringify({ url, headers: options.headers, payload: options.payload }),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  // Thrown errors are what UrlFetchApp does on a network failure, so Code.gs retries them.
  if (child.status !== 0 || !child.stdout) throw new Error('The request to Claude did not complete.');
  return JSON.parse(child.stdout);
}

const backend = loadBackend({
  claudeReplies: apiKey ? realClaudeReply : cannedClaudeReply,
  properties: {
    APP_SECRET: appSecret,
    // The stock server's own secret, when one is set: without it the server's actions stay switched off.
    SERVER_SECRET: process.env.SHEET_GATEWAY_SECRET || null,
    ...(apiKey ? { CLAUDE_API_KEY: apiKey, CLAUDE_MODEL: process.env.CLAUDE_MODEL || null } : {}),
  },
  recordRequests: false,
});
backend.context.setup();

createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const reply = request.method === 'POST'
      ? backend.context.doPost({ postData: { contents: Buffer.concat(chunks).toString('utf8') } })
      : backend.context.doGet();
    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    response.end(reply.text);
  });
}).listen(PORT, () => {
  console.log(`Local backend on http://localhost:${PORT} (in-memory sheet).`);
  console.log(apiKey ? 'Claude: REAL calls, billed to the key in .env.' : 'Claude: canned answers (no CLAUDE_API_KEY in .env).');
});
