import type { ScoreDocument } from "./model";
import { measureCapacity, TICKS_PER_QUARTER } from "./model";
import type { PlaybackNote } from "./exporters";

export const COUNT_IN_PART = "__garak_count_in__";
export const METRONOME_PART = "__garak_metronome__";
const click = (startSeconds: number, accent: boolean): PlaybackNote => ({ partId: METRONOME_PART, midi: accent ? 96 : 89, velocity: accent ? 110 : 75, startSeconds, durationSeconds: .045, notatedDurationSeconds: .045 });

/** One click per denominator beat, with a stronger first beat; follows meter changes. */
export function metronomeNotes(score: ScoreDocument): PlaybackNote[] {
  const secondsPerTick = 60 / score.tempo / TICKS_PER_QUARTER;
  let start = 0;
  return score.measureOrder.flatMap(id => {
    const measure = score.measures[id];
    const step = 60 / score.tempo * 4 / measure.time.denominator;
    const notes = Array.from({length: measure.time.numerator}, (_, beat) => click(start + beat * step, beat === 0));
    start += measureCapacity(measure) * secondsPerTick;
    return notes;
  });
}

export function countInForPosition(score: ScoreDocument, seconds: number, bars: 1 | 2 = 1) {
  let remaining = seconds;
  let measure = score.measures[score.measureOrder[0]];
  for (const id of score.measureOrder) {
    measure = score.measures[id];
    const length = measureCapacity(measure) * 60 / score.tempo / TICKS_PER_QUARTER;
    if (remaining < length) break;
    remaining -= length;
  }
  const beatSeconds = 60 / score.tempo * 4 / measure.time.denominator;
  return { beatsPerBar: measure.time.numerator, duration: bars * measure.time.numerator * beatSeconds, beatSeconds, beats: bars * measure.time.numerator,
    notes: Array.from({length: bars * measure.time.numerator}, (_, beat) => click(beat * beatSeconds, beat % measure.time.numerator === 0)) };
}
