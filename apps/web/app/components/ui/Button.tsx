import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: IconName;
};

export function Button({ variant = "secondary", size = "md", block, icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx("sb-btn", `sb-btn--${variant}`, `sb-btn--${size}`, block && "sb-btn--block", className)}
    >
      {icon && <Icon name={icon} size={size === "lg" ? 22 : 18} />}
      {children}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  tone?: "danger" | "camera";
};

export function IconButton({ icon, label, tone, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx("sb-iconbtn", tone && `sb-iconbtn--${tone}`, className)}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}
