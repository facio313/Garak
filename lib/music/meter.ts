import type { MeasureMeta } from "./model";

/** The existing score-model time signature shape, accepted without a schema migration. */
export type MeterSignature = Readonly<MeasureMeta["time"]>;

/** An exact duration expressed as an integer fraction of a whole note. */
export interface RationalDuration {
  readonly numerator: number;
  readonly denominator: number;
}

function assertMeter(meter: MeterSignature): void {
  if (!Number.isSafeInteger(meter.numerator) || meter.numerator <= 0) {
    throw new RangeError("A meter numerator must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(meter.denominator) || meter.denominator <= 0) {
    throw new RangeError("A meter denominator must be a positive safe integer.");
  }
}

function repeatedUnits(unit: number, count: number): number[] {
  return Array.from({ length: count }, () => unit);
}

/**
 * Returns conservative default beam groups as exact whole-note fractions.
 *
 * Quarter-note and broader meters group by the denominator beat. Subdivided
 * meters use conventional pairs, compound groups of three, and a final group
 * of three for odd meters (5 = 2+3, 7 = 2+2+3). A future custom grouping can
 * override this default without changing the score's time-signature shape.
 */
export function getDefaultBeamGroups(meter: MeterSignature): RationalDuration[] {
  assertMeter(meter);

  let units: number[];
  if (meter.denominator < 8) {
    units = repeatedUnits(1, meter.numerator);
  } else if (meter.numerator <= 3) {
    units = [meter.numerator];
  } else if (meter.numerator >= 6 && meter.numerator % 3 === 0) {
    units = repeatedUnits(3, meter.numerator / 3);
  } else if (meter.numerator % 2 === 0) {
    units = repeatedUnits(2, meter.numerator / 2);
  } else {
    units = [...repeatedUnits(2, (meter.numerator - 3) / 2), 3];
  }

  return units.map((numerator) => ({ numerator, denominator: meter.denominator }));
}

/** Exact duration for a semantic full-measure rest, preserving the meter unit. */
export function getFullMeasureDuration(meter: MeterSignature): RationalDuration {
  assertMeter(meter);
  return { numerator: meter.numerator, denominator: meter.denominator };
}
