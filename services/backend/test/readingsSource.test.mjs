import assert from "node:assert/strict";
import test from "node:test";
import {
  localReadingsSource,
  ReadingsUnavailableError,
  remoteReadingsSource
} from "../dist/services/readingsSource.js";
import { EvidenceVerificationError } from "../dist/services/evidenceVerification.js";
import { repositoryStub, storedEvidence } from "./harness.mjs";

const READINGS = [
  {
    sensorId: "S-1",
    sequence: 1,
    recordedAt: "2026-07-30T00:00:00.000Z",
    celsius: 2,
    signature: "c2lnbmF0dXJl"
  }
];

function stubFetch(respond) {
  const urls = [];
  return {
    urls,
    fetchImpl: async (url) => {
      urls.push(url);
      return respond(url);
    }
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("readings are fetched from the company that holds them, under a deadline", async () => {
  const signals = [];
  const { urls, fetchImpl: base } = stubFetch(() => json(READINGS));
  const fetchImpl = (url, init) => {
    signals.push(init?.signal);
    return base(url, init);
  };

  const sourced = await remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings(
    "EV-BATCH-001-a3f9"
  );

  assert.deepEqual(sourced.readings, READINGS);
  assert.deepEqual(urls, [
    "http://localhost:3006/temperature/evidence/EV-BATCH-001-a3f9/readings"
  ]);
  // Without one, a company that accepts the connection and stalls holds the check open forever.
  assert.ok(signals[0] instanceof AbortSignal, "the request carried no deadline");
});

test("an evidence ID with awkward characters is escaped rather than pasted into the path", async () => {
  const { urls, fetchImpl } = stubFetch(() => json(READINGS));

  await remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV/../secret");

  assert.match(urls[0], /EV%2F\.\.%2Fsecret\/readings$/);
});

// Fetched readings carry no claim about the holder's own bookkeeping, and verification reports
// that as unavailable rather than as a mismatch.
test("readings fetched from another company make no claim about its stored hash", async () => {
  const { fetchImpl } = stubFetch(() => json(READINGS));

  const sourced = await remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1");

  assert.equal(sourced.declaredHash, undefined);
});

// The holder saying it has no such evidence is the same condition its own backend reports as
// EVIDENCE_NOT_FOUND, and it is raised under the same code. Answering differently depending on
// which company was asked would make a mistyped evidence ID look like missing data on five of the
// six backends.
test("evidence the holder has never seen is refused the same way the holder refuses it", async () => {
  const { fetchImpl } = stubFetch(() => json({ error: "not on the ledger" }, 404));

  await assert.rejects(
    remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1"),
    (error) => error instanceof EvidenceVerificationError && error.code === "EVIDENCE_NOT_FOUND"
  );
});

// The one that matters. A holder that stops answering, or answers with a fault, must never be
// reported as a company with nothing to hide: that would turn "I could not check" into "clean".
test("a holder that cannot answer raises rather than reading as no readings", async () => {
  const failures = [
    () => json({ error: "database is down" }, 500),
    () => json({ error: "storage is not configured" }, 503),
    () => {
      throw new TypeError("fetch failed");
    },
    // A holder that accepts the connection and then says nothing. Hanging is how one would stop a
    // check finishing without ever returning an error, so the request carries a deadline.
    () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError"
      });
    }
  ];

  for (const respond of failures) {
    const { fetchImpl } = stubFetch(respond);
    await assert.rejects(
      remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1")
    );
  }
});

// This data comes from the party being audited, so a malformed reading is exactly the input a
// dishonest holder controls. Casting it would crash the check with a TypeError and report a server
// fault instead of the mismatch the check exists to surface.
test("a holder answering with readings of the wrong shape raises rather than crashing", async () => {
  const malformed = [
    { readings: "trust me" },
    "not even an array",
    [{ ...READINGS[0], celsius: "4.500" }],
    [{ sensorId: "S-1", celsius: 4.5 }],
    [{ ...READINGS[0], sensorId: 1 }],
    [{ ...READINGS[0], celsius: Number.NaN }],
    // A holder that simply left the signature off. Accepting it would leave the check with nothing
    // to verify and report "verified" for readings nobody ever signed, which is the exact failure
    // the signatures exist to prevent.
    [{ sensorId: "S-1", recordedAt: "2026-07-30T00:00:00.000Z", celsius: 2, sequence: 1 }],
    [{ ...READINGS[0], signature: "" }],
    [{ ...READINGS[0], sequence: undefined }],
    [{ ...READINGS[0], sequence: 1.5 }],
    [null]
  ];

  for (const body of malformed) {
    const { fetchImpl } = stubFetch(() => json(body));
    await assert.rejects(
      remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1"),
      (error) => error instanceof ReadingsUnavailableError,
      JSON.stringify(body)
    );
  }
});

// A 200 whose body is not JSON at all. The holder answered, so none of the checks above catch it,
// and letting the parse error escape would report a fault in the checker.
test("a holder answering with something that is not JSON raises rather than escaping", async () => {
  const { fetchImpl } = stubFetch(
    () => new Response("<html>proxy error</html>", { status: 200 })
  );

  await assert.rejects(
    remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1"),
    (error) => error instanceof ReadingsUnavailableError
  );
});

// fetch itself can reject with something that was never an Error. The reason still has to name
// something rather than coming out as "[object Object]".
test("a fetch that rejects with something other than an Error still names a reason", async () => {
  const { fetchImpl } = stubFetch(() => {
    throw "the socket closed";
  });

  await assert.rejects(
    remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1"),
    (error) => {
      assert.ok(error instanceof ReadingsUnavailableError);
      assert.match(error.message, /the socket closed/);
      return true;
    }
  );
});

// Naming the company that would not answer is the point: without it the checker looks broken when
// the party being checked is the one that went quiet.
test("a failure names the company that would not hand the readings over", async () => {
  const { fetchImpl } = stubFetch(() => json({ error: "down" }, 500));

  await assert.rejects(
    remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1"),
    (error) => {
      assert.equal(error.origin, "http://localhost:3006");
      assert.match(error.message, /http:\/\/localhost:3006/);
      return true;
    }
  );
});

// Only a company holding the row can tell these two apart, so they are raised from the local
// source and never from a fetched one.
test("the company holding the readings distinguishes unknown evidence from unanchored", async () => {
  await assert.rejects(
    localReadingsSource(repositoryStub({ getEvidence: async () => undefined })).getReadings("EV-1"),
    (error) => error instanceof EvidenceVerificationError && error.code === "EVIDENCE_NOT_FOUND"
  );

  await assert.rejects(
    localReadingsSource(
      repositoryStub({
        getEvidence: async () =>
          storedEvidence({ submissionStatus: "PENDING", fabricTransactionId: null })
      })
    ).getReadings("EV-1"),
    (error) => error instanceof EvidenceVerificationError && error.code === "EVIDENCE_NOT_ANCHORED"
  );
});

test("the company holding the readings reports what its own record claims the hash is", async () => {
  const sourced = await localReadingsSource(
    repositoryStub({
      getEvidence: async () => storedEvidence({ evidenceHash: "c".repeat(64) }),
      getReadings: async () => READINGS
    })
  ).getReadings("EV-1");

  assert.equal(sourced.declaredHash, "c".repeat(64));
  assert.deepEqual(sourced.readings, READINGS);
});
