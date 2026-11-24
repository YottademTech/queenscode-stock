// Performs one HTTP request described on stdin and prints {status, body} as JSON.
// Code.gs expects UrlFetchApp.fetch to be synchronous; the local backend gets that by running
// this file with spawnSync. The request (with its API key) arrives on stdin, never as an argument,
// so it cannot be read from the process list.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { url, headers, payload } = JSON.parse(input);

const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: payload,
  signal: AbortSignal.timeout(110_000),
});
process.stdout.write(JSON.stringify({ status: response.status, body: await response.text() }));
