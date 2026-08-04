/**
 * The simulation console: the same screen as the live one, with an in-memory chain behind it.
 *
 * It provides the console workflow without Fabric, PostgreSQL or organisation backends. Blocks use
 * deterministic placeholder hashes, while their links preserve the propagation behaviour needed
 * to show when an earlier block has been altered.
 */
import { useState } from "react";
import {
  BatchStepper,
  Button,
  CompanyChip,
  PageHeader,
  Panel,
  TempChart,
  TextInput,
  ToneBadge
} from "./components";
import {
  CaptionPanelBody,
  DEFAULT_PAIRS,
  GhostRows,
  HOME_ORIGIN,
  ORGS,
  OPENING_CAPTION,
  PresetToggle,
  STAGES,
  SettingRow,
  UNSAFE_PAIRS,
  blockNumber,
  captionStat,
  cheatLabel,
  chipRow,
  column,
  columns,
  feedScroll,
  label,
  lieInput,
  mono,
  page,
  readingInput,
  registryRow,
  settingText,
  short,
  stat,
  useGhosts,
  type Caption,
  type Org
} from "./shared";

function fakeHash(value: unknown): string {
  const str = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x12345678;
  for (let i = 0; i < str.length; i++) {
    h1 = ((h1 ^ str.charCodeAt(i)) * 16777619) >>> 0;
    h2 = (h2 * 31 + str.charCodeAt(i) + 7) >>> 0;
  }
  let out = "";
  let a = h1;
  let b = h2;
  while (out.length < 64) {
    a = (a * 1103515245 + 12345) >>> 0;
    b = (b * 22695477 + 1) >>> 0;
    out += a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

const sigOf = (at: string, celsius: string | number) =>
  fakeHash("SENSOR-001|" + at + "|" + Number(celsius)).slice(0, 6);

interface Row {
  readonly at: string;
  readonly celsius: string;
  readonly sig: string;
}

const signRows = (pairs: readonly (readonly [string, number])[]): Row[] =>
  pairs.map(([at, celsius]) => ({ at, celsius: String(celsius), sig: sigOf(at, celsius) }));

const DEFAULT_ROWS = signRows(DEFAULT_PAIRS);
const UNSAFE_ROWS = signRows(UNSAFE_PAIRS);
const rowsData = (rows: readonly Row[]) =>
  rows.map((r) => ({ at: r.at, celsius: Number(r.celsius) || 0 }));

interface Block {
  readonly n: number;
  readonly data: string;
  readonly originalData: string;
  readonly by: string;
  readonly committedPrev: string;
  readonly committedHash: string;
}

interface DerivedBlock extends Block {
  readonly derivedHash: string;
  readonly derivedPrev: string;
  readonly valid: boolean;
}

/**
 * Recomputes every hash from the block before it.
 *
 * A block whose text was edited no longer matches the hash that was committed with it, and because
 * each hash feeds the next, every later block becomes invalid too.
 */
function deriveChain(blocks: readonly Block[]): DerivedBlock[] {
  const asc = [...blocks].reverse();
  let prev = "—";
  return asc
    .map((b) => {
      const hash = fakeHash(prev + b.data + b.n);
      const out = {
        ...b,
        derivedHash: hash,
        derivedPrev: prev,
        valid: hash === b.committedHash && prev === b.committedPrev
      };
      prev = hash;
      return out;
    })
    .reverse();
}

interface Anchor {
  readonly hash: string;
  readonly reported: { readonly min: number; readonly max: number };
  readonly count: number;
}

interface Verification {
  readonly recomputedHash: string;
  readonly stats: { readonly min: number; readonly max: number };
  readonly hashOK: boolean;
  readonly statsOK: boolean;
  readonly sigOK: boolean | null;
  readonly forged: readonly string[];
  readonly by: string;
}

const genesis = (): Block => {
  const data = "the chain begins";
  return {
    n: 0,
    data,
    originalData: data,
    by: "all six companies together",
    committedPrev: "—",
    committedHash: fakeHash("—" + data + 0)
  };
};

/** Runs the console workflow against local state and a deterministic in-memory hash chain. */
export function SimApp() {
  const [org, setOrg] = useState<Org>("regulator");
  const [batchId] = useState("BATCH-001");
  const [reg, setReg] = useState<Record<string, boolean>>({});
  const [stage, setStage] = useState(-1);
  const [breach, setBreach] = useState(false);
  const [recalled, setRecalled] = useState(false);
  const [origin, setOrigin] = useState(HOME_ORIGIN);
  const [rows, setRows] = useState<readonly Row[]>(DEFAULT_ROWS);
  const [lie, setLie] = useState({ min: "1.8", max: "3.6" });
  const [preset, setPreset] = useState<string | null>("compliant");
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [verify, setVerify] = useState<Verification | null>(null);
  const [blocks, setBlocks] = useState<readonly Block[]>([genesis()]);
  const { ghosts, ghost } = useGhosts();
  const [caption, setCaption] = useState<Caption>({ tone: "chill", text: OPENING_CAPTION });

  const say = (tone: Caption["tone"], text: string) => setCaption({ tone, text });
  const chain = deriveChain(blocks);
  const chainBroken = chain.some((b) => !b.valid);

  const addBlock = (data: string, by: string) =>
    setBlocks((current) => {
      const prev = current[0].committedHash;
      const n = current[0].n + 1;
      return [
        {
          n,
          data,
          originalData: data,
          by,
          committedPrev: prev,
          committedHash: fakeHash(prev + data + n)
        },
        ...current
      ];
    });

  const refuse = (text: string, why?: string) => {
    ghost(text);
    say("refused", why || text);
  };

  const needReg = (who: string) => {
    if (!reg[who]) {
      refuse(
        `${who} is not registered`,
        `The ${who} isn't registered yet. That's the regulator's job.`
      );
      return false;
    }
    return true;
  };

  const editBlock = (n: number, text: string) => {
    setBlocks((current) => current.map((b) => (b.n === n ? { ...b, data: text } : b)));
    if (!chainBroken) {
      say(
        "broken",
        "You're rewriting history. Every block after this one just broke. Five other copies still agree."
      );
    }
  };

  const restoreChain = () => {
    setBlocks((current) => current.map((b) => ({ ...b, data: b.originalData })));
    say("ok", "Healed. Your copy was re-fetched from the other five.");
  };

  const registerAll = () => {
    if (ORGS.every((o) => reg[o]) && reg.sensorKey) {
      say("neutral", "Everyone is already registered.");
      return;
    }
    setReg(Object.fromEntries([...ORGS.map((o) => [o, true]), ["sensorKey", true]]));
    ORGS.forEach((o) => {
      if (!reg[o]) {
        addBlock(
          o === "regulator"
            ? "regulator joined as the first company"
            : `${o} registered by the regulator`,
          "regulator"
        );
      }
    });
    if (!reg.sensorKey) addBlock("SENSOR-001's public key registered", "regulator");
    say(
      "ok",
      "All six registered, plus the sensor's public key. Now anyone can check a reading's signature against the chain."
    );
  };

  const registerOrg = (who: Org) => {
    if (who !== "regulator" && !reg.regulator) {
      refuse("no regulator exists yet", "Someone has to be first: register the regulator itself.");
      return;
    }
    if (reg[who]) {
      say("neutral", "Already registered.");
      return;
    }
    setReg((r) => ({ ...r, [who]: true }));
    addBlock(
      who === "regulator"
        ? "regulator joined as the first company"
        : `${who} registered by the regulator`,
      "regulator"
    );
    say(
      "ok",
      who === "regulator"
        ? "The regulator is in. Register the others."
        : `The ${who} is registered. New block on the chain.`
    );
  };

  const registerSensor = () => {
    if (!reg.regulator) {
      refuse("no regulator exists yet", "Someone has to be first: register the regulator itself.");
      return;
    }
    if (reg.sensorKey) {
      say("neutral", "Already registered.");
      return;
    }
    setReg((r) => ({ ...r, sensorKey: true }));
    addBlock("SENSOR-001's public key registered", "regulator");
    say(
      "ok",
      "The sensor's public key is on the chain. Now anyone can check a reading's signature, and only the sensor can produce one."
    );
  };

  const create = () => {
    if (!needReg("farm")) return;
    if (stage >= 0) {
      refuse(`${batchId} already exists`, "A batch can only be created once.");
      return;
    }
    setStage(0);
    setVerify(null);
    setAnchor(null);
    addBlock(`${batchId} created at ${origin.farm}, ${origin.place}`, "farm");
    say("ok", `${batchId} created. Its origin is written once, forever.`);
  };

  const step = (i: number, summary: string, who: Org) => {
    if (!needReg(who)) return;
    if (stage === -1) {
      refuse(`${batchId} does not exist yet`, "No batch yet. The farm creates it first.");
      return;
    }
    if (recalled) {
      refuse("this batch was recalled", "Recalled. Nothing more can happen to this batch.");
      return;
    }
    if (i === 3 && breach) {
      refuse(
        "a flagged batch cannot be delivered",
        "Flagged milk can't be delivered until the regulator clears it."
      );
      return;
    }
    if (i !== stage + 1) {
      refuse(
        `out of order: the batch is at "${STAGES[stage]}"`,
        "Out of order. Steps can't be skipped, and every company checks."
      );
      return;
    }
    setStage(i);
    setVerify(null);
    addBlock(summary, who);
    const captions: Record<number, string> = {
      1: "Processed. Four of six peers verified this step independently.",
      2: "On the truck. Switch to the oracle for the temperatures.",
      3: "Delivered. Every step on the chain, signed."
    };
    say("ok", captions[i]);
  };

  const recall = () => {
    if (stage === -1) {
      refuse(`${batchId} does not exist yet`);
      return;
    }
    if (recalled) {
      refuse("already recalled");
      return;
    }
    setRecalled(true);
    addBlock(`${batchId} recalled: investigation opened`, "regulator");
    say("ok", "Recalled. This batch can never be delivered.");
  };

  const clearFlag = () => {
    if (!breach) {
      refuse("there is no flag on this batch");
      return;
    }
    setBreach(false);
    addBlock("temperature flag cleared: cold store repaired", "regulator");
    say("ok", "Flag cleared. The batch resumes where it stopped.");
  };

  const anchorReadings = (fake = false) => {
    if (!needReg("oracle")) return;
    if (stage === -1) {
      refuse(`${batchId} does not exist yet`, "No batch yet. The farm creates it first.");
      return;
    }
    if (recalled) {
      refuse("a recalled batch takes no more readings");
      return;
    }
    const data = rowsData(rows);
    const temps = data.map((r) => r.celsius);
    const honest = { min: Math.min(...temps), max: Math.max(...temps) };
    const reported = fake ? { min: Number(lie.min) || 0, max: Number(lie.max) || 0 } : honest;
    const a: Anchor = { hash: fakeHash(data), reported, count: data.length };
    setAnchor(a);
    setVerify(null);
    const unsafe = reported.max > 5 || reported.min < 0;
    addBlock(
      `fingerprint ${short(a.hash)} anchored, summary ${reported.min} to ${reported.max} °C: ${
        unsafe ? "outside 0 to 5 °C, batch flagged" : "kept cold"
      }`,
      "oracle"
    );
    if (unsafe) {
      setBreach(true);
      say(
        "broken",
        "The summary is outside 0 to 5 °C. The rules flagged the batch on their own. Try delivering it."
      );
    } else if (fake && (honest.max > 5 || honest.min < 0)) {
      say(
        "broken",
        `The oracle just lied. The readings go up to ${honest.max} °C, but it told the chain the max was ${reported.max}. The chain believed the summary and raised no flag. Now have someone check the readings.`
      );
    } else {
      say("ok", "Anchored. The readings stay in this table. Try editing one after the fact.");
    }
  };

  const doVerify = (who: string) => {
    if (!anchor) {
      refuse("nothing has been anchored yet", "Nothing anchored yet. The oracle goes first.");
      return;
    }
    const recomputedHash = fakeHash(rowsData(rows));
    const temps = rows.map((r) => Number(r.celsius) || 0);
    const stats = { min: Math.min(...temps), max: Math.max(...temps) };
    const hashOK = recomputedHash === anchor.hash;
    const statsOK = stats.min === anchor.reported.min && stats.max === anchor.reported.max;
    const keyOK = !!reg.sensorKey;
    const forged = rows.filter((r) => sigOf(r.at, r.celsius) !== r.sig).map((r) => r.at);
    const sigOK = keyOK ? forged.length === 0 : null;
    setVerify({ recomputedHash, stats, hashOK, statsOK, sigOK, forged, by: who });

    if (!hashOK) {
      say(
        "broken",
        "Caught by the fingerprint. The database was edited after anchoring; the chain never changed."
      );
    } else if (!statsOK) {
      say(
        "broken",
        `Caught by the summary. The chain says ${anchor.reported.min} to ${anchor.reported.max} °C, but the readings themselves say ${stats.min} to ${stats.max}. The oracle lied about the summary, and the readings expose it.`
      );
    } else if (sigOK === false) {
      say(
        "broken",
        `Caught by a signature. Fingerprint and summary agree, but the ${forged.join(", ")} reading was never signed by the sensor. The oracle submitted a number the sensor never measured.`
      );
    } else if (sigOK === null) {
      say(
        "refused",
        "Fingerprint and summary check out, but there is no sensor key on the chain, so the signatures cannot be checked. The regulator registers it."
      );
    } else {
      say(
        "ok",
        "Clean. Fingerprint, summary and every signature all match. The readings are exactly what the sensor measured."
      );
    }
  };

  const secretlyEdit = () => {
    if (!anchor) {
      say("neutral", "Anchor readings first, then edit them behind the app's back.");
      return;
    }
    const idx = rows.reduce((m, r, i) => (Number(r.celsius) > Number(rows[m].celsius) ? i : m), 0);
    const old = rows[idx].celsius;
    const next = (Number(old) || 0) + 1;
    setPreset(null);
    setRows((current) => current.map((x, j) => (j === idx ? { ...x, celsius: String(next) } : x)));
    say(
      "broken",
      `Straight into the database, around the app: ${old} °C at ${rows[idx].at} now reads ${next}. The anchor on the chain has not moved. Now have any company check the readings.`
    );
  };

  const reset = () => {
    setReg({});
    setStage(-1);
    setBreach(false);
    setRecalled(false);
    setRows(DEFAULT_ROWS);
    setPreset("compliant");
    setAnchor(null);
    setVerify(null);
    setOrg("regulator");
    setOrigin(HOME_ORIGIN);
    setBlocks([genesis()]);
    say("chill", "Fresh start. You're the regulator.");
  };

  const liveHash = fakeHash(rowsData(rows));
  const fpState = !anchor
    ? ["var(--muted)", "not anchored yet"]
    : liveHash === anchor.hash
      ? ["var(--ok)", "matches the chain"]
      : ["var(--broken)", "differs from the chain"];

  const surface: Record<Org, JSX.Element> = {
    regulator: (
      <div style={column}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={label}>Companies</div>
          {ORGS.map((o) => (
            <div key={o} style={{ ...registryRow, minHeight: 29 }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{o}</span>
              {reg[o] ? (
                stat("var(--ok)", "Registered")
              ) : (
                <Button size="sm" onClick={() => registerOrg(o)}>
                  {o === "regulator" ? "Join first" : "Register"}
                </Button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={label}>Sensor keys</div>
          <div style={registryRow}>
            <span style={{ ...mono, fontSize: 12, flex: 1 }}>SENSOR-001</span>
            {reg.sensorKey ? (
              stat("var(--ok)", "On the chain")
            ) : (
              <Button size="sm" onClick={registerSensor}>
                Put on the chain
              </Button>
            )}
          </div>
        </div>
        {ORGS.every((o) => reg[o]) && reg.sensorKey ? null : (
          <div>
            <Button variant="primary" onClick={registerAll}>
              Register everyone
            </Button>
          </div>
        )}
        <div>
          <div style={{ ...label, padding: "0 0 2px" }}>Powers</div>
          <SettingRow text="Withdraw the batch from sale">
            <Button size="sm" variant="danger" onClick={recall}>
              Recall the batch
            </Button>
          </SettingRow>
          <SettingRow text="Lift the temperature hold" divided>
            <Button size="sm" onClick={clearFlag}>
              Clear the flag
            </Button>
          </SettingRow>
          <SettingRow text="Verify the oracle's readings against the chain" divided>
            <Button size="sm" onClick={() => doVerify("regulator")}>
              Check the readings
            </Button>
          </SettingRow>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", marginTop: -6 }}>
          <div style={cheatLabel}>try to cheat</div>
          <SettingRow text="Submit temperature readings, even though only the oracle may">
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (!needReg("regulator")) return;
                refuse(
                  "regulator tried to submit temperature readings",
                  "Signed by the regulator, and still refused: only the oracle may submit temperature evidence. Not even the regulator outranks the rules."
                );
              }}
            >
              Try to submit readings
            </Button>
          </SettingRow>
        </div>
      </div>
    ),
    farm: (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <TextInput
          label="Farm"
          value={origin.farm}
          onChange={(v) => setOrigin((o) => ({ ...o, farm: v }))}
          style={{ width: 290 }}
        />
        <TextInput
          label="Where"
          value={origin.place}
          onChange={(v) => setOrigin((o) => ({ ...o, place: v }))}
          style={{ width: 160 }}
        />
        <Button variant="primary" onClick={create}>
          Create a batch
        </Button>
        <Button onClick={() => doVerify("farm")}>Check the readings</Button>
      </div>
    ),
    processor: (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={() => step(1, `${batchId} processed at Bega Processing Plant`, "processor")}
        >
          Record processing
        </Button>
        <Button onClick={() => doVerify("processor")}>Check the readings</Button>
      </div>
    ),
    logistics: (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={() => step(2, `${batchId} on the truck, Hume Highway`, "logistics")}
        >
          Put it on the truck
        </Button>
        <Button onClick={() => doVerify("logistics")}>Check the readings</Button>
      </div>
    ),
    retailer: (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={() => step(3, `${batchId} delivered to the shop`, "retailer")}
        >
          Take delivery
        </Button>
        <Button onClick={() => doVerify("retailer")}>Check the readings</Button>
      </div>
    ),
    oracle: (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PresetToggle
          options={[
            ["compliant", "Compliant run"],
            ["warm", "Too warm run"]
          ]}
          selected={preset}
          onPick={(id) => {
            setRows(id === "compliant" ? DEFAULT_ROWS : UNSAFE_ROWS);
            setPreset(id);
            say(
              "chill",
              id === "compliant"
                ? "Sensor run loaded: every reading inside 0 to 5 °C."
                : "Sensor run loaded: the truck got warm around 09:00."
            );
          }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {rows.map((r, i) => {
            const ok = sigOf(r.at, r.celsius) === r.sig;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ ...mono, fontSize: 10, color: "var(--muted)" }}>{r.at}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={r.celsius}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPreset(null);
                    setRows((current) =>
                      current.map((x, j) => (j === i ? { ...x, celsius: v } : x))
                    );
                  }}
                  style={{
                    ...readingInput,
                    border: "1px solid " + (ok ? "var(--line)" : "var(--broken)")
                  }}
                />
                <span
                  style={{ ...mono, fontSize: 9, color: ok ? "var(--faint)" : "var(--broken)" }}
                >
                  {ok ? "sig " + r.sig : "sig broken"}
                </span>
              </div>
            );
          })}
        </div>
        <TempChart readings={rowsData(rows)} height={150} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--well)",
            borderRadius: "var(--r-sm)",
            padding: "6px 6px 6px 12px",
            flexWrap: "wrap"
          }}
        >
          <span style={{ ...label, fontWeight: 600 }}>fingerprint</span>
          <span style={{ ...mono, fontSize: 12, color: "var(--ink-2)", flex: 1 }}>
            {short(liveHash)}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: fpState[0] }}>{fpState[1]}</span>
          <Button variant="primary" onClick={() => anchorReadings(false)}>
            Anchor on the chain
          </Button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", marginTop: -6 }}>
          <div style={cheatLabel}>try to cheat</div>
          <SettingRow text="Change a stored reading behind the app's back">
            <Button size="sm" variant="danger" onClick={secretlyEdit}>
              Secretly edit a reading
            </Button>
          </SettingRow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "9px 0",
              borderTop: "1px solid var(--hairline)",
              flexWrap: "wrap"
            }}
          >
            <span
              style={{
                ...settingText,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap"
              }}
            >
              Tell the chain the milk stayed between
              <input
                type="text"
                inputMode="decimal"
                value={lie.min}
                onChange={(e) => setLie((l) => ({ ...l, min: e.target.value }))}
                style={lieInput}
              />
              and
              <input
                type="text"
                inputMode="decimal"
                value={lie.max}
                onChange={(e) => setLie((l) => ({ ...l, max: e.target.value }))}
                style={lieInput}
              />
              °C
            </span>
            <Button size="sm" variant="danger" onClick={() => anchorReadings(true)}>
              Anchor a fake summary
            </Button>
          </div>
        </div>
      </div>
    )
  };

  return (
    <div style={page}>
      <PageHeader title="Fresh Milk Cold Chain">
        <Button variant="quiet" onClick={reset}>
          Reset
        </Button>
      </PageHeader>
      <div style={chipRow}>
        {ORGS.map((o) => (
          <CompanyChip
            key={o}
            name={o}
            status={reg[o] ? "up" : "unknown"}
            selected={org === o}
            onClick={() => setOrg(o)}
          />
        ))}
      </div>
      <div style={columns}>
        <div style={column}>
          <Panel title={org}>{surface[org]}</Panel>
          <Panel
            title="Journey"
            right={
              recalled
                ? stat("var(--faint)", "Recalled")
                : breach
                  ? stat("var(--broken)", "Temperature flag")
                  : stage === 3
                    ? stat("var(--ok)", "Delivered")
                    : null
            }
          >
            <BatchStepper
              current={stage}
              breach={breach}
              recalled={recalled}
              style={{ margin: "6px 0 2px" }}
            />
          </Panel>
          {verify && anchor ? (
            <Panel
              title="Verification"
              right={stat(
                verify.hashOK && verify.statsOK && verify.sigOK === true
                  ? "var(--ok)"
                  : verify.sigOK === null && verify.hashOK && verify.statsOK
                    ? "var(--refused)"
                    : "var(--broken)",
                !verify.hashOK
                  ? "Caught by the fingerprint"
                  : !verify.statsOK
                    ? "Caught by the summary"
                    : verify.sigOK === false
                      ? "Caught by a signature"
                      : verify.sigOK === null
                        ? "Unchecked"
                        : "Clean"
              )}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    [
                      "fingerprint",
                      `${short(anchor.hash)} on the chain · ${short(verify.recomputedHash)} recomputed`,
                      verify.hashOK
                    ],
                    [
                      "summary",
                      `chain says ${anchor.reported.min} to ${anchor.reported.max} °C · readings say ${verify.stats.min} to ${verify.stats.max} °C`,
                      verify.statsOK
                    ],
                    [
                      "signatures",
                      verify.sigOK === null
                        ? "no sensor key on the chain to check against"
                        : verify.forged.length
                          ? `the ${verify.forged.join(", ")} reading does not fit its signature`
                          : `all ${rows.length} fit the sensor's signatures`,
                      verify.sigOK
                    ]
                  ] as const
                ).map(([k, v, ok]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ ...label, width: "6.5rem", flex: "none" }}>{k}</span>
                    <span
                      style={{
                        ...mono,
                        fontSize: 11.5,
                        color: ok === false ? "var(--broken)" : "var(--ink-2)",
                        flex: 1,
                        overflowWrap: "anywhere"
                      }}
                    >
                      {v}
                    </span>
                    <ToneBadge tone={ok === true ? "ok" : ok === false ? "broken" : "neutral"}>
                      {ok === true ? "pass" : ok === false ? "fail" : "unchecked"}
                    </ToneBadge>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  checked by the {verify.by}
                </div>
              </div>
            </Panel>
          ) : null}
        </div>
        <div style={column}>
          <Panel title="Latest" right={captionStat(caption.tone)}>
            <CaptionPanelBody text={caption.text} />
          </Panel>
          <Panel
            title={`Chain · ${blocks.length} blocks`}
            right={
              chainBroken ? (
                <Button size="sm" variant="danger" onClick={restoreChain}>
                  Restore from the other five
                </Button>
              ) : (
                stat("var(--ok)", "All copies agree")
              )
            }
            pad={false}
          >
            <div style={feedScroll}>
              <GhostRows ghosts={ghosts} />
              {chain.map((b, i) => (
                <div
                  key={b.n}
                  style={{ position: "relative", paddingBottom: i < chain.length - 1 ? 14 : 0 }}
                >
                  {i < chain.length - 1 ? (
                    <div
                      style={{
                        position: "absolute",
                        left: 17,
                        top: "calc(100% - 14px)",
                        height: 14,
                        width: 2,
                        background: b.valid && chain[i + 1].valid ? "var(--line)" : "var(--broken)"
                      }}
                    ></div>
                  ) : null}
                  <div
                    className={i === 0 ? "fm-block-new" : ""}
                    style={{
                      border:
                        "1px solid " +
                        (!b.valid ? "var(--broken)" : i === 0 ? "var(--chill)" : "var(--line)"),
                      background: !b.valid
                        ? "var(--broken-tint)"
                        : i === 0
                          ? "var(--chill-tint)"
                          : "var(--well)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start"
                    }}
                  >
                    <span
                      style={{
                        ...blockNumber,
                        background: !b.valid ? "var(--broken-tint)" : "var(--chill-tint)",
                        color: !b.valid ? "var(--broken)" : "var(--chill-deep)"
                      }}
                    >
                      {b.n}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <input
                        value={b.data}
                        onChange={(e) => editBlock(b.n, e.target.value)}
                        style={{
                          display: "block",
                          width: "100%",
                          boxSizing: "border-box",
                          fontFamily: "var(--font-ui)",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: !b.valid ? "var(--broken)" : "var(--ink)",
                          background: "transparent",
                          border: "1px dashed transparent",
                          borderRadius: 4,
                          padding: "1px 4px",
                          margin: "0 -4px"
                        }}
                        onFocus={(e) => (e.target.style.borderColor = "var(--faint)")}
                        onBlur={(e) => (e.target.style.borderColor = "transparent")}
                      />
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--muted)",
                          marginTop: 2
                        }}
                      >
                        signed by {b.n === 0 ? b.by : "the " + b.by}
                      </span>
                      <span
                        style={{
                          display: "block",
                          ...mono,
                          fontSize: 10,
                          color: !b.valid ? "var(--broken)" : "var(--faint)",
                          marginTop: 3
                        }}
                      >
                        hash {short(b.derivedHash)} · prev{" "}
                        {b.derivedPrev === "—" ? "—" : short(b.derivedPrev)}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
