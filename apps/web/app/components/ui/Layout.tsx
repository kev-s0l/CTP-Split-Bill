import type { ReactNode } from "react";
import { cx } from "./cx";
import { IconButton } from "./Button";

type AppBarProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
};

export function AppBar({ title, subtitle, onBack, action }: AppBarProps) {
  return (
    <header className="sb-appbar">
      {onBack ? <IconButton icon="back" label="Back" onClick={onBack} /> : <span className="sb-appbar__spacer" />}
      <div className="sb-appbar__text">
        <h1 className="sb-appbar__title">{title}</h1>
        {subtitle && <p className="sb-appbar__sub">{subtitle}</p>}
      </div>
      {action ?? <span className="sb-appbar__spacer" />}
    </header>
  );
}

const DEFAULT_STEPS = ["Scan", "Check", "People", "Review", "Bill"];

type FlowStepsProps = { steps?: string[]; current: number };

export function FlowSteps({ steps = DEFAULT_STEPS, current }: FlowStepsProps) {
  return (
    <nav className="sb-steps" aria-label="Progress">
      <ol className="sb-steps__bar">
        {steps.map((s, i) => (
          <li
            key={s}
            className={cx("sb-steps__seg", i < current && "is-done", i === current && "is-current")}
            aria-current={i === current ? "step" : undefined}
          >
            <span className="sb-visually-hidden">{s + (i < current ? " (done)" : "")}</span>
          </li>
        ))}
      </ol>
      <p className="sb-steps__label">
        Step {current + 1} of {steps.length} · <strong>{steps[current]}</strong>
      </p>
    </nav>
  );
}

type BottomBarProps = { summary?: string; amount?: string; children: ReactNode };

// Sticky footer for host screens; a disabled primary should explain itself in `summary`.
export function BottomBar({ summary, amount, children }: BottomBarProps) {
  return (
    <div className="sb-bottombar">
      {(summary || amount) && (
        <div className="sb-bottombar__summary">
          {summary && <span className="sb-bottombar__label">{summary}</span>}
          {amount && <span className="sb-bottombar__amount">{amount}</span>}
        </div>
      )}
      <div className="sb-bottombar__actions">{children}</div>
    </div>
  );
}

type SheetProps = { title: string; children: ReactNode; footer?: ReactNode; onClose?: () => void };

export function Sheet({ title, children, footer, onClose }: SheetProps) {
  return (
    <div className="sb-sheet" role="dialog" aria-modal aria-label={title}>
      <div className="sb-sheet__grip" aria-hidden />
      <header className="sb-sheet__head">
        <h2 className="sb-sheet__title">{title}</h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      <div className="sb-sheet__body">{children}</div>
      {footer && <div className="sb-sheet__foot">{footer}</div>}
    </div>
  );
}
