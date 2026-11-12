# ADR-0018: The organizer on the roster, polling for picks, and one URL per receipt step

## Status

Accepted; builds on [ADR-0017](0017-group-pick-link.md), whose switch
between picking and editing these screens are built around

## Context

ADR-0017 gives each draft receipt two modes: while picking is open, guests
pick and the organizer can't make structural edits; while editing, the
organizer edits and guests can't pick. That leaves three gaps:

- The organizer usually ate too, but has no way to pick their own items. A
  roster row they add for themselves is indistinguishable from a guest's,
  could be sent a link, and could be removed by accident.
- While picking is open, the organizer watches picks arrive on their own
  screen, and nothing tells that screen picks changed.
- The organizer screens (upload, scan, edit, participants, picks, finalize)
  are being built in parallel, with no shared navigation and no agreed URLs.
  Each depends on the steps before it: picks mean nothing before the items
  are reviewed and the roster is saved. A deep link or a "next" button that
  skips a step lets the organizer act on state that isn't ready.

## Decision

### The organizer is a participant

- Creating a receipt also creates the organizer's own participant row, named
  from the user's account, and records it as
  receipts.organizer_participant_id. Screens label it "You".
- The organizer picks for that row through an owner-scoped route that
  reconciles exactly like a guest's picks, with no expectedRevision. It works
  in both ADR-0017 modes, since it changes only the organizer's own picks.
- The row can't be removed from the roster (409) and never gets a pick link
  or a group-link claim (400).
- Opening picking (ADR-0017) also requires at least one participant besides
  the organizer.
- Participants with no link and no claim get their items from the organizer,
  in Editing mode, through the existing assignment routes.
- Existing receipts have no organizer row. Screens treat that as "the
  organizer isn't on the roster".

### Live updates by polling first

- While picking is open, the organizer's picks screen re-reads the receipt
  every 5 seconds while the tab is visible, and right away when it regains
  focus. It replaces its state only when the revision changed.
- All refreshing goes through one client hook. Server-sent events through the
  ADR-0007 seam can replace that hook later without changing the screens.
- Polling first because it adds no route, needs no pg_notify call on every
  pick-changing write, is fully testable on PGlite, and suits a deployment
  that scales to zero. A 5-second delay is acceptable at a table.
- The guest page doesn't poll. It refreshes when it regains focus and has a
  "Check again" button while picking is paused, keeping its client
  JavaScript to the item list.

### One URL per step, forward-gated on the server

- A draft receipt moves through five steps: Scan, Items, People, Picks,
  Finalize. Each has its own route under `/receipts/[id]/`.
- Whether a step is available and whether it is done is derived from receipt
  detail by one pure function shared by server and client. Nothing about
  progress is stored.
- A step is available once the step before it is done. A request for a step
  that isn't available redirects to the furthest available one. Going back is
  always allowed. While picking is open, steps that edit render read-only.
- The route table at the time of this decision:

| Route | Screen |
|---|---|
| `/sign-in` | Sign in |
| `/` | Bills list |
| `/receipts/new` | Upload |
| `/receipts/[id]` | Redirects to the furthest available step |
| `/receipts/[id]/scan` | Reading the receipt, parse failures |
| `/receipts/[id]/items` | Edit receipt |
| `/receipts/[id]/participants` | People |
| `/receipts/[id]/picks` | Picks and assignments |
| `/receipts/[id]/finalize` | Totals check and finalize |
| `/p/[token]` | Guest picks, then the split |
| `/g/[token]` | Group link: claim a name (ADR-0017) |

The table is a snapshot. docs/specs/receipts/flow.md owns the routes from
here on, and changes there do not need a new ADR unless they change the
step model.

## Alternatives considered

- **The organizer adds themselves by hand.** No new field, but nothing stops
  the organizer from sending themselves a link, removing their own row, or
  forgetting to add it, and screens can't tell "you" from a guest.
- **Server-sent events from the start.** Picks appear instantly, but every
  pick-changing write must also notify, the push path can't be tested on
  PGlite so polling is needed anyway as a fallback, and open streams keep a
  replica awake and need reconnect handling.
- **One page with client-side steps.** Simpler routing, but a reload loses
  the step, the back button leaves the receipt, and gating lives only in the
  client.
- **Stored progress (a `currentStep` column).** Easy to read, but it can
  disagree with the receipt, for example after items are replaced, and every
  write would have to keep it right.

## Consequences

- Easier: one route map and one step model for every screen PR to build
  against. A skipped step can't be reached by URL.
- Easier: the organizer picks like everyone else, and their share is never
  forgotten.
- Harder: receipt creation writes a participant row too, and the roster and
  link routes gain organizer-row rules.
- Harder: polling costs one detail read per open picks tab every 5 seconds,
  and picks appear up to 5 seconds late.
- On acceptance: docs/specs/receipts/flow.md is the route and step spec;
  docs/specs/receipts/participants.md, participants-screen.md,
  guest-picks.md, detail.md and api.md gain the organizer row and its route
  in the PRs that build them.

## See also

- docs/specs/receipts/flow.md — the route map, step rules and step bar.
- docs/adr/0017-group-pick-link.md — the picking/editing switch and group
  link.
- docs/adr/0015-guest-pick-links.md — per-participant links.
- docs/adr/0007-pg-notify-sse.md — the push mechanism polling can give way to.
