---
type: feature
---
# The organizer sees what each person owes and finalizes the receipt on purpose

## Why

Finalizing creates the bills, and a finalized receipt can't be edited. Before
that, the organizer sees what each person will owe, whether the receipt adds
up, and who has finished picking, then confirms on purpose rather than by a
stray tap.

## Where it lives

- apps/web/app/receipts/[id]/finalize/page.tsx: server page, the Finalize
  step. Runs the step guard, then renders the summary section inside a
  Suspense boundary. The section reads the receipt through the layout's
  cached `getReceipt`, and either `previewReceipt` (draft) or
  `listReceiptBills` (finalized) from packages/domain.
- apps/web/app/receipts/[id]/finalize/error.tsx: segment error boundary
  rendering `ErrorState`.
- apps/web/app/receipts/[id]/finalize/summary.ts: pure mapping from receipt
  detail plus preview allocations (or bills) to display rows, the readiness
  label, the mismatch sentences and the confirmation text. Unit-tested.
- apps/web/app/receipts/[id]/finalize/SummaryTable.tsx: the "Who owes what"
  table, stacked below `md:`.
- apps/web/app/receipts/[id]/finalize/FinalizePanel.tsx: client leaf. The
  Finalize / Pause picking and finalize button, the confirmation
  `AlertDialog` and the request errors.
- packages/domain/src/totals.ts and receipt.ts: the `totals` object on
  receipt detail, as receipts/totals-check.md describes.
- packages/db/src/seed.ts: one reviewed, mismatched draft receipt for the
  drill.
- apps/web/tests/finalize-screen.test.ts.
- Writes go through the existing routes: POST
  `/api/receipts/[id]/picking` with `{ open: false }`
  (receipts/guest-picks.md) and POST `/api/receipts/[id]/finalize`
  (bills/split-allocation.md).

## Behavior

### Loading and access

- The page is at `/receipts/[id]/finalize`, inside the receipt layout's step
  bar and mode chip (receipts/flow.md). Signed-out visitors go to `/login`
  and return here. A foreign, unknown or deleted receipt renders the
  not-found page.
- The step guard runs first: while Picks isn't done, the page redirects
  (307) to the furthest available step.
- While the summary loads it shows `LoadingState`. A failed read shows
  `ErrorState`; "Try again" refetches.

### Draft receipt that adds up

- The page heading is "Review and finalize".
- A table titled "Who owes what" has one row per participant, in the
  preview's order (joinedAt, then id): name, Items (subtotal), Tax, Tip and
  Owes. A last row, "Total", sums each column; Owes sums to the receipt
  total. Amounts are formatted in the receipt's currency.
- Below `md:` each person is a stacked row: the name and Owes on the first
  line, "Items $x · Tax $y · Tip $z" muted under it. The Total row shows
  only the Owes sum.
- Unless the split mode is EVEN, each row carries a readiness `Badge`, from
  the receipt detail's participants:
  - "Done picking": `picksSubmittedAt` is set.
  - "Still picking": has a pick link, not done.
  - "No link": neither.
- The organizer's row carries a "You" badge in place of readiness, in every
  split mode.
- Readiness is information only. It never disables Finalize; the step guard
  already requires every item to be covered.
- The amounts are the ones finalization will bill: the page calls the same
  `previewReceipt` the preview route uses, with the revision it just read.

### Draft receipt that doesn't add up

- When `totals.reconciled` is false, the table is replaced by a destructive
  `Alert` titled "This receipt doesn't add up", with one sentence per
  non-zero difference, signed so it says short or over:
  - "The items are $2.50 short of the subtotal." /
    "The items are $2.50 over the subtotal."
  - "Subtotal, tax and tip are $1.00 short of the total." / "… over the
    total."
  - A null difference reads "Some item prices or amounts are missing."
- The alert ends with a **Fix the items** link to `/receipts/[id]/items`.
  Finalize is disabled, with "Fix the totals first" under it.
- When the preview is rejected for any other reason (400), the same alert
  shows the API's message instead of the difference sentences.

### Finalizing

- With picking paused, the button reads **Finalize**. With picking open it
  reads **Pause picking and finalize**: it sends `{ open: false }` to the
  picking route, refreshes the page (the chip changes to "Editing" and the
  amounts are read again, since guest picks may have changed them), then
  opens the confirmation. If the pause fails, the API's message shows above
  the button and no dialog opens.
- The confirmation is an `AlertDialog`: title "Finalize this receipt?", body
  "This creates N bills totaling $X. The receipt can't be edited after
  this." with **Cancel** and **Finalize**. N and $X come from the amounts on
  screen when it opens.
- Confirming sends the revision the page rendered. While it is in flight
  both dialog buttons are disabled and Escape does nothing.
- On success the page toasts "Receipt finalized" and navigates to `/`, where
  the new bills appear.
- On failure the dialog closes and the API's message shows above the
  button. A 409 (the receipt changed, or picking was reopened elsewhere)
  also offers **Reload**, which refreshes the page. A network failure says the server could not be
  reached. Nothing is retried automatically.

### Finalized receipt

- The page renders read-only: heading "Finalized", a line "Finalized on
  <date>", and the same table built from the stored bills. No readiness
  badges, no button, no mode chip (receipts/flow.md).

### Layout

- Organizer page, desktop-first, meeting web.md's mobile standard: no
  horizontal scroll at 375px, 44px targets, the table stacked below `md:`.
- Keyboard: Tab reaches Fix the items, the button and Reload. The dialog
  traps focus, opens on Cancel, and Escape (when idle) closes it and
  returns focus to the button.

## Examples

| State / input | Behavior |
|---|---|
| EVEN, 10.00, three people, picking paused | Rows owe 3.34 / 3.33 / 3.33; no badges; button "Finalize" |
| ITEMIZED, Maya done, Sam has a link and isn't done | Maya "Done picking", Sam "Still picking"; Finalize enabled |
| Picking open, press the button | Picking paused, chip reads "Editing", then the dialog opens |
| Pause returns an error | Message above the button; no dialog |
| Confirm with matching revision | Toast "Receipt finalized"; lands on `/` with the bills |
| Confirm after the receipt changed in another tab | Dialog closes; "Receipt has changed…" with Reload |
| Items 61.50, subtotal 64.00 | Alert "The items are $2.50 short of the subtotal."; Finalize disabled |
| One item with no price | Alert "Some item prices or amounts are missing." |
| Finalized receipt | "Finalized on …", bill amounts, no button |
| New receipt, open `/receipts/[id]/finalize` | 307 to scan or items |
| Foreign receipt id | Not-found page |

## Verify

- pnpm test (finalize-screen.test.ts) covers the row mapping and totals
  row, each readiness label and the organizer row, every mismatch sentence
  (short, over, null), the confirmation text, and static renders of the
  table, the mismatch alert, both button labels and the finalized view.
  The `totals` fields are covered as receipts/totals-check.md's Verify says.
- pnpm typecheck and pnpm build pass.
- Drill (pnpm dev, signed in): finish a seeded receipt through Picks, open
  picking, press Pause picking and finalize, confirm; the bills list shows
  its bills. Then open the seeded mismatched receipt (packages/db/src/seed.ts
  adds a reviewed receipt whose items are 2.50 short of its subtotal, since
  the editor can't produce one); it shows the alert and a disabled button.
- Phone pass at 375px from web.md, and a keyboard-only pass through opening,
  cancelling and confirming the dialog.

## Constraints & decisions

- The page calls `previewReceipt` in-process rather than fetching its own
  `/api/receipts/[id]/preview` route; it is the same function, so the
  amounts shown are still the amounts billed (bills/preview.md).
- No "finalize anyway": a receipt that doesn't add up can't be finalized
  (receipts/totals-check.md). Because content edits clear `reviewedAt` and
  review requires the totals to reconcile, the mismatch alert is a
  safeguard; the normal path never reaches it.
- Readiness doesn't block finalizing: the organizer may finalize for a guest
  who never pressed done, since coverage is already required.
- Pausing, not the confirmation, refreshes the amounts, so the dialog never
  names a total that guest picks have since changed.

## Out of scope

- Editing from this screen, and reopening a finalized receipt.
- Live updates of readiness or amounts while picking is open; the page reads
  them on load and when pausing.
- Bill detail and marking bills paid (bills/list-screen.md).
