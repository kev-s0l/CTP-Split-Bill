// Pure logic for the Items step (docs/specs/receipts/edit-screen.md): the form
// model, field and row checks, the totals check in integer cents, Confirm's
// pre-check, and the request bodies for Save and Confirm.

export type FormRow = { key: string; name: string; qty: string; price: string };

export type ReceiptForm = {
  merchant: string;
  date: string; // YYYY-MM-DD or ""
  subtotal: string;
  tax: string;
  tip: string;
  total: string;
  rows: FormRow[];
};

export type MoneyField = "subtotal" | "tax" | "tip" | "total";
export const MONEY_FIELDS: MoneyField[] = ["subtotal", "tax", "tip", "total"];

export type EditorReceipt = {
  id: string;
  revision: number;
  status: string;
  pickingOpen: boolean;
  reviewed: boolean;
  form: ReceiptForm;
};

export const MESSAGES = {
  money: "Enter an amount like 12.50",
  qty: "Enter a quantity above 0",
  name: "Enter a name",
  long: "Keep it under 200 characters",
  noItems: "Add at least one item",
  missingTotals: "Fill in the subtotal, tax and total",
  itemsMismatch: "Items don't add up to the subtotal yet",
  amountsMismatch: "Subtotal + tax + tip doesn't match the total yet",
  fixFields: "Fix the highlighted fields",
} as const;

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
// Commas are accepted only as thousands separators: 1,234.50, not 1,2.
const THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
const QTY = /^\d{1,7}(\.\d{1,3})?$/;
const MAX_TEXT = 200;

// ---- conversions -----------------------------------------------------------

type Stored = { toString(): string } | null;

// A stored decimal as an editable string ("12.5" → "12.50"), or "".
function moneyText(value: Stored): string {
  if (value === null) return "";
  const cents = toCents(value.toString());
  return cents === null ? value.toString() : displayMoney(cents);
}

let keySeq = 0;
export function newRowKey(): string {
  keySeq += 1;
  return `row-${keySeq}`;
}

export function toEditorReceipt(r: {
  id: string;
  revision: number;
  status: string;
  picksOpenedAt: Date | string | null;
  reviewedAt: Date | string | null;
  merchantName: string | null;
  purchasedAt: Date | string | null;
  subtotal: Stored;
  tax: Stored;
  tip: Stored;
  total: Stored;
  items: { name: string | null; quantity: Stored; totalPrice: Stored }[];
}): EditorReceipt {
  const purchased = r.purchasedAt === null ? "" : new Date(r.purchasedAt).toISOString().slice(0, 10);
  return {
    id: r.id,
    revision: r.revision,
    status: r.status,
    pickingOpen: r.picksOpenedAt !== null,
    reviewed: r.reviewedAt !== null,
    form: {
      merchant: r.merchantName ?? "",
      date: purchased,
      subtotal: moneyText(r.subtotal),
      tax: moneyText(r.tax),
      tip: moneyText(r.tip),
      total: moneyText(r.total),
      rows: r.items.map((item) => ({
        key: newRowKey(),
        name: item.name ?? "",
        qty: item.quantity === null ? "1" : String(Number(item.quantity.toString())),
        price: moneyText(item.totalPrice),
      })),
    },
  };
}

// The page's subtitle: after a failed scan there is nothing to fix, only
// lines to type.
export function subtitleFor(parseStatus: string): string {
  return parseStatus === "FAILED"
    ? "The scan couldn't read this one. Type the lines from the receipt, then confirm."
    : "Fix anything the scan got wrong, then confirm.";
}

// ---- cents -------------------------------------------------------------------

// What people type from a receipt: a leading "$" and thousands commas are
// fine. Returns the plain amount ("1234.50"), or null when it isn't one.
export function normalizeMoney(text: string): string | null {
  let t = text.trim();
  if (t.startsWith("$")) t = t.slice(1).trim();
  if (t.includes(",")) {
    if (!THOUSANDS.test(t)) return null;
    t = t.replace(/,/g, "");
  }
  return MONEY.test(t) ? t : null;
}

// "12.5", "$12.50" or "1,234" → cents; null for anything that isn't a valid amount.
export function toCents(text: string): number | null {
  const t = normalizeMoney(text);
  if (t === null) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// For people: thousands grouped, always two decimals ("1,024.00").
export function displayMoney(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

// What a money field shows after it loses focus: any accepted way of typing
// an amount ("1024", "$1,024", "1,024.5") becomes "1,024.00". Text that isn't
// an amount is left as typed so its error still makes sense.
export function tidyMoney(text: string): string {
  const cents = toCents(text);
  return cents === null ? text : displayMoney(cents);
}

export function dollars(cents: number): string {
  return `$${displayMoney(Math.abs(cents))}`;
}

// ---- rows and fields -------------------------------------------------------------

// A row with no name and no price is dropped on Save rather than an error.
export function isBlankRow(row: FormRow): boolean {
  return row.name.trim() === "" && row.price.trim() === "";
}

export function itemRows(form: ReceiptForm): FormRow[] {
  return form.rows.filter((row) => !isBlankRow(row));
}

export type RowErrors = { name?: string; qty?: string; price?: string };
export type FormErrors = {
  merchant?: string;
  fields: Partial<Record<MoneyField, string>>;
  rows: Record<string, RowErrors>;
};

function qtyOk(text: string): boolean {
  const t = text.trim();
  return QTY.test(t) && Number(t) > 0;
}

export function formErrors(form: ReceiptForm): FormErrors {
  const errors: FormErrors = { fields: {}, rows: {} };
  if (form.merchant.trim().length > MAX_TEXT) errors.merchant = MESSAGES.long;
  for (const field of MONEY_FIELDS) {
    if (form[field].trim() !== "" && toCents(form[field]) === null) errors.fields[field] = MESSAGES.money;
  }
  for (const row of itemRows(form)) {
    const e: RowErrors = {};
    if (row.name.trim() === "") e.name = MESSAGES.name;
    else if (row.name.trim().length > MAX_TEXT) e.name = MESSAGES.long;
    if (!qtyOk(row.qty)) e.qty = MESSAGES.qty;
    if (toCents(row.price) === null) e.price = MESSAGES.money;
    if (e.name || e.qty || e.price) errors.rows[row.key] = e;
  }
  return errors;
}

export function hasErrors(errors: FormErrors): boolean {
  return errors.merchant !== undefined || Object.keys(errors.fields).length > 0 || Object.keys(errors.rows).length > 0;
}

// The line total divided by the quantity, rounded to the cent. The line
// total is authoritative (receipts/items.md); this is only derived from it.
export function unitPriceCents(totalCents: number, quantity: number): number {
  return Math.round(totalCents / quantity);
}

// The price of one for a row whose Qty isn't 1 ("$2.40"); null otherwise.
export function eachPrice(row: FormRow): string | null {
  const total = toCents(row.price);
  if (!qtyOk(row.qty) || total === null) return null;
  const quantity = Number(row.qty.trim());
  if (quantity === 1) return null;
  return dollars(unitPriceCents(total, quantity));
}

// "10 × $2.40 each": the hint under a row's line total on wider screens, and
// what screen readers hear for it on every screen.
export function eachHint(row: FormRow): string | null {
  const each = eachPrice(row);
  return each === null ? null : `${Number(row.qty.trim())} × ${each} each`;
}

// Removing a row and putting it back (the Undo in the "Removed …" toast).
export function removeRowAt(rows: FormRow[], key: string): { rows: FormRow[]; removed: FormRow | null; index: number } {
  const index = rows.findIndex((row) => row.key === key);
  if (index === -1) return { rows, removed: null, index: -1 };
  return { rows: rows.filter((row) => row.key !== key), removed: rows[index], index };
}

// Puts a removed row back at its old position (or the end, if the list has
// shrunk since). A row that's already there is not added twice.
export function restoreRow(rows: FormRow[], removed: FormRow, index: number): FormRow[] {
  if (rows.some((row) => row.key === removed.key)) return rows;
  const at = Math.min(Math.max(index, 0), rows.length);
  return [...rows.slice(0, at), removed, ...rows.slice(at)];
}

// ---- totals check ------------------------------------------------------------

export type Totals = {
  // Sum of item prices; null while any item price is missing or invalid.
  itemsCents: number | null;
  // subtotal − items; positive means the items are short.
  itemsDiff: number | null;
  // total − (subtotal + tax + tip); positive means the parts are short.
  amountsDiff: number | null;
  partsCents: number | null;
};

export function totals(form: ReceiptForm): Totals {
  const rows = itemRows(form);
  const prices = rows.map((row) => toCents(row.price));
  const itemsCents = rows.length > 0 && prices.every((p) => p !== null) ? prices.reduce<number>((a, p) => a + p!, 0) : rows.length === 0 ? 0 : null;
  const subtotal = toCents(form.subtotal);
  const tax = toCents(form.tax);
  const tip = form.tip.trim() === "" ? 0 : toCents(form.tip);
  const total = toCents(form.total);
  const partsCents = subtotal !== null && tax !== null && tip !== null ? subtotal + tax + tip : null;
  return {
    itemsCents,
    itemsDiff: subtotal !== null && itemsCents !== null ? subtotal - itemsCents : null,
    amountsDiff: partsCents !== null && total !== null ? total - partsCents : null,
    partsCents,
  };
}

export function itemsCheckText(diff: number | null): string | null {
  if (diff === null) return null;
  if (diff === 0) return "Matches";
  return diff > 0 ? `Items are ${dollars(diff)} short of the subtotal` : `Items are ${dollars(diff)} over the subtotal`;
}

export function amountsCheckText(diff: number | null): string | null {
  if (diff === null) return null;
  if (diff === 0) return "Matches";
  return diff > 0 ? `${dollars(diff)} short of the total` : `${dollars(diff)} over the total`;
}

// ---- Confirm's pre-check ---------------------------------------------------------

export type Problem = { message: string; focusId: string };

export function fieldId(field: MoneyField | "merchant"): string {
  return `receipt-${field}`;
}

export function rowFieldId(key: string, field: keyof RowErrors): string {
  return `${key}-${field}`;
}

// Why Confirm can't go ahead, in the order the organizer should fix them; the
// first problem's field gets focus. Empty when Confirm can send.
export function confirmProblems(form: ReceiptForm): Problem[] {
  const problems: Problem[] = [];
  const errors = formErrors(form);
  if (hasErrors(errors)) {
    const firstRow = itemRows(form).find((row) => errors.rows[row.key]);
    const firstRowField = firstRow && (Object.keys(errors.rows[firstRow.key]) as (keyof RowErrors)[])[0];
    const firstField =
      errors.merchant !== undefined ? fieldId("merchant")
        : firstRow ? rowFieldId(firstRow.key, firstRowField!)
          : fieldId(MONEY_FIELDS.find((f) => errors.fields[f])!);
    problems.push({ message: MESSAGES.fixFields, focusId: firstField });
  }
  if (itemRows(form).length === 0) problems.push({ message: MESSAGES.noItems, focusId: "add-item" });
  const missing = (["subtotal", "tax", "total"] as const).find((f) => form[f].trim() === "");
  if (missing) problems.push({ message: MESSAGES.missingTotals, focusId: fieldId(missing) });
  if (problems.length === 0) {
    const t = totals(form);
    if (t.itemsDiff !== 0) problems.push({ message: MESSAGES.itemsMismatch, focusId: fieldId("subtotal") });
    if (t.amountsDiff !== 0) problems.push({ message: MESSAGES.amountsMismatch, focusId: fieldId("total") });
  }
  return problems;
}

// ---- requests ------------------------------------------------------------------

function normalizedRows(form: ReceiptForm) {
  return itemRows(form).map((row) => ({
    name: row.name.trim(),
    qty: qtyOk(row.qty) ? String(Number(row.qty.trim())) : row.qty.trim(),
    price: toCents(row.price),
  }));
}

export function itemsChanged(form: ReceiptForm, saved: ReceiptForm): boolean {
  return JSON.stringify(normalizedRows(form)) !== JSON.stringify(normalizedRows(saved));
}

function moneyValue(text: string): string | null {
  const cents = toCents(text);
  return cents === null ? null : formatCents(cents);
}

function fieldValues(form: ReceiptForm) {
  return {
    merchantName: form.merchant.trim() === "" ? null : form.merchant.trim(),
    // Noon UTC keeps the same calendar date in every time zone.
    purchasedAt: form.date === "" ? null : `${form.date}T12:00:00.000Z`,
    subtotal: moneyValue(form.subtotal),
    tax: moneyValue(form.tax),
    tip: moneyValue(form.tip),
    total: moneyValue(form.total),
  };
}

// The PATCH fields that differ from the saved receipt.
export function changedFields(form: ReceiptForm, saved: ReceiptForm): Record<string, string | null> {
  const now = fieldValues(form);
  const before = fieldValues(saved);
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(now) as (keyof typeof now)[]) {
    if (now[key] !== before[key]) out[key] = now[key];
  }
  return out;
}

export function isDirty(form: ReceiptForm, saved: ReceiptForm): boolean {
  return itemsChanged(form, saved) || Object.keys(changedFields(form, saved)).length > 0;
}

export function itemsBody(form: ReceiptForm, expectedRevision: number) {
  return {
    expectedRevision,
    items: itemRows(form).map((row, index) => {
      const quantity = String(Number(row.qty.trim()));
      const totalCents = toCents(row.price)!;
      return {
        lineNumber: index + 1,
        name: row.name.trim(),
        quantity,
        // The line total is authoritative (receipts/items.md); unit price is
        // derived from it.
        unitPrice: formatCents(unitPriceCents(totalCents, Number(quantity))),
        totalPrice: formatCents(totalCents),
      };
    }),
  };
}

export type SavePlan = {
  items: boolean;
  // Fields for the PATCH (expectedRevision is added when it's sent), or null.
  patch: Record<string, string | null | boolean> | null;
};

export function savePlan(form: ReceiptForm, saved: ReceiptForm, confirm: boolean): SavePlan {
  const fields: Record<string, string | null | boolean> = changedFields(form, saved);
  if (confirm) fields.reviewConfirmed = true;
  return { items: itemsChanged(form, saved), patch: Object.keys(fields).length > 0 ? fields : null };
}
