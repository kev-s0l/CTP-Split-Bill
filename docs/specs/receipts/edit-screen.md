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

- Under the heading "Check the items", the subtitle says "Fix anything the
  scan got wrong, then confirm." After a failed scan it says "The scan
  couldn't read this one. Type the lines from the receipt, then confirm."
- At the top: **Restaurant** (merchantName), first and full width, then
  **Date** (a date picker; purchasedAt).
- Below the items: **Subtotal**, **Tax**, **Tip** and **Total**, as money
  inputs (`inputmode="decimal"`, a `$` prefix). Money inputs, including
  Line total, have no placeholder, so an empty field never looks filled.
- Money and quantities are right-aligned in tabular figures, in the inputs
  and their table headers, so the columns line up like the paper receipt.
  Line total has the same `$` prefix as the totals.
- When a money field loses focus, a valid amount is tidied to grouped
  dollars and cents: "1024", "$1,024" and "1,024" all show as "1,024.00".
  Nothing changes while typing, and text that isn't an amount is left as
  typed. Amounts shown elsewhere (the totals check, the each hint, values
  loaded from the receipt) use the same "1,024.00" form.
- Empty is allowed for every field while editing. A non-empty money field
  must be a nonnegative amount with at most two decimals ("Enter an amount
  like 12.50"). A leading `$` and thousands commas are accepted as typed
  from a receipt ("$1,234.50"); a comma anywhere else is an error. What is
  saved is the plain amount ("1234.50"); the restaurant name is at most 200 characters. Messages show
  under the field after it loses focus, and on Save for every field.
- A chosen date is saved as noon UTC that day, so it shows the same date in
  every time zone.

### Items

- At `md:` and up the items are a `Table` with columns Item, Qty, Line
  total and a remove button; each input is labelled by its column for
  screen readers. Below `md:`, the items are a receipt-style list with no
  header and no cards: two lines per item, with a rule above the first
  item, between items and after the last one.
  - Line 1: the name (with "Item" as its placeholder) and its remove button.
  - Line 2 reads like receipt math: the quantity field with "Qty" inside
    it, then, when Qty is not 1, the price of one ("× $2.40 ="), then the
    line total with its `$` prefix: "Qty 10 × $2.40 = $24.00". A Qty of 1
    shows just "Qty 1" and the line total.
  - Every input keeps its screen-reader label ("Qty (item 2)"). No
    horizontal scroll at 375px.
- **Line total** is what the whole line costs, the number the receipt
  prints at the end of the line: Qty 10 with Line total 24.00 is ten items
  for $24.00 together. **Qty** defaults to 1 for a new item.
- When a row's Qty is not 1 and both Qty and Line total are valid, the price
  of one is the line total divided by the quantity, rounded to the cent. On
  phones it shows inline ("× $2.40 =", above); from `md:` up it shows under
  the line total as "10 × $2.40 each". Either way, the Line total input is
  described by "10 × $2.40 each" for screen readers. A Qty of 1 shows
  neither.
- Changing Qty keeps the Line total and updates the hint; nothing is
  recalculated behind the organizer's back.
- **+ Add item** adds an empty row at the end and focuses its name. Enter
  moves through a row: Item → Qty → Line total, and Enter in Line total adds
  the next row, so a receipt can be typed straight through. Phone keyboards
  show "next" on the Enter key for these fields. An empty list shows `EmptyState` "No items yet" with an **Add
  item** button; it is the same focus target as **+ Add item** (for "Add at
  least one item", and after removing the last row).
- **Remove** is a 44×44px × icon button named "Remove <item name>" (or
  "Remove item 3") for screen readers. It deletes the row at once, with no
  dialog, and shows a toast "Removed <item name>" with **Undo** for 6
  seconds; Undo puts the row back at its old position with everything typed
  in it. Removing a row with no name and no line total shows no toast.
  Removal is otherwise local: nothing is saved until
  Save, and focus moves to the next row's name (or Add item).
- Each row needs a name (at most 200 characters), a quantity greater than 0
  with at most three decimals, and a line total. A completely empty row (no
  name, no line total) is dropped on Save instead of being an error.
- Row order is the receipt's order; Save numbers the lines 1, 2, 3… in that
  order.

### The totals check

- A panel under the totals fields updates as the organizer types, computed
  in integer cents from the form (not from the last save):
  - **Items** add up to $X, compared with Subtotal.
  - **Subtotal + tax + tip** (empty tip counts as 0), compared with Total.
  - At the right end of each line, a green check (✓) when it matches, or
    how far off it is followed by a red cross (✗), so the marks line up at
    the panel's edge: "Items are $2.50 short of the subtotal" / "over the
    subtotal", or "$1.00 short of the total" / "$1.00 over the total". Nothing shows while a part
    is missing. The icons are decorative; a screen reader hears "Matches" or
    the short/over text.
- When Subtotal is empty and there is at least one priced item, a **Use items
  total** button fills it. When Total is empty and Subtotal and Tax are
  filled, a **Use subtotal + tax + tip** button fills it.
- When both checks match and there is at least one item, the panel's
  border turns brand-colored and a line above the two checks says
  "Everything adds up: $16.00" (the total), with "Confirm items, then add
  who was at the table." under it.
- Only the result lines are a polite live region; the Use buttons sit
  below it, outside the region, so a screen reader hears the result
  after a change.

### Save and Confirm

- Save and Confirm items sit in an **action bar** that sticks to the
  bottom of the screen while the page scrolls, at every width. "Confirmed"
  and the reconfirm note also live in the bar. The bar does not repeat the
  totals check; whether things add up is shown once, in the totals panel.
- **Save** stores the corrections without confirming. **Confirm items**
  stores them and confirms them, which is what makes the People step
  available.
- **Confirm items** is always enabled (except while saving or read-only).
  Pressing it checks first, without a request: the form must be valid, have
  at least one item, have Subtotal, Tax and Total filled, and both totals
  checks must match (✓). If not, nothing is sent; the reasons show in an
  alert between the Items and Totals sections, so it stays in view when
  focus moves to Subtotal or Total ("Add at least one item", "Fill in the subtotal,
  tax and total", "Items don't add up to the subtotal yet", "Subtotal + tax
  + tip doesn't match the total yet", and "Fix the highlighted fields") and
  focus moves to the first field with a problem. The server's check is still
  the authority; a 400 shows its message.
- Both send the known revision. When the items changed, the items are sent
  first (`PUT .../items`), then the fields with the new revision (`PATCH`,
  with `reviewConfirmed: true` for Confirm). When only the fields changed,
  only the PATCH is sent. A request that would change nothing is not sent:
  Save is disabled until something changes.
- The unit price is not an input; it is saved as the line total divided by
  the quantity, rounded to the cent, the same value the hint shows (receipts/items.md: the line total is
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
- A confirmed receipt shows "Confirmed" with a check, in the brand color,
  beside the buttons. Saving a change
  to it clears the confirmation (receipts/edit.md, receipts/items.md); the
  page says "Changing items or totals means confirming them again." whenever
  the receipt is confirmed and the form has changes.
- Toasts on this screen ("Saved", "Removed …") appear at the top center, so
  they never cover the sticky action bar.
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
| Qty 10, Line total 24 | "× $2.40 =" between the fields on phones, "10 × $2.40 each" under the line total from md up; items add 24.00 |
| Change that Qty to 12 | Line total stays 24.00; "12 × $2.00 each" |
| Line total "$1,024" with Qty 2 | Accepted; shows "1,024.00" after leaving the field; saved as 1024.00; "2 × $512.00 each" |
| A failed scan | Subtitle: "The scan couldn't read this one. Type the lines from the receipt, then confirm." |
| Line total "12.345" | "Enter an amount like 12.50" under the field |
| An empty row left at the end | Dropped on Save |
| Items 13.00 = subtotal, 13 + 1 + 2 = total 16.00 | "Everything adds up: $16.00" with the next step; brand-colored border |
| Picking open | Read-only with the pause banner |
| Phone at 375px, Chicken Qty 10 for 24.00 | Line 2 reads "Qty 10 × $2.40 = $ 24.00"; the action bar stays at the bottom while scrolling; no horizontal scroll |
| Tap × on Tea | Tea disappears; "Removed Tea" with Undo at the top; Undo puts it back where it was |

## Verify

- pnpm test: items-screen.test.ts covers the field and row checks, dropping
  empty rows, line numbering, unit price derivation and the "each" hint (shown only
  for a valid Qty other than 1), the cents arithmetic
  and both checks' wording (short, over, matches, empty tip), Confirm's
  pre-check (each reason, and which field gets focus), the Table
  primitive's slots, which requests Save and Confirm send for
  items-only, fields-only and both changes, and static renders of the empty,
  filled, mismatched, picking-open and finalized states.
- pnpm typecheck and pnpm build pass.
- Drill (pnpm dev, signed in): on a receipt after a failed scan, type three
  items with Enter, fill Subtotal with Use items total, fill Tax, Tip and
  Total, Confirm; People opens. Back on Items, edit a line total and reload
  without saving; the leave prompt shows. Save from a second, older tab;
  the conflict message shows.
- Phone pass at 375px from web.md, and a keyboard-only pass through the
  fields, adding and removing rows, and Confirm.

## Constraints & decisions

- The totals check runs on the client from the form so it reacts while
  typing; it uses the same cents rule as review confirmation
  (receipts/edit.md), and the server re-checks.
- Two requests instead of one, because items and fields are separate
  APIs. Items go first so a Confirm validates the new items. The pair is
  not atomic; the partial-failure path keeps what was saved.
- The organizer enters the line total, not a unit price: receipts print
  the line total (sometimes with "10 @ 2.40" beside it), the scan returns
  line totals, and items.md treats the line total as authoritative. A
  computed, read-only total, as invoicing tools use, would add a field to
  every row on a phone and couldn't match a receipt whose line total isn't
  exactly Qty × unit price. The column says "Line total" and the "each"
  hint shows the price of one, so a per-unit misreading is visible at once.
- Splitting a line by quantity ("I had 2 of the 3") belongs to the Picks
  step, not this screen.
- Confirm stays enabled and explains on press rather than being disabled:
  a disabled button can't be focused or tapped to find out why, and screen
  readers may skip it. The live totals check shows the state before then.
- `Table` is a layer-1 primitive in components/ui (docs/specs/components.md)
  so later screens reuse it.
- The action bar is sticky so Save and Confirm stay in reach while a long
  receipt is typed on a phone; it is the only copy of the buttons. It
  carries no totals status of its own, since that would only repeat the
  totals panel.
- Removing a row has an undo toast, not a confirmation dialog: deliberate
  removals stay one tap, and a mis-tap is recoverable. Nothing is lost
  until Save, and the leave guard covers abandoning the page.
- This screen's toasts sit at the top because a bottom toast would cover
  Confirm items in the sticky bar and take a tap meant for it.
- Title and address are editable through the API but not on this screen;
  the restaurant name is what the organizer and guests see.

## Out of scope

- Assigning or splitting items (the Picks step), finalizing (the Finalize
  step), and the payer and split mode.
- Re-scanning, editing the photo, or showing the photo beside the form.
- Discounts. Line totals are nonnegative (receipts/items.md) and the split
  does not model discounts (bills/split-allocation.md), so a receipt with a
  printed discount line cannot reconcile on this screen yet. A service fee
  or other positive charge is entered as an ordinary item.
