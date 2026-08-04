import type { CSSProperties } from "react";
import "./HashCompare.css";

export interface HashCompareRow {
  readonly label: string;
  readonly value: string;
  readonly bad?: boolean;
}

export interface HashCompareProps {
  readonly rows?: readonly HashCompareRow[];
  readonly match?: boolean;
  readonly matchText?: string;
  readonly mismatchText?: string;
  readonly style?: CSSProperties;
}

export function HashCompare({
  rows = [],
  match,
  matchText = "readings match the anchor",
  mismatchText = "MISMATCH — the readings were altered; the anchor was not",
  style
}: HashCompareProps) {
  return (
    <div className="fm-hash" style={style}>
      {rows.map((row) => (
        <div className="fm-hash__row" key={row.label}>
          <span className="fm-hash__label">{row.label}</span>
          <span className={"fm-hash__val" + (row.bad ? " fm-hash__val--bad" : "")}>
            {row.value}
          </span>
        </div>
      ))}
      {match !== undefined ? (
        <div className="fm-hash__verdict">
          <span
            className="fm-hash__eq"
            style={
              match
                ? { color: "var(--ok)", background: "var(--ok-tint)" }
                : { color: "var(--broken)", background: "var(--broken-tint)" }
            }
          >
            {match ? "=" : "≠"}
          </span>
          <span style={{ color: match ? "var(--ok)" : "var(--broken)" }}>
            {match ? matchText : mismatchText}
          </span>
        </div>
      ) : null}
    </div>
  );
}
