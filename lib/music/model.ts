import { isKeySignature } from "./key-signatures";
import type { KeySignature } from "./key-signatures";

export type { KeyMode, KeySignature } from "./key-signatures";

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

export type StaffSelector = number | string;

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
  /** Concert key; a transposing part derives its own written key from its instrument snapshot. */
  key: KeySignature;
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

/** Resolves a zero-based staff index or a persisted staff ID without guessing on invalid input. */
export function resolveStaffIndex(part: PartData, staffIdOrIndex: StaffSelector = 0): number {
  if (typeof staffIdOrIndex === "number") {
    return Number.isInteger(staffIdOrIndex) && staffIdOrIndex >= 0 && staffIdOrIndex < part.staves.length ? staffIdOrIndex : -1;
  }
  return part.staves.findIndex((staff) => staff.id === staffIdOrIndex);
}

export function getPrimaryVoice(part: PartData, measureId: string, staffIndex = 0): VoiceData {
  const staff = part.staves[staffIndex];
  const fallbackPrefix = staffIndex === 0 ? part.id : staff?.id ?? `${part.id}-staff-${staffIndex + 1}`;
  return staff?.measures[measureId]?.voices[0] ?? { id: `${fallbackPrefix}-${measureId}-v1`, events: [] };
}

/** Counts every staff by default, or one selected staff when a part ID is supplied. */
export function eventCount(score: ScoreDocument, partId?: string, staffIdOrIndex: StaffSelector = 0): number {
  if (partId !== undefined) {
    const part = score.parts.find((candidate) => candidate.id === partId);
    if (!part) return 0;
    const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
    if (staffIndex < 0) return 0;
    return score.measureOrder.reduce(
      (total, measureId) => total + getPrimaryVoice(part, measureId, staffIndex).events.length,
      0,
    );
  }

  return score.parts.reduce((scoreTotal, part) => scoreTotal + part.staves.reduce(
    (partTotal, _staff, staffIndex) => partTotal + score.measureOrder.reduce(
      (measureTotal, measureId) => measureTotal + getPrimaryVoice(part, measureId, staffIndex).events.length,
      0,
    ),
    0,
  ), 0);
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

  for (const measureId of candidate.measureOrder) {
    const measure = candidate.measures[measureId];
    if (!measure) continue;
    if (!isKeySignature(measure.key)) {
      errors.push(`Measure ${measure.number} has an invalid key signature; fifths must be an integer from -7 to 7 and mode must be major or minor.`);
    }
  }

  for (const part of candidate.parts) {
    if (!part.instrument || !part.staves?.length) {
      errors.push(`${part.name || "Part"} has no playable staff.`);
      continue;
    }
    const transposition = part.instrument.transposition;
    if (!transposition || !Number.isInteger(transposition.diatonic) || !Number.isInteger(transposition.chromatic) || !Number.isInteger(transposition.octaveChange)) {
      errors.push(`${part.name || "Part"} has an invalid transposition snapshot.`);
      continue;
    }
    part.staves.forEach((_staff, staffIndex) => {
      for (const measureId of candidate.measureOrder!) {
        const measure = candidate.measures![measureId];
        if (!measure) {
          errors.push(`Missing measure ${measureId}.`);
          continue;
        }
        const used = voiceTicks(getPrimaryVoice(part, measureId, staffIndex));
        const capacity = measureCapacity(measure);
        const staffLabel = part.staves.length > 1 ? `${part.name}, staff ${staffIndex + 1}` : part.name;
        if (used > capacity) errors.push(`${staffLabel}, measure ${measure.number} exceeds its time signature.`);
        if (requireComplete && used !== capacity) errors.push(`${staffLabel}, measure ${measure.number} is incomplete.`);
      }
    });
  }
  return errors;
}

export function pitchName(pitch: Pitch): string {
  const accidental = pitch.alter === -2 ? "𝄫" : pitch.alter === -1 ? "♭" : pitch.alter === 1 ? "♯" : pitch.alter === 2 ? "𝄪" : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}
