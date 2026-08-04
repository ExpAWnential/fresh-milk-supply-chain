/**
 * The pieces the simulation and the live console hold in common.
 *
 * Both consoles use the same screen, but the services behind their controls differ. Shared values
 * live here so the two cannot drift apart visually.
 */
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Tone } from "./components";

export const ORGS = ["regulator", "farm", "processor", "logistics", "retailer", "oracle"] as const;
export type Org = (typeof ORGS)[number];

export const STAGES = ["Created", "Processed", "In transit", "Delivered"];

export const DEFAULT_PAIRS: readonly (readonly [string, number])[] = [
  ["06:00", 2.4],
  ["07:00", 1.8],
  ["08:00", 2.2],
  ["09:00", 3.1],
  ["10:00", 2.8],
  ["11:00", 3.6],
  ["12:00", 4.2],
  ["13:00", 3.4]
];

export const UNSAFE_PAIRS: readonly (readonly [string, number])[] = [
  ["06:00", 2.4],
  ["07:00", 3.1],
  ["08:00", 4.2],
  ["09:00", 7.9],
  ["10:00", 8.4],
  ["11:00", 6.1],
  ["12:00", 4.6],
  ["13:00", 3.2]
];

export const HOME_ORIGIN = {
  farm: "Homelander's Mother Milk Dairy",
  place: "Vought Pastures"
};

export const OPENING_CAPTION = "You're the regulator. Register the six companies, one at a time.";

export const label: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--faint)"
};

export const mono: CSSProperties = { fontFamily: "var(--font-mono)" };

export const cheatLabel: CSSProperties = {
  ...label,
  fontWeight: 600,
  color: "var(--broken)",
  padding: "8px 0 2px"
};

export const settingRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "9px 0",
  flexWrap: "wrap"
};

export const dividedRow: CSSProperties = { ...settingRow, borderTop: "1px solid var(--hairline)" };

export const settingText: CSSProperties = {
  fontSize: 13,
  color: "var(--ink)",
  flex: 1,
  minWidth: 200
};

export const registryRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 10px",
  background: "var(--well)",
  borderRadius: "var(--r-sm)"
};

export const lieInput: CSSProperties = {
  ...mono,
  fontSize: 12,
  color: "var(--broken)",
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  padding: "3px 6px",
  cursor: "text",
  width: 30,
  textAlign: "center"
};

export const readingInput: CSSProperties = {
  ...mono,
  fontSize: 13,
  color: "var(--ink)",
  background: "var(--card)",
  borderRadius: 6,
  padding: "6px 8px",
  width: "100%",
  boxSizing: "border-box"
};

export const page: CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  padding: "24px 28px 48px",
  display: "flex",
  flexDirection: "column",
  gap: 16
};

export const columns: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "7fr 5fr",
  gap: 16,
  alignItems: "start"
};

export const column: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };

export const chipRow: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };

export const feedScroll: CSSProperties = {
  maxHeight: "32rem",
  overflow: "auto",
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column"
};

export const blockNumber: CSSProperties = {
  ...mono,
  fontSize: 11,
  fontWeight: 600,
  flex: "none",
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 7
};

export const short = (hash?: string | null) =>
  hash && typeof hash === "string" ? hash.slice(0, 10) + "…" : "—";

export function stat(color: string, text: string) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 500,
        color: "var(--muted)",
        whiteSpace: "nowrap"
      }}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: "50%", background: color, flex: "none" }}
      ></span>
      {text}
    </span>
  );
}

export interface Caption {
  readonly tone: Tone;
  readonly text: string;
}

export function captionStat(tone: Tone) {
  return stat(
    tone === "ok"
      ? "var(--ok)"
      : tone === "refused"
        ? "var(--refused)"
        : tone === "broken"
          ? "var(--broken)"
          : "var(--faint)",
    tone === "ok" ? "Done" : tone === "refused" ? "Refused" : tone === "broken" ? "Alert" : "Info"
  );
}

export function CaptionPanelBody({ text }: { readonly text: string }) {
  return <div style={{ fontSize: 16, lineHeight: 1.6, color: "var(--ink)" }}>{text}</div>;
}

interface Ghost {
  readonly id: number;
  readonly text: string;
}

/** Refused attempts appear as a dashed red row and fade out on their own. */
export function useGhosts() {
  const [ghosts, setGhosts] = useState<readonly Ghost[]>([]);
  const idRef = useRef(0);

  const ghost = useCallback((text: string) => {
    const id = ++idRef.current;
    setGhosts((current) => [{ id, text }, ...current]);
    setTimeout(() => setGhosts((current) => current.filter((g) => g.id !== id)), 3200);
  }, []);

  return { ghosts, ghost };
}

export function GhostRows({ ghosts }: { readonly ghosts: readonly Ghost[] }) {
  return (
    <>
      {ghosts.map((g) => (
        <div
          key={"g" + g.id}
          className="fm-ghost"
          style={{
            border: "1px dashed var(--broken)",
            background: "var(--broken-tint)",
            borderRadius: 10,
            padding: "8px 12px",
            marginBottom: 10
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--broken)" }}>
            refused · {g.text}
          </div>
        </div>
      ))}
    </>
  );
}

export function PresetToggle({
  options,
  selected,
  onPick
}: {
  readonly options: readonly (readonly [string, string])[];
  readonly selected: string | null;
  readonly onPick: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        background: "var(--well)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 2,
        gap: 2
      }}
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick(id)}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            fontWeight: 600,
            padding: "6px 12px",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            background: selected === id ? "var(--card)" : "transparent",
            color: selected === id ? "var(--ink)" : "var(--muted)",
            boxShadow: selected === id ? "var(--shadow-card)" : "none"
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function SettingRow({
  text,
  divided,
  children
}: {
  readonly text: ReactNode;
  readonly divided?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div style={divided ? dividedRow : settingRow}>
      <span style={settingText}>{text}</span>
      {children}
    </div>
  );
}
