import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";

export type Tone = 1 | 2 | 3 | 4 | 5 | 6;
export type Person = { name: string; tone: Tone };

// "Guest 3" -> "G3", "Maya Chen" -> "MC", "Maya" -> "M".
function initials(name: string) {
  const w = (name || "?").trim().split(/\s+/);
  if (w.length > 1 && /^\d+$/.test(w[1])) return (w[0][0] + w[1]).toUpperCase();
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0][0]).toUpperCase();
}

type AvatarProps = { name: string; tone?: Tone; size?: "md" | "sm" };

export function Avatar({ name, tone = 1, size }: AvatarProps) {
  return (
    <span
      className={cx("sb-avatar", `sb-avatar--${((tone - 1) % 6) + 1}`, size === "sm" && "sb-avatar--sm")}
      title={name}
      aria-label={name}
      role="img"
    >
      {initials(name)}
    </span>
  );
}

type AvatarStackProps = { people: Person[]; max?: number };

export function AvatarStack({ people, max = 3 }: AvatarStackProps) {
  return (
    <span className="sb-avstack">
      {people.slice(0, max).map((m, i) => (
        <Avatar key={i} name={m.name} tone={m.tone} size="sm" />
      ))}
      {people.length > max && <span className="sb-avstack__more">+{people.length - max}</span>}
    </span>
  );
}

type StatusPillProps = { tone?: "neutral" | "brand" | "accent" | "danger"; children: ReactNode };

export function StatusPill({ tone = "neutral", children }: StatusPillProps) {
  return (
    <span className={cx("sb-pill", `sb-pill--${tone}`)}>
      {tone === "brand" && <Icon name="check" size={14} />}
      {children}
    </span>
  );
}

type BannerProps = { tone?: "info" | "warn" | "danger"; title?: string; children?: ReactNode };

export function Banner({ tone = "info", title, children }: BannerProps) {
  return (
    <div className={cx("sb-banner", `sb-banner--${tone}`)} role={tone === "info" ? "status" : "alert"}>
      <Icon name={tone === "info" ? "receipt" : "alert"} />
      <div>
        {title && <p className="sb-banner__title">{title}</p>}
        {children && <p className="sb-banner__body">{children}</p>}
      </div>
    </div>
  );
}
