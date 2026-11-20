// Receipt parsing spike against the Classroom AI gateway (Ryan's API).
// Chain per receipt: decide (is this a readable receipt?) -> vision (extract JSON) -> cleanup checks.
//
// Usage:
//   node --env-file=.env scripts/gateway-spike.mjs test-receipts/r1.jpg [more images...]
//
// .env (never commit this file):
//   CLASSROOM_AI_URL=https://<gateway-host>/v1
//   CLASSROOM_AI_KEY=sk-...
//
// Rate limit: 2 requests per 10 seconds for the whole team, and each receipt uses 2
// (decide + vision), so receipts are spaced ~10s apart. Don't run this in a loop over
// dozens of files while teammates are testing.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";

const BASE = process.env.CLASSROOM_AI_URL?.replace(/\/$/, "");
const KEY = process.env.CLASSROOM_AI_KEY;
if (!BASE || !KEY) {
  console.error("Set CLASSROOM_AI_URL and CLASSROOM_AI_KEY in .env and run with: node --env-file=.env ...");
  process.exit(1);
}
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node --env-file=.env scripts/gateway-spike.mjs <receipt image> [...]");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

// POST with one retry on 429/502, waiting the 10s the gateway asks for.
async function post(path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status === 502) && attempt < 3) {
      console.log(`  ${res.status} from ${path}, waiting 10s and retrying...`);
      await sleep(10_000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${path} failed ${res.status}: ${text}`);
    return JSON.parse(text);
  }
}

const PROMPT = `Read this restaurant receipt and reply with ONLY minified JSON (no markdown, no explanation) in exactly this shape:
{"merchantName":string|null,"address":string|null,"purchasedAt":"YYYY-MM-DD"|null,"subtotal":"0.00"|null,"tax":"0.00"|null,"tip":"0.00"|null,"discount":"0.00"|null,"total":"0.00"|null,"items":[{"name":string,"quantity":"1"|null,"unitPrice":"0.00"|null,"totalPrice":"0.00"}]}
Rules:
- items: only food/drink lines. Skip subtotal, tax, tip, total, payment, card, cash and change lines.
- merchantName is the business name, usually the large text or logo at the top.
- Put a printed quantity (e.g. "3 MARTINI") in quantity, not in the name.
- Copy every amount exactly as printed. Never multiply or calculate: if "3 MARTINI 39.00" is printed, totalPrice is "39.00".
- Money values are plain numbers with two decimals, like "12.50": no $ signs or commas.
- purchasedAt must be YYYY-MM-DD.
- tax is only a line labeled tax. A service fee or percentage fee (e.g. "16% Fee") goes in tip.
- tip is only a printed tip line or a handwritten tip. Ignore suggested-tip tables. Use null if there is none.
- Use null for anything not clearly printed; never guess.`;

async function parseReceipt(file) {
  const mime = MIME[extname(file).toLowerCase()] ?? "image/jpeg";
  const dataUrl = `data:${mime};base64,${(await readFile(file)).toString("base64")}`;

  // 1) decide: cheap gate before spending a vision call.
  let t = Date.now();
  const decision = await post("/decide", {
    model: "decide",
    state: "A photo a user uploaded to a bill-splitting app.",
    images: [dataUrl],
    questions: {
      readable_receipt: {
        type: "noul",
        instructions: "Is this a photo of a restaurant or store receipt whose item names and prices are clearly readable?",
      },
    },
  });
  console.log(`  decide (${((Date.now() - t) / 1000).toFixed(1)}s):`, JSON.stringify(decision.answers ?? decision));

  // 2) vision: extract the receipt as JSON.
  t = Date.now();
  const res = await post("/chat/completions", {
    model: "vision",
    temperature: 0,
    messages: [{ role: "user", content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: dataUrl } },
    ] }],
  });
  const seconds = ((Date.now() - t) / 1000).toFixed(1);
  const choice = res.choices?.[0];
  // The gateway may return content as a string, an array of parts, or an object.
  const content = choice?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("")
      : content && typeof content === "object"
        ? (typeof content.text === "string" ? content.text : JSON.stringify(content))
        : "";
  if (!text) console.log("  raw vision response:", JSON.stringify(res).slice(0, 2000));
  const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (choice?.finish_reason === "length") {
    console.log("  ⚠️ vision hit its 512-token output limit; the JSON is probably cut off.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log(`  vision (${seconds}s) did not return valid JSON:\n${raw}`);
    return;
  }
  console.log(JSON.stringify(parsed, null, 2));
  console.log(`  vision: ${seconds}s, ${parsed.items?.length ?? 0} items, finish_reason=${choice?.finish_reason}`);

  // 3) checks: items vs subtotal here, plus Sahla's cleanup if it's in scripts/.
  const cents = (v) => {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const itemSum = (parsed.items ?? []).reduce((s, i) => s + (cents(i.totalPrice) ?? 0), 0);
  const sub = cents(parsed.subtotal);
  console.log(`  items sum ${(itemSum / 100).toFixed(2)} vs subtotal ${parsed.subtotal ?? "null"}` +
    (sub === null ? "" : sub === itemSum ? "  ✅ matches" : "  ⚠️ mismatch"));

  const cleanupPath = new URL("./qwen-spike-cleanup.mjs", import.meta.url);
  if (existsSync(cleanupPath)) {
    const { removeZeroPricedItems, fixUnitPrices, checkReceiptTotals } = await import(cleanupPath.href);
    const items = fixUnitPrices(removeZeroPricedItems(parsed.items ?? []));
    console.log(`  cleanup: ${parsed.items?.length ?? 0} -> ${items.length} items; totals check:`, JSON.stringify(checkReceiptTotals(parsed)));
  }
}

for (const [i, file] of files.entries()) {
  if (i > 0) await sleep(10_000); // stay under 2 requests / 10s
  console.log(`\n=== ${file}`);
  try {
    await parseReceipt(file);
  } catch (e) {
    console.log(`  error: ${e.message}`);
  }
}
