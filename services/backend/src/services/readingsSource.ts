/**
 * Gives verification one interface for obtaining raw readings.
 *
 * The data holder reads its own PostgreSQL database. Other organisations request the same readings
 * from that holder, with validation and a timeout so untrusted or stalled responses stay failures.
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
      // Only the holder can distinguish missing evidence from an unanchored local record.
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

// Distinguishes unavailable remote data from a completed verification result.
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
    Number.isFinite(candidate.celsius) &&
    typeof candidate.sequence === "number" &&
    Number.isSafeInteger(candidate.sequence) &&
    typeof candidate.signature === "string" &&
    candidate.signature.length > 0
  );
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// A holder that stops responding must not leave verification pending indefinitely.
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

      if (response.status === 404) {
        throw new EvidenceVerificationError(
          "EVIDENCE_NOT_FOUND",
          `Evidence '${evidenceId}' does not exist.`
        );
      }
      // Transport failure is not evidence absence and must remain distinguishable.
      if (!response.ok) {
        throw new ReadingsUnavailableError(origin, `it answered ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new ReadingsUnavailableError(origin, describe(error));
      }

      // Validate every untrusted reading before passing it to hashing and signature code.
      if (!Array.isArray(body) || !body.every(isReading)) {
        throw new ReadingsUnavailableError(origin, "its readings were not in the expected shape");
      }

      return { readings: body };
    }
  };
}
