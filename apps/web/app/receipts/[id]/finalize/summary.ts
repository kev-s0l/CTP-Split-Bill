// Display model for the finalize screen (docs/specs/receipts/finalize-screen.md):
// rows, readiness labels, mismatch sentences and confirmation text. Pure, with
// no database import, so it is unit-tested directly.

export type Amounts = { subtotal: string; tax: string; tip: string; owes: string };

export type SummaryRow = Amounts & {
  participantId: string;
  name: string;
  // Badge text, or null when the row shows none.
  readiness: string | null;
};

export type Summary = { rows: SummaryRow[]; totals: Amounts };

// One person's amounts as previewed or billed, two-decimal strings.
export type Allocation = {
  participantId: string;
  subtotal: string;
  taxShare: string;
  tipShare: string;
  amountOwed: string;
};

export type SummaryParticipant = {
  id: string;
  displayName: string;
  hasPickLink: boolean;
  picksSubmittedAt: Date | string | null;
};

export type TotalsCheck = {
  itemsDifference: string | null;
  amountsDifference: string | null;
  reconciled: boolean;
};

// Two-decimal strings to integer cents, so column sums are exact.
function cents(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -amount : amount;
}

function fromCents(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export function formatAmount(value: string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));
}

export function readinessLabel(
  participant: SummaryParticipant,
  splitMode: string,
  organizerParticipantId: string | null,
): string | null {
  if (participant.id === organizerParticipantId) return "You";
  if (splitMode === "EVEN") return null;
  if (participant.picksSubmittedAt !== null) return "Done picking";
  if (participant.hasPickLink) return "Still picking";
  return "No link";
}

// Rows in the allocations' order, with formatted amounts and a Total row.
// Readiness is omitted (null) for a finalized receipt: pass no receipt state.
export function buildSummary(
  allocations: Allocation[],
  participants: SummaryParticipant[],
  currency: string,
  readiness: { splitMode: string; organizerParticipantId: string | null } | null,
): Summary {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const sums = { subtotal: 0n, tax: 0n, tip: 0n, owes: 0n };
  const money = (value: string) => formatAmount(value, currency);
  const rows = allocations.map((a) => {
    sums.subtotal += cents(a.subtotal);
    sums.tax += cents(a.taxShare);
    sums.tip += cents(a.tipShare);
    sums.owes += cents(a.amountOwed);
    const participant = byId.get(a.participantId);
    return {
      participantId: a.participantId,
      name: participant?.displayName ?? "Unknown",
      subtotal: money(a.subtotal),
      tax: money(a.taxShare),
      tip: money(a.tipShare),
      owes: money(a.amountOwed),
      readiness:
        readiness && participant
          ? readinessLabel(participant, readiness.splitMode, readiness.organizerParticipantId)
          : null,
    };
  });
  return {
    rows,
    totals: {
      subtotal: money(fromCents(sums.subtotal)),
      tax: money(fromCents(sums.tax)),
      tip: money(fromCents(sums.tip)),
      owes: money(fromCents(sums.owes)),
    },
  };
}

// One sentence per thing that doesn't add up. Differences are signed:
// itemsDifference is subtotal − items, amountsDifference is total − (subtotal + tax + tip).
export function mismatchMessages(totals: TotalsCheck, currency: string): string[] {
  const messages: string[] = [];
  if (totals.itemsDifference === null || totals.amountsDifference === null) {
    messages.push("Some item prices or amounts are missing.");
  }
  const describe = (difference: string | null, what: string, target: string) => {
    if (difference === null) return;
    const value = cents(difference);
    if (value === 0n) return;
    const amount = formatAmount(fromCents(value < 0n ? -value : value), currency);
    messages.push(`${what} ${amount} ${value > 0n ? "short of" : "over"} the ${target}.`);
  };
  describe(totals.itemsDifference, "The items are", "subtotal");
  describe(totals.amountsDifference, "Subtotal, tax and tip are", "total");
  return messages;
}

export function confirmationText(billCount: number, total: string): string {
  const bills = billCount === 1 ? "1 bill" : `${billCount} bills`;
  return `This creates ${bills} totaling ${total}. The receipt can't be edited after this.`;
}
