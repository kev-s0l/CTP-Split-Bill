import { currentUserId } from "@project/auth";
import { ApiError, getReceiptImage, toApiError } from "@project/domain";
import { downloadAttachment } from "@project/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentUserId();
    const { id } = await params;
    const image = await getReceiptImage(me, id);
    const stored = await downloadAttachment(image.imageBlobName).catch(() => {
      throw new ApiError("INTERNAL", "Image storage is unavailable; try again later", 503);
    });
    if (!stored) throw new ApiError("NOT_FOUND", "Receipt image not found", 404);
    return new Response(Uint8Array.from(stored.data).buffer, {
      headers: {
        "Content-Type": image.imageContentType,
        "Content-Length": String(stored.data.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = toApiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
