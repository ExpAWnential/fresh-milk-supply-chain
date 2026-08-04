import type { CSSProperties } from "react";
import "./TempChart.css";

export interface ChartReading {
  readonly at?: string;
  readonly celsius: number;
}

export interface TempChartProps {
  readonly readings?: readonly ChartReading[];
  readonly safeMin?: number;
  readonly safeMax?: number;
  readonly height?: number;
  readonly style?: CSSProperties;
}

export function TempChart({
  readings = [],
  safeMin = 0,
  safeMax = 5,
  height = 180,
  style
}: TempChartProps) {
  const W = 640;
  const H = height;
  const PAD = { t: 14, r: 12, b: 22, l: 38 };
  const temps = readings.map((r) => r.celsius);
  const lo = Math.min(safeMin - 2, ...(temps.length ? temps : [safeMin]));
  const hi = Math.max(safeMax + 3, ...(temps.length ? temps : [safeMax]));
  const x = (i: number) =>
    readings.length < 2 ? W / 2 : PAD.l + (W - PAD.l - PAD.r) * (i / (readings.length - 1));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo));
  const pts = readings.map((r, i) => `${x(i)},${y(r.celsius)}`).join(" ");

  return (
    <svg
      className="fm-chart"
      viewBox={`0 0 ${W} ${H}`}
      style={style}
      role="img"
      aria-label="Temperature readings"
    >
      <rect
        x={PAD.l}
        y={y(safeMax)}
        width={W - PAD.l - PAD.r}
        height={y(safeMin) - y(safeMax)}
        fill="var(--ok-tint)"
      />
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={y(safeMax)}
        y2={y(safeMax)}
        stroke="var(--ok)"
        strokeDasharray="4 4"
        strokeWidth="1"
      />
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={y(safeMin)}
        y2={y(safeMin)}
        stroke="var(--ok)"
        strokeDasharray="4 4"
        strokeWidth="1"
      />
      <text x={PAD.l - 6} y={y(safeMax) + 3} textAnchor="end">
        {safeMax}°C
      </text>
      <text x={PAD.l - 6} y={y(safeMin) + 3} textAnchor="end">
        {safeMin}°C
      </text>
      <text className="fm-chart__bandlabel" x={W - PAD.r - 4} y={y(safeMax) + 12} textAnchor="end">
        safe band
      </text>
      {readings.length > 1 ? (
        <polyline points={pts} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      ) : null}
      {readings.map((r, i) => {
        const out = r.celsius < safeMin || r.celsius > safeMax;
        return (
          <g key={i}>
            {out ? <circle cx={x(i)} cy={y(r.celsius)} r="8" fill="var(--broken-tint)" /> : null}
            <circle
              cx={x(i)}
              cy={y(r.celsius)}
              r="3.2"
              fill={out ? "var(--broken)" : "var(--ok)"}
            />
          </g>
        );
      })}
      {readings.length ? (
        <text x={PAD.l} y={H - 6}>
          {readings[0].at ?? ""}
        </text>
      ) : null}
      {readings.length > 1 ? (
        <text x={W - PAD.r} y={H - 6} textAnchor="end">
          {readings[readings.length - 1].at ?? ""}
        </text>
      ) : null}
    </svg>
  );
}
