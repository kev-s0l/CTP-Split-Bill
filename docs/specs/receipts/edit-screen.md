---
type: feature
---
# The organizer checks and corrects a receipt's items and totals, then confirms them

## Why

Scanning is a starting point, not the truth: names come back wrong, lines go
missing, and totals are often empty. Before anyone picks or pays, the
organizer fixes the restaurant name, the items and the totals on one screen,
sees at a glance whether everything adds up, and confirms it. Typing a whole
receipt by hand after a failed scan is a normal path, so adding items and
filling totals has to be quick, especially on a phone.

## Where it lives

- apps/web/app/receipts/[id]/items/page.tsx: the Items step. Runs the step
  guard (receipts/flow.md) and renders the editor.
- apps/web/app/receipts/[id]/items/ItemsEditor.tsx: client editor; receipt
  fields, item rows, the totals check, Save and Confirm.
- apps/web/app/receipts/[id]/items/receipt-form.ts: pure; form model, field
  checks, cents arithmetic for the totals check, and the request bodies.
- apps/web/app/components/ui/table.tsx: shadcn's `Table` primitive
  (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`,
  `TableCell`), written by hand from the template; no new dependency.
- apps/web/app/receipts/[id]/participants/leave-guard.ts: reused for the
  unsaved-changes prompt.
- apps/web/tests/items-screen.test.ts.
- APIs used, unchanged: `PUT /api/receipts/[id]/items` (receipts/items.md),
  `PATCH /api/receipts/[id]` (receipts/edit.md) and
  `POST /api/receipts/[id]/picking` (receipts/guest-picks.md).

## Behavior

### Receipt fields

- At the top: **Restaurant** (merchantName), first and full width, then
  **Date** (a date picker; purchasedAt).
- Below the items: **Subtotal**, **Tax**, **Tip** and **Total**, as money
  inputs (`inputmode="decimal"`, a `$` prefix).
- Empty is allowed for every field while editing. A non-empty money field
  must be a nonnegative amount with at most two decimals ("Enter an amount
  like 12.50"); the restaurant name is at most 200 characters. Messages show
  under the field after it loses focus, and on Save for every field.
- A chosen date is saved as noon UTC that day, so it shows the same date in
  every time zone.

### Items

- At `md:` and up the items are a `Table` with columns Item, Qty, Price and
  a remove button; each input is labelled by its column for screen readers. Below `md:`, each item is a stacked block (Item on its own
  line, then Qty and Price side by side, then Remove), with no horizontal
  scroll at 375px.
- **Price** is the line's total (what the receipt prints at the end of the
  line). **Qty** defaults to 1 for a new item.
- **+ Add item** adds an empty row at the end and focuses its name. Enter in
  a row's Price field adds the next row, so a receipt can be typed straight
  through. An empty list shows `EmptyState` "No items yet" with an **Add
  item** button.
- **Remove** deletes the row at once, with no dialog: nothing is saved until
  Save, and focus moves to the next row's name (or Add item).
- Each row needs a name (at most 200 characters), a quantity greater than 0
  with at most three decimals, and a price. A completely empty row (no name,
  no price) is dropped on Save instead of being an error.
- Row order is the receipt's order; Save numbers the lines 1, 2, 3… in that
  order.

### The totals check

- A panel under the totals fields updates as the organizer types, computed
  in integer cents from the form (not from the last save):
  - **Items** add up to $X. Next to Subtotal: "Matches", "Items are $2.50
    short of the subtotal" or "Items are $2.50 over the subtotal".
  - **Subtotal + tax + tip** (empty tip counts as 0) next to Total:
    "Matches" or "$1.00 short" / "$1.00 over".
- When Subtotal is empty and there is at least one priced item, a **Use items
  total** button fills it. When Total is empty and Subtotal and Tax are
  filled, a **Use subtotal + tax + tip** button fills it.
- The panel is a polite live region, so a screen reader hears the result
  after a change.

### Save and Confirm

- **Save** stores the corrections without confirming. **Confirm items**
  stores them and confirms them, which is what makes the People step
  available.
- **Confirm items** is always enabled (except while saving or read-only).
  Pressing it checks first, without a request: the form must be valid, have
  at least one item, have Subtotal, Tax and Total filled, and both totals
  checks must say "Matches". If not, nothing is sent; the reasons show in an
  alert above the buttons ("Add at least one item", "Fill in the subtotal,
  tax and total", "Items don't add up to the subtotal yet", "Subtotal + tax
  + tip doesn't match the total yet", and "Fix the highlighted fields") and
  focus moves to the first field with a problem. The server's check is still
  the authority; a 400 shows its message.
- Both send the known revision. When the items changed, the items are sent
  first (`PUT .../items`), then the fields with the new revision (`PATCH`,
  with `reviewConfirmed: true` for Confirm). When only the fields changed,
  only the PATCH is sent. A request that would change nothing is not sent:
  Save is disabled until something changes.
- A unit price is not shown; it is saved as the price divided by the
  quantity, rounded to the cent (receipts/items.md: the line total is
  authoritative).
- After Save: a "Saved" toast, the form resets to the saved receipt, and the
  step bar refreshes. After Confirm: the browser goes to
  `/receipts/<id>/participants`.
- While saving, both buttons are disabled and the active one reads
  "Saving…".
- **409** (the receipt changed elsewhere, or picking was opened): "This
  receipt changed somewhere else. Reload to see the latest." with a
  **Reload** button; the draft is kept until Reload. **400**: the API's
  message. **401**: the browser goes to `/login`, returning here. A network
  failure keeps the draft and says so.
- If the items were saved but the field update then fails, the form keeps
  the saved items and the new revision, and shows the field error; Save
  again sends only the fields.
- A confirmed receipt shows "Confirmed" beside the buttons. Saving a change
  to it clears the confirmation (receipts/edit.md, receipts/items.md); the
  page says "Changing items or totals means confirming them again." whenever
  the receipt is confirmed and the form has changes.
- Leaving with unsaved changes asks first (the participants screen's leave
  guard, with its own message).

### Read-only states

- **Picking open:** the form renders read-only with a banner "Picking is
  open. Pause it to make changes." and a **Pause picking** button, which
  sends `{ open: false }` and then reloads the page's data (receipts/flow.md,
  "Mode chip and banners").
- **Finalized:** read-only with no banner and no buttons.

## Examples

| State / input | Behavior |
|---|---|
| Failed scan, no items | "No items yet" with Add item |
| Type Pad Thai, 1, 14.00, press Enter | A new empty row, focused |
| Items 61.50, subtotal 64.00 | "Items are $2.50 short of the subtotal" |
| Press Confirm items while items are short | No request; "Items don't add up to the subtotal yet"; focus on Subtotal |
| Subtotal empty, items 64.00 | Use items total fills 64.00 |
| Everything matches, press Confirm items | PUT items, PATCH with reviewConfirmed; lands on People |
| Change only the restaurant name, press Save | One PATCH; "Saved" |
| Save from a tab with an older revision | Conflict message with Reload; draft kept |
| Price "12.345" | "Enter an amount like 12.50" under the field |
| An empty row left at the end | Dropped on Save |
| Picking open | Read-only with the pause banner |
| Phone at 375px | Stacked item blocks; no horizontal scroll |

## Verify

- pnpm test: items-screen.test.ts covers the field and row checks, dropping
  empty rows, line numbering, unit price derivation, the cents arithmetic
  and both checks' wording (short, over, matches, empty tip), Confirm's
  pre-check (each reason, and which field gets focus), the Table
  primitive's slots, which requests Save and Confirm send for
  items-only, fields-only and both changes, and static renders of the empty,
  filled, mismatched, picking-open and finalized states.
- pnpm typecheck and pnpm build pass.
- Drill (pnpm dev, signed in): on a receipt after a failed scan, type three
  items with Enter, fill Subtotal with Use items total, fill Tax, Tip and
  Total, Confirm; People opens. Back on Items, edit a price and reload
  without saving; the leave prompt shows. Save from a second, older tab;
  the conflict message shows.
- Phone pass at 375px from web.md, and a keyboard-only pass through the
  fields, adding and removing rows, and Confirm.

## Constraints & decisions

- The totals check runs on the client from the form so it reacts while
  typing; it uses the same cents rule as review confirmation
  (receipts/edit.md, receipts/totals-check.md), and the server re-checks.
- Two requests instead of one, because items and fields are separate
  APIs. Items go first so a Confirm validates the new items. The pair is
  not atomic; the partial-failure path keeps what was saved.
- One Price per line instead of unit price and total: the receipt prints the
  line total, and items.md treats it as authoritative.
- Confirm stays enabled and explains on press rather than being disabled:
  a disabled button can't be focused or tapped to find out why, and screen
  readers may skip it. The live totals check shows the state before then.
- `Table` is a layer-1 primitive in components/ui (docs/specs/components.md)
  so later screens reuse it.
- Removing a row has no dialog because nothing is lost until Save, and the
  leave guard covers abandoning the page.
- Title and address are editable through the API but not on this screen;
  the restaurant name is what the organizer and guests see.

## Out of scope

- Assigning or splitting items (the Picks step), finalizing (the Finalize
  step), and the payer and split mode.
- Re-scanning, editing the photo, or showing the photo beside the form.
- Discount or fee lines as their own type; they are entered as items.
