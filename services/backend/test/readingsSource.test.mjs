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
  assert.deepEqual(urls, ["http://localhost:3006/temperature/evidence/EV-BATCH-001-a3f9/readings"]);
  // A stalled holder must not keep verification open indefinitely.
  assert.ok(signals[0] instanceof AbortSignal, "the request carried no deadline");
});

test("an evidence ID with awkward characters is escaped rather than pasted into the path", async () => {
  const { urls, fetchImpl } = stubFetch(() => json(READINGS));

  await remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV/../secret");

  assert.match(urls[0], /EV%2F\.\.%2Fsecret\/readings$/);
});

test("readings fetched from another company make no claim about its stored hash", async () => {
  const { fetchImpl } = stubFetch(() => json(READINGS));

  const sourced = await remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings(
    "EV-1"
  );

  assert.equal(sourced.declaredHash, undefined);
});

test("evidence the holder has never seen is refused the same way the holder refuses it", async () => {
  const { fetchImpl } = stubFetch(() => json({ error: "not on the ledger" }, 404));

  await assert.rejects(
    remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1"),
    (error) => error instanceof EvidenceVerificationError && error.code === "EVIDENCE_NOT_FOUND"
  );
});

test("a holder that cannot answer raises rather than reading as no readings", async () => {
  const failures = [
    () => json({ error: "database is down" }, 500),
    () => json({ error: "storage is not configured" }, 503),
    () => {
      throw new TypeError("fetch failed");
    },
    // Simulate a holder accepting the request without answering.
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

// Validate the untrusted response body before verification uses it.
test("a holder answering with readings of the wrong shape raises rather than crashing", async () => {
  const malformed = [
    { readings: "trust me" },
    "not even an array",
    [{ ...READINGS[0], celsius: "4.500" }],
    [{ sensorId: "S-1", celsius: 4.5 }],
    [{ ...READINGS[0], sensorId: 1 }],
    [{ ...READINGS[0], celsius: Number.NaN }],
    // A reading without its signature cannot be verified.
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

test("a holder answering with something that is not JSON raises rather than escaping", async () => {
  const { fetchImpl } = stubFetch(() => new Response("<html>proxy error</html>", { status: 200 }));

  await assert.rejects(
    remoteReadingsSource("http://localhost:3006", fetchImpl).getReadings("EV-1"),
    (error) => error instanceof ReadingsUnavailableError
  );
});

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

// Failure messages identify the readings holder that did not answer.
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

// Only a local holder can distinguish missing evidence from an unanchored record.
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
