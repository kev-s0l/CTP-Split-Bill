---
type: feature
---
# The organizer moves through a receipt one step at a time, at one URL per step

## Why

Splitting a receipt only works in order: the items must be right before
people pick them, and the roster must exist before anyone has a link. Each
screen has its own URL so the organizer can reload, go back, or share a link
with themselves, and a step bar shows where they are and what is left. A step
that isn't ready can't be reached, by button or by URL.

## Where it lives

- apps/web/app/receipts/new/page.tsx: upload. On success it redirects to the
  receipt's scan step.
- apps/web/app/receipts/[id]/layout.tsx: server layout. Reads the receipt
  once through `getReceipt` (packages/domain) wrapped in React `cache()`, so
  the step page reuses the same read, and renders the step bar and the mode
  chip above the page.
- apps/web/app/receipts/[id]/page.tsx: redirects to the furthest available
  step.
- apps/web/app/receipts/[id]/StepBar.tsx: client step bar. Uses `usePathname`
  for the current step; takes step states as props.
- apps/web/app/receipts/[id]/{scan,items,participants,picks,finalize}/page.tsx:
  the step pages. Each one calls the step guard before rendering. A step
  whose screen isn't built yet renders a placeholder that runs the guard and
  says the screen is coming.
- apps/web/app/receipts/[id]/step-guard.ts: `requireStep(receipt, step)`,
  which redirects when the step isn't available.
- packages/domain/src/steps.ts: `receiptSteps(detail)`, pure, with no database
  import. Client code imports it as `@project/domain/steps`, following the
  `@project/domain/contact` export.
- apps/web/tests/receipt-steps.test.ts and apps/web/tests/receipt-flow.test.ts.

## Behavior

### Routes

| Route | Screen |
|---|---|
| `/login` | Sign in (docs/specs/auth/sign-in.md) |
| `/` | Bills list |
| `/receipts/new` | Upload |
| `/receipts/[id]` | Redirects to the furthest available step |
| `/receipts/[id]/scan` | Reading the receipt and parse failures |
| `/receipts/[id]/items` | Edit merchant, date, items, tax and tip |
| `/receipts/[id]/participants` | People and pick links |
| `/receipts/[id]/picks` | Picks board and assignments |
| `/receipts/[id]/finalize` | Totals check, preview and finalize |
| `/p/[token]` | Guest picks, then the split (no step bar, no account) |
| `/g/[token]` | Group link: a guest claims their name (no step bar, no account) |

- Every `/receipts/...` route requires a signed-in user; the middleware sends
  signed-out visitors to sign in. A foreign, unknown or deleted receipt
  renders the not-found page, never a permission message.
- Route segments are lowercase nouns. A new receipt screen gets a new segment
  under `/receipts/[id]/` and a row in this table.

### Steps

A draft receipt has five steps, in this order. `receiptSteps` derives each
step's state from receipt detail; no progress is stored.

| Step | Route | Available when | Done when |
|---|---|---|---|
| Scan | `scan` | always | parse status is SUCCEEDED, or FAILED and `reviewedAt` is set |
| Items | `items` | parse status is not NOT_STARTED or PARSING | `reviewedAt` is set |
| People | `participants` | Items is done | at least one saved participant besides the organizer |
| Picks | `picks` | People is done | every item is covered for the split mode (below) |
| Finalize | `finalize` | Picks is done | the receipt is FINALIZED |

- After a FAILED scan, Items is available before Scan is done, so the
  organizer can enter the items by hand. The Scan page shows the failure and
  links to Items; once the items are reviewed, Scan shows as done.
- Picks coverage follows bills/split-allocation.md: EVEN needs no
  assignments; ITEMIZED needs one assignee per item; SHARED_ITEMS needs one
  assignee or at least two shared participants per item.
- Each step is one of: **done**, **current** (available and not done),
  **locked** (not available).
- The state is derived again on every read. An earlier change that undoes a
  later step shows that step as not done: replacing items clears `reviewedAt`
  and every guest's done state, so Items, Picks and Finalize all show as not
  done until the organizer reviews again.

### Gating

- A step page whose step is locked redirects (307) to the furthest available
  step. A deep link to `/receipts/[id]/finalize` on a new receipt lands on
  `/receipts/[id]/items` or `/receipts/[id]/scan`.
- Going back to any earlier step is always allowed.
- `/receipts/[id]` redirects to the first step that is available and not
  done, or to Finalize when every step before it is done.
- A FINALIZED receipt shows every step as done. Its step pages render
  read-only.

### Mode chip and banners

- Next to the step bar, a chip shows the receipt's picking mode: "Editing" or
  "Picking open" (docs/adr/0017-group-pick-link.md). A finalized receipt
  shows no chip.
- While picking is open, the Items and People pages render read-only, with a
  banner "Picking is open. Pause it to make changes." and a **Pause picking**
  button. Pick-link actions on People stay available.
- While picking is open, Finalize's button reads **Pause picking and
  finalize**. It pauses picking first, then opens the confirmation.

### Step bar

- At phone widths the bar shows "Step 3 of 5 · People" with **Back** and
  **Next** buttons. From `md:` up it lists all five steps with their state.
- Done and current steps are links. A locked step is plain text with
  `aria-disabled="true"`, never a link.
- When the next step is locked, **Next** is disabled and says why under it:
  "Wait for the scan to finish", "Review the items first", "Add someone
  besides you", "Assign every item".
- The current step has `aria-current="step"`.
- A step screen that saves something the step rules read refreshes the
  layout, so the bar updates without a reload.
- The bar meets web.md's mobile standard: 44px targets, no horizontal scroll
  at 375px, and every control reachable by keyboard.

## Examples

| State / input | Behavior |
|---|---|
| New receipt, parse in progress, open `/receipts/[id]/finalize` | 307 to `/receipts/[id]/scan` |
| Parse succeeded, not reviewed, open `/receipts/[id]` | 307 to `/receipts/[id]/items` |
| Parse failed, not reviewed, open `/receipts/[id]` | 307 to `/receipts/[id]/scan`; Items is available from there |
| Parse failed, items entered by hand and reviewed | Scan and Items show as done |
| Reviewed, roster is only the organizer | People current; Picks locked; Next says "Add someone besides you" |
| ITEMIZED, one item unassigned | Picks current; Finalize locked |
| EVEN, reviewed, two participants | Picks done; Finalize current |
| On Finalize, organizer replaces items from Items | Items, Picks and Finalize show not done |
| Picking open, open `/receipts/[id]/items` | Page renders read-only with the pause banner |
| Phone at 375px | "Step 3 of 5 · People" with Back and Next; no horizontal scroll |
| Foreign receipt id | Not-found page |

## Verify

- pnpm test: receipt-steps.test.ts covers every row of the step table, each
  split mode's coverage rule, and invalidation after items are replaced.
  receipt-flow.test.ts covers the guard's redirect target for each locked step
  and the `/receipts/[id]` redirect.
- pnpm typecheck and pnpm build pass.
- Drill (pnpm dev, signed in): on a new receipt, paste
  `/receipts/[id]/finalize` into the address bar; it lands on the scan or
  items step. Complete each step; the bar updates without a reload.
- Phone pass at 375px from web.md, and a keyboard-only pass through the step
  bar (Tab reaches Back, Next and every step link; locked steps are skipped).

## Constraints & decisions

- Progress is derived, not stored, so it can never disagree with the receipt.
  docs/adr/0018-organizer-row-polling-and-receipt-steps.md records the step
  model.
- Gating is on the server, in each step page, so a URL can't skip a step. The
  bar's disabled states are a convenience on top of that, not the guard.
- A failed scan counts as done once the items are reviewed, rather than
  when the organizer picks "enter by hand", because that choice would have
  to be stored and progress is derived.
- Placeholder step pages let the bar, the guard and the redirects work end
  to end before every screen exists; each screen's PR replaces its
  placeholder.
- The participants route keeps its existing `participants` segment; the step
  is labeled "People" in the bar.
- `receiptSteps` lives in the domain package with no database import so the
  server guard and the client bar can't disagree.

## Out of scope

- What each step's screen contains; each screen has its own spec
  (receipts/participants-screen.md, receipts/guest-picks.md,
  receipts/edit-screen.md, and the upload, picks and finalize screen specs
  as they are written).
- The picking/editing switch's API and data: receipts/guest-picks.md and
  bills/allocations.md, as updated for ADR-0017. The organizer row:
  receipts/participants.md, as updated for ADR-0018.
- Navigation for finalized receipts beyond read-only steps, such as a bill
  detail page.
