export interface RawTemperatureReading {
  readonly sensorId: string;
  readonly recordedAt: string;
  readonly celsius: number;
}

export interface CanonicalTemperatureReading {
  readonly sensorId: string;
  readonly recordedAt: string;
  readonly celsius: number;
}

export function canonicaliseReadings(_readings: readonly RawTemperatureReading[]): readonly CanonicalTemperatureReading[] {
  // TODO: Sort readings deterministically and normalise timestamp and temperature precision.
  throw new Error("canonicaliseReadings is not implemented yet.");
}
