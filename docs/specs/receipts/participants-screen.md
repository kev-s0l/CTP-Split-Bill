---
type: feature
---
# The organizer edits who is splitting a receipt and sends each person a pick link

## Why

Before splitting, the organizer lists who was at the table, adding contact
details only for people they will send a link to. From the same list they
text, email or copy each person's pick link, so guests can choose their own
items (receipts/guest-picks.md) without the app sending anything itself.

## Where it lives

- apps/web/app/receipts/[id]/participants/page.tsx: server page. Derives the
  session user, reads the receipt through `getReceipt` (packages/domain), and
  renders the roster section inside a Suspense boundary.
- apps/web/app/receipts/[id]/participants/error.tsx: segment error boundary
  rendering `ErrorState`.
- apps/web/app/receipts/[id]/participants/ParticipantsEditor.tsx: client
  roster editor, remove confirmation and link actions.
- apps/web/app/receipts/[id]/participants/roster.ts: the row model, field
  checks, dirty check and the PUT body, kept pure so they are unit-tested.
- apps/web/app/lib/pick-link-share.ts: pure builders for the `sms:` and
  `mailto:` hrefs and the shared message text.
- packages/domain/src/contact.ts: `normalizePhone` and `normalizeEmail`, moved
  unchanged out of participants.ts into a module with no database import, so
  the editor validates with the same rules the API applies. Client code
  imports it as `@project/domain/contact` (a package export); the package
  root would pull in the database client.
- apps/web/app/components/ui/: shadcn `alert-dialog`, `input` and `label`,
  generated from the `radix-ui` package already installed (no new dependency).
- apps/web/tests/participants-screen.test.ts and participants-page.test.ts
  (page access).
- Writes go through the existing routes: PUT
  `/api/receipts/[id]/participants` (receipts/participants.md) and POST
  `/api/receipts/[id]/participants/[participantId]/pick-link`
  (receipts/guest-picks.md).

## Behavior

### Loading and access

- The page is at `/receipts/[id]/participants`. Signed-out visitors are sent
  to `/login` and returned here after signing in (auth/sign-in.md); the page
  itself does the same if the session ends after the middleware check. A
  foreign, unknown or deleted receipt renders
  the not-found page, never a permission message.
- While the receipt loads, the roster section shows `LoadingState`. A failed
  read shows `ErrorState`; "Try again" refetches.
- A receipt with no participants shows `EmptyState` titled "No one's on this
  receipt yet", with an **Add person** button (`onAction`) as the primary
  action.

### Editing the roster

- The roster is one list with a compact row per person. A collapsed row
  shows the name (or "Guest N", the placeholder the API will save for that
  position), a second line with the phone and email that are filled in (or
  "No phone or email"), a link status (No link, Link sent, or Not saved for
  a row that has never been saved), and a ⋯ menu.
- Tapping the row, or Edit in its menu, expands it to Name, Phone and Email
  fields with visible labels and a Done button. One row is expanded at a
  time; opening another collapses the first. Edits stay in the draft either
  way.
- **+ Add person** appends a blank row, expanded, with its name field
  focused. It is disabled at 50 rows, with a note that 50 is the limit.
- Phone and email are validated on blur and on Save with `normalizePhone` and
  `normalizeEmail`. An invalid value shows the API's message under that field
  (`Enter a valid phone number`, `Enter a valid email address`) and blocks
  Save. A collapsed row with an invalid value says "Fix the phone or email"
  in place of its contact line, and Save expands the first such row.
- **Remove**, in the row's menu, opens an `AlertDialog` naming the person. If
  they have a pick link, the dialog says the link will stop working once
  saved. Confirming removes the row from the draft and moves focus to Add
  person (the empty state's button when no one is left); cancelling or
  Escape returns focus to the menu button.
- Changes are a draft until **Save**, which sends the whole roster in display
  order with the revision the page loaded. Save is disabled while nothing has
  changed, while no one is on the roster (the API requires at least one
  person), and while a save is in flight. While a save is in flight every
  field and button in the editor is disabled, so nothing typed then is lost
  when the saved roster comes back. Leaving the page with unsaved changes
  asks the browser to confirm; so does Sign out, which leaves without
  unloading the page.
- On success the editor takes the returned receipt detail as the new saved
  state and revision, new rows gain ids, and a toast says "Saved".
- On failure the draft is kept and the API's message is shown above the
  Save button. A 409 also offers **Reload**, which discards the draft:
  - the receipt changed elsewhere: "Receipt has changed; reload before
    saving";
  - a removed person is the payer or has items: the API's message telling
    the organizer to choose another payer or unassign them first;
  - 400: the API message. A network failure says the server could not be
    reached.
- A FINALIZED or PARSING receipt shows the roster read-only, with a line
  saying why. Link actions stay available on a finalized receipt, since the
  same link then shows the split.

### Pick links

- Link actions appear only on saved rows; an unsaved row's status reads
  "Not saved".
- A person with no link shows a **Create link** button under their row. A
  person who already has one shows "Link sent", and their menu offers **Send
  new link**, which first confirms in an `AlertDialog` that the earlier link
  will stop working, then rotates it.
- Creating or rotating returns the URL once. The row then shows it in a
  read-only field, and:
  - **Text**, when the saved phone is present: an `sms:` link to that phone
    with the message body filled in.
  - **Email**, when the saved email is present: a `mailto:` link to that
    address with a subject and the message body filled in.
  - **Copy link**, always: copies the URL and toasts "Link copied". If the
    clipboard is unavailable, the read-only field is focused with the URL
    selected so it can be copied by hand.
- The URL lives only in the page's memory. After a reload the row shows
  "Link sent" again, and the only way to send it again is Send new link.
  The row says this next to the URL ("Shown once; sending again makes a new
  link").
- The message names the receipt's merchant when it has one: "Pick what you
  had at <merchant>: <url>", and otherwise "Tap the items you had: <url>".
  It never includes names or amounts. The email subject is "Split Bill".
- While a row's link request is in flight, that row's Create link is
  disabled and its Send new link is hidden; other rows are unaffected.
- A failed link request shows the API's message on that row and changes
  nothing else. Link requests do not change the receipt revision, so they
  never make an unsaved draft stale.

### Layout

- Organizer page, desktop-first, meeting every rule in web.md's mobile
  standard: at 375px the rows and expanded fields are full width with no
  horizontal scroll; every row, button and menu item is at least 44px tall;
  inputs render at 16px or larger. At `md:` and up an expanded row's three
  fields sit side by side.
- Every action is reachable by keyboard. The remove and resend dialogs trap
  focus and close on Escape.

## Examples

| State / input | Behavior |
|---|---|
| New receipt, no participants | "No one's on this receipt yet" with Add person |
| Receipt from "Joe's Pizza": Text Maya | Messages opens with "Pick what you had at Joe's Pizza: <url>" |
| Receipt with no merchant: Text Maya | "Tap the items you had: <url>" |
| Add three rows, name only the first "Maya", Save | Saved as Maya, Guest 2, Guest 3; toast "Saved" |
| Phone "12", blur | "Enter a valid phone number" under the field; Save blocked |
| Remove Sam, confirm, Save; Sam is assigned the rice | Draft kept; API conflict message shown above Save |
| Save from a tab opened before another save | "Receipt has changed; reload before saving" with Reload |
| Maya (phone, no email): Create link | Text and Copy link shown; no Email |
| Reload after creating Maya's link | Status "Link sent"; Send new link in her menu; no URL |
| Send new link, confirm | New URL shown; the old link returns 404 |
| Unsaved new row | Status "Not saved"; no link actions |
| Alex with phone +12125550101, collapsed | "Alex", "(212) 555-0101", "No link", Create link |
| Phone "12" on a collapsed row | "Fix the phone or email"; Save expands that row |
| Finalized receipt | Roster read-only; link actions available |
| 50 rows | Add person disabled with the limit note |
| Foreign receipt id | Not-found page |

## Verify

- pnpm test (participants-screen.test.ts) covers the `sms:` and `mailto:`
  builders (encoding, missing phone or email, message with and without a
  merchant), phone formatting and the contact line, the roster-to-request
  mapping
  (order kept, ids kept, blank fields sent so they clear), and static renders
  of the empty, collapsed, expanded, invalid, read-only and link-shown
  states.
- pnpm typecheck and pnpm build pass.
- Drill (pnpm dev, signed in): add three participants, save, remove one
  through its menu and the confirm dialog, save, reload; the list matches.
- Link drill: create a link, open it in a private window; it loads the guest
  page. Send new link; the old URL returns 404.
- Phone drill: on a real phone, Text opens Messages and Email opens Mail with
  the link filled in.
- Phone pass at 375px from web.md, and a keyboard-only pass through adding,
  removing (dialog focus trapped, Escape closes) and saving.

## Constraints & decisions

- One Save for the whole roster, because the API replaces the roster under a
  single revision; saving row by row would make each row's save stale the
  next.
- The URL is shown once because only its hash is stored (ADR-0015);
  re-sending means rotating.
- The server never sends messages; Text and Email hand off to the
  organizer's own apps (ADR-0015).
- The message may name the merchant, unlike the guest page's metadata: the
  organizer sends it to someone they know and can edit it before sending,
  and a bare link with no context reads as spam. The guest page stays
  generic because previews, logs and search engines see it
  (receipts/guest-picks.md).
- Client and server share `normalizePhone` and `normalizeEmail` so a value
  the editor accepts is never rejected by the API for format.

## Out of scope

- Revoking a link without replacing it; the API supports it
  (receipts/guest-picks.md) but this screen does not offer it.
- Showing who has finished picking; that belongs to the review and finalize
  screen.
- Choosing the payer and assigning items (bills/split-screen.md, not yet
  written).
- Navigation into this page from other receipt screens; those screens own
  their links.
- The app sending SMS or email itself, and importing contacts.
