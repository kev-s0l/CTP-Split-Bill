# ADR-0017: One group link per receipt, claimed names, and an owner switch between picking and editing

## Status

Accepted; builds on [ADR-0015](0015-guest-pick-links.md) and amends one
rule of it: guest writes also require picking to be open (see "Picking and
editing"). The rest of ADR-0015 stands.

## Context

ADR-0015 gives each participant their own pick link. That keeps picks scoped
to one person, but it makes sending links the organizer's slowest step: one
text or email per person, phone numbers or emails stored for each, and a
link that is shown only once, so re-sending means rotating. At a table,
the natural move is to paste one link into the group chat.

A plain shared link with a "which one are you?" picker loses what ADR-0015
was for. Anyone could pick as anyone, the organizer could not cut off one
person, and "done" would mean "someone who tapped Maya's name".

Separately, ADR-0015 lets guests write until finalize. A guest's save
replaces that guest's whole set of picks, so a guest page left open from
before an owner's fix can undo the fix with its next save. The owner has no
way to hold guests off while they correct the split. It also runs the other
way: every guest pick advances the receipt revision, so while guests are
picking, an owner save built from an earlier read gets a 409 and loses its
draft.

## Decision

Add a second unauthenticated entry point: one **group token per receipt**.
Opening it lists the participants; tapping an unclaimed name **claims** it,
which issues that participant an ADR-0015 token. Everything after the claim
is the existing per-participant flow.

### The group token

- One per receipt at most: 32 bytes from a CSPRNG, base64url-encoded,
  stored only as a SHA-256 hash in receipts.group_token_hash (unique). The
  raw token is returned once, to the owner, as `<origin>/g/<token>`.
- Only the owner issues, rotates or revokes it, through owner-scoped
  routes. Rotating or revoking it does not affect participants who have
  already claimed.
- Unknown, revoked, rotated, deleted-receipt and PARSING tokens return the
  same 404, as in ADR-0015.

### Opening and claiming

- GET on a group token returns the receipt's merchant, purchase date and
  each participant's id, display name and whether they are claimed. It has
  no side effects, so link previews are harmless.
- **Claimed means the participant holds an ADR-0015 token.** There is no
  separate claim state to keep in sync.
- Tapping a name does not claim it. The page first asks the guest to confirm
  ("Are you Maya?"), and only confirming sends the claim. Going back sends
  nothing.
- POST claim with a participant id, under the receipt row lock: if that
  participant has no token, issue one and return the personal URL
  (`/p/<token>`); if they already have one, return 409 `CONFLICT` ("Already
  claimed"). A participant from another receipt returns 404.
- The guest's browser keeps the personal URL it was given, keyed by the
  group token, so reopening the group link on the same device offers
  "Continue as Maya". The server never reads this back.
- Claims on a FINALIZED receipt return 409. GET on a finalized receipt's
  group link returns the same split summary as a personal link, so one
  group message works before and after finalize.

### Getting back in, and fixing a wrong claim

- A guest whose device has lost their personal URL sees their name as
  taken. Recovery is the owner's **Send new link** (the existing ADR-0015
  rotate): it returns a new personal URL for the owner to send, and the old
  one stops working. This is the recommended path, because the guest does
  nothing but open the new link.
- Alternatively, the owner releases the claim by revoking that participant's
  link (the existing ADR-0015 revoke), and the name becomes claimable again
  from the group link. This is the path for a wrong claim, where someone
  else took the name.
- Either way, picks and done state belong to the participant, not the link,
  so they survive rotation and release.
- Personal links stay hash-only (ADR-0015). The server never stores a raw
  token, so it cannot resend the same URL; re-sending always means a new
  one. Storing raw or encrypted tokens to allow identical resends was
  rejected: a database read or leaked backup would then yield a working
  link for every guest, and encryption adds key management, all to save a
  guest from noticing a different URL.
- The owner's screen marks a claimed participant "Claimed", with Send new
  link and a hint to use it when someone cannot get back in.

### Picking and editing

- A DRAFT receipt is in one of two modes, stored as
  receipts.picks_opened_at: null is **Editing**, a timestamp is **Picking
  open**. Every receipt starts in Editing, because the items have to be
  right before anyone picks.
- The owner opens and pauses picking through owner-scoped routes, under the
  receipt row lock. Opening requires the receipt to be reviewed and to have
  at least one participant. Pausing waits behind any
  guest write already holding the lock. Neither changes the receipt
  revision, since receipt content is unchanged.
- **While picking is open,** guests pick and mark done as in ADR-0015, and
  the owner's structural writes return 409 `CONFLICT` ("Pause picking to
  make changes") and write nothing: receipt fields, items, participants,
  assignments, shared allocations, parse and finalize. Issuing, rotating
  and revoking links, and the group token routes, still work.
- **While editing,** guest pick writes and done return 409 `CONFLICT`
  ("The organizer is making changes") and write nothing. This amends
  ADR-0015, where guest writes required only DRAFT and not PARSING. The
  token stays valid, so this is not the 404 for a dead link.
- So only one side can change picks at a time: guests can't undo a fix
  while the owner is making it, and the owner never saves over picks that
  arrived after their read.
- Claims through the group link succeed in both modes, so a late guest can
  see the items, but they can't pick until picking is open.
- Every token projection reports the mode, so the guest page shows a
  read-only view with a plain reason instead of failing on save.
- Switching modes does not clear anyone's picks or done state.
- A FINALIZED receipt rejects guest writes whatever picks_opened_at holds.
- The switch is manual. The mode doesn't change when the owner opens an
  editing screen, because the server can't tell when the owner is finished,
  and a lock left behind by an abandoned tab would shut guests out with no
  visible cause.

### Unchanged

- Personal links still work and can still be sent one by one, for someone
  who is not in the group chat.
- Never returned from either token: phones, emails, owner identity, blob
  names and raw extraction.
- Link hygiene from ADR-0015 applies to `/g/`: generic page metadata,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, and no token in
  logs.

## Alternatives considered

- **Per-participant links only (ADR-0015 as is).** Strongest scoping, but the
  slowest to send, and it needs contact details for everyone.
- **Shared link with a name picker and no claim.** Easiest to build, but
  anyone can edit anyone's picks for the life of the link, and one person
  cannot be cut off without cutting off everyone.
- **Lock guests out automatically while the owner edits.** No extra button,
  but it needs a lease or heartbeat to release, and an abandoned tab leaves
  guests locked out with no explanation.
- **Reject stale guest saves (an expected revision on guest writes).**
  Stops a stale page from undoing an owner's fix, but every owner edit
  would then bounce every guest who is mid-pick, and it does not let the
  owner hold guests off while fixing.

## Consequences

- Easier: the organizer sends one message to the group. Phones and emails
  become optional extras rather than the normal path.
- Easier: no new pick, done or split machinery; a claim is an ADR-0015 issue.
- Harder: whoever confirms a name first gets it. The confirmation step stops
  a mis-tap, but a deliberate wrong claim still locks the real person out
  until the owner releases it. If the name is claimed while a guest's
  confirmation is open, their confirm gets "Already claimed" and the list
  refreshes.
- Harder: a forwarded group link lets an outsider claim any unclaimed name
  until the owner rotates or revokes the group link.
- Harder: "Continue as" depends on the browser that claimed. It is missing
  on another device, after clearing browser data, in a private tab, and
  often when the link is opened from a different app, since apps such as
  Instagram and WhatsApp open links in their own browser with separate
  storage. The guest then asks the owner, who sends a new link.
- Easier: the owner pauses picking, fixes the split, and finalizes without
  a guest undoing a fix, and guest picks never make an owner save stale.
- Harder: the owner must pause picking to change anything, including
  finalizing. Screens that edit show a read-only view with a pause button
  while picking is open.
- Harder: after picking is reopened, a guest page left open from before an
  owner's fix can still undo that guest's part of it with its next save, as
  in ADR-0015. Keeping picking paused until finalize avoids it.
- Harder: an owner who forgets to open or reopen picking leaves guests
  read-only; the guest page says so, so a guest knows to ask.
- Claims, group-token changes and opening or pausing picking do not change
  the receipt revision, so they never make an owner's unsaved edit stale
  (same rule as ADR-0015).
- Existing receipts get picks_opened_at null, so they start in Editing.
- On acceptance:
  - docs/specs/receipts/guest-picks.md gains the group token, claim route,
    `/g/[token]` page, the open and pause routes, and the mode in its
    projections and guest write rules.
  - docs/specs/receipts/edit.md, items.md, participants.md and
    bills/allocations.md gain the "pause picking" 409 on owner writes.
  - docs/specs/receipts/participants-screen.md gains a group link section
    and the open/pause picking switch, renders the roster read-only while
    picking is open, and per-person rows read "Claimed" rather than "Link
    sent".
  - The assign items screen's spec, when written, shows the same switch.
  - `apps/web/middleware.ts` exempts `/g/` as well as `/p/`.
  - docs/specs/web.md's guest-route exception names `/api/groups/[token]`.

## See also

- docs/adr/0015-guest-pick-links.md — the per-participant tokens a claim
  issues.
- docs/specs/receipts/guest-picks.md — the pick and split behavior after a
  claim.
- docs/specs/receipts/participants-screen.md — where the owner shares links.
