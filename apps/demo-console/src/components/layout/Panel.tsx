import type { CSSProperties, ReactNode } from "react";
import "./Panel.css";

export interface PanelProps {
  readonly title?: ReactNode;
  readonly right?: ReactNode;
  readonly children?: ReactNode;
  readonly pad?: boolean;
  readonly style?: CSSProperties;
}

export function Panel({ title, right, children, pad = true, style }: PanelProps) {
  return (
    <section className="fm-panel" style={style}>
      {title ? (
        <div className="fm-panel__head">
          <span className="fm-panel__title">{title}</span>
          {right ? (
            <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>{right}</span>
          ) : null}
        </div>
      ) : null}
      <div className={pad ? "fm-panel__body" : undefined}>{children}</div>
    </section>
  );
}
