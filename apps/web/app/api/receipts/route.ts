// GET /api/receipts - List the organizer's receipt history.
// POST /api/receipts - Upload a receipt photo and create an organizer-owned draft.

import { randomUUID } from "node:crypto";
import { currentUserId } from "@project/auth";
import {
  apiError, createReceipt, listReceipts, requireReceiptUser, toApiError,
  validateReceiptImage, validateReceiptUpload,
} from "@project/domain";
import { log } from "@project/log";
import { deleteAttachment, MAX_ATTACHMENT_BYTES, storageAvailable, uploadAttachment } from "@project/services";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await currentUserId();
    const receipts = await listReceipts(userId);
    return Response.json(receipts);
  } catch (error) {
    return toApiError(error);
  }
}

function storageUnavailable() {
  return apiError("INTERNAL", "Image storage is unavailable; try again later", 503);
}

export async function POST(req: Request) {
  try {
    const userId = await currentUserId();
    await requireReceiptUser(userId);
    const form = await req.formData().catch(() => null);
    if (!form) {
      return apiError("INVALID_INPUT", "Body must be valid multipart form data", 400);
    }

    const file = validateReceiptUpload(form, MAX_ATTACHMENT_BYTES);
    const data = await file.arrayBuffer();
    validateReceiptImage(data, file.type);
    if (!await storageAvailable()) return storageUnavailable();

    const receiptId = randomUUID();
    let imageBlobName: string;
    try {
      imageBlobName = await uploadAttachment(receiptId, file.name, file.type, data);
    } catch (error) {
      log.error({ err: error, receiptId }, "receipt photo upload failed");
      return storageUnavailable();
    }

    let receipt: Awaited<ReturnType<typeof createReceipt>>;
    try {
      receipt = await createReceipt(userId, { id: receiptId, imageBlobName, imageContentType: file.type });
    } catch (error) {
      try {
        await deleteAttachment(imageBlobName);
      } catch (cleanupError) {
        log.error({ err: cleanupError, receiptId }, "failed to clean up uncommitted receipt photo");
      }
      throw error;
    }

    // Creation is durable; a cache failure must not turn success into a retry.
    try {
      revalidatePath("/api/receipts");
    } catch (error) {
      log.error({ err: error, receiptId }, "failed to revalidate receipt collection");
    }
    return Response.json(receipt, {
      status: 201,
      headers: { Location: `/api/receipts/${receipt.id}` },
    });
  } catch (error) {
    return toApiError(error);
  }
}
