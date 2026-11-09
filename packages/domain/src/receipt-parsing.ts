import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";
import { receiptDetail, ExpectedRevision } from "./receipt";
import { receiptScope, requireReceiptUser } from "./receipt-access";

// Starting and finishing an attempt each consume a PostgreSQL integer revision.
export const ParseReceipt = ExpectedRevision.extend({
  expectedRevision: z.number().int().positive().max(2147483645),
});
const money = z.string().regex(/^\d{1,10}\.\d{2}$/);
const quantity = z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/).refine((v) => /[1-9]/.test(v));
const Extraction = z.object({
  merchantName: z.string().trim().min(1).max(200).nullable(),
  address: z.string().trim().min(1).max(500).nullable(),
  purchasedAt: z.string().datetime().nullable(),
  subtotal: money.nullable(), tax: money.nullable(), tip: money.nullable(), total: money.nullable(),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(200), quantity: quantity.nullable(),
    unitPrice: money.nullable(), totalPrice: money,
  })).min(1).max(500),
});

// Only explicit labels and line prices are extracted. Missing quantities and
// unit prices remain unknown, even when assuming one would balance the receipt.
export function extractReceiptText(text: unknown) {
  if (typeof text !== "string" || text.length > 100_000) {
    throw new ApiError("INVALID_INPUT", "Receipt extraction is invalid", 400);
  }
  const result: z.infer<typeof Extraction> = {
    merchantName: null, address: null, purchasedAt: null,
    subtotal: null, tax: null, tip: null, total: null, items: [],
  };
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, " ");
    const amount = line.match(/^(sub\s*total|tax|tip|total)\s*:?\s*\$?(\d+\.\d{2})$/i);
    if (amount) {
      const key = amount[1].toLowerCase().replace(/\s/g, "") as "subtotal" | "tax" | "tip" | "total";
      result[key] = seen.has(key) ? null : amount[2];
      seen.add(key);
      continue;
    }
    const metadata = line.match(/^(merchant|store|address|date)\s*:\s*(.+)$/i);
    if (metadata) {
      const key = metadata[1].toLowerCase();
      const field = key === "merchant" || key === "store" ? "merchantName" : key === "date" ? "purchasedAt" : "address";
      const value = metadata[2];
      const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
      result[field] = seen.has(field) ? null : field === "purchasedAt"
        ? date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.toISOString() : null
        : value;
      seen.add(field);
      continue;
    }
    // Summary/payment lines and negative adjustments must not become food items.
    if (/^(?:sub\s*total|tax|tip|total|cash|change|card|visa|mastercard|amex|payment|paid|balance|discount|refund|savings|service|gratuity|amount|thank|tel|phone|order|table|check|receipt|date)\b/i.test(line)) continue;
    const item = line.match(/^(.+?)\s+\$?(\d+\.\d{2})$/);
    if (!item || !/[a-z]/i.test(item[1]) || /[-−]\s*\$?\s*$/.test(item[1])) continue;
    const explicit = item[1].match(/^(\d+(?:\.\d{1,3})?)\s*[x×]\s+(.+?)\s+@\s*\$?(\d+\.\d{2})$/i);
    result.items.push({
      name: explicit ? explicit[2] : item[1], quantity: explicit ? explicit[1] : null,
      unitPrice: explicit ? explicit[3] : null, totalPrice: item[2],
    });
  }
  const parsed = Extraction.safeParse(result);
  if (!parsed.success) throw new ApiError("INVALID_INPUT", "Photo has no usable receipt extraction; correct it manually", 400);
  return parsed.data;
}

export async function startReceiptParsing(userId: string, receiptId: string, expectedRevision: number) {
  await requireReceiptUser(userId);
  if (!ParseReceipt.safeParse({ expectedRevision }).success) {
    throw new ApiError("INVALID_INPUT", "Invalid parsing revision", 400);
  }
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    const started = await tx.receipt.updateMany({
      where: {
        ...scope, status: "DRAFT", revision: expectedRevision,
        OR: [{ parseStatus: { not: "PARSING" } }, { updatedAt: { lt: new Date(Date.now() - 300_000) } }],
      },
      data: { parseStatus: "PARSING", parseError: null, revision: { increment: 1 } },
    });
    if (!started.count) {
      const receipt = await tx.receipt.findFirst({ where: scope, select: { id: true } });
      if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
      throw new ApiError("CONFLICT", "Receipt has changed or cannot be parsed; reload before retrying", 409);
    }
    return tx.receipt.findFirstOrThrow({
      where: scope, select: { revision: true, imageBlobName: true, imageContentType: true },
    });
  });
}

export async function completeReceiptParsing(userId: string, receiptId: string, revision: number, text: unknown) {
  await requireReceiptUser(userId);
  const extracted = extractReceiptText(text);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    const completed = await tx.receipt.updateMany({
      where: { ...scope, status: "DRAFT", parseStatus: "PARSING", revision },
      data: {
        merchantName: extracted.merchantName, address: extracted.address,
        purchasedAt: extracted.purchasedAt, subtotal: extracted.subtotal,
        tax: extracted.tax, tip: extracted.tip, total: extracted.total,
        extraction: { text: text as string }, parseStatus: "SUCCEEDED", parseError: null,
        reviewedAt: null, revision: { increment: 1 },
      },
    });
    if (!completed.count) throw new ApiError("CONFLICT", "Parsing attempt has been superseded; reload the receipt", 409);
    await tx.sharedItemAllocation.deleteMany({ where: { receiptId, item: { receipt: scope } } });
    await tx.receiptItem.deleteMany({ where: { receiptId, receipt: scope } });
    await tx.receiptItem.createMany({
      data: extracted.items.map((item, index) => ({ ...item, receiptId, lineNumber: index + 1, isVerified: false })),
    });
    return tx.receipt.findFirstOrThrow({ where: scope, select: receiptDetail });
  });
}

export async function failReceiptParsing(userId: string, receiptId: string, revision: number) {
  await requireReceiptUser(userId);
  return prisma.receipt.updateMany({
    where: { ...receiptScope(userId, receiptId), status: "DRAFT", parseStatus: "PARSING", revision },
    data: { parseStatus: "FAILED", parseError: "Receipt parsing failed; retry or correct manually", revision: { increment: 1 } },
  });
}
