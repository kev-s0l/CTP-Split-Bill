---
type: feature
---
# The organizer extracts a stored receipt photo into an unreviewed draft

## Why

The organizer starts corrections from extracted receipt lines and totals
instead of entering every value by hand, then reviews them before splitting.

## Where it lives

- packages/domain/src/receipt-parsing.ts: input validation, extraction
  normalization and owner/revision-scoped parsing transitions.
- packages/services/src/ocr.ts: local image OCR and bounded worker lifetime.
- apps/web/app/api/receipts/[id]/parse/route.ts: POST and storage/OCR orchestration.
- packages/domain/tests/receipt-parsing.test.ts: extraction and transaction tests.
- apps/web/tests/receipts-parse-route.test.ts: real route and PGlite coverage.
- docs/runbooks/receipt-ocr.md: local language-data setup and a real-image drill.

## Behavior

- POST accepts JSON containing expectedRevision (an integer from 1 through
  2147483645, reserving two revision advances). Identity comes from the
  session; missing or unknown users return 401. Invalid JSON or revision
  returns 400. Unknown, foreign, missing and deleted receipts return 404.
- Finalized receipts and stale revisions return 409. An active PARSING receipt
  returns 409. A PARSING attempt older than five minutes can be retried with
  its current revision; the previous attempt loses permission to complete.
- An atomic owner/DRAFT/revision check starts parsing, advances revision,
  records PARSING and clears the previous parser error. This commits before
  image download and OCR; no database transaction spans those operations.
- The endpoint downloads only that receipt's stored image and runs local
  English OCR. The adapter uses Tesseract.js with locally provisioned
  language data. Images are not sent to an external OCR service.
- OCR execution has a 60-second budget; its worker is terminated on success,
  error or timeout. Setup documents any language-data provisioning separately
  from serving requests. Requests perform no language-data downloads.
- Extraction recognizes conservative item-name/line-price pairs and explicitly
  labelled subtotal, tax, tip and total values. Uncertain fields stay null;
  missing unit price or quantity is not invented. Ambiguous metadata stays
  null. Discounts and unsupported layouts require manual correction.
- At least one usable item is required for success. There are at most 500
  items, with unique sequential line numbers and money/quantity values within
  the existing schema bounds. Raw OCR text is internal extraction data.
- Successful completion checks the same owner, receipt, PARSING state and
  attempt revision. In one transaction it replaces items, clears assignments
  and shared allocations, saves extracted fields, clears reviewedAt, records
  SUCCEEDED and advances revision. Participants and the selected payer remain;
  every participant's picksSubmittedAt is cleared (receipts/guest-picks.md).
  Items are unverified; existing review and finalization checks still apply.
- Success returns 200 with receipt detail and revalidates receipt/history
  caches. The response excludes raw extraction, blob names and parser errors.
- On failure after starting, a guarded transaction records FAILED, stores only
  a safe internal error summary and advances revision. Existing receipt fields,
  items, assignments and review data survive; no partial extraction is saved.
- Missing images return 404; no usable extraction returns 400; storage/OCR
  outages and timeouts return 503 INTERNAL. Unexpected failures use generic
  500. Errors never expose OCR internals. The owner reloads the current revision
  before retrying. A superseded attempt cannot overwrite a newer attempt.

## Examples

| State / input | Result |
|---|---|
| Owned draft, current revision, readable photo | 200; unverified extracted items and SUCCEEDED |
| Same revision submitted concurrently | One starts; the other gets 409 |
| Finalized or actively parsing receipt | 409; no new OCR work |
| Photo has no usable item lines | 400; FAILED, existing corrections preserved |
| OCR times out or storage is unavailable | 503; FAILED, no partial data |
| Abandoned PARSING attempt is older than five minutes | Current-revision retry starts a new attempt |
| Previous attempt completes after a retry | Guard rejects it; newer data survives |

## Verify

- Fixture-based tests cover extraction, null fields, malformed/oversized
  results, schema bounds and labelled totals without requiring an OCR service.
- Route tests cover authentication, ownership, deletion, revision/state guards,
  actual persisted extracted values, assignment cleanup, rollback, failure
  preservation, timeout cleanup, abandoned-attempt recovery and competing writes.
- The OCR runbook provisions local English data and parses the checked-in synthetic
  receipt-image fixture, then compares stored items and totals and confirms that
  review remains required. Mock-only OCR tests do not replace this drill.
- pnpm test, pnpm typecheck and pnpm build pass.

## Constraints & decisions

- tesseract.js 7.0.0 provides local OCR without a cloud account.
  pnpm ocr:setup provisions English tessdata_fast 4.1.0 with a pinned SHA-256.
  Its Apache-2.0 source is https://github.com/tesseract-ocr/tessdata_fast.
  The model lives in ignored .ocr/ or absolute RECEIPT_OCR_DATA_DIR.
- A child process bounds OCR initialization and recognition together. Its worker
  is terminated on normal completion; timeout/error kills the entire process.
  The deployment includes the workspace manifest, OCR runner and runtime
  dependencies. Language data is provisioned before requests are served.
- Parsing is synchronous for this endpoint. It does not enqueue work into the
  current worker, which has no receipt handler or retry contract.
- Two short transactions protect the attempt around external work. Revision
  guards prevent an old attempt from overwriting a retried attempt.
- OCR provides a correction starting point, not trusted accounting data.
- No schema change is needed: existing parsing state, extraction, error,
  revision and updatedAt fields represent attempt state and recovery.

## Out of scope

- Cloud OCR, background queue delivery, multilingual extraction, confidence UI,
  automatic review/finalization and changes to financial reconciliation.
- Photo upload: upload.md; image retrieval: image.md; corrections: edit.md and
  items.md; exposing totals differences: totals-check.md.
