import type { CSSProperties } from "react";
import "./BatchStepper.css";

const DEFAULT_STEPS = ["Created", "Processed", "In transit", "Delivered"];

export interface BatchStepperProps {
  readonly steps?: readonly string[];
  readonly current?: number;
  readonly breach?: boolean;
  readonly recalled?: boolean;
  readonly bylines?: readonly string[];
  readonly style?: CSSProperties;
}

export function BatchStepper({
  steps = DEFAULT_STEPS,
  current = -1,
  breach = false,
  recalled = false,
  bylines,
  style
}: BatchStepperProps) {
  return (
    <div className="fm-step" style={style}>
      {steps.map((label, i) => {
        const done = i < current || (i === current && !breach && !recalled);
        const isCurrent = i === current;
        const nodeCls =
          "fm-step__node" +
          (isCurrent && breach
            ? " fm-step__node--breach"
            : done
              ? " fm-step__node--done"
              : isCurrent
                ? " fm-step__node--current"
                : "");
        const labelCls =
          "fm-step__label" +
          (isCurrent && breach
            ? " fm-step__label--breach"
            : done
              ? " fm-step__label--done"
              : isCurrent
                ? " fm-step__label--current"
                : "");

        return (
          <div className="fm-step__col" key={label}>
            {i > 0 ? (
              <div className={"fm-step__line" + (i <= current ? " fm-step__line--done" : "")}></div>
            ) : null}
            <div className={nodeCls}>{isCurrent && breach ? "!" : done ? "✓" : i + 1}</div>
            <div className={labelCls}>{label}</div>
            {bylines && bylines[i] ? (
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  color: "var(--faint)",
                  marginTop: -4
                }}
              >
                {bylines[i]}
              </div>
            ) : null}
            {isCurrent && breach ? (
              <span
                className="fm-step__stamp"
                style={{ color: "var(--broken)", background: "var(--broken-tint)" }}
              >
                out of range
              </span>
            ) : null}
            {isCurrent && recalled && !breach ? (
              <span
                className="fm-step__stamp"
                style={{ color: "var(--muted)", background: "var(--well)" }}
              >
                recalled
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
