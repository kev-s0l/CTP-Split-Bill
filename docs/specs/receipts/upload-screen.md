---
type: feature
---
# The organizer photographs a receipt, watches it being read, and lands on its items

## Why

Scanning is how every split starts. The organizer takes or picks a photo of
the receipt, sees that it is being read (which can take up to a minute), and
then goes on to check the items. When reading fails, they can try again or
type the items themselves instead of being stuck.

## Where it lives

- apps/web/app/receipts/new/page.tsx: server page; the upload form, with no
  step bar (there is no receipt yet).
- apps/web/app/receipts/new/UploadForm.tsx: client form; file choice,
  client-side checks, the upload request and the redirect.
- apps/web/app/receipts/new/upload.ts: pure form states, the type check and
  the meaning of each upload response.
- apps/web/app/receipts/new/shrink-photo.ts: client; redraws a photo that is
  over the size limit onto a canvas as a smaller JPEG.
- apps/web/app/receipts/[id]/scan/page.tsx: the Scan step. Runs the step
  guard (receipts/flow.md) and renders the scan status.
- apps/web/app/receipts/[id]/scan/ScanStatus.tsx: client; starts parsing,
  polls while another request is parsing, and picks what to show.
- apps/web/app/receipts/[id]/scan/ScanPanel.tsx: the reading, succeeded and
  failed states.
- apps/web/app/receipts/[id]/scan/scan-state.ts: pure mapping from receipt
  detail and parse responses to what the screen shows.
- apps/web/tests/upload-screen.test.ts.
- APIs used, unchanged: `POST /api/receipts` (receipts/upload.md),
  `POST /api/receipts/[id]/parse` (receipts/parse.md) and
  `GET /api/receipts/[id]` (receipts/detail.md).

## Behavior

### Upload (`/receipts/new`)

- The page requires a signed-in user; the middleware sends signed-out
  visitors to `/login` and back (auth/sign-in.md). The home page's New
  receipt action links here.
- Two buttons start it, each opening its own hidden file input that accepts
  `image/jpeg`, `image/png` and `image/webp`:
  - **Take photo** opens the camera directly (`capture="environment"`, the
    back camera). It shows only on touch devices (`pointer: coarse`), since
    elsewhere it would just open the file picker.
  - **Choose from library** has no `capture`, so it opens the photo library
    on a phone and the file picker on a computer. On a computer it is the
    only button.
  - The buttons are real `<button>`s that open their inputs, so both work by
    keyboard and are announced by name; the inputs themselves are not in the
    tab order.
- Nothing is sent when a photo is chosen. The page replaces the buttons with a
  **preview** so the organizer can confirm it's the right receipt and that
  it's readable:
  - the photo, as large as the content column allows and at most 60% of the
    viewport's height, scaled to fit without cropping, with alt text
    "Receipt photo preview";
  - **Scan this receipt**, the primary button, which uploads it;
  - **Choose a different photo**, which brings back Take photo and Choose
    from library; picking a new photo replaces the preview.
- The preview shows the photo as chosen; shrinking happens after **Scan this
  receipt** is pressed. The preview's object URL is released when the photo
  is replaced or the page is left.
- A file that isn't JPEG, PNG or WebP shows "Choose a JPEG, PNG or WebP
  photo" inline instead of a preview, and the two buttons stay.
- **Shrinking:** a photo over 5 MiB is redrawn on a canvas so its longest
  side is at most 2400 px, keeping its orientation, and saved as a JPEG at
  quality 0.85, then 0.7 if it is still over 5 MiB. Photos at or under
  5 MiB are sent unchanged. While it runs, the button reads "Preparing
  photo…". If the result is still over 5 MiB, or the browser can't decode
  the photo, the page shows "This photo is too large. Try a screenshot of
  it." and sends nothing.
- Upload sends one multipart field named `file`. While it runs, the button
  reads "Uploading…", and both buttons are disabled.
- 201: the browser goes to `/receipts/<id>/scan`.
- 400: the API's message is shown inline and the file can be changed.
  503: "Couldn't save the photo. Try again in a moment." with the same file
  kept for a retry. 401: the browser goes to `/login`, returning to
  `/receipts/new`. A network failure shows "Couldn't reach the server. Check
  your connection and try again."
- Errors are announced (`role="alert"`) and focus moves to them.

### Scan (`/receipts/[id]/scan`)

The page renders inside the receipt layout (step bar and mode chip) and runs
the step guard; Scan is always available. What it shows depends on the
receipt's parse status:

| Parse status | Screen |
|---|---|
| NOT_STARTED | Starts parsing at once and shows the reading state |
| PARSING | Reading state; reads the receipt again every 3 seconds until the status changes |
| SUCCEEDED | "Read N items" and a **Check the items** link to `/receipts/<id>/items` |
| FAILED | A destructive `Alert` "We couldn't read this receipt", with **Try again** and **Enter items by hand** (a link to `/receipts/<id>/items`) |

- **Reading state:** a spinning loader with "Reading your receipt…" and
  "Finding the items and totals. This can take up to a minute.", in a
  `role="status"` region. The loader is decorative (`aria-hidden`) and stops
  spinning when the OS asks for reduced motion. The state stays until the
  outcome is known.
- **Starting a parse** sends `{ expectedRevision }` from the receipt the page
  loaded. Outcomes of that request:
  - 200: the browser replaces the URL with `/receipts/<id>/items`.
  - 400 (nothing readable): the FAILED state, with the message "We couldn't
    find any items on this photo."
  - 503 (reading or storage failed): the FAILED state; **Try again** starts a
    new parse with the current revision.
  - 409 (already parsing, stale, or picking open): the page reads the receipt
    again and shows whatever its status now is. It never retries a 409 on
    its own.
  - 401: the browser goes to `/login`, returning to this step.
- **Try again** reads the receipt first, then starts a parse with its current
  revision.
- A parse that has been PARSING for more than five minutes (from the
  receipt's `updatedAt`) is treated as abandoned: polling stops and the
  FAILED state offers **Try again** (receipts/parse.md allows the retry).
- Starting a parse happens once per page visit. A reload while a parse is
  running finds PARSING and polls instead of starting a second one.
- When the outcome is known, the step bar is refreshed so Scan and Items show
  their new states.

## Examples

| State / input | Behavior |
|---|---|
| Phone: Take photo | The back camera opens; the photo taken shows in the preview |
| Computer, open `/receipts/new` | Only Choose from library shows |
| Choose a 2 MB JPEG | Preview with Scan this receipt and Choose a different photo; nothing uploaded yet |
| Press Scan this receipt | 201; lands on `/receipts/<id>/scan`, which shows "Reading your receipt…" |
| Press Choose a different photo and pick another | The preview shows the new photo; nothing uploaded |
| Choose a 7 MB phone photo | Shrunk to a JPEG under 5 MiB, then uploaded |
| A photo still over 5 MiB after shrinking | "This photo is too large…"; no request |
| Choose a PDF | Inline "Choose a JPEG, PNG or WebP photo"; no request |
| Upload while storage is down | "Couldn't save the photo…"; file kept |
| Parse returns 200 | Lands on `/receipts/<id>/items` |
| Parse returns 400 | FAILED alert: Try again, Enter items by hand |
| Reload the scan page mid-parse | Reading state; polls; no second parse request |
| PARSING for six minutes | FAILED alert with Try again |
| Open the Scan step on a SUCCEEDED receipt | "Read 4 items" and Check the items |
| Signed out, open `/receipts/new` | Redirect to `/login?callbackUrl=%2Freceipts%2Fnew` |

## Verify

- pnpm test: upload-screen.test.ts covers the client file checks (type and
  the 5 MiB boundary), the shrink sizing (longest side, aspect ratio, files at
  or under 5 MiB left alone), that choosing a file sends nothing until Scan
  this receipt, the mapping from each parse status and each parse
  response to the screen, abandoned-PARSING detection, and static renders of
  the upload form (Take photo's input has `capture="environment"`, Choose
  from library's has none), the preview, reading, succeeded and failed states.
- pnpm typecheck and pnpm build pass.
- Drill (pnpm dev, signed in, after `pnpm ocr:setup`): choose
  apps/web/tests/fixtures/receipt-ocr.png on `/receipts/new`, check the
  preview, swap it with Choose a different photo and back, then press Scan
  this receipt; the reading
  state shows with its spinner, then the Items step. Upload a photo with no text; the failed
  alert shows, and Enter items by hand opens Items.
- Phone pass at 375px from web.md. On a real phone, Take photo opens the back
  camera and Choose from library opens the photo library; a full-resolution
  photo taken with Take photo is shrunk, uploads and
  is read the right way up.
- Keyboard-only pass: Tab to Choose from library, Enter, choose a file, Tab to Scan
  this receipt, Enter; on failure, focus is on the message and Try again is reachable.

## Constraints & decisions

- Two buttons instead of one input: on a phone, Take photo skips the
  system's camera-or-library menu and makes the camera the obvious path. It
  is hidden without a touch screen because `capture` does nothing there.
- The preview is a confirm step before anything is stored: a wrong or
  blurry photo is replaced for free, while an uploaded one creates a receipt
  that has to be deleted.
- Parsing is started by the Scan page, not by the upload, because the parse
  request can take up to 60 seconds and the organizer should see progress on
  the receipt's own page rather than wait on the upload form.
- One parse per visit plus polling keeps a reload or a second tab from
  starting competing parses; the API's revision guard is the real protection.
- Phone camera photos are often over upload.md's 5 MiB limit, so the
  browser shrinks them instead of rejecting them. 2400 px on the longest side
  keeps receipt text large enough to read. Only oversized photos are
  re-encoded, so a photo that already fits reaches the reader untouched. The
  server's limit stays the authority. The canvas is built into the browser;
  no dependency is added.
- Polling every 3 seconds is enough for a one-minute operation and stops as
  soon as the status leaves PARSING.

## Out of scope

- Cropping, rotating, multiple photos per receipt, replacing the photo, and
  re-scanning a receipt that was read successfully.
- Entering items without a photo; correcting items (receipts/edit.md and
  receipts/items.md, on the Items step).
