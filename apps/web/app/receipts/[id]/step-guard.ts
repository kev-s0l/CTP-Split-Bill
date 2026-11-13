// Server-side reads and gating for the receipt step pages
// (docs/specs/receipts/flow.md, "Gating"). The layout and the step page share
// one receipt read per request through React cache().
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { currentUserId } from "@project/auth";
import { ApiError, getReceipt } from "@project/domain";
import { type StepKey, furthestAvailableStep, receiptSteps } from "@project/domain/steps";
import { loginPath } from "../../lib/page-access";

export type ReceiptDetail = Awaited<ReturnType<typeof getReceipt>>;

const readReceipt = cache((userId: string, receiptId: string) => getReceipt(userId, receiptId));

export function stepPath(receiptId: string, step: StepKey): string {
  return `/receipts/${encodeURIComponent(receiptId)}/${step}`;
}

// The signed-in user's receipt, or the not-found page. callbackPath is where
// sign-in returns to if the session ended after the middleware check.
export async function loadReceipt(receiptId: string, callbackPath: string): Promise<ReceiptDetail> {
  const signIn = loginPath(callbackPath);
  const userId = await currentUserId();
  if (!userId) redirect(signIn);
  try {
    return await readReceipt(userId, receiptId);
  } catch (e) {
    // Foreign and unknown receipts look the same: not found, never forbidden.
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 401) redirect(signIn);
    throw e;
  }
}

// Redirects (307) to the furthest available step when `step` is locked.
export function requireStep(receipt: ReceiptDetail, step: StepKey): void {
  const steps = receiptSteps(receipt);
  if (steps.find((s) => s.key === step)!.state === "locked") {
    redirect(stepPath(receipt.id, furthestAvailableStep(steps)));
  }
}

// What every step page calls before rendering.
export async function loadStep(receiptId: string, step: StepKey): Promise<ReceiptDetail> {
  const receipt = await loadReceipt(receiptId, stepPath(receiptId, step));
  requireStep(receipt, step);
  return receipt;
}
