/**
 * The two ways a company can get hold of the readings behind a piece of evidence: out of its own
 * database, or over HTTP from the company that keeps them.
 *
 * The oracle collects the readings, so only the oracle has them locally. Everyone else asks it,
 * recomputes the fingerprint themselves and compares it against the ledger. A dishonest oracle
 * cannot make altered readings verify: the most it can do is refuse to hand them over, which is
 * why an unreachable source has to raise rather than read as "no readings".
 */
import type { StoredTemperatureReading, TemperatureRepository } from "@fresh-milk/storage";
import {
  EvidenceVerificationError,
  type ReadingsSource,
  type SourcedReadings
} from "./evidenceVerification.js";

export function localReadingsSource(repository: TemperatureRepository): ReadingsSource {
  return {
    async getReadings(evidenceId: string): Promise<SourcedReadings | undefined> {
      // Only a company holding the row can tell "never recorded" from "recorded but never
      // anchored", so those two are raised from here rather than from the verification itself.
      const evidence = await repository.getEvidence(evidenceId);
      if (!evidence) {
        throw new EvidenceVerificationError(
          "EVIDENCE_NOT_FOUND",
          `Evidence '${evidenceId}' does not exist.`
        );
      }
      if (evidence.submissionStatus !== "ANCHORED" || !evidence.fabricTransactionId) {
        throw new EvidenceVerificationError(
          "EVIDENCE_NOT_ANCHORED",
          `Evidence '${evidenceId}' has not been anchored to Fabric.`
        );
      }

      return {
        readings: await repository.getReadings(evidenceId),
        declaredHash: evidence.evidenceHash
      };
    }
  };
}

// The company holding the readings would not hand them over. Distinct from a verification result
// and from a fault in the checker, because it is neither: it names the party that did not answer,
// which is the only thing that tells an operator whose problem it is.
export class ReadingsUnavailableError extends Error {
  public constructor(
    public readonly origin: string,
    reason: string
  ) {
    super(`The readings could not be fetched from ${origin}: ${reason}.`);
    this.name = "ReadingsUnavailableError";
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "it did not answer in time" : error.message;
  }
  return String(error);
}

function isReading(value: unknown): value is StoredTemperatureReading {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StoredTemperatureReading>;
  return (
    typeof candidate.sensorId === "string" &&
    typeof candidate.recordedAt === "string" &&
    typeof candidate.celsius === "number" &&
    Number.isFinite(candidate.celsius)
  );
}

// fetch is a parameter for the same reason the gateway connector is one: it is the seam that lets
// this be exercised without another process running.
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// The gateway calls all carry a deadline because a peer that stalls would otherwise hold a request
// open forever. The same is true of a company that accepts the connection and then says nothing,
// and it is a company with a motive: hanging is how a holder would stop a check finishing without
// ever returning an error.
const READINGS_TIMEOUT_MS = 30_000;

export function remoteReadingsSource(
  origin: string,
  fetchImpl: FetchLike = fetch
): ReadingsSource {
  return {
    async getReadings(evidenceId: string): Promise<SourcedReadings | undefined> {
      const url = `${origin}/temperature/evidence/${encodeURIComponent(evidenceId)}/readings`;
      let response: Response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(READINGS_TIMEOUT_MS) });
      } catch (error) {
        throw new ReadingsUnavailableError(origin, describe(error));
      }

      // The holder saying it has no such evidence is the same condition its own backend reports as
      // EVIDENCE_NOT_FOUND, so it is raised under the same code. Answering differently depending on
      // which company was asked would make a mistyped evidence ID look like missing data.
      if (response.status === 404) {
        throw new EvidenceVerificationError(
          "EVIDENCE_NOT_FOUND",
          `Evidence '${evidenceId}' does not exist.`
        );
      }
      // Anything else has to raise rather than read as "no readings": a company that simply stopped
      // answering must never look like one with nothing to hide.
      if (!response.ok) {
        throw new ReadingsUnavailableError(origin, `it answered ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new ReadingsUnavailableError(origin, describe(error));
      }

      // Checked element by element, not just that it is an array. This data comes from the party
      // being audited, so a malformed reading is exactly the input a dishonest holder controls,
      // and casting it would crash the check with a TypeError instead of reporting a mismatch.
      if (!Array.isArray(body) || !body.every(isReading)) {
        throw new ReadingsUnavailableError(origin, "its readings were not in the expected shape");
      }

      // No declaredHash. The company that publishes readings does not publish its own bookkeeping,
      // and the check does not need it.
      return { readings: body };
    }
  };
}
