import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";
import { IconButton } from "./Button";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  money?: boolean;
};

export function TextField({ label, hint, error, prefix, money, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cx("sb-field", error && "is-error", money && "sb-field--money")}>
      <label className="sb-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="sb-field__control">
        {prefix && <span className="sb-field__prefix">{prefix}</span>}
        <input
          id={inputId}
          className="sb-field__input"
          inputMode={money ? "decimal" : undefined}
          {...rest}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {(error || hint) && <p className="sb-field__hint">{error || hint}</p>}
    </div>
  );
}

type CountStepperProps = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
};

export function CountStepper({ label, value, min = 1, max = 20, onIncrement, onDecrement }: CountStepperProps) {
  return (
    <div className="sb-count" role="group" aria-label={label}>
      <span className="sb-count__label">{label}</span>
      <div className="sb-count__ctrl">
        <IconButton icon="minus" label="Remove a person" disabled={value <= min} onClick={onDecrement} />
        <output className="sb-count__value" aria-live="polite">
          {value}
        </output>
        <IconButton icon="plus" label="Add a person" disabled={value >= max} onClick={onIncrement} />
      </div>
    </div>
  );
}

type ToggleProps = { label: string; description?: string; checked: boolean; onChange?: () => void };

export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <div className="sb-toggle">
      <div className="sb-toggle__text">
        <span className="sb-toggle__label">{label}</span>
        {description && <span className="sb-toggle__desc">{description}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="sb-switch" onClick={onChange}>
        <span className="sb-switch__thumb" />
      </button>
    </div>
  );
}
