import type { CSSProperties, ReactNode } from "react";
import "./ToneBadge.css";

export type Tone = "ok" | "refused" | "broken" | "chill" | "neutral";

export interface ToneBadgeProps {
  readonly tone?: Tone;
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
}

export function ToneBadge({ tone = "neutral", children, style }: ToneBadgeProps) {
  return (
    <span className={`fm-badge fm-badge--${tone}`} style={style}>
      {children}
    </span>
  );
}
