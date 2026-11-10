// Separate process so the caller can stop OCR even during worker initialization.
const { createWorker, OEM } = require("tesseract.js");

process.once("message", async ({ data, langPath }) => {
  let worker;
  let text;
  try {
    worker = await createWorker("eng", OEM.LSTM_ONLY, {
      langPath, gzip: false, cacheMethod: "none",
      logger: () => {}, errorHandler: () => {},
    });
    const result = await worker.recognize(Buffer.from(data));
    if (typeof result.data.text === "string" && result.data.text.length <= 100_000) text = result.data.text;
  } catch {
    // Only the status crosses IPC. Parser and image details stay private.
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
  if (process.send) process.send(text === undefined ? { failed: true } : { text });
});
