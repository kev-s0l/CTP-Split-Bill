import { fork, type ForkOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { MAX_ATTACHMENT_BYTES } from "./storage";

// pnpm starts processes both at the workspace root and inside apps/web. Finding
// the manifest avoids tying runtime asset paths to a bundler's output directory.
function workspaceRoot() {
  let directory = process.cwd();
  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error("OCR workspace is unavailable");
    directory = parent;
  }
  return directory;
}

// Turbopack (next dev) treats a fork() argument it can partly evaluate as a
// module reference and fails the route when the guess misses. Taking the path
// as a parameter leaves only a runtime value for it to see.
function forkWorker(file: string, options: ForkOptions) {
  return fork(file, [], options);
}

export async function recognizeReceipt(data: Uint8Array): Promise<string> {
  if (!data.byteLength || data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("OCR image size is invalid");
  const root = workspaceRoot();
  const configured = process.env.RECEIPT_OCR_DATA_DIR;
  if (configured && !isAbsolute(configured)) throw new Error("OCR data directory must be absolute");
  const langPath = configured ?? resolve(root, ".ocr");
  await access(join(langPath, "eng.traineddata"));

  // Isolate Tesseract initialization as well as recognition. Killing this
  // process also ends its worker threads if createWorker never resolves.
  return new Promise((resolveText, reject) => {
    const child = forkWorker(join(root, "packages/services/src/ocr-worker.cjs"), {
      execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
    });
    let finished = false;
    const finish = (text?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      if (text !== undefined) resolveText(text);
      else reject(new Error("Receipt OCR is unavailable; retry or correct manually"));
    };
    const timer = setTimeout(() => finish(), 60_000);
    child.once("error", () => finish());
    child.once("exit", () => finish());
    child.once("message", (message: unknown) => {
      const text = (message as { text?: unknown } | null)?.text;
      finish(typeof text === "string" && text.length <= 100_000 ? text : undefined);
    });
    try {
      child.send({ data: Buffer.from(data), langPath }, (error) => { if (error) finish(); });
    } catch {
      finish();
    }
  });
}
