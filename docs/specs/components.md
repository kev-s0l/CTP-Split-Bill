---
type: infrastructure
---
# UI components — shadcn primitives under pure-presenter domain components

## Purpose

Every screen in `apps/web` draws from one set of components in two layers:
shadcn/ui primitives that own interaction and accessibility, and domain
components that present screen-ready data. This spec is the contract each
layer holds to — what it may import, which props it may take, and who owns
formatting. It is cross-cutting because a component that breaks it stops
being safely reusable: a presenter that fetches data or formats money pulls a
query plan or a currency decision into whatever screen renders it next.

## Where it lives

- `apps/web/app/components/ui/` — **layer 1**, shadcn primitives: `card.tsx`
  (`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`,
  `CardContent`, `CardFooter`), `button.tsx` (`Button`, `buttonVariants`),
  `dropdown-menu.tsx` (`DropdownMenu` and its parts), `skeleton.tsx`
  (`Skeleton`), `alert.tsx` (`Alert`, `AlertTitle`, `AlertDescription`),
  `sonner.tsx` (`Toaster`), `badge.tsx` (`Badge`, `badgeVariants`) and
  `table.tsx` (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`,
  `TableCell`).
- `apps/web/app/components/` (outside `ui/`) — **layer 2**, domain
  components: `BillCard.tsx`, `UserMenu.tsx`, and the async-state blocks
  `LoadingState.tsx`, `EmptyState.tsx` and `ErrorState.tsx`.
- `apps/web/app/lib/cn.ts` — `cn()`, the `clsx` + `tailwind-merge` helper
  layer-1 files merge `className` through.
- `apps/web/components.json` — shadcn CLI config: `new-york` style,
  `rsc: true`, aliases `@/app/components/ui` and `@/app/lib/cn`.
- `apps/web/app/globals.css` — `@import "tailwindcss"`, the design tokens,
  and the shadcn alias block; the only stylesheet.
- `apps/web/app/layout.tsx` — the app shell every page renders inside: the
  header, its account slot and sign-out Server Action, and the toast host.
- `apps/web/app/error.tsx` — the root error boundary, drawn with
  `ErrorState`.
- `apps/web/tests/components.test.ts` — static-markup rendering checks.
- No component lives in `packages/` ([ADR-0016](../adr/0016-shadcn-ui-primitives.md)).

## Layer 1 — primitives (`components/ui/`)

1. **Generated, then owned.** Files come from
   `pnpm dlx shadcn@4.23.0 add <name>`, run in `apps/web`. The version is
   pinned so every teammate generates the same output; bumping it is a
   reviewed change to this spec. Once generated a file is our code — local
   edits are allowed, and re-running `add` over an edited file is reviewed as
   a diff.
2. **Only what a screen uses.** A primitive is added in the PR whose screen
   first needs it, with any package it pulls in named in that PR. No bulk
   install.
3. **shadcn conventions apply here and only here**: a `className` prop
   merged through `cn()`, `cva` variants (`<Button variant="outline">`), and
   `"use client"` where the underlying Radix primitive requires it.
4. **Primitives stay in `ui/`; nothing else does.** The directory decides
   which rules apply, so a primitive outside `ui/` or a domain component
   inside it is a defect.
5. **Never run `shadcn init`.** It rewrites `globals.css` with shadcn's own
   palette and a `.dark` class variant, both of which this contract rules
   out. `components.json` is maintained by hand.

## Layer 2 — domain components (`components/`, outside `ui/`)

1. **Props in, JSX out.** No Prisma, no `fetch`, no `currentUserId()`, and
   no import from `@project/domain`, `@project/db`, `@project/services`, or
   `@project/auth`. Imports are React, layer-1 primitives, sibling
   components, and types. This is the rule a reviewer greps for.
2. **No client boundary without state.** A domain component carries
   `"use client"` only if it owns state, an effect, or an event handler
   itself. Rendering a client primitive does not make the parent a client
   component. `UserMenu` is the one that does: it owns the handler that
   keeps the menu open while sign-out submits.
3. **No `className` or `variant` prop.** A domain component may pass
   `className` and `variant` *down* to primitives; it does not accept them
   *from* screens. The overridable surface ends at layer 1. A screen that
   wants no footer omits it by composition, not by a flag.
4. **Display-ready props only.** Money and dates cross the boundary as
   strings already formatted for the screen. `Decimal` is never narrowed to
   `number` on the way in — see [split-allocation](bills/split-allocation.md).
5. **Screen language, not column names.** `BillCard` takes `restaurant`,
   `paidTo`, `partyCount`, `total`, `date` — the words on the page — not the
   columns of `Bill` and `Receipt`.
6. **Our token names.** Layer-2 code styles with our semantic utilities
   (`text-ink-muted`, `bg-surface`), not shadcn's aliases, and carries no
   `dark:` utilities.

## Rules that span both layers

- **Pages stay server components.** Client boundaries are leaves — a
  dialog, a picker, a form — never a whole `page.tsx`. Data is fetched on the
  server and passed down as display-ready props.
- **No file in either layer is named for a Next convention.** `page.tsx`,
  `route.ts`, `layout.tsx`, `loading.tsx`, and `error.tsx` are routable names
  inside `app/`; a component using one would become a URL.

## Design tokens

Tokens are declared once, in the `@theme` block in `globals.css`, and
generate the utilities components use. Nothing names a raw palette step such
as `neutral-200` or `blue-600`, so a theme change is an edit to `globals.css`
and nowhere else.

| Token | Utility | Means |
|---|---|---|
| `--color-canvas` | `bg-canvas` | page background behind cards |
| `--color-surface` | `bg-surface` | card and header background |
| `--color-line` | `border-line` | borders and slot dividers |
| `--color-ink` | `text-ink` | primary text |
| `--color-ink-muted` | `text-ink-muted` | labels and secondary text |
| `--color-brand` / `--color-brand-ink` | `text-brand`, `bg-brand` / `text-brand-ink` | links and primary actions, and text on them |
| `--color-danger` | `text-danger` | error text |
| `--radius-card` | `rounded-card` | card corner radius |
| `--font-sans` | `font-sans` | the system UI font stack |

Spacing, type scale, and shadow use Tailwind's defaults.

### shadcn aliases

Generated primitives use shadcn's variable names. Each is declared in a
`:root` block as an alias of one of our tokens and exposed to Tailwind
through `@theme inline`, so our tokens remain the source of truth and
primitives are regenerated without hand edits.

| shadcn variable | Aliases |
|---|---|
| `--background` / `--foreground` | `--color-canvas` / `--color-ink` |
| `--card`, `--popover` | `--color-surface` |
| `--card-foreground`, `--popover-foreground` | `--color-ink` |
| `--primary` / `--primary-foreground` | `--color-brand` / `--color-brand-ink` |
| `--secondary`, `--muted`, `--accent` | `--color-canvas` |
| `--secondary-foreground`, `--accent-foreground` | `--color-ink` |
| `--muted-foreground` | `--color-ink-muted` |
| `--destructive` | `--color-danger` |
| `--border`, `--input` | `--color-line` |
| `--ring` | `--color-brand` |
| `--radius` | `--radius-card`; `rounded-sm`…`rounded-xl` are derived from it |

A base-layer rule applies `border-border` to every element, so a bare
`border` utility draws in `--color-line` rather than Tailwind's
`currentColor` default.

**Our brand color is `brand`, not `accent`.** shadcn's `accent` means a
quiet hover surface (ghost buttons, menu highlights). Both cannot own
`--color-accent` — the alias and the token would reference each other and
resolve to nothing — so the brand token is named `--color-brand` and
`accent` belongs to shadcn.

### Dark mode

Dark mode follows the operating system. The `prefers-color-scheme: dark`
block redefines our source tokens and the aliases follow. shadcn's `.dark`
class variant is not added, so any `dark:` utility in a generated file
resolves to the OS preference too.

## The shell

`layout.tsx` renders the shell around every page: a `canvas` background, a
`surface` header bar, a single `<main>` content column (`max-w-2xl`), and one
`Toaster`. Pages render inside that `<main>` and do not render their own
header, `<main>` or toast host.

- **The header** holds the app name as a link to `/` on the left and the
  account slot on the right. Both are at least 44px tall, and the bar fits a
  375px viewport with no horizontal scroll.
- **The account slot** is its own Suspense boundary, so a page never waits
  on it; while it loads it shows a `Skeleton` the size of the menu trigger.
  - No session: the slot is empty and the header shows only the app name.
  - A session: the slot reads the profile in-process with `currentUserId()`
    and `getCurrentUser()`, the same query as
    [`GET /api/me`](auth/profile.md), and renders `UserMenu` with the
    user's name.
  - The profile read fails (the user record is gone, the query errors):
    `UserMenu` renders with the name "Account", so sign-out stays
    reachable. The failure is logged on the server and the page renders
    normally.
  - The session itself can't be read: the slot is empty, since there is no
    known user to sign out, and the failure is logged.
- **Sign out** submits a Server Action that calls Auth.js `signOut()`,
  which revokes the database session, then redirects to `/`.
- **Toasts.** The `Toaster` follows the OS theme like every other token.
  Client leaves call `toast()` from `sonner` for the optimistic-rollback
  toasts that [web](web.md) requires.
- **The root error boundary** (`app/error.tsx`) catches a page that throws
  outside its own section boundaries. It renders `ErrorState` with generic
  copy and never the error's message; retry refetches the server data and
  resets the boundary.

## The primitives

**`Card`** is a non-interactive container: a `card`-colored panel with a
border, `rounded-xl` corners and vertical rhythm between its slots. It has no
semantics of its own — no `<article>`, no heading level, no `role`, no
`tabIndex`. **A card that must be clickable gets an `<a>` or `<button>` from
its caller, inside a slot**, so keyboard and screen-reader behavior come from
a real interactive element. Slot order is header → content → footer by
convention; `Card` renders `children` in the order given and review is the
only guard. `CardHeader` and `CardFooter` draw a divider only when given
`border-b` / `border-t`.

**`Button`** renders a `<button>` (or, with `asChild`, its single child via
Radix `Slot`). Variants: `default`, `destructive`, `outline`, `secondary`,
`ghost`, `link`; sizes `default`, `xs`, `sm`, `lg`, and the `icon*` sizes.
It is a server-compatible component; the handler lives in its caller.

**`DropdownMenu`** is Radix's menu: Enter, Space or ArrowDown on the trigger
opens it and focuses the first item, arrow keys move between items, and
Escape or a selection closes it and returns focus to the trigger. Content
renders in a portal, so it is absent from markup until opened.

**`Skeleton`** is a pulsing placeholder block. **`Alert`** is a bordered
panel with `role="alert"`; its `destructive` variant draws in `danger`.
**`Toaster`** is the Sonner host; its generated file is edited to take the
OS theme (`theme="system"`) instead of `next-themes`.

## The compositions

### `UserMenu`

`UserMenu` takes `name` (a display string) and `signOutAction` (a Server
Action).
Its trigger is a ghost `Button` showing `name`, truncated so a long name
never widens the header. The menu holds a label, "Signed in as" plus `name`,
then a separator, then a "Sign out" item that submits `signOutAction` from
a `<form>`. The trigger and every item are at least 44px tall. The keyboard
behavior is the primitive's. Its one handler keeps the menu open when "Sign
out" is selected: the menu's content unmounts on close, and a form removed
before the browser submits it is never sent.

### Async states

The building blocks for the async-honesty standard in [web](web.md). A
screen decides when each one shows; these decide what it looks like.

| Component | Props | Renders |
|---|---|---|
| `LoadingState` | `label`, `rows` (default 3) | a `role="status"` region announcing `label` to screen readers, with `rows` `Skeleton` bars; the Suspense fallback for a section |
| `EmptyState` | `title`, `message`, `actionLabel`, exactly one of `actionHref` or `onAction`, and an optional `actionId` so a caller can move focus to the action | the title and message, and one primary action drawn as a `Button`: a link to `actionHref`, or a button that calls `onAction`. There is no variant without an action |
| `ErrorState` | `title`, `message`, `onRetry` | a destructive `Alert` with the title, message and a "Try again" button that calls `onRetry` |

`ErrorState`, and `EmptyState` given `onAction`, take a handler, so their
callers are client components (error boundaries, client leaves). Neither
carries a `"use client"` of its own: each joins the client bundle through
its caller. `EmptyState` with `actionHref` stays usable from a server
component.

### `BillCard`

`BillCard` renders one receipt summary into the card slots: `restaurant` in
`CardTitle` inside the header; optional `status` (`ReactNode`) beside the
title in the header; `paidTo` / `partyCount` / `total` in
`CardContent` as a description list labelled `Paid to`, `People`, and
`Total` (emphasised); and `date` in a `CardFooter` with a top divider
and small muted text, behind the literal label `Date Created:`.

Its display props map to data the caller must assemble and format:

| Prop | Source | Caller's job |
|---|---|---|
| `restaurant` | `Receipt.merchantName` (nullable) | supply a fallback — the prop is `string`, not `string \| null` |
| `paidTo` | `Receipt.paidByParticipantId` → `Participant.displayName` (payer nullable) | resolve the receipt-local participant and supply a fallback |
| `partyCount` | count of participants billed on the receipt | count it in the query, not in the component |
| `status` | receipt status and aggregate bill settlement | caller supplies a status Badge; omit when settlement is not applicable |
| `total` | `Receipt.total`, a `Decimal` serialized as a string | format for display — the prop is `string` |
| `date` | `Receipt.createdAt`, an ISO string | format for display |

`BillCard` presents a receipt summary; it does not decide which receipts exist
or who may see one. That scoping is [the bills list screen](bills/list-screen.md), and the loading,
empty, and error states around a list of these cards are the async-honesty
standard in [web](web.md) — owned by the screen, not by the card.

## Boundaries

| Inside this spec | Deliberately outside |
|---|---|
| Both layers' rules, and what each may import | Which screens render which component |
| That props are display-ready | The formatting helpers that make them so — they do not exist yet |
| The token set, the shadcn alias table, dark-mode behavior | Per-screen layout beyond the shell's content column |
| How primitives are added and owned | Each primitive's internal markup — that is the generated file |

The home screen maps summary results to `BillCard` through
`toBillCardProps` in `apps/web/app/lib/format.ts`; that mapping formats raw
money and date values before they reach the presenter.

## Verify

- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass; `pnpm build` is what
  catches a component accidentally named for a Next route convention, since
  the route types are generated into `.next/types/`.
- Layer-2 rule 1 is a grep, and it is the drill:
  `grep -rE "@project/(domain|db|services|auth)|currentUserId|prisma" apps/web/app/components/ --exclude-dir=ui`
  returns nothing.
- Layer-2 rule 2: `grep -r "use client" apps/web/app/components/ --exclude-dir=ui`
  returns only `UserMenu.tsx`.
- Layer-2 rules 3 and 6: `grep -rnE "className\??:|variant\??:|dark:" apps/web/app/components/ --exclude-dir=ui`
  returns nothing.
- Token rule: `grep -rE "(neutral|gray|slate|zinc|blue)-[0-9]" apps/web/app/`
  returns nothing.
- `apps/web/tests/components.test.ts` renders to static markup with literal
  props: `Card`'s slots appear in the order given (fails if `Card` stops
  rendering `children`), `Card` styles through the aliased tokens
  (`bg-card`, `text-card-foreground`), and `BillCard` renders its formatted
  display strings and optional status slot untouched. It also renders, from literal props:
  - `LoadingState`: a `role="status"` region with the label and exactly
    `rows` skeleton bars.
  - `EmptyState`: the title, message, and an action link with the given
    label and href, or, given `onAction`, a button with that label and no
    link.
  - `ErrorState`: a `role="alert"` region with the title, message and a
    "Try again" button.
  - `UserMenu`: a trigger showing the name, marked as opening a menu.
  - `app/error.tsx`, given an error with a message, never renders that
    message.
- Visual pass: `pnpm dev`, open `/` in light and dark OS themes — the header,
  canvas, receipt cards, badges and actions use the token colors in both.
- Phone pass ([web](web.md)) at 375px, signed in with a long display name:
  no horizontal scroll, the name truncates, and the trigger and "Sign out"
  are at least 44px tall and work by tap.
- Keyboard-only pass: Tab to the trigger, Enter opens the menu with focus on
  "Sign out", arrow keys move, Escape closes it with focus back on the
  trigger. Enter on "Sign out" signs out and lands on `/` with no menu.
- Signed-out pass: `/` shows the header with the app name and no menu.

## Key ADRs

- [ADR-0016](../adr/0016-shadcn-ui-primitives.md) — shadcn/ui as the
  primitive layer under pure-presenter domain components; supersedes
  [ADR-0013](../adr/0013-presentational-components.md).
- [ADR-0009](../adr/0009-domain-web-only.md) — data access lives in
  `packages/domain`, which is what layer-2 rule 1 keeps out of here.
- [ADR-0001](../adr/0001-monorepo-turbo.md) — the apps-vs-packages split that a
  future `packages/ui` would invoke.
