// Qwen receipt-parsing spike for Split Bill.
// Usage: node scripts/qwen-spike.mjs path/to/receipt.jpg [model]
// Needs Ollama running locally (http://localhost:11434) with a Qwen vision model.
// Output shape mirrors the Extraction schema in packages/domain/src/receipt-parsing.ts.

import { readFile } from "node:fs/promises";

const [imagePath, model = "qwen2.5vl:3b"] = process.argv.slice(2);
if (!imagePath) {
  console.error("Usage: node scripts/qwen-spike.mjs <receipt image> [model]");
  process.exit(1);
}

const money = { type: ["string", "null"], pattern: "^\\d{1,10}\\.\\d{2}$" };
const schema = {
  type: "object",
  properties: {
    merchantName: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    purchasedAt: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
    subtotal: money, tax: money, tip: money, total: money,
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: ["string", "null"] },
          unitPrice: money,
          totalPrice: { type: "string", pattern: "^\\d{1,10}\\.\\d{2}$" },
        },
        required: ["name", "quantity", "unitPrice", "totalPrice"],
      },
    },
  },
  required: ["merchantName", "address", "purchasedAt", "subtotal", "tax", "tip", "total", "items"],
};

const prompt = `Read this restaurant receipt and return JSON only.
Rules:
- items: only food/drink lines. Skip subtotal, tax, tip, total, payment, change and discount lines.  // temporary
- Money values are strings with two decimals, e.g. "12.50".
- If a value is not clearly printed, use null. Do not guess quantities or unit prices.
- purchasedAt is YYYY-MM-DD or null.`;

const image = (await readFile(imagePath)).toString("base64");
const started = Date.now();
const res = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    format: schema,
    options: { temperature: 0 },
    messages: [{ role: "user", content: prompt, images: [image] }],
  }),
});
if (!res.ok) {
  console.error(`Ollama error ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const raw = (await res.json()).message.content;

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error("Model did not return valid JSON:\n" + raw);
  process.exit(1);
}

console.log(JSON.stringify(parsed, null, 2));

// Quick sanity check: do the item prices add up to the printed subtotal?
const cents = (v) => Math.round(Number(v) * 100);
const itemSum = parsed.items.reduce((sum, item) => sum + cents(item.totalPrice), 0);
console.log(`\nModel: ${model}`);
console.log(`Time: ${seconds}s`);
console.log(`Items found: ${parsed.items.length}`);
console.log(`Items sum: ${(itemSum / 100).toFixed(2)} | printed subtotal: ${parsed.subtotal ?? "null"}` +
  (parsed.subtotal ? (cents(parsed.subtotal) === itemSum ? "  Items match!" : "  Items mismatch!") : ""));