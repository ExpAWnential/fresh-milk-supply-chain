import type { CSSProperties } from "react";
import "./CompanyChip.css";

export type ChipStatus = "up" | "down" | "unknown";

export interface CompanyChipProps {
  readonly name: string;
  readonly port?: number | string;
  readonly status?: ChipStatus;
  readonly selected?: boolean;
  readonly onClick?: () => void;
  readonly style?: CSSProperties;
}

export function CompanyChip({
  name,
  port,
  status = "unknown",
  selected,
  onClick,
  style
}: CompanyChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"fm-org" + (selected ? " fm-org--sel" : "")}
      style={style}
    >
      <span
        className={
          "fm-org__dot" +
          (status === "up" ? " fm-org__dot--up" : status === "down" ? " fm-org__dot--down" : "")
        }
      ></span>
      <span className="fm-org__name">{name}</span>
      {port ? <span className="fm-org__port">:{port}</span> : null}
    </button>
  );
}
