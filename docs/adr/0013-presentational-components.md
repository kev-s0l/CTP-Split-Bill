# ADR-0013: Presentational components live in the web app, as compound primitives

## Status

Proposed

## Context

The app has reached the point where the same visual container — a bordered,
padded block with a header, a body, and a footer — is needed by several
unrelated screens: a bill in the "what do I owe" list, a party in the party
list, a receipt awaiting parse. Three forces pull on where that container
lives and what it knows.

1. **The monorepo rule says `packages/` are shared libraries and `apps/` are
   deployable processes** ([ADR-0001](0001-monorepo-turbo.md),
   `docs/specs/monorepo.md`). A `packages/ui` is therefore the reflexive home
   for shared components — but there is exactly one consumer, `apps/web`, and
   no second one on any roadmap. A package with one consumer buys a build
   step, a `package.json`, and a Tailwind content path, and sells nothing.
2. **Components that fetch their own data are untestable and uncacheable.**
   A `BillCard` that calls `listBills()` couples a pixel decision to a query
   plan, and makes every visual change a database concern.
3. **A single fat `<Card variant="bill" />` grows a boolean per screen.**
   `hasFooter`, `headerRight`, `dense` — the props become a private layout
   language that only the component's author can read.

## Decision

Presentational components live in `apps/web/app/components/`, are **pure
functions of their props**, and compose as **compound primitives**.

- **Location**: `apps/web/app/components/`. No `packages/ui` until a second
  app needs the same component. Promotion is a later, cheap refactor; an
  unneeded package is a permanent tax.
- **Pure presentation**: a component in this directory may not call Prisma,
  `fetch`, `currentUserId()`, or anything from `@project/domain`,
  `@project/db`, or `@project/services`. Everything it renders arrives as a
  prop. Its only imports are React, other components in this directory, and
  types.
- **Compound over variants**: a container primitive exports its named slots
  (`Card`, `CardHeader`, `CardBody`, `CardFooter`) and the caller composes
  them. Slots take `children` only. A slot a screen does not need is simply
  not rendered — there is no `hasFooter` prop, and there never will be.
- **Server components by default**: no `"use client"` unless the component
  itself owns state, an effect, or an event handler. These components own
  none, so they ship zero JavaScript to the browser.
- **Domain components are compositions, not new primitives**: `BillCard`
  composes `Card`'s slots and names its props in the language of the screen
  (`restaurant`, `paidTo`, `total`). It does not reach for `<div>` layout
  that `Card` already owns.
- **Formatting is the caller's job.** Money arrives as a pre-formatted
  string, not a `Decimal` or a `number`; dates arrive as a pre-formatted
  string, not a `Date`. A presenter that formats money owns a currency and
  locale decision it cannot see the context for — and `Decimal` must not be
  narrowed to `number` anywhere
  (`docs/specs/bills/split-allocation.md`).
- **Styling is Tailwind utility classes in the component**, per the existing
  `globals.css` (`@import "tailwindcss"`). No CSS modules, no
  `styled-components`, no `className` prop punched through a primitive for
  callers to override — an overridable primitive is a primitive with no
  contract.

## Consequences

- **Easier**: a component can be read in full in one screen and rendered in
  a test with a literal props object — no database, no session, no mocks.
  Visual changes stay inside `app/components/`.
- **Easier**: because the primitives hold no state, the bill list stays a
  server component, and the "what do I owe" screen costs no client bundle.
- **Harder**: every caller must map its data to display strings before
  rendering, and two callers can format the same money differently. The
  formatting helpers that fix that are a later decision, not this one.
- **Harder**: compound components cannot enforce slot order or forbid a
  stray child — `<Card>` will happily render `<CardFooter>` first. The
  guard is review, not the type system.
- **Accepted tradeoff**: no component library (shadcn/ui, Radix, MUI) and so
  no donated accessibility work. That is affordable only while the
  primitives stay non-interactive containers. **The first component needing
  focus management, a dialog, or a listbox is the trigger to revisit this
  ADR** rather than hand-roll ARIA.
- **Accepted tradeoff**: `apps/web/app/components/` sits inside the `app/`
  directory, so the folder name is load-bearing — Next treats only
  `page`/`route`/`layout` files as routable, and a file named `page.tsx`
  here would become a URL. No file in this directory is ever named for a
  Next convention.

## See also

- `docs/specs/components.md` — the contract these components hold to.
- [ADR-0001](0001-monorepo-turbo.md) — the apps-vs-packages split this
  decision declines to invoke yet.
- [ADR-0009](0009-domain-web-only.md) — why data access stays in
  `packages/domain`, which is what keeps it out of here.
- `docs/specs/web.md` — the async-honesty UI standard these components are
  the building blocks for.
