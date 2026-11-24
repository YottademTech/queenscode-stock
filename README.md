# Stock count app

Count stock from phone photos. Claude reads each photo, a person checks the numbers, and the
confirmed count is written to the stock Google Sheet. Product photos are stored in Google Drive.

```
web/           React app (Vite + TypeScript) for phones
apps-script/   Code.gs: the backend, pasted into the Sheet's Apps Script project
```

The data contract (tabs and columns) is in `STOCK_APP_BRIEF.md`. The app adds columns G to U to
Products and one hidden tab, `App_Requests`.

## What Claude records about a product

Claude is told to keep everything it can read on the pack, because the shop does not yet know
which details it will need. Each product row holds: name, size, barcode, category, expiry date,
product photo link, brand, variant, description, batch number, manufacture date, manufacturer,
country of origin, ingredients, directions, **Other details** (any other fact, one per line, such
as claims, warnings or registration numbers) and **Label text** (all legible text, word for word).
Claude leaves a field empty when the photo does not show it.

Each row also has a **QR code** column for what a QR code on the pack holds. Claude is not asked
for it, because a photo cannot be relied on to decode one: staff type, paste or scan it in. Like
the barcode, it is optional.

## Front and back photos

On the Photo screen, **Add front and back photos** groups photos into a set: the first photo is the
one counted, and up to three more (the front and back of one item, a marking on a sack) are read
for details. The whole set goes to Claude as one request, so one request returns the count and the
details. In the camera, tap **Next** to move to the next product; with Upload, tap **Count this set**.

The option is off until someone switches it on, and each phone remembers its own choice. The camera
shows the same choice as **One by one** or **Stock, front, back**, so it can be seen and changed
where the photos are taken. With it off, every photo is counted on its own: a close-up of a back
label sent that way comes back as a separate product with one piece.

- Claude counts from the first photo only, and still counts products no close-up shows.
- A new product is created with every detail read from the set.
- For a product already in the Sheet, the details fill only the cells that are empty. Nothing a
  person entered is replaced, the name is never changed, and a Low-confidence row fills nothing.

The option appears only when the deployed Apps Script supports it.

## Where stock is kept

Places come from the Sheet's Settings tab (B4:B6). The word in the name decides how a place is
counted: "Shop shelf" is counted in single pieces; a name containing bag, sack, box or carton
(for example "Warehouse bags", "Warehouse sacks") is counted in full bags or sacks, pieces in each,
plus loose pieces. The workbook ships with "Warehouse boxes" in B5: change it if yours are bags.

## Logo

Save the logo as `web/src/assets/logo.png` (or .jpg, .webp, .svg) and it appears in the top bar.

## Secrets

Every secret is kept in one file, `.env` at the project root (git-ignored). Copy `.env.example`
to create it. Nothing secret is written in the code, `package.json` or this README.

| Variable | Used by | Reaches the browser? |
|---|---|---|
| `CLAUDE_API_KEY` | local backend only | No |
| `VITE_APP_SECRET` | app and local backend | Yes, by design: it is the app's password |
| `VITE_API_URL` | app | Yes (not a secret) |

Google Apps Script cannot read a `.env` file. For the deployed backend the same two secrets go
in its Script Properties, which is Google's equivalent.

## Run it locally, without a Sheet

```
cd web
npm install
npm run backend    # terminal 1: local stand-in for the Sheet, on port 8790
npm run dev        # terminal 2: the app, on http://localhost:5173
```

The local backend runs the real `Code.gs` against an in-memory copy of the workbook: saves last
until it stops, the Stock screen does not recalculate, and product photos are not stored.
With `CLAUDE_API_KEY` set, Claude reads photos for real and the key is billed. Without it, every
photo gets the same canned answer.

## Connect the real Sheet

1. Create a new, blank Google Sheet (sheets.new) and give it a name. A Sheet made by uploading
   `stock_count_system.xlsx` also works; `setup` keeps the tabs it finds.
2. In the Sheet: Extensions > Apps Script. Then:
   - Project Settings (gear) > tick "Show appsscript.json manifest file in editor".
   - Back in the Editor, replace `appsscript.json` with `apps-script/appsscript.json`. It limits the
     script to this spreadsheet, Drive files it creates itself, and calls to Claude. Without it the
     script asks for all of Drive, which Google blocks ("This app is blocked").
   - Replace `Code.gs` with `apps-script/Code.gs`, and save.
3. Project Settings > Script Properties, add:
   - `CLAUDE_API_KEY`: the key from the Claude Console.
   - `APP_SECRET`: the value of `VITE_APP_SECRET` in `.env`.
   - `CLAUDE_MODEL` (optional): defaults to `claude-haiku-5-5`. Set `claude-opus-5-5` for more
     careful counting at a higher price per photo.
4. In the editor, choose the `setup` function and press Run. Approve the permissions. In a blank
   Sheet it creates the tabs Settings, Products, Claude_Counts, Form_Adjustments and Stock with
   their formulas, a hidden `App_Requests` tab, and a Drive folder "Stock app product images"
   (anyone with the link can view, so photos can be shown).
5. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL
   ending in `/exec`. Opening it in a browser should show `{"ok":true,...}`.
6. In the project's `.env`, set `VITE_API_URL` to that URL.
7. `npm run dev` to test, `npm run build` to produce `web/dist/`, which can be hosted on any
   static host (Netlify, Cloudflare Pages, GitHub Pages).

After changing `Code.gs`, use Deploy > Manage deployments > Edit > New version, so the URL stays
the same.

## Things to know

- **The secret is inside the built app.** Anyone who has the app can read it. Share the link only
  with staff, change `APP_SECRET` (and rebuild) when someone leaves, and set a monthly spend limit
  on the API key in the Claude Console. The backend also stops at 1,500 photos per day.
- **Sheet limits.** The Stock formulas cover 200 products and 500 photo-count rows in total.
  The app refuses a save that would not fit. Clear old Claude_Counts rows between stocktakes.
- **Stocktake date.** Counts are filed under Settings!B3. Change it in the Sheet to start a new
  stocktake; the app warns when it is not today.
- **Snap and move on.** With "Save counts as they come in" on (the default), each photo is counted
  in the background and saved without a tap. A row is held for the counter only when something is
  missing that a photo cannot show, such as the pieces in a closed sack. Low-confidence rows are
  saved and flagged CHECK on the Stock screen. Turn the switch off to review every row first.
- **In-app camera.** "Take photos" opens a camera that stays open between shots. Browsers only
  allow it on https (or localhost); elsewhere the card opens the phone's own camera instead.
- **Counting twice adds up.** Two saved photo counts of the same product and place are summed.
  The review screen warns before this happens. Use "Hand count > Correct the count" to replace a
  number.
- **No signal.** Confirmed counts are kept on the phone and sent when the connection returns.
  Reading a photo and saving a product need a connection.

## Tests

```
cd web
npm run test:backend   # runs the real Code.gs against an in-memory sheet
npm test               # app logic
npm run build          # type check and production build
```
