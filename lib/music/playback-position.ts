import type { ScoreDocument } from "./model";
import { measureCapacity, TICKS_PER_QUARTER, TICKS_PER_WHOLE } from "./model";

export interface PlaybackPosition {
  measureId: string;
  measureNumber: number;
  /** Zero-based tick position within the current measure. */
  tickInMeasure: number;
  /** Zero-to-one visual progress through the current measure. */
  measureProgress: number;
  /** One-based denominator-beat number for a compact transport label. */
  beat: number;
}

/**
 * Maps the global-tempo Web Audio clock back to the semantic score timeline.
 * Keeping this mapping outside the renderer lets the transport label and the
 * engraved playhead share one source of truth across meter changes.
 */
export function locatePlaybackPosition(score: ScoreDocument, elapsedSeconds: number): PlaybackPosition | null {
  if (!score.measureOrder.length) return null;
  const safeSeconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const targetTick = safeSeconds * score.tempo / 60 * TICKS_PER_QUARTER;
  let measureStartTick = 0;

  for (const [index, measureId] of score.measureOrder.entries()) {
    const measure = score.measures[measureId];
    if (!measure) continue;
    const capacity = measureCapacity(measure);
    const isLast = index === score.measureOrder.length - 1;
    if (targetTick < measureStartTick + capacity || isLast) {
      const tickInMeasure = Math.max(0, Math.min(capacity, targetTick - measureStartTick));
      const beatTicks = TICKS_PER_WHOLE / measure.time.denominator;
      const beat = Math.min(measure.time.numerator, Math.floor(tickInMeasure / beatTicks) + 1);
      return {
        measureId,
        measureNumber: measure.number,
        tickInMeasure,
        measureProgress: capacity > 0 ? tickInMeasure / capacity : 0,
        beat,
      };
    }
    measureStartTick += capacity;
  }

  return null;
}
