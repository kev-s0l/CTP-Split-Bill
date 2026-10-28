// Upgrade real legacy rows through both SQL migrations, without external services.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const initial = readFileSync(new URL("../../../packages/db/prisma/migrations/0001_init.sql", import.meta.url), "utf8");
const remodel = readFileSync(new URL("../../../packages/db/prisma/migrations/0002_receipt_remodel.sql", import.meta.url), "utf8");
let db: PGlite;

beforeEach(async () => {
  db = new PGlite("memory://");
  await db.exec(initial);
  await db.exec(`
    INSERT INTO users (id, name, email, phone) VALUES
      ('owner', 'Alex', 'alex@example.com', '+12125550123'),
      ('other', 'Other', 'other@example.com', '+12125550124');
    INSERT INTO parties (id, organizer_id, name, deleted_at) VALUES
      ('party', 'owner', 'Dinner', null), ('gone', 'other', 'Deleted', '2020-01-01'),
      ('unused', 'owner', 'No receipts', null);
    INSERT INTO party_members (id, party_id, user_id, display_name) VALUES
      ('alex', 'party', 'owner', 'Alex'), ('sam', 'party', null, 'Sam'),
      ('other-member', 'party', 'other', 'Other'), ('gone-member', 'gone', 'other', 'Other'),
      ('unused-member', 'unused', 'owner', 'Alex');
    INSERT INTO receipts (id, party_id, uploaded_by_id, paid_by_member_id, status,
      split_mode, image_blob_name, image_content_type, subtotal, tax, tip, total, created_at) VALUES
      ('first', 'party', 'other', 'alex', 'PARSED', 'ITEMIZED', 'first.jpg', 'image/jpeg', 30, 2.70, 6, 38.70, '2020-01-01'),
      ('second', 'party', 'owner', 'alex', 'FINALIZED', 'ITEMIZED', 'second.jpg', 'image/jpeg', 30, 2.70, 6, 38.70, '2020-01-02'),
      ('deleted', 'gone', 'other', null, 'PARSE_FAILED', 'EVEN', 'deleted.jpg', 'image/jpeg', null, null, null, null, '2020-01-03');
    INSERT INTO receipt_items (id, receipt_id, line_number, name, quantity, unit_price, total_price) VALUES
      ('steak-1', 'first', 1, 'Steak', 1, 20, 20), ('app-1', 'first', 2, 'Appetizer', 1, 10, 10),
      ('steak-2', 'second', 1, 'Steak', 1, 20, 20), ('app-2', 'second', 2, 'Appetizer', 1, 10, 10);
    INSERT INTO item_shares (item_id, member_id) VALUES
      ('steak-1', 'alex'), ('app-1', 'alex'), ('app-1', 'sam'),
      ('steak-2', 'alex'), ('app-2', 'alex'), ('app-2', 'sam');
    INSERT INTO bills (id, receipt_id, member_id, subtotal, tax_share, tip_share, amount_owed) VALUES
      ('bill-alex', 'second', 'alex', 25, 2.25, 5, 32.25),
      ('bill-sam', 'second', 'sam', 5, 0.45, 1, 6.45),
      ('bill-zero', 'second', 'other-member', 0, 0, 0, 0);
    INSERT INTO payments (id, bill_id, amount, paid_at) VALUES
      ('payment', 'bill-sam', 6.45, '2020-01-05');
  `);
});
afterEach(async () => { await db.close(); });

async function rejectsUpgrade(message: string | RegExp) {
  await expect(db.exec(remodel)).rejects.toThrow(message);
  await db.exec("ROLLBACK");
  expect((await db.query("SELECT count(*)::int AS n FROM party_members")).rows).toEqual([{ n: 5 }]);
  expect((await db.query("SELECT uploaded_by_id FROM receipts WHERE id='first'")).rows).toEqual([{ uploaded_by_id: "other" }]);
  expect((await db.query("SELECT to_regclass('participants') AS target")).rows).toEqual([{ target: null }]);
}

describe("receipt remodel migration", () => {
  it("creates exactly the six target tables and preserves receipt, item and bill IDs", async () => {
    await db.exec(remodel);
    const tables = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "bills", "participants", "receipt_items", "receipts", "shared_item_allocations", "users",
    ]);
    expect((await db.query("SELECT id FROM receipts ORDER BY id")).rows).toEqual([{ id: "deleted" }, { id: "first" }, { id: "second" }]);
    expect((await db.query("SELECT id FROM receipt_items ORDER BY id")).rows).toHaveLength(4);
    expect((await db.query("SELECT id FROM bills ORDER BY id")).rows).toEqual([{ id: "bill-alex" }, { id: "bill-sam" }, { id: "bill-zero" }]);
  });

  it("uses the organizer as owner, retains metadata and propagates soft deletion", async () => {
    await db.exec(remodel);
    expect((await db.query("SELECT owner_id, title, status, parse_status, revision, reviewed_at FROM receipts WHERE id='first'")).rows).toEqual([
      { owner_id: "owner", title: "Dinner", status: "DRAFT", parse_status: "SUCCEEDED", revision: 1, reviewed_at: null },
    ]);
    const deleted = (await db.query<{ deleted_at: string; parse_status: string }>("SELECT deleted_at::text, parse_status FROM receipts WHERE id='deleted'")).rows[0];
    expect(deleted.deleted_at).toBe("2020-01-01 00:00:00");
    expect(deleted.parse_status).toBe("FAILED");
    expect((await db.query("SELECT name, email, phone FROM users WHERE id='owner'")).rows).toEqual([
      { name: "Alex", email: "alex@example.com", phone: "+12125550123" },
    ]);
  });

  it("copies participants per receipt and remaps bills and payer to the same receipt", async () => {
    await db.exec(remodel);
    expect((await db.query("SELECT id, receipt_id, phone FROM participants WHERE id='alex'")).rows).toEqual([
      { id: "alex", receipt_id: "first", phone: "+12125550123" },
    ]);
    const second = (await db.query<{ id: string; receipt_id: string }>("SELECT id, receipt_id FROM participants WHERE receipt_id='second' AND display_name='Alex'")).rows[0];
    expect(second.id).toMatch(/^rp_/);
    expect(second.id).not.toBe("alex");
    expect((await db.query("SELECT participant_id FROM bills WHERE id='bill-alex'")).rows).toEqual([{ participant_id: second.id }]);
    expect((await db.query("SELECT paid_by_participant_id FROM receipts WHERE id='second'")).rows).toEqual([{ paid_by_participant_id: second.id }]);
    expect((await db.query("SELECT count(*)::int AS n FROM participants")).rows).toEqual([{ n: 7 }]);
  });

  it("separates single assignments from shared allocations without changing bill amounts", async () => {
    await db.exec(remodel);
    expect((await db.query("SELECT assigned_participant_id FROM receipt_items WHERE id='steak-1'")).rows).toEqual([{ assigned_participant_id: "alex" }]);
    expect((await db.query("SELECT assigned_participant_id FROM receipt_items WHERE id='app-1'")).rows).toEqual([{ assigned_participant_id: null }]);
    expect((await db.query("SELECT participant_id FROM shared_item_allocations WHERE item_id='app-1' ORDER BY participant_id")).rows).toEqual([
      { participant_id: "alex" }, { participant_id: "sam" },
    ]);
    expect((await db.query("SELECT split_mode FROM receipts WHERE id='first'")).rows).toEqual([{ split_mode: "SHARED_ITEMS" }]);
    expect((await db.query("SELECT sum(subtotal)::text AS subtotal, sum(tax_share)::text AS tax, sum(tip_share)::text AS tip, sum(amount_owed)::text AS total FROM bills")).rows).toEqual([
      { subtotal: "30.00", tax: "2.70", tip: "6.00", total: "38.70" },
    ]);
    const paid = (await db.query<{ paid_at: string }>("SELECT paid_at::text FROM bills WHERE id='bill-sam'")).rows[0];
    expect(paid.paid_at).toBe("2020-01-05 00:00:00");
    expect((await db.query("SELECT paid_at FROM bills WHERE id='bill-alex'")).rows).toEqual([{ paid_at: null }]);
  });

  it("maps strictly individual legacy splits and removes dormant even shares", async () => {
    await db.exec("DELETE FROM item_shares WHERE item_id='app-1' AND member_id='sam'; UPDATE receipts SET split_mode='EVEN' WHERE id='second'");
    await db.exec(remodel);
    expect((await db.query("SELECT split_mode FROM receipts WHERE id='first'")).rows).toEqual([{ split_mode: "ITEMIZED" }]);
    expect((await db.query("SELECT assigned_participant_id FROM receipt_items WHERE id='app-1'")).rows).toEqual([{ assigned_participant_id: "alex" }]);
    expect((await db.query("SELECT count(*)::int AS n FROM shared_item_allocations WHERE receipt_id='second'")).rows).toEqual([{ n: 0 }]);
    expect((await db.query<{ assigned_participant_id: string | null }>("SELECT assigned_participant_id FROM receipt_items WHERE receipt_id='second'")).rows.every((row) => row.assigned_participant_id === null)).toBe(true);
  });

  it("enforces same-receipt assignees, shares, bills and payer references", async () => {
    await db.exec(remodel);
    await expect(db.exec("UPDATE receipt_items SET assigned_participant_id='gone-member' WHERE id='steak-1'")).rejects.toThrow();
    await expect(db.exec("INSERT INTO shared_item_allocations VALUES ('first', 'app-1', 'gone-member')")).rejects.toThrow();
    await expect(db.exec("UPDATE bills SET participant_id='alex' WHERE id='bill-alex'")).rejects.toThrow();
    await expect(db.exec("UPDATE receipts SET paid_by_participant_id='gone-member' WHERE id='first'")).rejects.toThrow();
  });

  it("rejects active unequal weights without losing legacy rows", async () => {
    await db.exec("UPDATE item_shares SET weight=2 WHERE item_id='app-1' AND member_id='alex'");
    await rejectsUpgrade("unequal active item weights");
  });

  it.each(["3.00", "7.00", "-1.00"])("rejects incompatible payment amount %s", async (amount) => {
    await db.query("UPDATE payments SET amount=$1 WHERE id='payment'", [amount]);
    await rejectsUpgrade("payment balances");
  });

  it("rejects cross-party financial references", async () => {
    await db.exec("UPDATE bills SET member_id='gone-member' WHERE id='bill-alex'");
    await rejectsUpgrade("cross-party");
  });

  it("rolls back even a late constraint failure after renaming and copying rows", async () => {
    await db.exec("UPDATE receipt_items SET quantity=0 WHERE id='steak-1'");
    await rejectsUpgrade(/receipt_items_values_check/);
    expect((await db.query("SELECT member_id FROM bills WHERE id='bill-alex'")).rows).toEqual([{ member_id: "alex" }]);
    expect((await db.query("SELECT count(*)::int AS n FROM payments")).rows).toEqual([{ n: 1 }]);
  });
});
