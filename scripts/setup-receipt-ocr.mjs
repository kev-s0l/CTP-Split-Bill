import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata";
const sha256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2";
const configured = process.env.RECEIPT_OCR_DATA_DIR;
if (configured && !isAbsolute(configured)) throw new Error("RECEIPT_OCR_DATA_DIR must be absolute");
const directory = configured ?? fileURLToPath(new URL("../.ocr/", import.meta.url));
const target = join(directory, "eng.traineddata");
const digest = (data) => createHash("sha256").update(data).digest("hex");
const existing = await readFile(target).catch(() => null);
if (existing && digest(existing) === sha256) {
  console.log("Local English OCR data is ready (SHA-256 verified).");
} else {
  const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OCR setup download failed (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== sha256) throw new Error("OCR language-data checksum mismatch");
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, target);
  console.log("Local English OCR data is ready (SHA-256 verified).");
}
