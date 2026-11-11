import type { MeasureMeta, ScoreDocument } from "./model";
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

function positionInMeasure(measureId: string, measure: MeasureMeta, capacity: number, tick: number): PlaybackPosition {
  const tickInMeasure = Math.max(0, Math.min(capacity, tick));
  const beatTicks = TICKS_PER_WHOLE / measure.time.denominator;
  return {
    measureId,
    measureNumber: measure.number,
    tickInMeasure,
    measureProgress: capacity > 0 ? tickInMeasure / capacity : 0,
    beat: Math.min(measure.time.numerator, Math.floor(tickInMeasure / beatTicks) + 1),
  };
}

/**
 * Build once per immutable score snapshot, then reuse for animation frames.
 * Binary search also supports backward seeks and loop wrap without a mutable cursor.
 */
export function createPlaybackPositionLocator(score: ScoreDocument): (elapsedSeconds: number) => PlaybackPosition | null {
  let startTick = 0;
  const timeline = score.measureOrder.flatMap((measureId, index) => {
    const measure = score.measures[measureId];
    if (!measure) return [];
    const capacity = measureCapacity(measure);
    const entry = { measureId, measure, capacity, startTick, endTick: startTick + capacity, isLast: index === score.measureOrder.length - 1 };
    startTick += capacity;
    return [entry];
  });
  const tempo = score.tempo;
  return (elapsedSeconds) => {
    const safeSeconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    const targetTick = safeSeconds * tempo / 60 * TICKS_PER_QUARTER;
    let low = 0;
    let high = timeline.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (targetTick < timeline[middle].endTick || timeline[middle].isLast) high = middle;
      else low = middle + 1;
    }
    const entry = timeline[low];
    return entry ? positionInMeasure(entry.measureId, entry.measure, entry.capacity, targetTick - entry.startTick) : null;
  };
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
      return positionInMeasure(measureId, measure, capacity, targetTick - measureStartTick);
    }
    measureStartTick += capacity;
  }

  return null;
}
