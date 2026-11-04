import type { ReactNode } from "react";
import { IconButton } from "./Button";
import { Avatar, StatusPill, type Tone } from "./Status";

const STATUS = {
  done: ["brand", "Done"],
  picking: ["accent", "Picking"],
  invited: ["neutral", "Link sent"],
  unopened: ["neutral", "Not opened"],
  host: ["neutral", "Assigned by you"],
} as const;

type MemberRowProps = {
  name?: string;
  /** Default name ("Guest 3") shown when `name` is empty. */
  placeholder?: string;
  phone?: string;
  tone?: Tone;
  host?: boolean;
  status?: keyof typeof STATUS;
  editable?: boolean;
  onNameChange?: (value: string) => void;
  onPhoneChange?: (value: string) => void;
  onRemove?: () => void;
};

// A person in the party. Stack inside <MemberList>. Passing onRemove shows the remove button.
export function MemberRow({
  name, placeholder, phone, tone, host, status, editable, onNameChange, onPhoneChange, onRemove,
}: MemberRowProps) {
  const display = name || placeholder || "";
  const st = status && STATUS[status];
  return (
    <div className="sb-member">
      <Avatar name={display} tone={tone} />
      {editable ? (
        <div className="sb-member__fields">
          <input
            className="sb-member__input"
            aria-label="Name"
            defaultValue={name}
            placeholder={placeholder}
            onChange={onNameChange && ((e) => onNameChange(e.target.value))}
          />
          <input
            className="sb-member__input sb-member__input--phone"
            aria-label="Phone (optional)"
            type="tel"
            defaultValue={phone}
            placeholder="Phone (optional)"
            onChange={onPhoneChange && ((e) => onPhoneChange(e.target.value))}
          />
        </div>
      ) : (
        <div className="sb-member__text">
          <span className="sb-member__name">
            {name}
            {host && <span className="sb-member__you"> (host)</span>}
          </span>
          {phone && <span className="sb-member__phone">{phone}</span>}
        </div>
      )}
      {st && <StatusPill tone={st[0]}>{st[1]}</StatusPill>}
      {onRemove && <IconButton icon="close" label={`Remove ${display}`} tone="danger" onClick={onRemove} />}
    </div>
  );
}

export function MemberList({ children }: { children: ReactNode }) {
  return <div className="sb-members">{children}</div>;
}

type MemberBillProps = {
  name: string;
  tone?: Tone;
  owed: string;
  subtotal: string;
  tax: string;
  tip: string;
  payer?: boolean;
  items?: { name: string; amount: string }[];
};

export function MemberBill({ name, tone, owed, subtotal, tax, tip, payer, items }: MemberBillProps) {
  return (
    <section className="sb-bill">
      <header className="sb-bill__head">
        <Avatar name={name} tone={tone} />
        <div className="sb-bill__who">
          <h3 className="sb-bill__name">{name}</h3>
          {payer && <StatusPill tone="brand">Paid the bill</StatusPill>}
        </div>
        <span className="sb-bill__owed">{owed}</span>
      </header>
      {items && (
        <ul className="sb-bill__items">
          {items.map((it) => (
            <li key={it.name}>
              <span>{it.name}</span>
              <span className="sb-mono">{it.amount}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="sb-bill__math">
        {subtotal} + {tax} tax + {tip} tip
      </p>
    </section>
  );
}
