import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fork: vi.fn(), access: vi.fn() }));
vi.mock("node:child_process", () => ({ fork: mocks.fork }));
vi.mock("node:fs/promises", () => ({ access: mocks.access }));
import { recognizeReceipt } from "../src/ocr";

let child: EventEmitter & { kill: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  mocks.access.mockReset().mockResolvedValue(undefined);
  child = Object.assign(new EventEmitter(), { kill: vi.fn(), send: vi.fn((_data, callback) => callback(null)) });
  mocks.fork.mockReset().mockReturnValue(child);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("bounded local OCR", () => {
  it("uses local data, returns recognized text and stops the process", async () => {
    const promise = recognizeReceipt(Uint8Array.from([1, 2, 3]));
    await Promise.resolve();
    expect(mocks.access).toHaveBeenCalledWith(expect.stringMatching(/eng\.traineddata$/));
    expect(child.send).toHaveBeenCalledWith({ data: Buffer.from([1, 2, 3]), langPath: expect.any(String) }, expect.any(Function));
    child.emit("message", { text: "Soup 10.00" });
    await expect(promise).resolves.toBe("Soup 10.00");
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("kills a stalled process after 60 seconds, including stalled initialization", async () => {
    const promise = recognizeReceipt(Uint8Array.from([1]));
    const checked = expect(promise).rejects.toThrow("Receipt OCR is unavailable");
    await vi.advanceTimersByTimeAsync(60_000);
    await checked;
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it.each(["error", "exit", "invalid", "oversized"])("stops the process on %s", async (kind) => {
    const promise = recognizeReceipt(Uint8Array.from([1]));
    const checked = expect(promise).rejects.toThrow("Receipt OCR is unavailable");
    await Promise.resolve();
    if (kind === "invalid" || kind === "oversized") child.emit("message", { text: kind === "invalid" ? 2 : "x".repeat(100_001) });
    else child.emit(kind, kind === "error" ? new Error("private initialization failure") : 1);
    await checked;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails before starting OCR if local language data is missing", async () => {
    mocks.access.mockRejectedValueOnce(new Error("missing language data"));
    await expect(recognizeReceipt(Uint8Array.from([1]))).rejects.toThrow();
    expect(mocks.fork).not.toHaveBeenCalled();
  });

  it("rejects URL/relative language-data configuration and invalid image sizes", async () => {
    vi.stubEnv("RECEIPT_OCR_DATA_DIR", "https://example.com/model");
    await expect(recognizeReceipt(Uint8Array.from([1]))).rejects.toThrow();
    vi.unstubAllEnvs();
    await expect(recognizeReceipt(new Uint8Array())).rejects.toThrow();
    await expect(recognizeReceipt(new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow();
    expect(mocks.fork).not.toHaveBeenCalled();
  });
});
