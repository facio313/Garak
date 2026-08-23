export type PitchStep = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Clef = "treble" | "bass" | "alto" | "tenor" | "percussion";
export type DurationBase = 1 | 2 | 4 | 8 | 16;

export interface Fraction {
  numerator: number;
  denominator: number;
}

export interface DurationValue {
  base: DurationBase;
  dots: 0 | 1;
}

export interface Pitch {
  step: PitchStep;
  alter: -2 | -1 | 0 | 1 | 2;
  octave: number;
}

export interface Transposition {
  diatonic: number;
  chromatic: number;
  octaveChange: number;
}

export interface InstrumentSnapshot {
  catalogId: string;
  family: string;
  name: string;
  shortName: string;
  clef: Clef;
  transposition: Transposition;
  midiProgram: number;
  color: string;
}

export interface ScoreNote {
  id: string;
  pitch: Pitch;
  accidentalDisplay: "auto" | "force" | "hide";
}

export interface NoteEvent {
  id: string;
  kind: "note";
  notes: ScoreNote[];
  duration: DurationValue;
}

export interface RestEvent {
  id: string;
  kind: "rest";
  duration: DurationValue;
}

export type MusicEvent = NoteEvent | RestEvent;

export interface VoiceData {
  id: string;
  events: MusicEvent[];
}

export interface StaffMeasure {
  voices: VoiceData[];
}

export interface StaffData {
  id: string;
  clef: Clef;
  measures: Record<string, StaffMeasure>;
}

export interface PartData {
  id: string;
  name: string;
  shortName: string;
  instrument: InstrumentSnapshot;
  staves: StaffData[];
  muted: boolean;
  solo: boolean;
}

export interface MeasureMeta {
  id: string;
  number: number;
  time: { numerator: number; denominator: number };
  key: { fifths: number; mode: "major" | "minor" };
}

export interface TieEdge {
  id: string;
  fromNoteId: string;
  toNoteId: string;
}

export interface ScoreDocument {
  format: "garak-score";
  schemaVersion: 1;
  id: string;
  metadata: {
    title: string;
    subtitle: string;
    composer: string;
    copyright: string;
  };
  tempo: number;
  measureOrder: string[];
  measures: Record<string, MeasureMeta>;
  parts: PartData[];
  ties: TieEdge[];
  updatedAt: string;
}

export const TICKS_PER_QUARTER = 960;
export const TICKS_PER_WHOLE = TICKS_PER_QUARTER * 4;

export const DURATION_LABELS: Record<DurationBase, string> = {
  1: "Whole",
  2: "Half",
  4: "Quarter",
  8: "Eighth",
  16: "Sixteenth",
};

export function durationTicks(duration: DurationValue): number {
  const baseTicks = TICKS_PER_WHOLE / duration.base;
  return duration.dots === 1 ? baseTicks + baseTicks / 2 : baseTicks;
}

export function measureCapacity(measure: MeasureMeta): number {
  return (measure.time.numerator * TICKS_PER_WHOLE) / measure.time.denominator;
}

export function voiceTicks(voice: VoiceData): number {
  return voice.events.reduce((total, event) => total + durationTicks(event.duration), 0);
}

const STEP_SEMITONES: Record<PitchStep, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function writtenMidi(pitch: Pitch): number {
  return 12 * (pitch.octave + 1) + STEP_SEMITONES[pitch.step] + pitch.alter;
}

export function writtenToSounding(pitch: Pitch, transposition: Transposition): number {
  return writtenMidi(pitch) + transposition.chromatic + transposition.octaveChange * 12;
}

export function getPrimaryVoice(part: PartData, measureId: string): VoiceData {
  return part.staves[0]?.measures[measureId]?.voices[0] ?? { id: `${part.id}-${measureId}-v1`, events: [] };
}

export function eventCount(score: ScoreDocument): number {
  return score.parts.reduce(
    (partTotal, part) =>
      partTotal +
      score.measureOrder.reduce((measureTotal, measureId) => measureTotal + getPrimaryVoice(part, measureId).events.length, 0),
    0,
  );
}

export function validateScore(score: unknown, requireComplete = false): string[] {
  const errors: string[] = [];
  if (!score || typeof score !== "object") return ["Score must be an object."];
  const candidate = score as Partial<ScoreDocument>;
  if (candidate.format !== "garak-score" || candidate.schemaVersion !== 1) errors.push("Unsupported Garak score format.");
  if (!candidate.metadata?.title?.trim()) errors.push("A score title is required.");
  if (!Array.isArray(candidate.measureOrder) || !candidate.measureOrder.length) errors.push("At least one measure is required.");
  if (!Array.isArray(candidate.parts) || !candidate.parts.length) errors.push("At least one instrument is required.");
  if (errors.length || !candidate.measureOrder || !candidate.parts || !candidate.measures) return errors;

  for (const part of candidate.parts) {
    if (!part.instrument || !part.staves?.length) {
      errors.push(`${part.name || "Part"} has no playable staff.`);
      continue;
    }
    for (const measureId of candidate.measureOrder) {
      const measure = candidate.measures[measureId];
      if (!measure) {
        errors.push(`Missing measure ${measureId}.`);
        continue;
      }
      const used = voiceTicks(getPrimaryVoice(part, measureId));
      const capacity = measureCapacity(measure);
      if (used > capacity) errors.push(`${part.name}, measure ${measure.number} exceeds its time signature.`);
      if (requireComplete && used !== capacity) errors.push(`${part.name}, measure ${measure.number} is incomplete.`);
    }
  }
  return errors;
}

export function pitchName(pitch: Pitch): string {
  const accidental = pitch.alter === -2 ? "𝄫" : pitch.alter === -1 ? "♭" : pitch.alter === 1 ? "♯" : pitch.alter === 2 ? "𝄪" : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}
