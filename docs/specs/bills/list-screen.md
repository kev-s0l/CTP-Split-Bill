---
type: feature
---
# The organizer sees receipt summaries and settlement status on the home screen

## Why

Organizers need a quick view of their receipts, the people involved and whether
the finalized bills have been settled, while keeping drafts visible for work
that is still in progress.

## Where it lives

- packages/domain/src/receipt-summaries.ts: owner-scoped receipt summary query
  and shared bill settlement projection.
- apps/web/app/api/receipts/summary/route.ts: summary collection GET.
- apps/web/app/page.tsx: home screen fetch, formatting and list states.
- apps/web/app/components/BillCard.tsx and
  apps/web/app/components/ui/badge.tsx: receipt card and status.
- apps/web/app/lib/format.ts: raw summary to display-ready BillCard props.
- apps/web/tests/receipt-summaries-route.test.ts and
  apps/web/tests/components.test.ts.

## Behavior

- `GET /api/receipts/summary` returns receipts owned by the signed-in user,
  including drafts and finalized receipts, ordered newest first by `createdAt`.
  Deleted receipts are excluded. The response does not change the existing
  `GET /api/receipts` contract.
- Each entry contains only `id`, `status`, nullable `merchantName`, nullable
  `title`, `total` as a decimal string, `createdAt` as an ISO string, nullable
  `payerName`, `participantCount`, and nullable `settled`.
- `participantCount` counts every participant on the receipt, including
  participants without a bill.
- `payerName` is the display name of the receipt's payer participant, or null
  when no payer is selected or the participant is unavailable.
- `settled` is null for DRAFT receipts and for receipts with no bills. For a
  finalized receipt with bills, it is true only when every bill is settled.
  Settlement uses the shared rule used by `presentBill`: manually paid
  (`paidAt`), the receipt payer, or zero `amountOwed`. The rule is implemented
  once in a shared domain helper and used by both bill presentation and this
  summary query.
- The endpoint returns raw decimal and ISO date strings. The home page formats
  total and date before passing them to `BillCard`; the component receives
  display-ready strings. The page shows a `Badge` for Paid, Unpaid, or a draft
  state when `settled` is null, plus a primary New receipt action.
- The page uses the shared shell's loading, empty and error states:
  `LoadingState` while the list loads, `EmptyState` with the New receipt
  action when there are no receipts, and the root error boundary
  (`app/error.tsx`) when the read fails.
- Each card links to `/receipts/[id]`, which redirects to the receipt's next
  step (receipts/flow.md); a finalized receipt opens on Finalize.
- `/` stays public (auth/sign-in.md). A signed-out visitor sees a short
  landing with a Sign in link to `/login`; the summary query never runs for
  them.
- Missing session identity returns 401. An unknown current user returns 401.
  Unexpected failures return the standard generic 500. Errors use
  `{ error: { code, message } }`; raw errors are not returned.

## Examples

| Receipt state | Summary fields | Home badge |
|---|---|---|
| Draft, three participants, no bills | `participantCount: 3`, `settled: null` | Draft |
| Finalized, three participants, all bills settled | `participantCount: 3`, `settled: true` | Paid |
| Finalized, one bill outstanding | `settled: false` | Unpaid |
| No owned, non-deleted receipts | Empty array | Empty state with New receipt action |
| Signed-out request to the endpoint | 401 error envelope | — |
| Signed-out visitor opens `/` | — | Landing with a Sign in link; no error |

## Verify

- Route tests cover owner scoping, deleted receipts, drafts, empty bill lists,
  participant counts, payer names, newest-first ordering, nullable metadata,
  decimal/ISO serialization, each settlement condition, authentication and
  generic errors.
- Component tests cover the optional BillCard status slot and verify raw API
  money/date values are formatted before formatted strings reach the card.
- Run `pnpm typecheck` and `pnpm build`.
- Click or Tab-and-Enter a card: it opens the receipt on its next step.
- Open `/` signed out: the landing shows with a Sign in link, not an error.
- Complete the phone pass in web.md for the home screen, cards, badge and New
  receipt action.
- The component spec no longer lists the missing home-screen `BillCard` use as
  a known gap.

## Constraints & decisions

- The summary endpoint is a home-screen projection; it does not replace or
  widen the existing receipt history or detail APIs.
- `settled` is nullable because a draft or a finalized receipt without bills
  has no settlement state; treating an empty bill list as settled would
  incorrectly show Paid.
- The summary is read-only and does not recalculate bill amounts or mutate
  receipt state.
- Formatting remains in the screen so locale and presentation choices do not
  become part of the API contract.

## Out of scope

- Filtering, search, pagination and marking bills paid from the list are not
  part of this screen; bill settlement mutations are specified in [bill reads](list.md).
- Receipt creation and editing are specified in the receipt upload and edit
  specs.
