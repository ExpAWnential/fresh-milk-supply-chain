/**
 * The live console: the same screen as the simulation, driving the six real backends.
 *
 * Selecting a company chip changes which origin the next request goes to, and each backend signs
 * with only its own certificate. That is what makes a refusal here mean something: the request was
 * genuinely made by that company and genuinely turned down by the contract.
 */
import { useEffect, useState } from "react";
import {
  BatchStepper,
  Button,
  CompanyChip,
  HashCompare,
  PageHeader,
  Panel,
  TempChart,
  TextInput
} from "./components";
import {
  CaptionPanelBody,
  DEFAULT_PAIRS,
  GhostRows,
  HOME_ORIGIN,
  OPENING_CAPTION,
  PresetToggle,
  SettingRow,
  UNSAFE_PAIRS,
  blockDetail,
  blockDetailLabel,
  blockDetailValue,
  blockNumber,
  blockRow,
  captionStat,
  cheatLabel,
  chevron,
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
  type Caption
} from "./shared";

interface Company {
  readonly name: string;
  readonly origin: string;
  readonly stakeholderId: string;
  readonly up: boolean;
  readonly certificateId: string | null;
}

const FALLBACK: readonly Company[] = (
  [
    ["regulator", 3001],
    ["farm", 3002],
    ["processor", 3003],
    ["logistics", 3004],
    ["retailer", 3005],
    ["oracle", 3006]
  ] as const
).map(([name, port]) => ({
  name,
  origin: `http://localhost:${port}`,
  stakeholderId: `${name}-001`,
  up: false,
  certificateId: null
}));

const STAGE_OF: Record<string, number> = {
  CREATED: 0,
  PROCESSED: 1,
  IN_TRANSIT: 2,
  DELIVERED: 3
};

const SENSORS = [
  {
    sensorId: "SENSOR-001",
    publicKey: "MCowBQYDK2VwAyEAuQBUNozc43qvuq0ks7mBu0k9/FERFhM3pxKJNZ1WWsA="
  },
  {
    sensorId: "SENSOR-002",
    publicKey: "MCowBQYDK2VwAyEAdHH5MLcXlIlEbBbdgbwKtVD4ccV1yZaJ+uW/FfE+efY="
  }
];

const DEMO_URL = "http://localhost:3016";

interface Row {
  readonly at: string;
  readonly celsius: string;
}

const plainRows = (pairs: readonly (readonly [string, number])[]): Row[] =>
  pairs.map(([at, celsius]) => ({ at, celsius: String(celsius) }));

const DEFAULT_ROWS = plainRows(DEFAULT_PAIRS);
const UNSAFE_ROWS = plainRows(UNSAFE_PAIRS);

async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const portOf = (origin: string) => {
  try {
    return new URL(origin).port;
  } catch {
    return "?";
  }
};

interface Reply {
  readonly status: number;
  // Either the parsed JSON body or, when it was not JSON, the raw text.
  readonly body: unknown;
}

interface Verification {
  readonly match?: boolean;
  readonly anchoredHash?: string;
  readonly recomputedHash?: string;
  readonly statisticsMatch?: boolean | null;
  readonly anchoredStatistics?: { readonly minCelsius: number; readonly maxCelsius: number } | null;
  readonly signaturesMatch?: boolean | null;
  readonly signatureFailures?: readonly number[];
  readonly fabricTransactionId?: string | null;
  readonly by: string;
}

interface Batch {
  readonly status?: string;
  readonly statusBeforeBreach?: string;
}

// One row the helper rewrote directly in the oracle's database.
interface ChangedReading {
  readonly old_celsius: string;
  readonly new_celsius: string;
  readonly recorded_at: string;
}

interface HistoryEntry {
  readonly txId?: string;
  readonly timestamp?: string;
  readonly isDelete?: boolean;
  readonly submittedByStakeholderId?: string;
  readonly batch?: { readonly status?: string; readonly lastKnownLocation?: string };
}

/** Connects the console controls to the organisation backends and their authenticated identities. */
export function LiveApp() {
  const [companies, setCompanies] = useState<readonly Company[]>(FALLBACK);
  const [org, setOrg] = useState("regulator");
  const [batchId, setBatchId] = useState("BATCH-001");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [history, setHistory] = useState<readonly HistoryEntry[]>([]);
  const [registered, setRegistered] = useState<Record<string, boolean>>({});
  const [sensorReg, setSensorReg] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<readonly Row[]>(DEFAULT_ROWS);
  const [lie, setLie] = useState({ min: "1.8", max: "3.6" });
  const [preset, setPreset] = useState<string | null>("compliant");
  const [liveHash, setLiveHash] = useState("");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verification | null>(null);
  // Expanding one block at a time keeps the history feed compact and predictable.
  const [openBlock, setOpenBlock] = useState<number | null>(null);
  const { ghosts, ghost, clearGhosts } = useGhosts();
  const [caption, setCaption] = useState<Caption>({ tone: "chill", text: OPENING_CAPTION });
  const [origin, setOrigin] = useState(HOME_ORIGIN);

  const say = (tone: Caption["tone"], text: string) => setCaption({ tone, text });
  const byName = (name: string) => companies.find((c) => c.name === name);
  const regOrigin = () => byName("regulator")?.origin;

  // The fingerprint the oracle would anchor for what is currently in the table.
  useEffect(() => {
    let on = true;
    sha256Hex(
      JSON.stringify({
        batchId,
        readings: rows.map((r) => ({ recordedAt: r.at, celsius: Number(r.celsius) || 0 }))
      })
    ).then((hash) => {
      if (on) setLiveHash(hash);
    });
    return () => {
      on = false;
    };
  }, [rows, batchId]);

  async function call(
    method: string,
    path: string,
    { origin: target, body }: { origin?: string; body?: unknown } = {}
  ): Promise<Reply> {
    const dest = target ?? byName(org)?.origin;
    try {
      const res = await fetch(dest + path, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // A non-JSON body is reported exactly as it arrived.
      }
      return { status: res.status, body: parsed };
    } catch (error) {
      return { status: 0, body: String(error) };
    }
  }

  // Preserve contract refusals so the client does not replace an authoritative reason with a guess.
  const explain = (body: unknown): string => {
    if (typeof body === "string") return body;
    const stated = body as { error?: string; message?: string } | null;
    return stated?.error || stated?.message || JSON.stringify(body);
  };

  async function pingAll(list?: readonly Company[]): Promise<readonly Company[]> {
    const base = list ?? companies;
    const next = await Promise.all(
      base.map(async (c) => {
        try {
          const res = await fetch(c.origin + "/identity");
          const identity = await res.json();
          return { ...c, up: true, certificateId: identity.certificateId as string };
        } catch {
          return { ...c, up: false, certificateId: null };
        }
      })
    );
    setCompanies(next);
    return next;
  }

  async function loadDirectory(): Promise<readonly Company[]> {
    try {
      const res = await fetch("/organisations");
      if (res.ok) {
        const directory = await res.json();
        return pingAll(
          directory.map((d: Partial<Company>) => ({ up: false, certificateId: null, ...d }))
        );
      }
    } catch {
      // Fall back to the known ports below.
    }
    return pingAll(FALLBACK);
  }

  async function refreshBatch(id = batchId, cs = companies) {
    const any = cs.find((c) => c.up) ?? cs[0];
    const got = await call("GET", `/batches/${encodeURIComponent(id)}`, { origin: any.origin });
    if (got.status === 200) {
      setBatch(got.body as Batch);
      const h = await call("GET", `/batches/${encodeURIComponent(id)}/history`, {
        origin: any.origin
      });
      setHistory(h.status === 200 && Array.isArray(h.body) ? h.body : []);
    } else {
      setBatch(null);
      setHistory([]);
    }
  }

  async function probeRegistrations(cs: readonly Company[]) {
    const any = cs.find((c) => c.up);
    if (!any) return;
    const results = await Promise.all(
      cs.map(async (c) => {
        const r = await call("GET", `/stakeholders/${encodeURIComponent(c.stakeholderId)}`, {
          origin: any.origin
        });
        return [c.name, r.status === 200] as const;
      })
    );
    setRegistered(Object.fromEntries(results.filter(([, ok]) => ok)));

    // Read existing sensor registrations so the interface does not offer a duplicate transaction.
    const keys = await Promise.all(
      SENSORS.map(async (s) => {
        const r = await call("GET", `/sensors/${encodeURIComponent(s.sensorId)}`, {
          origin: any.origin
        });
        return [s.sensorId, r.status === 200] as const;
      })
    );
    setSensorReg(Object.fromEntries(keys.filter(([, ok]) => ok)));
  }

  // Load shared identities and ledger state once when the console opens.
  useEffect(() => {
    (async () => {
      const cs = await loadDirectory();
      await probeRegistrations(cs);
      await refreshBatch(batchId, cs);
    })();
  }, []);

  async function act(
    label: string,
    method: string,
    path: string,
    opts?: { origin?: string; body?: unknown },
    onOk?: () => void
  ): Promise<Reply> {
    const r = await call(method, path, opts);
    if (r.status >= 200 && r.status < 300) {
      await refreshBatch();
      if (onOk) onOk();
      return r;
    }
    if (r.status === 0) {
      ghost(`${label}: backend did not answer`);
      say("broken", `No answer from the backend. Is the network running? (${label})`);
    } else {
      ghost(`${label}: ${explain(r.body)}`);
      say("refused", `${explain(r.body)}`);
    }
    return r;
  }

  async function registerOne(name: string) {
    const fresh = await pingAll();
    const c = fresh.find((x) => x.name === name);
    const reg = fresh.find((x) => x.name === "regulator")!;
    if (!c?.up) {
      ghost(`${name}'s backend did not answer`);
      say("broken", `The ${name}'s backend is not running, so it cannot report its certificate.`);
      return;
    }
    if (name === "regulator") {
      const r = await act("bootstrap", "POST", "/stakeholders/bootstrap", {
        origin: reg.origin,
        body: { stakeholderId: reg.stakeholderId }
      });
      if (r.status >= 200 && r.status < 300) {
        setRegistered((x) => ({ ...x, regulator: true }));
        say("ok", "The regulator is in. Register the others.");
      }
      return;
    }
    const r = await act(`register ${name}`, "POST", "/stakeholders", {
      origin: reg.origin,
      body: {
        stakeholderId: c.stakeholderId,
        role: name.toUpperCase(),
        certificateId: c.certificateId
      }
    });
    if (r.status >= 200 && r.status < 300) {
      setRegistered((x) => ({ ...x, [name]: true }));
      say("ok", `The ${name} is registered on the ledger.`);
    }
  }

  async function registerSensor(s: (typeof SENSORS)[number]) {
    const r = await act(`sensor key ${s.sensorId}`, "POST", "/sensors", {
      origin: regOrigin(),
      body: { ...s, algorithm: "ed25519" }
    });
    if (r.status >= 200 && r.status < 300) {
      setSensorReg((x) => ({ ...x, [s.sensorId]: true }));
      say(
        "ok",
        `${s.sensorId}'s public key is on the ledger. Anyone can check its signatures now.`
      );
    }
  }

  async function registerAll() {
    const fresh = await pingAll();
    const missing = fresh.filter((c) => !c.certificateId);
    if (missing.length) {
      say(
        "broken",
        `Not every backend answered (${missing.map((c) => ":" + portOf(c.origin)).join(", ")}). All six must be running.`
      );
      return;
    }
    const reg = fresh.find((c) => c.name === "regulator")!;
    await act("bootstrap", "POST", "/stakeholders/bootstrap", {
      origin: reg.origin,
      body: { stakeholderId: reg.stakeholderId }
    });
    for (const c of fresh.filter((x) => x.name !== "regulator")) {
      await act(`register ${c.name}`, "POST", "/stakeholders", {
        origin: reg.origin,
        body: {
          stakeholderId: c.stakeholderId,
          role: c.name.toUpperCase(),
          certificateId: c.certificateId
        }
      });
    }
    for (const s of SENSORS) {
      await act(`sensor key ${s.sensorId}`, "POST", "/sensors", {
        origin: reg.origin,
        body: { ...s, algorithm: "ed25519" }
      });
    }
    setRegistered(Object.fromEntries(fresh.map((c) => [c.name, true])));
    setSensorReg(Object.fromEntries(SENSORS.map((s) => [s.sensorId, true])));
    say(
      "ok",
      "Registration sent to your real ledger: six companies and two sensor keys, all signed by the regulator's certificate."
    );
  }

  const create = () =>
    act(
      "create",
      "POST",
      "/batches",
      {
        origin: byName("farm")?.origin,
        body: { batchId, origin: origin.farm, location: origin.place }
      },
      () => say("ok", `${batchId} created on the ledger. Its origin can never be changed.`)
    );

  const step = (evType: string, who: string, msg: string, location: string) =>
    act(
      evType,
      "POST",
      `/batches/${encodeURIComponent(batchId)}/events`,
      { origin: byName(who)?.origin, body: { eventType: evType, location } },
      () => say("ok", msg)
    );

  const recall = () =>
    act(
      "recall",
      "POST",
      `/batches/${encodeURIComponent(batchId)}/recall`,
      { origin: regOrigin(), body: { reason: "Investigation opened" } },
      () => say("ok", "Recalled. This batch can never be delivered.")
    );

  const clearFlag = () =>
    act(
      "clear breach",
      "POST",
      `/temperature/batches/${encodeURIComponent(batchId)}/resolve-breach`,
      { origin: regOrigin(), body: { reason: "Cold store repaired and stock rechecked" } },
      () => say("ok", "Flag cleared. The batch resumes where it stopped.")
    );

  async function anchorFromTable(fake = false) {
    const data = rows.map((r) => ({ recordedAt: r.at, celsius: Number(r.celsius) || 0 }));
    const temps = data.map((r) => r.celsius);
    const unsafe = temps.some((t) => t < 0 || t > 5);
    try {
      const res = await fetch(DEMO_URL + "/demo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batchId,
          readings: data,
          lieAboutSummary: fake,
          fakeStatistics: fake
            ? { minCelsius: Number(lie.min) || 0, maxCelsius: Number(lie.max) || 0 }
            : undefined
        })
      });
      const j = await res.json().catch(() => null);
      if (res.ok) {
        setEvidenceId(j.evidenceId);
        await refreshBatch();
        if (fake) {
          say(
            "broken",
            unsafe
              ? `The oracle lied to the real chain: the readings go up to ${Math.max(...temps)} °C, but it reported max ${Number(lie.max) || 0}. The contract believed the summary and raised no flag. Now have someone check the readings.`
              : "Anchored with a lied summary, though the readings were compliant anyway. Type a warm number first to make the lie matter."
          );
        } else {
          say(
            unsafe ? "broken" : "ok",
            unsafe
              ? "Signed, stored, anchored — and the real contract flagged the batch: a reading is outside 0 to 5 °C. Try delivering it."
              : "Signed as SENSOR-001, stored in PostgreSQL, fingerprint anchored on Fabric. The contract judged it safe."
          );
        }
        return;
      }
      ghost(`anchor: ${j && j.error ? j.error : res.status}`);
      say("refused", j && j.error ? j.error : "The oracle pipeline refused the readings.");
      return;
    } catch {
      // Fall back to direct anchoring when the isolated signing and storage helper is unavailable.
    }

    if (fake) {
      say(
        "refused",
        "The oracle's pipeline didn't answer. Check everything is running, then try again."
      );
      return;
    }
    const statistics = {
      minCelsius: Math.min(...temps),
      maxCelsius: Math.max(...temps),
      readingCount: data.length
    };
    const evidenceId2 = `EV-${batchId}-${liveHash.slice(0, 8)}`;
    const r = await act(
      "anchor evidence",
      "POST",
      `/temperature/batches/${encodeURIComponent(batchId)}/evidence`,
      {
        origin: byName("oracle")?.origin,
        body: {
          evidenceId: evidenceId2,
          evidenceHash: liveHash,
          offChainReference: `postgres://temperature_evidence/${evidenceId2}`,
          statistics
        }
      }
    );
    if (r.status >= 200 && r.status < 300) {
      setEvidenceId(evidenceId2);
      say(
        unsafe ? "broken" : "ok",
        (unsafe
          ? "Anchored, and the real contract flagged the batch. "
          : "Anchored on the real ledger. ") +
          "Note: only the summary reached the ledger this time; the readings themselves were not stored."
      );
    }
  }

  async function tamperDb() {
    if (!evidenceId) {
      say("neutral", "Anchor readings first.");
      return;
    }
    try {
      const res = await fetch(DEMO_URL + "/demo/tamper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceId })
      });
      const j = await res.json().catch(() => null);
      if (res.ok) {
        const changed: ChangedReading[] = j.changedReadings || [];
        // PostgreSQL returns fixed-scale numerics, so remove trailing zeros before displaying them.
        const listed = changed
          .map((c) => `${Number(c.old_celsius)} °C at ${(c.recorded_at || "").slice(11, 16)}`)
          .join(", ");
        say(
          "broken",
          `Straight into PostgreSQL, around the app: ${listed} now all read ${Number(changed[0]?.new_celsius)}. The breach looks gone, but the anchor on the ledger has not moved. Now have any company check the readings.`
        );
        const r2 = await call(
          "GET",
          `/temperature/evidence/${encodeURIComponent(evidenceId)}/readings`,
          { origin: byName("oracle")?.origin }
        );
        if (r2.status === 200 && Array.isArray(r2.body)) {
          setRows(
            r2.body.map((x: { recordedAt?: string; celsius: number }) => ({
              at: (x.recordedAt || "").slice(11, 16),
              celsius: String(Number(x.celsius))
            }))
          );
        }
        return;
      }
      ghost(`tamper: ${j && j.error ? j.error : res.status}`);
      say("refused", j && j.error ? j.error : "Could not tamper.");
    } catch {
      say(
        "refused",
        "The oracle's database didn't answer. Check everything is running, then try again."
      );
    }
  }

  async function loadEvidence(): Promise<string | null> {
    const oracle = byName("oracle");
    const listed = await call(
      "GET",
      `/temperature/batches/${encodeURIComponent(batchId)}/evidence`,
      {
        origin: oracle?.origin
      }
    );
    if (listed.status !== 200 || !Array.isArray(listed.body) || listed.body.length === 0) {
      setEvidenceId(null);
      say("neutral", "No readings for this batch yet. Anchor some first.");
      return null;
    }
    const ev = listed.body[listed.body.length - 1].evidenceId as string;
    setEvidenceId(ev);
    const r = await call("GET", `/temperature/evidence/${encodeURIComponent(ev)}/readings`, {
      origin: oracle?.origin
    });
    if (r.status === 200 && Array.isArray(r.body)) {
      const got = r.body.map((x: { recordedAt?: string; celsius: number }) => ({
        at: (x.recordedAt || "").slice(11, 16),
        celsius: String(Number(x.celsius))
      }));
      if (got.length) setRows(got);
      say("chill", `Loaded the oracle's stored readings for ${ev}. They are in the table now.`);
    }
    return ev;
  }

  async function doVerify(who: string) {
    const ev = evidenceId ?? (await loadEvidence());
    if (!ev) return;
    const r = await call("GET", `/temperature/evidence/${encodeURIComponent(ev)}/verify`, {
      origin: byName(who)?.origin
    });
    if (r.status !== 200) {
      ghost(`verify: ${explain(r.body)}`);
      say("refused", explain(r.body));
      return;
    }
    const v = r.body as Omit<Verification, "by">;
    setVerify({ ...v, by: who });
    if (v.match === false) {
      say(
        "broken",
        "Caught by the fingerprint. The readings no longer match the anchor on the ledger. The database was edited; the ledger was not."
      );
    } else if (v.statisticsMatch === false) {
      say(
        "broken",
        "Caught by the summary. The statistics anchored on the ledger do not match the ones recomputed from the readings. The oracle lied about the summary."
      );
    } else if (v.signaturesMatch === false) {
      say(
        "broken",
        "Caught by a signature. Fingerprint and summary agree, but a reading was never signed by the sensor."
      );
    } else {
      say(
        "ok",
        `Clean. Readings fetched from the oracle, anchor read from the ledger with the ${who}'s own certificate. Everything matches.`
      );
    }
  }

  const restoreRows = () => {
    if (preset === "db") {
      loadEvidence();
      say("chill", "Reloaded from the oracle's database.");
      return;
    }
    const id = preset || "compliant";
    setPreset(id);
    setRows(id === "warm" ? UNSAFE_ROWS : DEFAULT_ROWS);
    say("chill", "Sensor data restored to what SENSOR-001 actually recorded.");
  };

  const newBatch = () => {
    const id = `BATCH-${Math.floor(1000 + Math.random() * 9000)}`;
    setBatchId(id);
    setBatch(null);
    setHistory([]);
    setRows(DEFAULT_ROWS);
    setPreset("compliant");
    setOpenBlock(null);
    setEvidenceId(null);
    setVerify(null);
    setLie({ min: "1.8", max: "3.6" });
    clearGhosts();
    setOrg("regulator");
    // Reset only the oracle's off-chain rows because committed ledger history must remain immutable.
    fetch(DEMO_URL + "/demo/reset", { method: "POST" }).catch(() => {});
    loadDirectory().then((cs) => {
      probeRegistrations(cs);
      refreshBatch(id, cs);
    });
    say(
      "chill",
      `Fresh start on ${id}. The old batches stay on the ledger forever, which is the point.`
    );
  };

  const status = (batch && batch.status) || null;
  const breach = status === "COLD_CHAIN_BREACH";
  const recalled = status === "RECALLED";
  const stageName = breach ? batch?.statusBeforeBreach || "CREATED" : status;
  const stage = batch ? (STAGE_OF[stageName ?? ""] ?? 0) : -1;

  const surface: Record<string, JSX.Element> = {
    regulator: (
      <div style={column}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={label}>Companies</div>
          {companies.map((c) => (
            <div key={c.name} style={registryRow}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{c.name}</span>
              {registered[c.name] ? (
                stat("var(--ok)", "Registered")
              ) : (
                <Button size="sm" onClick={() => registerOne(c.name)}>
                  {c.name === "regulator" ? "Join first" : "Register"}
                </Button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={label}>Sensor keys</div>
          {SENSORS.map((s) => (
            <div key={s.sensorId} style={registryRow}>
              <span style={{ ...mono, fontSize: 12, flex: 1 }}>{s.sensorId}</span>
              {sensorReg[s.sensorId] ? (
                stat("var(--ok)", "On the chain")
              ) : (
                <Button size="sm" onClick={() => registerSensor(s)}>
                  Put on the chain
                </Button>
              )}
            </div>
          ))}
        </div>
        {Object.keys(registered).length >= companies.length &&
        SENSORS.every((s) => sensorReg[s.sensorId]) ? null : (
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
                const temps = rows.map((r) => Number(r.celsius) || 0);
                act(
                  "regulator tried to submit readings",
                  "POST",
                  `/temperature/batches/${encodeURIComponent(batchId)}/evidence`,
                  {
                    origin: regOrigin(),
                    body: {
                      evidenceId: `EV-${batchId}-regulator`,
                      evidenceHash: liveHash,
                      offChainReference: `postgres://temperature_evidence/EV-${batchId}-regulator`,
                      statistics: {
                        minCelsius: Math.min(...temps),
                        maxCelsius: Math.max(...temps),
                        readingCount: rows.length
                      }
                    }
                  }
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
          onClick={() =>
            step(
              "PROCESSING",
              "processor",
              "Processed. Endorsed by a majority of the six peers.",
              "Bega Processing Plant"
            )
          }
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
          onClick={() =>
            step(
              "TRANSPORT",
              "logistics",
              "On the truck. The oracle's sensors take it from here.",
              "Hume Highway"
            )
          }
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
          onClick={() =>
            step(
              "DELIVERY",
              "retailer",
              "Delivered. Every step on the ledger, signed.",
              "Sydney Depot"
            )
          }
        >
          Take delivery
        </Button>
        <Button onClick={() => doVerify("retailer")}>Check the readings</Button>
      </div>
    ),
    oracle: (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <PresetToggle
            options={[
              ["compliant", "Compliant run"],
              ["warm", "Too warm run"],
              ["db", "From the database"]
            ]}
            selected={preset}
            onPick={(id) => {
              setPreset(id);
              if (id === "db") {
                loadEvidence();
                return;
              }
              setRows(id === "compliant" ? DEFAULT_ROWS : UNSAFE_ROWS);
              say(
                "chill",
                id === "compliant"
                  ? "Sensor run loaded: every reading inside 0 to 5 °C."
                  : "Sensor run loaded: the truck got warm around 09:00."
              );
            }}
          />
          <Button variant="quiet" size="sm" onClick={restoreRows}>
            Restore the sensor&apos;s data
          </Button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ ...mono, fontSize: 10, color: "var(--muted)" }}>{r.at}</span>
              <input
                type="text"
                inputMode="decimal"
                value={r.celsius}
                onChange={(e) => {
                  const v = e.target.value;
                  setRows((current) => current.map((x, j) => (j === i ? { ...x, celsius: v } : x)));
                }}
                style={{ ...readingInput, border: "1px solid var(--line)" }}
              />
            </div>
          ))}
        </div>
        <TempChart
          readings={rows.map((r) => ({ at: r.at, celsius: Number(r.celsius) || 0 }))}
          height={150}
        />
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
          <span style={label}>fingerprint</span>
          <span style={{ ...mono, fontSize: 12, color: "var(--ink-2)", flex: 1 }}>
            {short(liveHash)}
          </span>
          <Button variant="primary" onClick={() => anchorFromTable(false)}>
            Anchor on the chain
          </Button>
        </div>
        {/* These mutations apply only to an unsafe reading set, where there is a breach to hide. */}
        {preset === "warm" ? (
          <div style={{ borderTop: "1px solid var(--line)", marginTop: -6 }}>
            <div style={cheatLabel}>try to cheat</div>
            <SettingRow text="Change a stored reading behind the app's back">
              <Button size="sm" variant="danger" onClick={tamperDb}>
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
              <Button size="sm" variant="danger" onClick={() => anchorFromTable(true)}>
                Anchor a fake summary
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    )
  };

  return (
    <div style={page}>
      <PageHeader title="Fresh Milk Cold Chain">
        <Button variant="quiet" onClick={newBatch}>
          Reset
        </Button>
      </PageHeader>
      <div style={chipRow}>
        {companies.map((c) => (
          <CompanyChip
            key={c.name}
            name={c.name}
            status={c.up ? "up" : "down"}
            selected={org === c.name}
            onClick={() => setOrg(c.name)}
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
          {verify ? (
            <Panel
              title="Verification"
              right={stat(
                verify.match && verify.statisticsMatch !== false && verify.signaturesMatch !== false
                  ? "var(--ok)"
                  : "var(--broken)",
                verify.match === false
                  ? "Caught by the fingerprint"
                  : verify.statisticsMatch === false
                    ? "Caught by the summary"
                    : verify.signaturesMatch === false
                      ? "Caught by a signature"
                      : "Clean"
              )}
            >
              <HashCompare
                rows={[
                  { label: "on the ledger", value: short(verify.anchoredHash) },
                  {
                    label: "recomputed",
                    value: short(verify.recomputedHash),
                    bad: verify.match === false
                  },
                  {
                    label: "summary",
                    value: verify.anchoredStatistics
                      ? `chain says ${verify.anchoredStatistics.minCelsius} to ${verify.anchoredStatistics.maxCelsius} °C${
                          verify.statisticsMatch === false ? ", the readings disagree" : ""
                        }`
                      : "not recorded",
                    bad: verify.statisticsMatch === false
                  },
                  {
                    label: "signatures",
                    value:
                      verify.signaturesMatch === null
                        ? "could not check"
                        : verify.signaturesMatch
                          ? "all signed by the sensor"
                          : "signature failure" +
                            (verify.signatureFailures && verify.signatureFailures.length
                              ? ": reading " + verify.signatureFailures.join(", ")
                              : ""),
                    bad: verify.signaturesMatch === false
                  },
                  { label: "transaction", value: short(verify.fabricTransactionId) }
                ]}
                match={
                  !!verify.match &&
                  verify.statisticsMatch !== false &&
                  verify.signaturesMatch !== false
                }
                matchText={`checked by the ${verify.by}`}
                mismatchText={`checked by the ${verify.by}`}
              />
            </Panel>
          ) : null}
        </div>
        <div style={column}>
          <Panel title="Latest" right={captionStat(caption.tone)}>
            <CaptionPanelBody text={caption.text} />
          </Panel>
          <Panel
            title={`Ledger · ${batchId}`}
            right={
              <Button size="sm" variant="quiet" onClick={() => refreshBatch()}>
                Refresh
              </Button>
            }
            pad={false}
          >
            <div style={feedScroll}>
              <GhostRows ghosts={ghosts} />
              {history.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)", padding: "4px 2px" }}>
                  No events on the ledger for this batch yet.
                </div>
              ) : (
                // The ledger hands its history back newest first, which is the order the feed wants,
                // so the newest event keeps the highest number.
                history.map((e, i) => {
                  const b = e.batch || {};
                  const st = (b.status || "").replaceAll("_", " ").toLowerCase();
                  const n = history.length - 1 - i;
                  const open = openBlock === n;
                  return (
                    <div
                      key={e.txId || i}
                      style={{
                        position: "relative",
                        paddingBottom: i < history.length - 1 ? 14 : 0
                      }}
                    >
                      {i < history.length - 1 ? (
                        <div
                          style={{
                            position: "absolute",
                            left: 17,
                            top: "calc(100% - 14px)",
                            height: 14,
                            width: 2,
                            background: "var(--line)"
                          }}
                        ></div>
                      ) : null}
                      <div
                        style={{
                          ...blockRow,
                          border: "1px solid " + (i === 0 ? "var(--chill)" : "var(--line)"),
                          background: i === 0 ? "var(--chill-tint)" : "var(--well)"
                        }}
                      >
                        <span
                          onClick={() => setOpenBlock(open ? null : n)}
                          title={open ? "Hide the block's contents" : "Show the block's contents"}
                          style={{
                            ...blockNumber,
                            background: "var(--chill-tint)",
                            color: "var(--chill-deep)"
                          }}
                        >
                          {n}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              fontSize: 12.5,
                              fontWeight: 600,
                              color: "var(--ink)"
                            }}
                          >
                            {e.isDelete
                              ? "record deleted"
                              : st + (b.lastKnownLocation ? " · " + b.lastKnownLocation : "")}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "var(--muted)",
                              marginTop: 2
                            }}
                          >
                            {e.submittedByStakeholderId || "unknown submitter"}
                            {e.timestamp
                              ? " · " + String(e.timestamp).slice(0, 19).replace("T", " ")
                              : ""}
                          </span>
                          <span
                            style={{
                              display: "block",
                              ...mono,
                              fontSize: 10,
                              color: "var(--faint)",
                              marginTop: 3
                            }}
                          >
                            tx {short(e.txId)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenBlock(open ? null : n)}
                          style={chevron}
                        >
                          {open ? "▲" : "▼"}
                        </button>
                        {open ? (
                          <div style={{ ...blockDetail, borderTop: "1px solid var(--hairline)" }}>
                            <span style={blockDetailLabel}>block</span>
                            <span style={{ ...mono, color: "var(--ink-2)" }}>{n}</span>
                            <span style={blockDetailLabel}>tx id</span>
                            <span style={{ ...mono, ...blockDetailValue }}>{e.txId || "—"}</span>
                            <span style={blockDetailLabel}>submitted by</span>
                            <span style={{ color: "var(--ink-2)" }}>
                              {e.submittedByStakeholderId || "unknown"}
                            </span>
                            {e.timestamp ? (
                              <>
                                <span style={blockDetailLabel}>time</span>
                                <span style={{ ...mono, color: "var(--ink-2)" }}>
                                  {String(e.timestamp).slice(0, 19).replace("T", " ")}
                                </span>
                              </>
                            ) : null}
                            <span style={blockDetailLabel}>record</span>
                            <span style={{ ...mono, ...blockDetailValue, whiteSpace: "pre-wrap" }}>
                              {e.isDelete
                                ? "deleted"
                                : JSON.stringify(b, null, 1).replace(/[{}"]/g, "").trim()}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
