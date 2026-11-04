// Bill links: the organizer issues a bearer link per bill and sends it from their
// own messaging app; holding the link is the authorization to read that one bill.
// Only token hashes are stored. See ADR-0016 and docs/specs/bills/public-share.md.
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@project/db";
import { ApiError } from "./errors";
import { billDetail, presentBill } from "./bills";
import { requireReceiptUser } from "./receipt-access";

export const BILL_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const BILL_LINK_PATH = "/b/";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const billNotFound = () => new ApiError("NOT_FOUND", "Bill not found", 404);

const linkReceipt = { paidByParticipantId: true, title: true, merchantName: true, purchasedAt: true, currency: true } as const;

async function findOwnedBill(userId: string, billId: string) {
  await requireReceiptUser(userId);
  // Undefined Prisma filters are omitted; never let a missing route id widen a query.
  if (typeof billId !== "string" || billId.trim() === "") throw billNotFound();
  const bill = await prisma.bill.findFirst({
    where: { id: billId, receipt: { ownerId: userId, deletedAt: null } },
    select: { ...billDetail, receipt: { select: linkReceipt } },
  });
  if (!bill) throw billNotFound();
  return bill;
}

function formatMoney(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

// Issuing replaces any live link for the bill, so the previous link stops working.
export async function issueBillLink(userId: string, billId: string, baseUrl: string, now = new Date()) {
  const bill = await findOwnedBill(userId, billId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + BILL_LINK_TTL_MS);
  await prisma.$transaction([
    prisma.billLink.updateMany({ where: { billId: bill.id, revokedAt: null }, data: { revokedAt: now } }),
    prisma.billLink.create({ data: { billId: bill.id, tokenHash: hashToken(token), expiresAt, createdAt: now } }),
  ]);
  const url = `${baseUrl.replace(/\/+$/, "")}${BILL_LINK_PATH}${token}`;
  const place = bill.receipt.merchantName ?? bill.receipt.title ?? "the bill";
  const amount = formatMoney(presentBill(bill, bill.receipt.paidByParticipantId).amountOwed, bill.receipt.currency);
  const message = `Hi ${bill.participant.displayName}, your share of ${place} is ${amount}. View your bill: ${url}`;
  return {
    url, expiresAt, message,
    smsHref: bill.participant.phone ? `sms:${bill.participant.phone}?body=${encodeURIComponent(message)}` : null,
  };
}

export async function revokeBillLink(userId: string, billId: string, now = new Date()) {
  const bill = await findOwnedBill(userId, billId);
  await prisma.billLink.updateMany({ where: { billId: bill.id, revokedAt: null }, data: { revokedAt: now } });
}

// Public read. Unknown, malformed, revoked, expired and deleted-receipt links are
// indistinguishable 404s. The projection omits ids, phones and other participants.
export async function readBillLink(token: string, now = new Date()) {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw billNotFound();
  const link = await prisma.billLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      expiresAt: true, revokedAt: true,
      bill: { select: { ...billDetail, receipt: { select: { ...linkReceipt, deletedAt: true } } } },
    },
  });
  if (!link || link.revokedAt !== null || link.expiresAt <= now || link.bill.receipt.deletedAt !== null) {
    throw billNotFound();
  }
  const { receipt, ...detail } = link.bill;
  const bill = presentBill(detail, receipt.paidByParticipantId);
  return {
    displayName: bill.displayName,
    subtotal: bill.subtotal, taxShare: bill.taxShare, tipShare: bill.tipShare, amountOwed: bill.amountOwed,
    paidAt: bill.paidAt, settled: bill.settled, outstandingAmount: bill.outstandingAmount,
    receipt: { title: receipt.title, merchantName: receipt.merchantName, purchasedAt: receipt.purchasedAt, currency: receipt.currency },
    expiresAt: link.expiresAt,
  };
}
