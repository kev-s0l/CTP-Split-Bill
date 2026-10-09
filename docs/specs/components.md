---
type: infrastructure
---
# UI components — pure presenters, composed from compound primitives

## Purpose

Every screen in `apps/web` draws from one small set of presentational
components. This spec is the contract they hold to: what they are allowed to
know, how they compose, and who owns formatting. It is cross-cutting because
a component that breaks it stops being safely reusable — a presenter that
fetches data, or formats money, pulls a query plan or a currency decision
into whatever screen renders it next.

## Where it lives

- `apps/web/app/components/Card.tsx` — the container primitive and its
  slots: `Card`, `CardHeader`, `CardBody`, `CardFooter`.
- `apps/web/app/components/BillCard.tsx` — `BillCard`, the bills-domain
  composition of those slots.
- `apps/web/app/globals.css` — `@import "tailwindcss"`; the only stylesheet.
- No component lives in `packages/` ([ADR-0013](../adr/0013-presentational-components.md)).

## The contract

A file in `apps/web/app/components/` holds to all seven:

1. **Props in, JSX out.** No Prisma, no `fetch`, no `currentUserId()`, and
   no import from `@project/domain`, `@project/db`, `@project/services`, or
   `@project/auth`. Imports are React, sibling components, and types only.
   This is the rule a reviewer greps for.
2. **No client boundary without state.** A component carries `"use client"`
   only if it owns state, an effect, or an event handler. None currently do,
   so the component layer ships **0 bytes** of JavaScript to the browser.
3. **Slots take `children` and nothing else.** `CardHeader`, `CardBody`, and
   `CardFooter` share one `CardProps` type — `{ children: React.ReactNode }`.
   A slot that needs a second prop is a sign the caller should compose, not
   that the slot should grow.
4. **Composition, not variants.** There is no `variant`, `dense`,
   `hasFooter`, or `className` prop on a primitive. A screen that wants no
   footer omits `<CardFooter>`. A primitive whose styling callers can
   override has no contract to hold.
5. **Display-ready props only.** Money and dates cross the boundary as
   strings already formatted for the screen. `Decimal` is never narrowed to
   `number` on the way in — see [split-allocation](bills/split-allocation.md).
6. **Domain components name the screen's language.** `BillCard` takes
   `restaurant`, `paidTo`, `partyCount`, `total`, `date` — the words on the
   page — not the column names of `Bill` and `Receipt`.
7. **No file here is named for a Next convention.** `page.tsx`,
   `route.ts`, `layout.tsx`, `loading.tsx`, and `error.tsx` are routable
   names inside `app/`; a component using one would become a URL.

## The primitive

`Card` is a non-interactive container. It renders a wrapper `<div>` and its
children; the three slots each render one `<div>`. It has no semantics of its
own — no `<article>`, no heading level, no `role`, no `tabIndex`. **A card
that must be clickable gets an `<a>` or `<button>` from its caller, inside a
slot**, so the interactive element is a real one and keyboard and screen
reader behavior come from the platform rather than from ARIA.

Slot order is `CardHeader` → `CardBody` → `CardFooter` by convention. Nothing
enforces it: `Card` renders `children` in the order given, so a caller can
produce a footer-first card, and review is the only guard
([ADR-0013](../adr/0013-presentational-components.md)).

## The composition

`BillCard` renders one bill's summary into the three slots: `restaurant` in
the header, `paidTo` / `partyCount` / `total` in the body, and `date` in the
footer behind the literal label `Date Created:`.

Its five props map to data the caller must assemble and format:

| Prop | Source | Caller's job |
|---|---|---|
| `restaurant` | `Receipt.merchantName` (nullable) | supply a fallback — the prop is `string`, not `string \| null` |
| `paidTo` | `Receipt.paidByMemberId` → `PartyMember.displayName` (both nullable) | resolve the member and supply a fallback |
| `partyCount` | count of members billed on the receipt | count it in the query, not in the component |
| `total` | `Bill.amountOwed`, a `Decimal` serialized as a string | format for display |
| `date` | `Bill.createdAt` or `Receipt.purchasedAt`, a `DateTime` | format for display |

`BillCard` presents a bill; it does not decide which bills exist or who may
see one. That scoping is [my-bills](bills/my-bills.md), and the loading,
empty, and error states around a list of these cards are the async-honesty
standard in [web](web.md) — owned by the screen, not by the card.

## Boundaries

| Inside this spec | Deliberately outside |
|---|---|
| Structure, composition, and what a component may import | Which screens render which card |
| That props are display-ready | The formatting helpers that make them so — they do not exist yet |
| That `Card` is non-interactive | Focus management, dialogs, listboxes — the trigger to revisit [ADR-0013](../adr/0013-presentational-components.md) |
| Tailwind utilities as the styling mechanism | The design tokens (spacing, radius, color scale) — not chosen yet |

## Known gaps against this contract

Two statements above are contract, not yet fact. A PR that closes either
deletes its line from this section.

- **`Card`'s and `BillCard`'s `className` attributes are empty strings.** The
  structure is in place; no Tailwind utilities have been applied, so the
  components currently render unstyled nested `<div>`s.
- **No screen imports `BillCard`.** `apps/web/app/page.tsx` is still the
  starter skeleton, so nothing yet maps `Bill` rows to the five display
  props, and `BillCard`'s `total: number` disagrees with the string that
  [my-bills](bills/my-bills.md) says `GET /api/bills` returns. The first
  caller resolves that in favour of the string — rule 5.

## Verify

- `pnpm typecheck` and `pnpm build` pass; `pnpm build` is what catches a
  component accidentally named for a Next route convention, since the route
  types are generated into `.next/types/`.
- Rule 1 is a grep, and it is the drill:
  `grep -rE "@project/(domain|db|services|auth)|currentUserId|prisma" apps/web/app/components/`
  returns nothing.
- Rule 2 is a grep: `grep -r "use client" apps/web/app/components/` returns
  nothing while no component owns state.
- There are no component tests. A rendering test asserting the three slots
  appear in order, with a literal props object, is the honest test here — one
  that fails if `Card` stops rendering `children`. Until it exists, this
  spec is verified by the greps and the build.

## Key ADRs

- [ADR-0013](../adr/0013-presentational-components.md) — components in the
  web app, pure, compound, server-rendered, and the tradeoffs accepted.
- [ADR-0009](../adr/0009-domain-web-only.md) — data access lives in
  `packages/domain`, which is what rule 1 keeps out of here.
- [ADR-0001](../adr/0001-monorepo-turbo.md) — the apps-vs-packages split that a
  future `packages/ui` would invoke.
