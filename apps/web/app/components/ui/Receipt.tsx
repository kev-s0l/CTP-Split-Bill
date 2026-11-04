import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { IconButton } from "./Button";
import { AvatarStack, StatusPill, type Person } from "./Status";

type ReceiptItemRowProps = {
  mode?: "view" | "edit" | "pick" | "assign";
  /** An empty name renders as a flagged "Unnamed item". */
  name: string;
  /** Display-ready string, e.g. "$16.50". */
  price: string;
  qty?: number;
  unit?: string;
  note?: string;
  selected?: boolean;
  assignees?: Person[];
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

// One line item, rendered the same way on every screen. Stack inside <ItemList>.
export function ReceiptItemRow({
  mode = "view", name, price, qty, unit, note, selected, assignees, onClick, onEdit, onDelete,
}: ReceiptItemRowProps) {
  const unnamed = !name;
  const meta = [
    qty && qty !== 1 ? `${qty} × ${unit}` : null,
    unnamed && mode === "edit" ? "Tap to name it" : null,
    note || null,
  ].filter(Boolean).join(" · ");
  const main = (
    <span className="sb-item__main">
      <span className={cx("sb-item__name", unnamed && "is-unnamed")}>{unnamed ? "Unnamed item" : name}</span>
      <span className="sb-item__meta">{meta}</span>
    </span>
  );
  const priceEl = <span className="sb-item__price">{price}</span>;

  if (mode === "pick") {
    return (
      <button type="button" className={cx("sb-item", "sb-item--pick", selected && "is-selected")} aria-pressed={!!selected} onClick={onClick}>
        <span className="sb-item__check">{selected && <Icon name="check" size={16} />}</span>
        {main}
        {priceEl}
      </button>
    );
  }

  if (mode === "assign") {
    const assigned = assignees && assignees.length > 0;
    return (
      <button type="button" className={cx("sb-item", "sb-item--assign", !assigned && "is-flagged")} onClick={onClick}>
        {main}
        {assigned ? <AvatarStack people={assignees} /> : <StatusPill tone="accent">Unassigned</StatusPill>}
        {priceEl}
        <Icon name="chevron" size={18} className="sb-item__chev" />
      </button>
    );
  }

  const label = name || "unnamed item";
  return (
    <div className={cx("sb-item", `sb-item--${mode}`, unnamed && "is-flagged")}>
      {main}
      {priceEl}
      {mode === "edit" && (
        <span className="sb-item__actions">
          <IconButton icon="pencil" label={`Edit ${label}`} onClick={onEdit} />
          <IconButton icon="trash" label={`Delete ${label}`} tone="danger" onClick={onDelete} />
        </span>
      )}
    </div>
  );
}

export function ItemList({ children }: { children: ReactNode }) {
  return <div className="sb-items">{children}</div>;
}

type TotalsPanelProps = {
  rows: { label: string; value: string; flag?: string }[];
  total?: string;
  totalLabel?: string;
};

export function TotalsPanel({ rows, total, totalLabel = "Total" }: TotalsPanelProps) {
  return (
    <dl className="sb-totals">
      {rows.map((r) => (
        <div key={r.label} className={cx("sb-totals__row", r.flag && "is-flagged")}>
          <dt>
            {r.label}
            {r.flag && <span className="sb-totals__flag"> · {r.flag}</span>}
          </dt>
          <dd>{r.value}</dd>
        </div>
      ))}
      {total && (
        <div className="sb-totals__row sb-totals__row--total">
          <dt>{totalLabel}</dt>
          <dd>{total}</dd>
        </div>
      )}
    </dl>
  );
}
