// Items step (docs/specs/receipts/edit-screen.md): field and row checks, the
// totals check in cents, Confirm's pre-check, the Save/Confirm requests, the
// Table primitive, and static renders of each state. No DOM, no database.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));

const form = await import("../app/receipts/[id]/items/receipt-form");
const { CheckMark, ItemsEditor } = await import("../app/receipts/[id]/items/ItemsEditor");
const { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } = await import("../app/components/ui/table");
const { LEAVE_MESSAGE, installLeaveGuard } = await import("../app/receipts/[id]/participants/leave-guard");

const { MESSAGES } = form;
type ReceiptForm = import("../app/receipts/[id]/items/receipt-form").ReceiptForm;

const row = (key: string, name: string, price: string, qty = "1") => ({ key, name, qty, price });

function f(overrides: Partial<ReceiptForm> = {}): ReceiptForm {
  return {
    merchant: "Thai Place",
    date: "2026-11-02",
    subtotal: "20.00",
    tax: "1.80",
    tip: "3.20",
    total: "25.00",
    rows: [row("a", "Pad Thai", "14.00"), row("b", "Tea", "6.00")],
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1", revision: 4, status: "DRAFT", picksOpenedAt: null, reviewedAt: null,
    merchantName: "Thai Place", purchasedAt: new Date("2026-11-02T12:00:00Z"),
    subtotal: "20", tax: "1.8", tip: null, total: "21.80",
    items: [
      { name: "Pad Thai", quantity: "10", totalPrice: "14" },
      { name: null, quantity: null, totalPrice: null },
    ],
    ...overrides,
  };
}

describe("row keys", () => {
  it("never collide between the server's saved rows and rows added in the browser", async () => {
    // Two separate copies of the module, like the server render and the
    // browser bundle, each with its own counter.
    const server = form.toEditorReceipt(detail({ items: [{ name: "A", quantity: "1", totalPrice: "1" }, { name: "B", quantity: "1", totalPrice: "2" }] }));
    vi.resetModules();
    const browser = await import("../app/receipts/[id]/items/receipt-form");
    const added = [browser.newRowKey(), browser.newRowKey(), browser.newRowKey()];
    const all = [...server.form.rows.map((r) => r.key), ...added];
    expect(new Set(all).size).toBe(all.length);
  });

  it("are stable for saved rows, so a reload keys the same line the same way", () => {
    const a = form.toEditorReceipt(detail()).form.rows.map((r) => r.key);
    const b = form.toEditorReceipt(detail()).form.rows.map((r) => r.key);
    expect(a).toEqual(["line-1", "line-2"]);
    expect(b).toEqual(a);
  });
});

describe("loading a receipt into the form", () => {
  it("formats money, keeps whole quantities, and fills blanks from nulls", () => {
    const editor = form.toEditorReceipt(detail());
    expect(editor).toMatchObject({ id: "r1", revision: 4, pickingOpen: false, reviewed: false });
    expect(editor.form).toMatchObject({ merchant: "Thai Place", date: "2026-11-02", subtotal: "20.00", tax: "1.80", tip: "", total: "21.80" });
    expect(editor.form.rows.map(({ name, qty, price }) => ({ name, qty, price }))).toEqual([
      { name: "Pad Thai", qty: "10", price: "14.00" },
      { name: "", qty: "1", price: "" },
    ]);
  });

  it("reads picking open and confirmation", () => {
    const editor = form.toEditorReceipt(detail({ picksOpenedAt: new Date(), reviewedAt: new Date() }));
    expect([editor.pickingOpen, editor.reviewed]).toEqual([true, true]);
  });
});

describe("money as people type it", () => {
  it("accepts a leading $ and thousands commas", () => {
    expect(form.toCents("$12.50")).toBe(1250);
    expect(form.toCents("$ 12.5")).toBe(1250);
    expect(form.toCents("1,234.00")).toBe(123400);
    expect(form.toCents("$1,234,567")).toBe(123456700);
    expect(form.formErrors(f({ tax: "$1.80", rows: [row("a", "Pad Thai", "$14.00"), row("b", "Tea", "6")] })).fields).toEqual({});
  });

  it("saves what was typed as a plain amount", () => {
    expect(form.changedFields(f({ subtotal: "$1,020.00" }), f())).toEqual({ subtotal: "1020.00" });
    expect(form.itemsBody(f({ rows: [row("a", "Wings", "$1,024", "2")] }), 1).items[0]).toMatchObject({ totalPrice: "1024.00", unitPrice: "512.00" });
    expect(form.isDirty(f({ subtotal: "$20.00" }), f())).toBe(false);
  });
});

describe("tidying amounts", () => {
  it("shows any accepted amount as grouped dollars and cents after the field is left", () => {
    for (const typed of ["1024", "$1024", "1,024", "$1,024", "$ 1,024.0", "1024.00"]) expect(form.tidyMoney(typed)).toBe("1,024.00");
    expect(form.tidyMoney("12.5")).toBe("12.50");
    expect(form.tidyMoney("0")).toBe("0.00");
  });

  it("leaves text that isn't an amount as typed, so its error makes sense", () => {
    for (const typed of ["12.345", "1,2", "abc", ""]) expect(form.tidyMoney(typed)).toBe(typed);
  });

  it("groups thousands wherever money is shown", () => {
    expect(form.displayMoney(123456789)).toBe("1,234,567.89");
    expect(form.dollars(-102400)).toBe("$1,024.00");
    expect(form.toEditorReceipt(detail({ subtotal: "2048.5" })).form.subtotal).toBe("2,048.50");
  });
});

describe("set subtotal / set total", () => {
  it("offers the items total for the subtotal when it's empty or off, not when it matches", () => {
    expect(form.setSubtotalTo(f({ subtotal: "" }), form.totals(f({ subtotal: "" })))).toBe("20.00");
    expect(form.setSubtotalTo(f({ subtotal: "22.50" }), form.totals(f({ subtotal: "22.50" })))).toBe("20.00");
    expect(form.setSubtotalTo(f(), form.totals(f()))).toBeNull();
    expect(form.setSubtotalTo(f({ rows: [] }), form.totals(f({ rows: [] })))).toBeNull();
  });

  it("offers subtotal + tax + tip for the total when it's empty or off, not when it matches", () => {
    expect(form.setTotalTo(form.totals(f({ total: "" })))).toBe("25.00");
    expect(form.setTotalTo(form.totals(f({ total: "26.00" })))).toBe("25.00");
    expect(form.setTotalTo(form.totals(f()))).toBeNull();
    expect(form.setTotalTo(form.totals(f({ tax: "" })))).toBeNull();
  });

  it("groups large amounts like the fields do", () => {
    const big = f({ subtotal: "", rows: [row("a", "Wine", "1,250.00")] });
    expect(form.setSubtotalTo(big, form.totals(big))).toBe("1,250.00");
  });
});

describe("price of one", () => {
  it("is the line total over the quantity, only when Qty isn't 1", () => {
    expect(form.eachPrice(row("a", "Chicken", "24", "10"))).toBe("$2.40");
    expect(form.eachPrice(row("a", "Tea", "10", "1"))).toBeNull();
    expect(form.eachPrice(row("a", "Tea", "", "3"))).toBeNull();
  });
});

describe("removing a row and undoing it", () => {
  const rows = [row("a", "Chicken", "24", "10"), row("b", "Tea", "10"), row("c", "Rice", "3")];

  it("removes the row and remembers where it was", () => {
    const { rows: left, removed, index } = form.removeRowAt(rows, "b");
    expect(left.map((r) => r.key)).toEqual(["a", "c"]);
    expect(removed).toEqual(rows[1]);
    expect(index).toBe(1);
    expect(form.removeRowAt(rows, "nope")).toEqual({ rows, removed: null, index: -1 });
  });

  it("Undo puts the row back where it was, with everything typed in it", () => {
    const { rows: left, removed, index } = form.removeRowAt(rows, "b");
    expect(form.restoreRow(left, removed!, index)).toEqual(rows);
  });

  it("Undo after more rows were removed puts it at the end instead of past it, and never twice", () => {
    const { removed, index } = form.removeRowAt(rows, "c");
    expect(form.restoreRow([rows[0]], removed!, index).map((r) => r.key)).toEqual(["a", "c"]);
    expect(form.restoreRow(rows, rows[2], 2)).toEqual(rows);
  });
});

describe("subtitle", () => {
  it("after a failed scan, asks for the lines to be typed instead of fixed", () => {
    expect(form.subtitleFor("FAILED")).toBe("The scan couldn't read this one. Type the lines from the receipt, then confirm.");
    expect(form.subtitleFor("SUCCEEDED")).toBe("Fix anything the scan got wrong, then confirm.");
  });
});

describe("field and row checks", () => {
  it("accepts amounts with up to two decimals and rejects anything else", () => {
    for (const ok of ["0", "12", "12.5", "12.50", "9999999999.99"]) expect(form.toCents(ok)).not.toBeNull();
    for (const bad of ["12.345", "-1", "1,00", "1,2", "12,34.5", "$$1", "abc", "", "12345678901"]) expect(form.toCents(bad)).toBeNull();
    expect(form.formErrors(f({ tax: "1.805" })).fields).toEqual({ tax: MESSAGES.money });
    expect(form.formErrors(f({ tip: "" })).fields).toEqual({});
  });

  it("needs a name, a quantity above 0 and a price on each row", () => {
    const errors = form.formErrors(f({ rows: [row("a", "", "4.00", "0"), row("b", "Tea", "x")] }));
    expect(errors.rows).toEqual({
      a: { name: MESSAGES.name, qty: MESSAGES.qty },
      b: { price: MESSAGES.money },
    });
    expect(form.formErrors(f({ rows: [row("a", "Tea", "4", "1.2345")] })).rows.a).toEqual({ qty: MESSAGES.qty });
  });

  it("drops completely empty rows instead of flagging them", () => {
    const withBlank = f({ rows: [row("a", "Pad Thai", "14.00"), row("x", "  ", ""), row("b", "Tea", "6.00")] });
    expect(form.formErrors(withBlank).rows).toEqual({});
    expect(form.itemRows(withBlank).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("caps the restaurant name at 200 characters", () => {
    expect(form.formErrors(f({ merchant: "x".repeat(201) })).merchant).toBe(MESSAGES.long);
    expect(form.formErrors(f({ merchant: "x".repeat(200) })).merchant).toBeUndefined();
  });
});

describe("totals check", () => {
  it("matches when items equal the subtotal and the parts equal the total", () => {
    const t = form.totals(f());
    expect(t).toEqual({ itemsCents: 2000, itemsDiff: 0, amountsDiff: 0, partsCents: 2500 });
    expect(form.itemsCheckText(t.itemsDiff)).toBe("Matches");
    expect(form.amountsCheckText(t.amountsDiff)).toBe("Matches");
  });

  it("says short or over by the exact amount", () => {
    expect(form.itemsCheckText(form.totals(f({ subtotal: "22.50" })).itemsDiff)).toBe("Items are $2.50 short of the subtotal");
    expect(form.itemsCheckText(form.totals(f({ subtotal: "19.00" })).itemsDiff)).toBe("Items are $1.00 over the subtotal");
    expect(form.amountsCheckText(form.totals(f({ total: "26.00" })).amountsDiff)).toBe("$1.00 short of the total");
    expect(form.amountsCheckText(form.totals(f({ total: "24.99" })).amountsDiff)).toBe("$0.01 over the total");
  });

  it("counts an empty tip as 0 and has no answer while a part is missing", () => {
    expect(form.totals(f({ tip: "", total: "21.80" })).amountsDiff).toBe(0);
    expect(form.totals(f({ tax: "" })).amountsDiff).toBeNull();
    expect(form.totals(f({ rows: [row("a", "Pad Thai", "")] })).itemsCents).toBeNull();
  });

  it("adds in cents, so 0.10 + 0.20 is exactly 0.30", () => {
    const t = form.totals(f({ subtotal: "0.30", rows: [row("a", "A", "0.10"), row("b", "B", "0.20")] }));
    expect(t.itemsDiff).toBe(0);
  });
});

describe("Confirm's pre-check", () => {
  it("is empty when everything is filled and matches", () => {
    expect(form.confirmProblems(f())).toEqual([]);
  });

  it("asks for an item first, focusing Add item", () => {
    expect(form.confirmProblems(f({ rows: [] }))[0]).toEqual({ message: MESSAGES.noItems, focusId: "add-item" });
  });

  it("asks for the subtotal, tax and total, focusing the first empty one", () => {
    expect(form.confirmProblems(f({ tax: "", total: "" }))).toEqual([{ message: MESSAGES.missingTotals, focusId: "receipt-tax" }]);
  });

  it("names each mismatch, focusing Subtotal for the items and Total for the parts", () => {
    expect(form.confirmProblems(f({ subtotal: "22.50", total: "27.50" }))).toEqual([
      { message: MESSAGES.itemsMismatch, focusId: "receipt-subtotal" },
    ]);
    expect(form.confirmProblems(f({ total: "26.00" }))).toEqual([{ message: MESSAGES.amountsMismatch, focusId: "receipt-total" }]);
  });

  it("points invalid fields at the first bad one", () => {
    expect(form.confirmProblems(f({ rows: [row("a", "Pad Thai", "14.00"), row("b", "", "6.00")] }))[0]).toEqual({
      message: MESSAGES.fixFields,
      focusId: "b-name",
    });
    expect(form.confirmProblems(f({ tip: "3.205" }))[0]).toEqual({ message: MESSAGES.fixFields, focusId: "receipt-tip" });
  });
});

describe("the each hint", () => {
  it("shows the price of one when Qty isn't 1", () => {
    expect(form.eachHint(row("a", "Wings", "24", "10"))).toBe("10 × $2.40 each");
    expect(form.eachHint(row("a", "Wings", "10.00", "3"))).toBe("3 × $3.33 each");
    expect(form.eachHint(row("a", "Rice", "6.00", "1.5"))).toBe("1.5 × $4.00 each");
  });

  it("keeps the line total when Qty changes: 24 over 12 is $2.00 each", () => {
    expect(form.eachHint(row("a", "Wings", "24", "12"))).toBe("12 × $2.00 each");
  });

  it("shows nothing for Qty 1 or while Qty or Line total is invalid", () => {
    expect(form.eachHint(row("a", "Tea", "6.00", "1"))).toBeNull();
    expect(form.eachHint(row("a", "Tea", "6.00", "1.0"))).toBeNull();
    expect(form.eachHint(row("a", "Tea", "6.00", "0"))).toBeNull();
    expect(form.eachHint(row("a", "Tea", "", "3"))).toBeNull();
    expect(form.eachHint(row("a", "Tea", "abc", "3"))).toBeNull();
  });

  it("matches the unit price that's saved", () => {
    const [saved] = form.itemsBody(f({ rows: [row("a", "Wings", "24", "10")] }), 1).items;
    expect(form.eachHint(row("a", "Wings", "24", "10"))).toBe(`10 × $${saved.unitPrice} each`);
  });
});

describe("Save and Confirm requests", () => {
  const saved = f();

  it("numbers lines in order and derives the unit price from the line total", () => {
    const body = form.itemsBody(f({ rows: [row("a", " Wings ", "10.00", "3"), row("x", "", ""), row("b", "Tea", "6", "1.500")] }), 7);
    expect(body).toEqual({
      expectedRevision: 7,
      items: [
        { lineNumber: 1, name: "Wings", quantity: "3", unitPrice: "3.33", totalPrice: "10.00" },
        { lineNumber: 2, name: "Tea", quantity: "1.5", unitPrice: "4.00", totalPrice: "6.00" },
      ],
    });
  });

  it("sends only a PATCH when only fields changed", () => {
    expect(form.savePlan(f({ merchant: "Thai House" }), saved, false)).toEqual({ items: false, patch: { merchantName: "Thai House" } });
  });

  it("sends only the items when only items changed", () => {
    expect(form.savePlan(f({ rows: [row("a", "Pad Thai", "15.00"), row("b", "Tea", "6.00")] }), saved, false)).toEqual({ items: true, patch: null });
  });

  it("sends both, and Confirm always adds reviewConfirmed", () => {
    const changed = f({ tip: "4.00", rows: [row("a", "Pad Thai", "14.00")] });
    expect(form.savePlan(changed, saved, true)).toEqual({ items: true, patch: { tip: "4.00", reviewConfirmed: true } });
    expect(form.savePlan(saved, saved, true)).toEqual({ items: false, patch: { reviewConfirmed: true } });
    expect(form.savePlan(saved, saved, false)).toEqual({ items: false, patch: null });
  });

  it("saves the date at noon UTC and empty fields as null", () => {
    expect(form.changedFields(f({ date: "2026-12-31", merchant: "  " }), saved)).toEqual({
      merchantName: null,
      purchasedAt: "2026-12-31T12:00:00.000Z",
    });
  });

  it("isn't dirty for formatting-only differences", () => {
    expect(form.isDirty(f({ subtotal: "20", rows: [row("z", "Pad Thai", "14", "1.0"), row("y", "Tea", "6.0")] }), saved)).toBe(false);
  });
});

describe("leave guard", () => {
  it("asks with the Items screen's own message", () => {
    const target = new EventTarget();
    const asked: string[] = [];
    installLeaveGuard(target, (m) => (asked.push(m), true), "items message");
    target.dispatchEvent(new Event("submit"));
    expect(asked).toEqual(["items message"]);
    const other: string[] = [];
    installLeaveGuard(new EventTarget(), () => true);
    const t2 = new EventTarget();
    installLeaveGuard(t2, (m) => (other.push(m), true));
    t2.dispatchEvent(new Event("submit"));
    expect(other).toEqual([LEAVE_MESSAGE]);
  });
});

// The markup of the element carrying aria-live, from its opening tag to its
// matching close.
function liveRegion(html: string): string {
  const start = html.lastIndexOf("<", html.indexOf('aria-live="polite"'));
  const tag = html.slice(start + 1).match(/^[a-z]+/)![0];
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error("unclosed live region");
}

describe("renders", () => {
  const render = (overrides: Record<string, unknown> = {}) =>
    renderToStaticMarkup(h(ItemsEditor, { initial: form.toEditorReceipt(detail(overrides)) }));

  it("Table primitive renders its slots", () => {
    const html = renderToStaticMarkup(
      h(Table, null, h(TableHeader, null, h(TableRow, null, h(TableHead, null, "Item"))), h(TableBody, null, h(TableRow, null, h(TableCell, null, "Tea")))),
    );
    for (const slot of ["table-container", "table", "table-header", "table-body", "table-row", "table-head", "table-cell"]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
    expect(html).toMatch(/<th[^>]*>Item<\/th>[\s\S]*<td[^>]*>Tea<\/td>/);
  });

  it("empty receipt: No items yet with Add item, which is Confirm's focus target", () => {
    const html = render({ items: [] });
    expect(html).toContain("No items yet");
    expect(html).toMatch(/<button[^>]*id="add-item"[^>]*>Add item<\/button>/);
    // The focus target the "Add at least one item" problem points at exists.
    const target = form.confirmProblems(form.toEditorReceipt(detail({ items: [] })).form)[0].focusId;
    expect(html).toContain(`id="${target}"`);
  });

  it("filled: restaurant first, labelled item inputs, money inputs, and both buttons enabled", () => {
    const html = render();
    expect(html.indexOf('id="receipt-merchant"')).toBeLessThan(html.indexOf("Items</h2>"));
    expect(html).toMatch(/<input[^>]*id="receipt-subtotal"[^>]*inputMode="decimal"|<input[^>]*inputMode="decimal"[^>]*id="receipt-subtotal"/i);
    expect(html).toMatch(/<label[^>]*class="[^"]*sr-only[^"]*"[^>]*>Item<span class="sr-only"> \(item 1\)<\/span><\/label>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
    expect(html.match(/<button[^>]*>Confirm items<\/button>/)![0]).not.toContain('disabled=""');
    expect(html).toContain("+ Add item");
    expect(html).toMatch(/<th[^>]*>Line total<\/th>/);
    expect(html).not.toMatch(/>Price</);
  });

  it("describes the Line total input with the each hint for Qty other than 1", () => {
    const html = render({ items: [{ name: "Wings", quantity: "10", totalPrice: "24" }] });
    const hint = html.match(/<p id="([^"]+-each)"[^>]*>10 × \$2\.40 each<\/p>/);
    expect(hint).not.toBeNull();
    expect(html).toMatch(new RegExp(`<input[^>]*aria-describedby="${hint![1]}"`));
    expect(render({ items: [{ name: "Tea", quantity: "1", totalPrice: "6" }] })).not.toContain(" each</p>");
  });

  it("mismatched: the totals check says how far off, in a live region", () => {
    const html = render({ subtotal: "22.50", items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    expect(html).toMatch(/role="status" aria-live="polite"[\s\S]*Items are \$2\.50 short of the subtotal/);
  });

  it("a match is a check, with Matches only for screen readers", () => {
    const html = renderToStaticMarkup(h(CheckMark, { diff: 0, text: "Matches" }));
    expect(html).toMatch(/<svg[^>]*lucide-check[^>]*aria-hidden="true"|<svg[^>]*aria-hidden="true"[^>]*lucide-check/);
    expect(html).toContain('<span class="sr-only">Matches</span>');
    expect(html).not.toContain("lucide-x");
  });

  it("a mismatch is a cross with how far off it is, visible", () => {
    const html = renderToStaticMarkup(h(CheckMark, { diff: 250, text: "Items are $2.50 short of the subtotal" }));
    expect(html).toContain("lucide-x");
    expect(html).toContain("<span>Items are $2.50 short of the subtotal</span>");
    expect(html).not.toContain("sr-only");
    // The cross comes after the text, so it sits at the right edge.
    expect(html.indexOf("short of the subtotal")).toBeLessThan(html.indexOf("lucide-x"));
  });

  it("shows nothing while a part is missing", () => {
    expect(renderToStaticMarkup(h(CheckMark, { diff: null, text: null }))).toBe("");
  });

  it("the filled receipt shows two checks and no visible Matches", () => {
    const html = render({ tip: "0", items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    // "Everything adds up" and the two result lines; the action bar has none.
    expect(html.match(/lucide-check/g)).toHaveLength(3);
    expect(html.match(/<div class="flex items-start justify-between gap-3">/g)).toHaveLength(2);
    // Every "Matches" is screen-reader only.
    expect(html.split(">Matches<").length - 1).toBe(2);
    expect(html.split('sr-only">Matches<').length - 1).toBe(2);
  });

  it("money and quantities are right-aligned in tabular figures, and line totals get a $ prefix", () => {
    const html = render();
    expect(html).toMatch(/<th[^>]*class="[^"]*text-right[^"]*"[^>]*>Qty<\/th>/);
    expect(html).toMatch(/<th[^>]*class="[^"]*text-right[^"]*"[^>]*>Line total<\/th>/);
    const price = html.match(/<div class="relative min-w-0 flex-1">(?:(?!<\/div>).)*?id="(?:line|new)-\d+-price"[^>]*>/)![0];
    expect(price).toContain(">$</span>");
    expect(price).toMatch(/class="[^"]*text-right tabular-nums pl-7/);
    expect(html).toMatch(/class="[^"]*pl-7 text-right tabular-nums[^"]*" id="receipt-subtotal"/);
  });

  it("money fields have no placeholder, so an empty field never looks filled", () => {
    expect(render({ subtotal: null, tax: null, items: [{ name: null, quantity: null, totalPrice: null }] })).not.toContain('placeholder="0.00"');
  });

  it("phones get a receipt-style list: rows divided by rules, no cards and no floating header", () => {
    const html = render();
    const tr = html.match(/<tr data-slot="table-row" class="[^"]*max-md:grid[^"]*"/)![0];
    expect(tr).toMatch(/^<tr data-slot="table-row" class="border-b /);
    expect(tr).not.toContain("max-md:bg-surface");
    expect(tr).not.toContain("max-md:rounded-card");
    expect(html).toMatch(/<tbody[^>]*class="[^"]*max-md:border-y max-md:border-line/);
    // No separate phone header; labels sit inside the fields instead.
    expect(html).not.toMatch(/<div aria-hidden="true" class="grid [^"]*md:hidden">/);
    expect(html).not.toMatch(/md:sr-only/);
    expect(html).toMatch(/id="(?:line|new)-\d+-name"[^>]*placeholder="Item"|placeholder="Item"[^>]*id="(?:line|new)-\d+-name"/);
  });

  it("on phones the second line reads like receipt math: Qty 10 × $2.40 = $24.00", () => {
    const html = render({ items: [{ name: "Chicken", quantity: "10", totalPrice: "24" }, { name: "Tea", quantity: "1", totalPrice: "10" }] });
    // "Qty" sits inside the quantity field on phones only.
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*md:hidden">Qty<\/span><input[^>]*class="[^"]*max-md:pl-11[^"]*" id="(?:line|new)-\d+-qty"/);
    // The price of one sits between Qty and the line total, on phones only, hidden from screen readers.
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*md:hidden">× \$2\.40 =<\/span><div class="relative min-w-0 flex-1"><span aria-hidden="true"[^>]*>\$<\/span><input/);
    // Screen readers still hear the full hint, which is visible from md up.
    expect(html).toMatch(/<p id="(?:line|new)-\d+-each" class="[^"]*max-md:hidden">10 × \$2\.40 each<\/p>/);
    // Qty 1 shows no math.
    expect(html.match(/× \$[\d.,]+ =/g)).toHaveLength(1);
  });

  it("on phones the remove button sits on the item's name line, and Qty | Line total share the second", () => {
    const html = render();
    const cells = html.match(/<tr data-slot="table-row" class="[^"]*max-md:grid[\s\S]*?<\/tr>/)![0].match(/<td[^>]*class="([^"]*)"/g)!;
    expect(cells[0]).toContain("max-md:col-span-2 max-md:row-start-1");
    expect(cells[1]).toContain("max-md:col-start-1 max-md:row-start-2");
    expect(cells[2]).toContain("max-md:col-span-2 max-md:col-start-2 max-md:row-start-2");
    expect(cells[3]).toContain("max-md:col-start-3 max-md:row-start-1");
  });

  it("remove is a 44px icon button named for its item", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*class="[^"]*size-11[^"]*"[^>]*aria-label="Remove Pad Thai"/);
    expect(html).toMatch(/aria-label="Remove item 2"/);
    expect(html).not.toMatch(/>Remove<span/);
  });

  it("Enter moves through Item, Qty and Line total", () => {
    const html = render();
    expect(html.match(/enterKeyHint="next"/gi)?.length).toBe(6);
  });

  it("the action bar sticks to the bottom with only Save and Confirm, no repeated totals", () => {
    const html = render({ subtotal: "22.50", items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    expect(html).toMatch(/data-testid="action-bar" class="[^"]*sticky bottom-0/);
    const bar = html.slice(html.indexOf('data-testid="action-bar"'));
    expect(bar).toMatch(/>Save<\/button>[\s\S]*>Confirm items<\/button>/);
    expect(bar).not.toContain("Items $");
    expect(bar).not.toContain("lucide-check");
    expect(bar).not.toContain("lucide-x");
  });

  it("when everything matches, says so with the total and what comes next", () => {
    const html = render({ tip: "0", items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    expect(html).toContain("Everything adds up: <span class=\"tabular-nums\">$21.80</span>");
    expect(html).toContain("Confirm items, then add who was at the table.");
    expect(html).toMatch(/class="[^"]*rounded-card border bg-surface[^"]*border-brand/);
    expect(render({ subtotal: "22.50" })).not.toContain("Everything adds up");
  });

  it("only the results are live; the Use buttons sit outside the live region", () => {
    const html = render({ subtotal: null });
    const region = liveRegion(html);
    expect(region).toContain("Items add up to");
    expect(region).toContain("Subtotal + tax + tip is");
    expect(region).not.toContain("Set subtotal to");
    expect(html).toContain(">Set subtotal to $14.00</button>");
  });

  it("a confirmed receipt shows Confirmed with a check, in the brand color", () => {
    const html = render({ reviewedAt: new Date(), tip: "0", items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    expect(html).toMatch(/<span class="[^"]*text-brand[^"]*"><svg[^>]*lucide-check[^>]*>[\s\S]*?<\/svg>Confirmed<\/span>/);
  });

  it("offers Set subtotal / Set total with the amount whenever a field doesn't match, and never when it does", () => {
    // Empty subtotal and total.
    const empty = render({ subtotal: null, total: null, items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    expect(empty).toContain(">Set subtotal to $20.00</button>");
    // A mismatched (not empty) subtotal and total.
    const off = render({ subtotal: "22.50", total: "30", items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    expect(off).toContain(">Set subtotal to $20.00</button>");
    expect(off).toContain(">Set total to $24.30</button>");
    // Everything matches: no buttons.
    const ok = render({ tip: "0", items: [{ name: "Pad Thai", quantity: "1", totalPrice: "20" }] });
    expect(ok).not.toContain("Set subtotal to");
    expect(ok).not.toContain("Set total to");
  });

  it("picking open: read-only with the pause banner", () => {
    const html = render({ picksOpenedAt: new Date() });
    expect(html).toContain("Picking is open. Pause it to make changes.");
    expect(html).toMatch(/<button[^>]*>Pause picking<\/button>/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).not.toContain("Confirm items");
  });

  it("finalized: read-only with no banner and no buttons", () => {
    const html = render({ status: "FINALIZED", picksOpenedAt: new Date() });
    expect(html).not.toContain("Pause picking");
    expect(html).not.toContain("Confirm items");
    expect(html).not.toContain("+ Add item");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  });
});
