"use client";
// Items step editor: restaurant, date, items, totals, the live totals check,
// Save and Confirm items. Spec: docs/specs/receipts/edit-screen.md.
import { CheckIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "../../../components/EmptyState";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { cn } from "../../../lib/cn";
import { loginPath } from "../../../lib/page-access";
import { installLeaveGuard } from "../participants/leave-guard";
import {
  type EditorReceipt,
  type FormRow,
  type MoneyField,
  type Problem,
  type ReceiptForm,
  amountsCheckText,
  confirmProblems,
  dollars,
  eachHint,
  fieldId,
  formErrors,
  hasErrors,
  isBlankRow,
  isDirty,
  itemRows,
  itemsBody,
  itemsCheckText,
  newRowKey,
  removeRowAt,
  restoreRow,
  rowFieldId,
  savePlan,
  tidyMoney,
  displayMoney,
  toEditorReceipt,
  totals,
} from "./receipt-form";

export const LEAVE_MESSAGE = "You have unsaved changes to this receipt's items. Leave anyway?";
const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";
const CONFLICT = "This receipt changed somewhere else. Reload to see the latest.";
// Toasts on this screen go to the top: the sticky action bar owns the bottom,
// and a toast over it would take a tap meant for Confirm.
const TOAST_POSITION = "top-center" as const;

type SaveError = { message: string; conflict: boolean };

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "Something went wrong. Try again in a moment.";
}

export function ItemsEditor({ initial }: { initial: EditorReceipt }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState<ReceiptForm>(initial.form);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState<"save" | "confirm" | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);

  const finalized = saved.status === "FINALIZED";
  const readOnly = finalized || saved.pickingOpen;
  const dirty = isDirty(form, saved.form);
  const errors = useMemo(() => formErrors(form), [form]);
  const check = totals(form);
  const base = `/receipts/${encodeURIComponent(saved.id)}`;

  useEffect(() => {
    if (!dirty || readOnly) return;
    return installLeaveGuard(window, (message) => window.confirm(message), LEAVE_MESSAGE);
  }, [dirty, readOnly]);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const shown = (id: string, message: string | undefined) => (showAll || touched[id] ? message : undefined);
  const touch = (id: string) => setTouched((t) => ({ ...t, [id]: true }));

  function update(patch: Partial<ReceiptForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setProblems([]);
  }
  function updateRow(key: string, patch: Partial<FormRow>) {
    update({ rows: form.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) });
  }
  function addRow() {
    const key = newRowKey();
    update({ rows: [...form.rows, { key, name: "", qty: "1", price: "" }] });
    setFocusId(rowFieldId(key, "name"));
  }
  function removeRow(key: string) {
    const { rows, removed, index } = removeRowAt(form.rows, key);
    if (!removed) return;
    update({ rows });
    const next = rows[index] ?? rows[index - 1];
    setFocusId(next ? rowFieldId(next.key, "name") : "add-item");
    // An empty row loses nothing, so it goes without a toast.
    if (isBlankRow(removed)) return;
    toast(`Removed ${removed.name.trim() || `item ${index + 1}`}`, {
      position: TOAST_POSITION,
      duration: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          setForm((f) => ({ ...f, rows: restoreRow(f.rows, removed, index) }));
          setFocusId(rowFieldId(removed.key, "name"));
        },
      },
    });
  }

  async function reload() {
    try {
      const res = await fetch(`/api/receipts/${encodeURIComponent(saved.id)}`, { cache: "no-store" });
      if (res.status === 401) return window.location.assign(loginPath(`${base}/items`));
      if (!res.ok) return setSaveError({ message: await errorMessage(res), conflict: false });
      const next = toEditorReceipt(await res.json());
      setSaved(next);
      setForm(next.form);
      setTouched({});
      setShowAll(false);
      setSaveError(null);
      setProblems([]);
      router.refresh();
    } catch {
      setSaveError({ message: NETWORK_ERROR, conflict: false });
    }
  }

  async function pausePicking() {
    try {
      const res = await fetch(`/api/receipts/${encodeURIComponent(saved.id)}/picking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: false }),
      });
      if (!res.ok) return setSaveError({ message: await errorMessage(res), conflict: false });
      await reload();
    } catch {
      setSaveError({ message: NETWORK_ERROR, conflict: false });
    }
  }

  // Sends one request; returns the new receipt, or null after showing why not.
  async function send(path: string, method: "PUT" | "PATCH", body: unknown): Promise<EditorReceipt | null> {
    let res: Response;
    try {
      res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setSaveError({ message: NETWORK_ERROR, conflict: false });
      return null;
    }
    if (res.status === 401) {
      window.location.assign(loginPath(`${base}/items`));
      return null;
    }
    if (res.status === 409) {
      setSaveError({ message: CONFLICT, conflict: true });
      return null;
    }
    if (!res.ok) {
      setSaveError({ message: await errorMessage(res), conflict: false });
      return null;
    }
    return toEditorReceipt(await res.json());
  }

  async function save(confirm: boolean) {
    setShowAll(true);
    setSaveError(null);
    if (confirm) {
      const found = confirmProblems(form);
      setProblems(found);
      if (found.length > 0) return setFocusId(found[0].focusId);
    } else if (hasErrors(errors)) {
      const first = confirmProblems(form)[0];
      return setFocusId(first?.focusId ?? null);
    }

    const plan = savePlan(form, saved.form, confirm);
    setSaving(confirm ? "confirm" : "save");
    let current = saved;
    try {
      if (plan.items) {
        const next = await send(`/api/receipts/${encodeURIComponent(saved.id)}/items`, "PUT", itemsBody(form, current.revision));
        if (!next) return;
        // Keep the saved items even if the field update below fails.
        current = { ...next, form: { ...current.form, rows: next.form.rows } };
        setSaved(current);
      }
      if (plan.patch) {
        const fields = savePlan(form, current.form, confirm).patch!;
        const next = await send(`/api/receipts/${encodeURIComponent(saved.id)}`, "PATCH", { expectedRevision: current.revision, ...fields });
        if (!next) return;
        current = next;
      }
      if (confirm) {
        router.push(`${base}/participants`);
        return;
      }
      setSaved(current);
      setForm(current.form);
      setTouched({});
      setShowAll(false);
      toast.success("Saved", { position: TOAST_POSITION });
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      {saved.pickingOpen && !finalized && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
          <p>Picking is open. Pause it to make changes.</p>
          <Button type="button" className="min-h-11" onClick={pausePicking}>
            Pause picking
          </Button>
        </div>
      )}

      <fieldset disabled={readOnly || saving !== null} className="space-y-6">
        <legend className="sr-only">Receipt details</legend>
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <Field id={fieldId("merchant")} label="Restaurant" error={shown(fieldId("merchant"), errors.merchant)}>
            <Input
              id={fieldId("merchant")}
              value={form.merchant}
              placeholder="Where was this?"
              autoComplete="off"
              className="min-h-11"
              aria-invalid={shown(fieldId("merchant"), errors.merchant) ? true : undefined}
              aria-describedby={shown(fieldId("merchant"), errors.merchant) ? `${fieldId("merchant")}-error` : undefined}
              onChange={(e) => update({ merchant: e.target.value })}
              onBlur={() => touch(fieldId("merchant"))}
            />
          </Field>
          <Field id="receipt-date" label="Date">
            <Input id="receipt-date" type="date" value={form.date} className="min-h-11" onChange={(e) => update({ date: e.target.value })} />
          </Field>
        </div>

        <section aria-labelledby="items-heading" className="space-y-3">
          <h2 id="items-heading" className="text-lg font-semibold">Items</h2>
          {form.rows.length === 0 ? (
            !readOnly && (
              <EmptyState title="No items yet" message="Add each line from the receipt." actionLabel="Add item" actionId="add-item" onAction={addRow} />
            )
          ) : (
            <ItemsTable
              rows={form.rows}
              errors={errors.rows}
              shown={shown}
              touch={touch}
              readOnly={readOnly}
              onChange={updateRow}
              onRemove={removeRow}
              onEnterInPrice={addRow}
            />
          )}
          {!readOnly && form.rows.length > 0 && (
            <Button id="add-item" type="button" variant="outline" className="min-h-11" onClick={addRow}>
              + Add item
            </Button>
          )}
        </section>

        {/* Above the totals, so it stays in view when focus moves to Subtotal or Total. */}
        {problems.length > 0 && (
          <div role="alert" className="space-y-1 rounded-md border border-destructive p-3 text-destructive">
            <p className="font-medium">Before confirming:</p>
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p.message}>{p.message}</li>
              ))}
            </ul>
          </div>
        )}

        <section aria-labelledby="totals-heading" className="space-y-3">
          <h2 id="totals-heading" className="text-lg font-semibold">Totals</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {(["subtotal", "tax", "tip", "total"] as MoneyField[]).map((field) => (
              <MoneyField
                key={field}
                id={fieldId(field)}
                label={field[0].toUpperCase() + field.slice(1)}
                value={form[field]}
                error={shown(fieldId(field), errors.fields[field])}
                onChange={(value) => update({ [field]: value })}
                onBlur={() => {
                  touch(fieldId(field));
                  const tidy = tidyMoney(form[field]);
                  if (tidy !== form[field]) update({ [field]: tidy });
                }}
              />
            ))}
          </div>
          <TotalsCheck form={form} check={check} readOnly={readOnly} onFill={update} />
        </section>
      </fieldset>

      {saveError && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive p-3 text-destructive">
          <p>{saveError.message}</p>
          {saveError.conflict && (
            <Button type="button" variant="outline" className="min-h-11" onClick={reload}>
              Reload
            </Button>
          )}
        </div>
      )}

      {!readOnly && (
        // Sticks to the bottom of the screen while the items scroll, so Save
        // and Confirm stay in reach on a long receipt. Whether things add up
        // is shown once, in the totals panel.
        <div data-testid="action-bar" className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-line bg-canvas px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {saved.reviewed && dirty && (
            <p className="text-sm text-ink-muted">Changing items or totals means confirming them again.</p>
          )}
          <div className="flex items-center justify-end gap-3">
            {saved.reviewed && !dirty && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
                <CheckIcon aria-hidden="true" className="size-4" strokeWidth={3} />
                Confirmed
              </span>
            )}
            <Button type="button" variant="outline" className="min-h-11 max-md:flex-1" disabled={!dirty || saving !== null} onClick={() => save(false)}>
              {saving === "save" ? "Saving…" : "Save"}
            </Button>
            <Button type="button" className="min-h-11 max-md:flex-1" disabled={saving !== null} onClick={() => save(true)}>
              {saving === "confirm" ? "Saving…" : "Confirm items"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function MoneyField({
  id,
  label,
  value,
  error,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <Field id={id} label={label} error={error}>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted">
          $
        </span>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          className="min-h-11 pl-7 text-right tabular-nums"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      </div>
    </Field>
  );
}

// Enter in Item or Qty moves to the next field in the row.
function focusOnEnter(ev: React.KeyboardEvent<HTMLInputElement>, nextId: string) {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  document.getElementById(nextId)?.focus();
}

// A table at md: and up; below md each row stacks into a block, with visible
// labels standing in for the hidden column headers.
export function ItemsTable({
  rows,
  errors,
  shown,
  touch,
  readOnly,
  onChange,
  onRemove,
  onEnterInPrice,
}: {
  rows: FormRow[];
  errors: Record<string, { name?: string; qty?: string; price?: string }>;
  shown: (id: string, message: string | undefined) => string | undefined;
  touch: (id: string) => void;
  readOnly: boolean;
  onChange: (key: string, patch: Partial<FormRow>) => void;
  onRemove: (key: string) => void;
  onEnterInPrice: () => void;
}) {
  return (
    <>
    {/* Phones: one header for the second line of every item (Qty, Line
        total); the first line is the item's name and its remove button. */}
    <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_2.75rem] gap-2 border-b border-line pb-2 text-sm font-medium text-ink-muted md:hidden">
      <span className="text-right">Qty</span>
      <span className="col-span-2 text-right">Line total</span>
    </div>
    <Table className="max-md:block">
      <TableHeader className="max-md:hidden">
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="w-24 text-right">Qty</TableHead>
          <TableHead className="w-36 text-right">Line total</TableHead>
          {!readOnly && <TableHead className="w-14"><span className="sr-only">Remove</span></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody className="max-md:block max-md:border-b max-md:border-line">
        {rows.map((row, index) => {
          const e = errors[row.key] ?? {};
          const cell = "whitespace-normal align-top max-md:block max-md:p-0";
          const hint = eachHint(row);
          const hintId = `${row.key}-each`;
          const numeric = (field: "name" | "qty" | "price") => field !== "name";
          const input = (field: "name" | "qty" | "price", label: string, props: React.ComponentProps<typeof Input>) => {
            const id = rowFieldId(row.key, field);
            const error = shown(id, e[field]);
            const describedBy = [error ? `${id}-error` : null, field === "price" && hint ? hintId : null].filter(Boolean).join(" ");
            return (
              <div className="space-y-1">
                <Label htmlFor={id} className="sr-only">
                  {label}
                  <span className="sr-only"> (item {index + 1})</span>
                </Label>
                <div className="relative">
                  {field === "price" && (
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted">
                      $
                    </span>
                  )}
                  <Input
                    id={id}
                    className={cn("min-h-11", numeric(field) && "text-right tabular-nums", field === "price" && "pl-7")}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy || undefined}
                    onBlur={() => touch(id)}
                    {...props}
                  />
                </div>
                {error && (
                  <p id={`${id}-error`} className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                {field === "price" && hint && (
                  <p id={hintId} className="text-right text-sm text-ink-muted tabular-nums">
                    {hint}
                  </p>
                )}
              </div>
            );
          };
          return (
            // Phones: two lines per item, the name and its remove button on the
            // first, then Qty | Line total, divided by rules like a printed
            // receipt.
            <TableRow
              key={row.key}
              className="hover:bg-transparent max-md:grid max-md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_2.75rem] max-md:gap-2 max-md:border-line max-md:py-3"
            >
              <TableCell className={cn(cell, "max-md:col-span-2 max-md:row-start-1")}>
                {input("name", "Item", {
                  value: row.name,
                  placeholder: "Item",
                  autoComplete: "off",
                  enterKeyHint: "next",
                  onChange: (ev) => onChange(row.key, { name: ev.target.value }),
                  onKeyDown: (ev) => focusOnEnter(ev, rowFieldId(row.key, "qty")),
                })}
              </TableCell>
              <TableCell className={cn(cell, "max-md:col-start-1 max-md:row-start-2")}>
                {input("qty", "Qty", {
                  value: row.qty,
                  inputMode: "decimal",
                  enterKeyHint: "next",
                  onChange: (ev) => onChange(row.key, { qty: ev.target.value }),
                  onKeyDown: (ev) => focusOnEnter(ev, rowFieldId(row.key, "price")),
                })}
              </TableCell>
              <TableCell className={cn(cell, "max-md:col-span-2 max-md:col-start-2 max-md:row-start-2")}>
                {input("price", "Line total", {
                  value: row.price,
                  inputMode: "decimal",
                  enterKeyHint: "next",
                  onChange: (ev) => onChange(row.key, { price: ev.target.value }),
                  onBlur: () => {
                    touch(rowFieldId(row.key, "price"));
                    const tidy = tidyMoney(row.price);
                    if (tidy !== row.price) onChange(row.key, { price: tidy });
                  },
                  onKeyDown: (ev) => {
                    if (ev.key === "Enter" && !readOnly) {
                      ev.preventDefault();
                      onEnterInPrice();
                    }
                  },
                })}
              </TableCell>
              {!readOnly && (
                <TableCell className={cn(cell, "max-md:col-start-3 max-md:row-start-1")}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 text-ink-muted hover:text-destructive"
                    aria-label={`Remove ${row.name.trim() || `item ${index + 1}`}`}
                    title="Remove"
                    onClick={() => onRemove(row.key)}
                  >
                    <XIcon aria-hidden="true" className="size-5" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </>
  );
}

export function TotalsCheck({
  form,
  check,
  readOnly,
  onFill,
}: {
  form: ReceiptForm;
  check: ReturnType<typeof totals>;
  readOnly: boolean;
  onFill: (patch: Partial<ReceiptForm>) => void;
}) {
  const items = itemsCheckText(check.itemsDiff);
  const amounts = amountsCheckText(check.amountsDiff);
  const canFillSubtotal = form.subtotal.trim() === "" && itemRows(form).length > 0 && check.itemsCents !== null;
  const canFillTotal = form.total.trim() === "" && check.partsCents !== null;
  const allMatch = check.itemsDiff === 0 && check.amountsDiff === 0 && itemRows(form).length > 0;
  const fills = !readOnly && (canFillSubtotal || canFillTotal);
  return (
    <div className={cn("space-y-3 rounded-card border bg-surface p-4 text-sm", allMatch ? "border-brand" : "border-line")}>
      {/* Only the results are live, so a screen reader hears the outcome of a
          change, not the shortcut buttons below it. */}
      <div role="status" aria-live="polite" className="space-y-2">
        {allMatch && (
          <div className="space-y-1 border-b border-line pb-3">
            <p className="flex items-start justify-between gap-3 text-base font-semibold">
              <span>
                Everything adds up: <span className="tabular-nums">{dollars(check.partsCents!)}</span>
              </span>
              <CheckIcon aria-hidden="true" className="size-5 shrink-0 text-brand" strokeWidth={3} />
            </p>
            <p className="text-ink-muted">Confirm items, then add who was at the table.</p>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <p>
            <span className="text-ink-muted">Items add up to </span>
            <span className="font-semibold tabular-nums">{check.itemsCents === null ? "—" : dollars(check.itemsCents)}</span>
          </p>
          <CheckMark diff={check.itemsDiff} text={items} />
        </div>
        <div className="flex items-start justify-between gap-3">
          <p>
            <span className="text-ink-muted">Subtotal + tax + tip is </span>
            <span className="font-semibold tabular-nums">{check.partsCents === null ? "—" : dollars(check.partsCents)}</span>
          </p>
          <CheckMark diff={check.amountsDiff} text={amounts} />
        </div>
      </div>
      {fills && (
        <div className="flex flex-wrap gap-2">
          {canFillSubtotal && (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => onFill({ subtotal: displayMoney(check.itemsCents!) })}>
              Use items total
            </Button>
          )}
          {canFillTotal && (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => onFill({ total: displayMoney(check.partsCents!) })}>
              Use subtotal + tax + tip
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Right-aligned on its line: ✓ when a check matches (its words stay for
// screen readers); how far off it is, then ✗, when it doesn't; nothing while
// a part is missing. The icon is last so the marks line up at the edge.
export function CheckMark({ diff, text }: { diff: number | null; text: string | null }) {
  if (diff === null || text === null) return null;
  if (diff === 0) {
    return (
      <span className="inline-flex shrink-0 items-center text-brand">
        <CheckIcon aria-hidden="true" className="size-5" strokeWidth={3} />
        <span className="sr-only">{text}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1 text-right text-destructive">
      <span>{text}</span>
      <XIcon aria-hidden="true" className="size-5 shrink-0" strokeWidth={3} />
    </span>
  );
}
