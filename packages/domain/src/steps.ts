// The receipt's five steps and their states, derived from receipt detail
// (docs/specs/receipts/flow.md, "Steps"). Pure, with no database import, so
// the server guard and the client step bar share one rule set.

export const STEP_KEYS = ["scan", "items", "participants", "picks", "finalize"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_LABELS: Record<StepKey, string> = {
  scan: "Scan",
  items: "Items",
  participants: "People",
  picks: "Picks",
  finalize: "Finalize",
};

export type StepState = "done" | "current" | "locked";

export type Step = {
  key: StepKey;
  label: string;
  state: StepState;
  // Why the step is locked, phrased as what to do first; null when available.
  lockedReason: string | null;
};

// The slice of receipt detail the step rules read.
export type StepReceipt = {
  status: string;
  parseStatus: string;
  splitMode: string;
  reviewedAt: Date | string | null;
  organizerParticipantId: string | null;
  participants: { id: string }[];
  items: { assignedParticipantId: string | null; sharedAllocations: { participantId: string }[] }[];
};

// bills/split-allocation.md: what "every item is covered" means per mode.
function itemsCovered(receipt: StepReceipt): boolean {
  switch (receipt.splitMode) {
    case "EVEN":
      return true;
    case "ITEMIZED":
      return receipt.items.every((item) => item.assignedParticipantId !== null);
    case "SHARED_ITEMS":
      return receipt.items.every(
        (item) => item.assignedParticipantId !== null || item.sharedAllocations.length >= 2,
      );
    default:
      return false;
  }
}

export function receiptSteps(receipt: StepReceipt): Step[] {
  const finalized = receipt.status === "FINALIZED";
  const reviewed = receipt.reviewedAt !== null;
  const scanFinished = receipt.parseStatus === "SUCCEEDED" || receipt.parseStatus === "FAILED";
  const others = receipt.participants.filter((p) => p.id !== receipt.organizerParticipantId).length;

  const scanDone = receipt.parseStatus === "SUCCEEDED" || (receipt.parseStatus === "FAILED" && reviewed);
  const itemsDone = scanFinished && reviewed;
  const peopleDone = itemsDone && others > 0;
  const picksDone = peopleDone && itemsCovered(receipt);

  const rules: Record<StepKey, { available: boolean; done: boolean; reason: string }> = {
    scan: { available: true, done: scanDone, reason: "" },
    // Items opens once the scan finishes either way, so a failed scan can be
    // entered by hand before Scan counts as done.
    items: { available: scanFinished, done: itemsDone, reason: "Wait for the scan to finish" },
    participants: { available: itemsDone, done: peopleDone, reason: "Review the items first" },
    picks: { available: peopleDone, done: picksDone, reason: "Add someone besides you" },
    finalize: { available: picksDone, done: finalized, reason: "Assign every item" },
  };

  return STEP_KEYS.map((key) => {
    const rule = rules[key];
    const state: StepState = finalized || rule.done ? "done" : rule.available ? "current" : "locked";
    return { key, label: STEP_LABELS[key], state, lockedReason: state === "locked" ? rule.reason : null };
  });
}

// Where a locked step's page redirects: the furthest step that is not locked.
export function furthestAvailableStep(steps: Step[]): StepKey {
  return [...steps].reverse().find((step) => step.state !== "locked")!.key;
}

// Where /receipts/[id] lands: the first step still to do, or Finalize when
// everything before it is done.
export function landingStep(steps: Step[]): StepKey {
  return steps.find((step) => step.state === "current")?.key ?? "finalize";
}
