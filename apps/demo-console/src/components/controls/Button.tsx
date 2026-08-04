import type { CSSProperties, ReactNode } from "react";
import "./Button.css";

export interface ButtonProps {
  readonly variant?: "default" | "primary" | "quiet" | "danger";
  readonly size?: "md" | "sm";
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
  readonly title?: string;
}

export function Button({
  variant = "default",
  size = "md",
  disabled,
  onClick,
  children,
  style,
  title
}: ButtonProps) {
  const className = [
    "fm-btn",
    variant !== "default" ? `fm-btn--${variant}` : "",
    size === "sm" ? "fm-btn--sm" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
      style={style}
      title={title}
    >
      {children}
    </button>
  );
}
