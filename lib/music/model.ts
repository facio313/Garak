import { isKeySignature } from "./key-signatures";
import type { KeySignature } from "./key-signatures";

export type { KeyMode, KeySignature } from "./key-signatures";

export type PitchStep = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Clef = "treble" | "bass" | "alto" | "tenor" | "percussion";
export type DurationBase = 1 | 2 | 4 | 8 | 16 | 32 | 64;
export const DYNAMIC_MARKINGS = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"] as const;
export type DynamicMarking = typeof DYNAMIC_MARKINGS[number];

/** MIDI Note On velocities used consistently by live playback and MIDI export. */
export const DYNAMIC_VELOCITIES: Record<DynamicMarking, number> = {
  ppp: 32,
  pp: 44,
  p: 56,
  mp: 68,
  mf: 82,
  f: 96,
  ff: 112,
  fff: 124,
};
export const DEFAULT_MIDI_VELOCITY = DYNAMIC_VELOCITIES.mf;

export interface Fraction {
  numerator: number;
  denominator: number;
}

export interface DurationValue {
  base: DurationBase;
  dots: 0 | 1 | 2;
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
  dynamic?: DynamicMarking;
}

export interface RestEvent {
  id: string;
  kind: "rest";
  duration: DurationValue;
  dynamic?: DynamicMarking;
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

/**
 * Generous schema-v1 alpha safety ceilings. The structural limits mirror the
 * MusicXML importer's 20,000-measure and 10,000 staff-measure-cell budgets,
 * while keeping synchronous rendering/export materialization practical.
 * Schema-v1 materializes exactly one editable voice per cell. The timeline
 * ceiling is twice MIDI's largest
 * variable-length delta because Garak converts 960 native ticks per quarter to
 * 480 MIDI ticks per quarter during export.
 */
export const SCORE_VALIDATION_LIMITS = Object.freeze({
  orderedMeasures: 20_000,
  parts: 256,
  staves: 512,
  staffMeasureCells: 10_000,
  voices: 10_000,
  events: 50_000,
  notes: 100_000,
  ties: 50_000,
  timelineTicks: 0x0fffffff * 2,
  idCharacters: 256,
  voiceIdCharacters: 1_024,
  noteIdCharacters: 512,
  tieIdCharacters: 2_048,
  nameCharacters: 200,
  shortNameCharacters: 80,
  copyrightCharacters: 500,
  colorCharacters: 64,
  updatedAtCharacters: 64,
  validationErrors: 200,
} as const);

export const DURATION_LABELS: Record<DurationBase, string> = {
  1: "Whole",
  2: "Half",
  4: "Quarter",
  8: "Eighth",
  16: "Sixteenth",
  32: "Thirty-second",
  64: "Sixty-fourth",
};

export function durationTicks(duration: DurationValue): number {
  const dotDenominator = 2 ** duration.dots;
  const dotNumerator = 2 ** (duration.dots + 1) - 1;
  return TICKS_PER_WHOLE * dotNumerator / (duration.base * dotDenominator);
}

export function nextAugmentationDotCount(dots: DurationValue["dots"]): DurationValue["dots"] {
  if (dots === 0) return 1;
  if (dots === 1) return 2;
  return 0;
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

type ValidationRecord = Record<string, unknown>;

interface TieNoteLocation {
  partIndex: number;
  staffIndex: number;
  voiceIndex: number;
  eventStartTick: number;
  eventEndTick: number;
}

const VALID_CLEFS = new Set<Clef>(["treble", "bass", "alto", "tenor", "percussion"]);
const VALID_DURATION_BASES = new Set<number>([1, 2, 4, 8, 16, 32, 64]);
const VALID_DOT_COUNTS = new Set<number>([0, 1, 2]);
const VALID_PITCH_STEPS = new Set<PitchStep>(["C", "D", "E", "F", "G", "A", "B"]);
const VALID_ACCIDENTAL_DISPLAYS = new Set<ScoreNote["accidentalDisplay"]>(["auto", "force", "hide"]);
const VALID_DYNAMIC_MARKINGS = new Set<DynamicMarking>(DYNAMIC_MARKINGS);
const VALID_INSTRUMENT_COLOR = /^#[0-9A-Fa-f]{6}$/;

class ValidationErrorLimitReached extends Error {
  constructor(readonly visibleErrors: string[]) {
    super("Score validation error limit reached.");
  }
}

class ValidationErrors extends Array<string> {
  override push(...messages: string[]): number {
    for (const message of messages) {
      if (this.length >= SCORE_VALIDATION_LIMITS.validationErrors) {
        throw new ValidationErrorLimitReached([
          ...this,
          `Additional validation errors were omitted after the first ${SCORE_VALIDATION_LIMITS.validationErrors}.`,
        ]);
      }
      super.push(message);
    }
    return this.length;
  }
}

function isValidationRecord(value: unknown): value is ValidationRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function checkedBoundedSum(current: number, additional: number, maximum: number): number | null {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(additional) || current < 0 || additional < 0 || current > maximum || additional > maximum - current) {
    return null;
  }
  return current + additional;
}

function scoreComplexityError(candidate: ValidationRecord): string | null {
  const rawMeasureOrder = candidate.measureOrder;
  if (Array.isArray(rawMeasureOrder) && rawMeasureOrder.length > SCORE_VALIDATION_LIMITS.orderedMeasures) {
    return `Score exceeds the ${SCORE_VALIDATION_LIMITS.orderedMeasures.toLocaleString("en-US")}-ordered-measure safety limit.`;
  }
  const measureOrder = Array.isArray(rawMeasureOrder) ? rawMeasureOrder : [];

  const rawParts = candidate.parts;
  if (Array.isArray(rawParts) && rawParts.length > SCORE_VALIDATION_LIMITS.parts) {
    return `Score exceeds the ${SCORE_VALIDATION_LIMITS.parts.toLocaleString("en-US")}-part safety limit.`;
  }

  const rawTies = candidate.ties;
  if (Array.isArray(rawTies) && rawTies.length > SCORE_VALIDATION_LIMITS.ties) {
    return `Score exceeds the ${SCORE_VALIDATION_LIMITS.ties.toLocaleString("en-US")}-tie safety limit.`;
  }

  const staffRecords: ValidationRecord[] = [];
  let totalStaves = 0;
  if (Array.isArray(rawParts)) {
    for (const rawPart of rawParts) {
      if (!isValidationRecord(rawPart) || !Array.isArray(rawPart.staves)) continue;
      const nextTotal = checkedBoundedSum(totalStaves, rawPart.staves.length, SCORE_VALIDATION_LIMITS.staves);
      if (nextTotal === null) {
        return `Score exceeds the ${SCORE_VALIDATION_LIMITS.staves.toLocaleString("en-US")}-staff safety limit.`;
      }
      totalStaves = nextTotal;
      for (const rawStaff of rawPart.staves) {
        if (isValidationRecord(rawStaff)) staffRecords.push(rawStaff);
      }
    }
  }

  if (measureOrder.length > 0 && totalStaves > Math.floor(SCORE_VALIDATION_LIMITS.staffMeasureCells / measureOrder.length)) {
    return `Score exceeds the ${SCORE_VALIDATION_LIMITS.staffMeasureCells.toLocaleString("en-US")}-cell staff-by-measure safety limit.`;
  }

  let totalVoices = 0;
  let totalEvents = 0;
  let totalNotes = 0;
  for (const rawStaff of staffRecords) {
    if (!isValidationRecord(rawStaff.measures)) continue;
    for (const rawMeasureId of measureOrder) {
      if (typeof rawMeasureId !== "string" || rawMeasureId.length > SCORE_VALIDATION_LIMITS.idCharacters) continue;
      if (!Object.prototype.hasOwnProperty.call(rawStaff.measures, rawMeasureId)) continue;
      const rawStaffMeasure = rawStaff.measures[rawMeasureId];
      if (!isValidationRecord(rawStaffMeasure) || !Array.isArray(rawStaffMeasure.voices)) continue;
      const nextVoiceTotal = checkedBoundedSum(totalVoices, rawStaffMeasure.voices.length, SCORE_VALIDATION_LIMITS.voices);
      if (nextVoiceTotal === null) {
        return `Score exceeds the ${SCORE_VALIDATION_LIMITS.voices.toLocaleString("en-US")}-voice safety limit.`;
      }
      totalVoices = nextVoiceTotal;

      for (const rawVoice of rawStaffMeasure.voices) {
        if (!isValidationRecord(rawVoice) || !Array.isArray(rawVoice.events)) continue;
        const nextEventTotal = checkedBoundedSum(totalEvents, rawVoice.events.length, SCORE_VALIDATION_LIMITS.events);
        if (nextEventTotal === null) {
          return `Score exceeds the ${SCORE_VALIDATION_LIMITS.events.toLocaleString("en-US")}-event safety limit.`;
        }
        totalEvents = nextEventTotal;

        for (const rawEvent of rawVoice.events) {
          if (!isValidationRecord(rawEvent) || !Array.isArray(rawEvent.notes)) continue;
          const nextNoteTotal = checkedBoundedSum(totalNotes, rawEvent.notes.length, SCORE_VALIDATION_LIMITS.notes);
          if (nextNoteTotal === null) {
            return `Score exceeds the ${SCORE_VALIDATION_LIMITS.notes.toLocaleString("en-US")}-note safety limit.`;
          }
          totalNotes = nextNoteTotal;
        }
      }
    }
  }

  return null;
}

function validateScoreStructure(score: unknown, requireComplete: boolean): string[] {
  const errors = new ValidationErrors();
  if (!isValidationRecord(score)) return ["Score must be an object."];
  const candidate = score;

  const complexityError = scoreComplexityError(candidate);
  if (complexityError) return [complexityError];

  if (candidate.format !== "garak-score" || candidate.schemaVersion !== 1) errors.push("Unsupported Garak score format.");
  if (!isNonEmptyString(candidate.id)) errors.push("A score ID is required.");
  else if (candidate.id.length > SCORE_VALIDATION_LIMITS.idCharacters) {
    errors.push(`Score ID exceeds the ${SCORE_VALIDATION_LIMITS.idCharacters}-character safety limit.`);
  }

  const metadata = isValidationRecord(candidate.metadata) ? candidate.metadata : null;
  if (!metadata || !isNonEmptyString(metadata.title)) errors.push("A score title is required.");
  else if (metadata.title.length > SCORE_VALIDATION_LIMITS.nameCharacters) {
    errors.push(`Score title exceeds the ${SCORE_VALIDATION_LIMITS.nameCharacters}-character safety limit.`);
  }
  if (metadata) {
    for (const field of ["subtitle", "composer", "copyright"] as const) {
      if (typeof metadata[field] !== "string") errors.push(`Score metadata ${field} must be a string.`);
      else {
        const maximum = field === "copyright" ? SCORE_VALIDATION_LIMITS.copyrightCharacters : SCORE_VALIDATION_LIMITS.nameCharacters;
        if (metadata[field].length > maximum) errors.push(`Score metadata ${field} exceeds the ${maximum}-character safety limit.`);
      }
    }
  } else {
    errors.push("Score metadata must be an object.");
  }
  if (!Number.isInteger(candidate.tempo) || (candidate.tempo as number) < 30 || (candidate.tempo as number) > 300) {
    errors.push("Score tempo must be an integer from 30 through 300 BPM.");
  }
  if (typeof candidate.updatedAt !== "string") errors.push("Score updatedAt must be a string.");
  else if (candidate.updatedAt.length > SCORE_VALIDATION_LIMITS.updatedAtCharacters) {
    errors.push(`Score updatedAt exceeds the ${SCORE_VALIDATION_LIMITS.updatedAtCharacters}-character safety limit.`);
  }

  const rawMeasureOrder = candidate.measureOrder;
  const measureOrder: string[] = [];
  const orderedMeasureIds = new Set<string>();
  if (!Array.isArray(rawMeasureOrder) || !rawMeasureOrder.length) {
    errors.push("At least one measure is required.");
  } else {
    rawMeasureOrder.forEach((value, index) => {
      if (!isNonEmptyString(value)) {
        errors.push(`Measure order entry ${index + 1} must be a non-empty string ID.`);
        return;
      }
      if (value.length > SCORE_VALIDATION_LIMITS.idCharacters) {
        errors.push(`Measure order entry ${index + 1} exceeds the ${SCORE_VALIDATION_LIMITS.idCharacters}-character ID safety limit.`);
        return;
      }
      if (orderedMeasureIds.has(value)) {
        errors.push(`Measure order contains duplicate ID "${value}".`);
        return;
      }
      orderedMeasureIds.add(value);
      measureOrder.push(value);
    });
  }

  const measures = isValidationRecord(candidate.measures) ? candidate.measures : null;
  if (!measures) errors.push("Score measures must be an object.");
  const measureCapacities = new Map<string, number>();
  const measureNumbers = new Map<string, number>();
  if (measures) {
    for (const measureId of measureOrder) {
      if (!Object.prototype.hasOwnProperty.call(measures, measureId)) {
        errors.push(`Missing measure ${measureId}.`);
        continue;
      }
      const measure = measures[measureId];
      if (!isValidationRecord(measure)) {
        errors.push(`Measure ${measureId} must be an object.`);
        continue;
      }
      if (measure.id !== measureId) errors.push(`Measure ${measureId} must store the same ID in its metadata.`);
      if (!isSafeIntegerInRange(measure.number, 0, Number.MAX_SAFE_INTEGER)) {
        errors.push(`Measure ${measureId} has an invalid measure number; use a non-negative integer.`);
      } else {
        measureNumbers.set(measureId, measure.number);
      }
      const measureLabel = isSafeIntegerInRange(measure.number, 0, Number.MAX_SAFE_INTEGER) ? measure.number : measureId;
      const time = isValidationRecord(measure.time) ? measure.time : null;
      const timeIsValid = Boolean(
        time &&
        isSafeIntegerInRange(time.numerator, 1, 255) &&
        isSafeIntegerInRange(time.denominator, 1, Number.MAX_SAFE_INTEGER),
      );
      if (!timeIsValid) {
        errors.push(`Measure ${measureLabel} has an invalid time signature; numerator must be an integer from 1 through 255 and denominator must be a positive integer.`);
      } else {
        if (!Number.isInteger(Math.log2(time!.denominator as number))) {
          errors.push(`Measure ${measureLabel} has an invalid time signature; the beat-type denominator must be a power of two.`);
          continue;
        }
        const capacity = (time!.numerator as number) * TICKS_PER_WHOLE / (time!.denominator as number);
        if (!Number.isSafeInteger(capacity) || capacity <= 0) {
          errors.push(`Measure ${measureLabel} has an invalid time-signature capacity; it must resolve to an exact integer tick count.`);
        } else {
          measureCapacities.set(measureId, capacity);
        }
      }
      if (!isKeySignature(measure.key)) {
        errors.push(`Measure ${measureLabel} has an invalid key signature; fifths must be an integer from -7 to 7 and mode must be major or minor.`);
      }
    }
  }

  const measureStartTicks = new Map<string, number>();
  let nextMeasureStartTick: number | null = 0;
  let timelineLimitReported = false;
  for (const measureId of measureOrder) {
    const capacity = measureCapacities.get(measureId);
    if (nextMeasureStartTick === null || capacity === undefined) {
      nextMeasureStartTick = null;
      continue;
    }
    measureStartTicks.set(measureId, nextMeasureStartTick);
    const followingMeasureStartTick = checkedBoundedSum(nextMeasureStartTick, capacity, SCORE_VALIDATION_LIMITS.timelineTicks);
    if (followingMeasureStartTick === null && !timelineLimitReported) {
      errors.push(`Score timeline exceeds the ${SCORE_VALIDATION_LIMITS.timelineTicks.toLocaleString("en-US")}-tick safety limit.`);
      timelineLimitReported = true;
    }
    nextMeasureStartTick = followingMeasureStartTick;
  }

  const globalIds = new Map<string, string>();
  const registerGlobalId = (value: unknown, owner: string, maximumLength: number = SCORE_VALIDATION_LIMITS.idCharacters): string | null => {
    if (!isNonEmptyString(value)) {
      errors.push(`${owner} must have a non-empty string ID.`);
      return null;
    }
    if (value.length > maximumLength) {
      errors.push(`${owner} exceeds the ${maximumLength.toLocaleString("en-US")}-character ID safety limit.`);
      return null;
    }
    const previousOwner = globalIds.get(value);
    if (previousOwner) errors.push(`Duplicate ID "${value}" is used by ${previousOwner} and ${owner}.`);
    else globalIds.set(value, owner);
    return value;
  };

  const noteIds = new Set<string>();
  const notePitches = new Map<string, Pitch>();
  const noteLocations = new Map<string, TieNoteLocation>();
  const rawParts = candidate.parts;
  if (!Array.isArray(rawParts) || !rawParts.length) errors.push("At least one instrument is required.");
  if (Array.isArray(rawParts)) rawParts.forEach((rawPart, partIndex) => {
    const genericPartLabel = `Part ${partIndex + 1}`;
    if (!isValidationRecord(rawPart)) {
      errors.push(`${genericPartLabel} must be an object.`);
      return;
    }
    const partName = isNonEmptyString(rawPart.name) ? rawPart.name : null;
    const partLabel = partName && partName.length <= SCORE_VALIDATION_LIMITS.nameCharacters ? partName : genericPartLabel;
    registerGlobalId(rawPart.id, partLabel);
    if (!partName) errors.push(`${genericPartLabel} must have a name.`);
    else if (partName.length > SCORE_VALIDATION_LIMITS.nameCharacters) {
      errors.push(`${genericPartLabel} name exceeds the ${SCORE_VALIDATION_LIMITS.nameCharacters}-character safety limit.`);
    }
    if (typeof rawPart.shortName !== "string") errors.push(`${partLabel} must have a short name string.`);
    else if (rawPart.shortName.length > SCORE_VALIDATION_LIMITS.shortNameCharacters) {
      errors.push(`${partLabel} short name exceeds the ${SCORE_VALIDATION_LIMITS.shortNameCharacters}-character safety limit.`);
    }
    if (typeof rawPart.muted !== "boolean" || typeof rawPart.solo !== "boolean") {
      errors.push(`${partLabel} must store boolean muted and solo states.`);
    }

    const instrument = isValidationRecord(rawPart.instrument) ? rawPart.instrument : null;
    if (!instrument) {
      errors.push(`${partLabel} has an invalid instrument snapshot.`);
    } else {
      const stringLimits = {
        catalogId: SCORE_VALIDATION_LIMITS.idCharacters,
        family: SCORE_VALIDATION_LIMITS.nameCharacters,
        name: SCORE_VALIDATION_LIMITS.nameCharacters,
        shortName: SCORE_VALIDATION_LIMITS.shortNameCharacters,
        color: SCORE_VALIDATION_LIMITS.colorCharacters,
      } as const;
      const stringFields = Object.keys(stringLimits) as Array<keyof typeof stringLimits>;
      if (stringFields.some((field) => !isNonEmptyString(instrument[field]) || (instrument[field] as string).length > stringLimits[field]) ||
        (typeof instrument.color === "string" && !VALID_INSTRUMENT_COLOR.test(instrument.color)) ||
        !VALID_CLEFS.has(instrument.clef as Clef) ||
        !isSafeIntegerInRange(instrument.midiProgram, 0, 127)) {
        errors.push(`${partLabel} has an invalid instrument snapshot.`);
      }
      stringFields.forEach((field) => {
        const value = instrument[field];
        if (typeof value === "string" && value.length > stringLimits[field]) {
          errors.push(`${partLabel} instrument ${field} exceeds the ${stringLimits[field]}-character safety limit.`);
        }
      });
      if (typeof instrument.color === "string" && instrument.color.length <= SCORE_VALIDATION_LIMITS.colorCharacters && !VALID_INSTRUMENT_COLOR.test(instrument.color)) {
        errors.push(`${partLabel} instrument color must use the safe #RRGGBB hexadecimal format.`);
      }
      const transposition = isValidationRecord(instrument.transposition) ? instrument.transposition : null;
      if (!transposition ||
        !isSafeIntegerInRange(transposition.diatonic, -96, 96) ||
        !isSafeIntegerInRange(transposition.chromatic, -96, 96) ||
        !isSafeIntegerInRange(transposition.octaveChange, -8, 8)) {
        errors.push(`${partLabel} has an invalid transposition snapshot.`);
      }
    }

    const rawStaves = rawPart.staves;
    if (!Array.isArray(rawStaves) || !rawStaves.length) {
      errors.push(`${partLabel} has no playable staff.`);
      return;
    }
    rawStaves.forEach((rawStaff, staffIndex) => {
      const staffLabel = rawStaves.length > 1 ? `${partLabel}, staff ${staffIndex + 1}` : partLabel;
      if (!isValidationRecord(rawStaff)) {
        errors.push(`${staffLabel} must be an object.`);
        return;
      }
      registerGlobalId(rawStaff.id, `${staffLabel} ID`);
      if (!VALID_CLEFS.has(rawStaff.clef as Clef)) errors.push(`${staffLabel} has an invalid clef.`);
      const staffMeasures = isValidationRecord(rawStaff.measures) ? rawStaff.measures : null;
      if (!staffMeasures) {
        errors.push(`${staffLabel} measures must be an object.`);
        return;
      }

      for (const measureId of measureOrder) {
        const measureNumber = measureNumbers.get(measureId) ?? measureId;
        if (!Object.prototype.hasOwnProperty.call(staffMeasures, measureId)) {
          errors.push(`${staffLabel} is missing ordered measure ${measureNumber}.`);
          continue;
        }
        const rawStaffMeasure = staffMeasures[measureId];
        if (!isValidationRecord(rawStaffMeasure)) {
          errors.push(`${staffLabel}, measure ${measureNumber} must be an object.`);
          continue;
        }
        const rawVoices = rawStaffMeasure.voices;
        if (!Array.isArray(rawVoices) || !rawVoices.length) {
          errors.push(`${staffLabel}, measure ${measureNumber} must contain at least one voice.`);
          continue;
        }

        if (rawVoices.length !== 1) {
          errors.push(`${staffLabel}, measure ${measureNumber} must contain exactly one editable voice in schema version 1.`);
        }

        rawVoices.forEach((rawVoice, voiceIndex) => {
          const voiceLabel = `${staffLabel}, measure ${measureNumber}, voice ${voiceIndex + 1}`;
          if (!isValidationRecord(rawVoice)) {
            errors.push(`${voiceLabel} must be an object.`);
            return;
          }
          registerGlobalId(rawVoice.id, `${voiceLabel} ID`, SCORE_VALIDATION_LIMITS.voiceIdCharacters);
          const rawEvents = rawVoice.events;
          if (!Array.isArray(rawEvents)) {
            errors.push(`${voiceLabel} events must be an array.`);
            return;
          }

          let usedTicks = 0;
          let rhythmIsValid = true;
          let timelineIsValid = measureStartTicks.has(measureId);
          rawEvents.forEach((rawEvent, eventIndex) => {
            const eventLabel = `${voiceLabel}, event ${eventIndex + 1}`;
            if (!isValidationRecord(rawEvent)) {
              errors.push(`${eventLabel} must be an object.`);
              rhythmIsValid = false;
              timelineIsValid = false;
              return;
            }
            registerGlobalId(rawEvent.id, `${eventLabel} ID`);

            if (Object.prototype.hasOwnProperty.call(rawEvent, "rest")) {
              errors.push(`${eventLabel} must not contain the legacy rest flag; use the event kind discriminator.`);
            }

            if (Object.prototype.hasOwnProperty.call(rawEvent, "dynamic") &&
              !VALID_DYNAMIC_MARKINGS.has(rawEvent.dynamic as DynamicMarking)) {
              errors.push(`${eventLabel} has an invalid dynamic marking; use ppp, pp, p, mp, mf, f, ff, or fff.`);
            }

            let eventStartTick: number | null = null;
            let eventEndTick: number | null = null;
            const duration = isValidationRecord(rawEvent.duration) ? rawEvent.duration : null;
            if (!duration || !VALID_DURATION_BASES.has(duration.base as number) || !VALID_DOT_COUNTS.has(duration.dots as number)) {
              errors.push(`${eventLabel} has an invalid duration; base must be 1, 2, 4, 8, 16, 32, or 64 and dots must be 0, 1, or 2.`);
              rhythmIsValid = false;
              timelineIsValid = false;
            } else {
              // Only validated duration values reach arithmetic. This keeps malformed JSON
              // from producing NaN/Infinity or throwing inside voiceTicks/durationTicks.
              const ticks = durationTicks({ base: duration.base as DurationBase, dots: duration.dots as DurationValue["dots"] });
              if (!Number.isSafeInteger(ticks) || ticks <= 0) {
                errors.push(`${eventLabel} has a duration that cannot be represented safely.`);
                rhythmIsValid = false;
                timelineIsValid = false;
              } else {
                const followingUsedTicks = checkedBoundedSum(usedTicks, ticks, Number.MAX_SAFE_INTEGER);
                if (followingUsedTicks === null) {
                  errors.push(`${eventLabel} makes its voice timeline exceed the safe integer range.`);
                  rhythmIsValid = false;
                  timelineIsValid = false;
                  return;
                }
                if (timelineIsValid) {
                  const measureStartTick = measureStartTicks.get(measureId)!;
                  const startTick = checkedBoundedSum(measureStartTick, usedTicks, Number.MAX_SAFE_INTEGER);
                  const endTick = startTick === null ? null : checkedBoundedSum(startTick, ticks, Number.MAX_SAFE_INTEGER);
                  if (startTick !== null && endTick !== null) {
                    eventStartTick = startTick;
                    eventEndTick = endTick;
                  } else {
                    timelineIsValid = false;
                  }
                }
                usedTicks = followingUsedTicks;
              }
            }

            const hasEventPitch = Object.prototype.hasOwnProperty.call(rawEvent, "pitch");
            if (rawEvent.kind === "rest") {
              if (hasEventPitch) errors.push(`${eventLabel} is a rest and must not contain pitch data.`);
              if (Object.prototype.hasOwnProperty.call(rawEvent, "notes")) errors.push(`${eventLabel} is a rest and must not contain note data.`);
              return;
            }
            if (rawEvent.kind !== "note") {
              if (hasEventPitch) errors.push(`${eventLabel} must not contain event-level pitch data; pitches belong to note entries.`);
              errors.push(`${eventLabel} has an invalid event kind.`);
              return;
            }
            if (hasEventPitch) errors.push(`${eventLabel} is a note event and must not contain event-level pitch data; pitches belong to note entries.`);
            const rawNotes = rawEvent.notes;
            if (!Array.isArray(rawNotes) || !rawNotes.length) {
              errors.push(`${eventLabel} must contain at least one note.`);
              return;
            }
            const writtenPitches = new Set<string>();
            rawNotes.forEach((rawNote, noteIndex) => {
              const noteLabel = `${eventLabel}, note ${noteIndex + 1}`;
              if (!isValidationRecord(rawNote)) {
                errors.push(`${noteLabel} must be an object.`);
                return;
              }
              const noteId = registerGlobalId(rawNote.id, `${noteLabel} ID`, SCORE_VALIDATION_LIMITS.noteIdCharacters);
              if (noteId) {
                noteIds.add(noteId);
                if (eventStartTick !== null && eventEndTick !== null && !noteLocations.has(noteId)) {
                  noteLocations.set(noteId, { partIndex, staffIndex, voiceIndex, eventStartTick, eventEndTick });
                }
              }
              if (!VALID_ACCIDENTAL_DISPLAYS.has(rawNote.accidentalDisplay as ScoreNote["accidentalDisplay"])) {
                errors.push(`${noteLabel} has an invalid accidental display mode.`);
              }
              const rawPitch = isValidationRecord(rawNote.pitch) ? rawNote.pitch : null;
              if (!rawPitch ||
                !VALID_PITCH_STEPS.has(rawPitch.step as PitchStep) ||
                !isSafeIntegerInRange(rawPitch.alter, -2, 2) ||
                !isSafeIntegerInRange(rawPitch.octave, -1, 9)) {
                errors.push(`${noteLabel} has an invalid written pitch; use steps A-G, alteration -2 through 2, and an integer octave from -1 through 9.`);
              } else {
                const pitch: Pitch = {
                  step: rawPitch.step as PitchStep,
                  alter: rawPitch.alter as Pitch["alter"],
                  octave: rawPitch.octave as number,
                };
                const pitchKey = `${pitch.step}:${pitch.alter}:${pitch.octave}`;
                if (writtenPitches.has(pitchKey)) {
                  errors.push(`${noteLabel} duplicates written pitch ${pitch.step}/${pitch.alter}/${pitch.octave} within one chord event.`);
                } else {
                  writtenPitches.add(pitchKey);
                }
                if (noteId && !notePitches.has(noteId)) notePitches.set(noteId, pitch);
              }
            });
          });

          const capacity = measureCapacities.get(measureId);
          if (rhythmIsValid && capacity !== undefined) {
            if (usedTicks > capacity) errors.push(`${staffLabel}, measure ${measureNumber} exceeds its time signature.`);
            if (requireComplete && usedTicks !== capacity) errors.push(`${staffLabel}, measure ${measureNumber} is incomplete.`);
          }
        });
      }
    });
  });

  const rawTies = candidate.ties;
  const tieEdges = new Set<string>();
  const outgoingTies = new Map<string, number>();
  const incomingTies = new Map<string, number>();
  const tieAdjacency = new Map<string, Set<string>>();
  const tieIndegrees = new Map<string, number>();
  if (!Array.isArray(rawTies)) {
    errors.push("Score ties must be an array.");
  } else rawTies.forEach((rawTie, tieIndex) => {
    const tieLabel = `Tie ${tieIndex + 1}`;
    if (!isValidationRecord(rawTie)) {
      errors.push(`${tieLabel} must be an object.`);
      return;
    }
    registerGlobalId(rawTie.id, `${tieLabel} ID`, SCORE_VALIDATION_LIMITS.tieIdCharacters);
    const from = rawTie.fromNoteId;
    const to = rawTie.toNoteId;
    if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
      errors.push(`${tieLabel} must reference non-empty source and destination note IDs.`);
      return;
    }
    if (from.length > SCORE_VALIDATION_LIMITS.noteIdCharacters || to.length > SCORE_VALIDATION_LIMITS.noteIdCharacters) {
      errors.push(`${tieLabel} endpoint IDs must not exceed the ${SCORE_VALIDATION_LIMITS.noteIdCharacters}-character note-ID safety limit.`);
      return;
    }
    const edgeKey = `${from}\u0000${to}`;
    if (tieEdges.has(edgeKey)) errors.push(`${tieLabel} duplicates the tie edge from "${from}" to "${to}".`);
    else {
      tieEdges.add(edgeKey);
      const destinations = tieAdjacency.get(from) ?? new Set<string>();
      destinations.add(to);
      tieAdjacency.set(from, destinations);
      if (!tieIndegrees.has(from)) tieIndegrees.set(from, 0);
      tieIndegrees.set(to, (tieIndegrees.get(to) ?? 0) + 1);
    }
    if (outgoingTies.has(from)) errors.push(`${tieLabel} gives source note "${from}" more than one outgoing tie.`);
    else outgoingTies.set(from, tieIndex);
    if (incomingTies.has(to)) errors.push(`${tieLabel} gives destination note "${to}" more than one incoming tie.`);
    else incomingTies.set(to, tieIndex);
    if (from === to) errors.push(`${tieLabel} must connect two different notes.`);
    if (!noteIds.has(from)) errors.push(`${tieLabel} source note "${from}" does not exist.`);
    if (!noteIds.has(to)) errors.push(`${tieLabel} destination note "${to}" does not exist.`);
    const fromPitch = notePitches.get(from);
    const toPitch = notePitches.get(to);
    if (fromPitch && toPitch &&
      (fromPitch.step !== toPitch.step || fromPitch.alter !== toPitch.alter || fromPitch.octave !== toPitch.octave)) {
      errors.push(`${tieLabel} endpoints must have the same written pitch.`);
    }
    const fromLocation = noteLocations.get(from);
    const toLocation = noteLocations.get(to);
    if (fromLocation && toLocation) {
      const sameVoice = fromLocation.partIndex === toLocation.partIndex &&
        fromLocation.staffIndex === toLocation.staffIndex &&
        fromLocation.voiceIndex === toLocation.voiceIndex;
      if (!sameVoice) {
        errors.push(`${tieLabel} endpoints must belong to the same part, staff, and voice.`);
      } else if (toLocation.eventStartTick <= fromLocation.eventStartTick) {
        errors.push(`${tieLabel} destination must follow its source in the voice timeline.`);
      } else if (toLocation.eventStartTick !== fromLocation.eventEndTick) {
        errors.push(`${tieLabel} destination must be the immediately following event: its start tick must exactly equal the source event's end tick.`);
      }
    }
  });

  if (tieIndegrees.size) {
    const remainingIndegrees = new Map(tieIndegrees);
    const ready = [...remainingIndegrees].filter(([, degree]) => degree === 0).map(([noteId]) => noteId);
    let visited = 0;
    for (let index = 0; index < ready.length; index += 1) {
      const noteId = ready[index];
      visited += 1;
      for (const destination of tieAdjacency.get(noteId) ?? []) {
        const nextDegree = (remainingIndegrees.get(destination) ?? 0) - 1;
        remainingIndegrees.set(destination, nextDegree);
        if (nextDegree === 0) ready.push(destination);
      }
    }
    if (visited < remainingIndegrees.size) errors.push("Tie graph must not contain cycles.");
  }

  return [...errors];
}

/**
 * Validates untrusted persisted/imported data without mutating it. Any hostile or
 * otherwise unreadable object shape is reported as data, never allowed to throw
 * through a save/import boundary.
 */
export function validateScore(score: unknown, requireComplete = false): string[] {
  try {
    return validateScoreStructure(score, requireComplete);
  } catch (error) {
    if (error instanceof ValidationErrorLimitReached) return error.visibleErrors;
    return ["Score contains unreadable or malformed data."];
  }
}

export function pitchName(pitch: Pitch): string {
  const accidental = pitch.alter === -2 ? "𝄫" : pitch.alter === -1 ? "♭" : pitch.alter === 1 ? "♯" : pitch.alter === 2 ? "𝄪" : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}
