import { currentUserId } from "@project/auth";
import { revalidatePath } from "next/cache";
import { log } from "@project/log";
import {
  ApiError, apiError, invalidInput, ParseReceipt, requireReceiptUser, toApiError,
  startReceiptParsing, completeReceiptParsing, failReceiptParsing,
} from "@project/domain";
import { downloadAttachment, recognizeReceipt } from "@project/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentUserId();
    await requireReceiptUser(me);
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = ParseReceipt.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const attempt = await startReceiptParsing(me, id, parsed.data.expectedRevision);
    let receipt;
    try {
      const image = await downloadAttachment(attempt.imageBlobName).catch(() => {
        throw new ApiError("INTERNAL", "Image storage is unavailable; try again later", 503);
      });
      if (!image) throw new ApiError("NOT_FOUND", "Receipt image not found", 404);
      const text = await recognizeReceipt(image.data).catch(() => {
        throw new ApiError("INTERNAL", "Receipt OCR is unavailable; try again later", 503);
      });
      receipt = await completeReceiptParsing(me, id, attempt.revision, text);
    } catch (error) {
      // Failure recording is guarded too: an expired attempt cannot touch a retry.
      await failReceiptParsing(me, id, attempt.revision).catch(() => {
        log.error({ receiptId: id }, "could not record receipt parsing failure");
      });
      throw error;
    }
    try {
      revalidatePath(`/api/receipts/${id}`);
      revalidatePath("/api/receipts");
    } catch {
      log.error({ receiptId: id }, "could not revalidate parsed receipt");
    }
    return Response.json(receipt);
  } catch (error) {
    return toApiError(error);
  }
}
