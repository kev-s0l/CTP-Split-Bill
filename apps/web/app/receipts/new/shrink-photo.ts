// Shrinks an oversized receipt photo in the browser before upload
// (docs/specs/receipts/upload-screen.md, "Shrinking"). The sizing rules are
// pure; shrinkPhoto itself needs a browser canvas.

// Mirrors MAX_ATTACHMENT_BYTES in receipts/upload.md; the server stays the
// authority.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SIDE_PX = 2400;
export const JPEG_QUALITIES = [0.85, 0.7] as const;

export function needsShrink(size: number): boolean {
  return size > MAX_UPLOAD_BYTES;
}

// The largest size with the same aspect ratio whose longest side is at most
// maxSide. Never enlarges.
export function fitWithin(width: number, height: number, maxSide = MAX_SIDE_PX): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]*$/, "") || "receipt";
  return `${base}.jpg`;
}

// Returns the file unchanged when it fits, a smaller JPEG when shrinking
// works, or null when the photo can't be decoded or is still too large.
export async function shrinkPhoto(file: File): Promise<File | null> {
  if (!needsShrink(file.size)) return file;
  let bitmap: ImageBitmap;
  try {
    // from-image applies the camera's EXIF orientation, so the result is upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of JPEG_QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && !needsShrink(blob.size)) {
        return new File([blob], jpegName(file.name), { type: "image/jpeg" });
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}
