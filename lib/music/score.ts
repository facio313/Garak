import { getInstrument, INSTRUMENTS, SCORE_TEMPLATES } from "./catalog";
import { removeOrphanHairpins, timedHairpins } from "./hairpins";
import type { HairpinSpan } from "./model";
import { assertKeySignature } from "./key-signatures";
import type { KeySignature } from "./key-signatures";
import type { Articulation, DurationValue, DynamicMarking, InstrumentSnapshot, MeasureMeta, MusicEvent, PartData, Pitch, ScoreDocument, ScoreNote, StaffSelector } from "./model";
import { ARTICULATIONS, DYNAMIC_MARKINGS, SCORE_VALIDATION_LIMITS, TICKS_PER_WHOLE, durationTicks, getPrimaryVoice, measureCapacity, resolveStaffIndex, validateScore, voiceTicks, writtenMidi } from "./model";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;

function cloneInstrument(catalogId: string): InstrumentSnapshot {
  const definition = getInstrument(catalogId);
  return structuredClone({
    catalogId: definition.catalogId,
    family: definition.family,
    name: definition.name,
    shortName: definition.shortName,
    clef: definition.clef,
    transposition: definition.transposition,
    midiProgram: definition.midiProgram,
    color: definition.color,
  });
}

function makePart(catalogId: string, index: number, measureIds: string[], occurrence = 1, totalOccurrences = 1): PartData {
  const definition = getInstrument(catalogId);
  const instrument = cloneInstrument(catalogId);
  const staffClefs = definition.staffClefs?.length ? [...definition.staffClefs] : [instrument.clef];
  const roman = ["I", "II", "III", "IV", "V", "VI"][occurrence - 1] ?? String(occurrence);
  const name = totalOccurrences > 1 ? `${instrument.name} ${roman}` : instrument.name;
  const partId = `part-${index + 1}-${catalogId}`;
  return {
    id: partId,
    name,
    shortName: instrument.shortName,
    instrument,
    muted: false,
    solo: false,
    staves: staffClefs.map((clef, staffIndex) => {
      const staffId = `${partId}-staff-${staffIndex + 1}`;
      const voicePrefix = staffIndex === 0 ? partId : staffId;
      return {
        id: staffId,
        clef,
        measures: Object.fromEntries(measureIds.map((measureId) => [measureId, {
          voices: [{ id: `${voicePrefix}-${measureId}-v1`, events: [] }],
        }])),
      };
    }),
  };
}

export interface CreateScoreOptions {
  seedDemo?: boolean;
  /** Instrument chosen for the single-part Solo template. */
  soloInstrumentId?: string;
  /** Concert key copied into every initial measure. */
  key?: KeySignature;
}

export function createScore(templateId?: string, seedDemo?: boolean): ScoreDocument;
export function createScore(templateId?: string, options?: CreateScoreOptions): ScoreDocument;
export function createScore(templateId: string = "chamber", seedDemoOrOptions: boolean | CreateScoreOptions = true): ScoreDocument {
  const options = typeof seedDemoOrOptions === "boolean" ? { seedDemo: seedDemoOrOptions } : seedDemoOrOptions;
  const seedDemo = options.seedDemo ?? true;
  const key = options.key ?? { fifths: 0, mode: "major" as const };
  assertKeySignature(key);
  const template = SCORE_TEMPLATES.find((item) => item.id === templateId) ?? SCORE_TEMPLATES[2];
  if (options.soloInstrumentId && !INSTRUMENTS.some((instrument) => instrument.catalogId === options.soloInstrumentId)) {
    throw new Error("Choose an instrument from the catalog.");
  }
  const instruments = template.id === "solo" && options.soloInstrumentId ? [options.soloInstrumentId] : template.instruments;
  const measureOrder = ["measure-1", "measure-2", "measure-3", "measure-4"];
  const measures = Object.fromEntries(measureOrder.map((id, index) => [id, { id, number: index + 1, time: { numerator: 4, denominator: 4 }, key: { ...key } }]));
  const occurrences = new Map<string, number>();
  const parts = instruments.map((catalogId, index) => {
    const occurrence = (occurrences.get(catalogId) ?? 0) + 1;
    occurrences.set(catalogId, occurrence);
    const totalOccurrences = instruments.filter((candidate) => candidate === catalogId).length;
    return makePart(catalogId, index, measureOrder, occurrence, totalOccurrences);
  });
  const now = new Date(0).toISOString();
  const score: ScoreDocument = {
    format: "garak-score",
    schemaVersion: 1,
    id: `score-${template.id}`,
    metadata: { title: "New morning", subtitle: template.name, composer: "Garak Composer", copyright: "" },
    tempo: 96,
    measureOrder,
    measures,
    parts,
    ties: [],
    updatedAt: now,
  };

  const motif: Pitch[] = [
    { step: "C", alter: 0, octave: 4 },
    { step: "E", alter: 0, octave: 4 },
    { step: "G", alter: 0, octave: 4 },
    { step: "D", alter: 0, octave: 5 },
  ];
  if (seedDemo) {
    score.parts.forEach((part, partIndex) => {
      const voice = part.staves[0].measures[measureOrder[0]].voices[0];
      voice.events = motif.map((pitch, eventIndex) => ({
        id: `seed-${partIndex}-${eventIndex}`,
        kind: "note" as const,
        duration: { base: 4, dots: 0 },
        notes: [{ id: `seed-note-${partIndex}-${eventIndex}`, pitch: { ...pitch, octave: Math.max(2, pitch.octave - (part.instrument.clef === "bass" ? 2 : 0)) }, accidentalDisplay: "auto" as const }],
      }));
    });
  }
  return score;
}

export function addInstrument(score: ScoreDocument, catalogId: string): ScoreDocument {
  const next = structuredClone(score);
  const usedIds = collectScoreIds(next);

  let candidateIndex = next.parts.length;
  let candidate: PartData;
  while (true) {
    candidate = makePart(catalogId, candidateIndex, next.measureOrder);
    const candidateIds = [candidate.id, ...candidate.staves.flatMap((staff) => [
      staff.id,
      ...Object.values(staff.measures).flatMap((measure) => measure.voices.map((voice) => voice.id)),
    ])];
    if (candidateIds.every((id) => !usedIds.has(id))) break;
    candidateIndex += 1;
  }
  next.parts.push(candidate);
  const stamped = stamp(next);
  return validateScore(stamped).length ? score : stamped;
}

export function removeInstrument(score: ScoreDocument, partId: string): ScoreDocument {
  if (score.parts.length <= 1) return score;
  const removedPart = score.parts.find((part) => part.id === partId);
  if (!removedPart) return score;
  const removedNoteIds = new Set(removedPart.staves.flatMap((staff) => Object.values(staff.measures).flatMap((measure) =>
    measure.voices.flatMap((voice) => voice.events.flatMap((event) => event.kind === "note" ? event.notes.map((note) => note.id) : [])),
  )));
  const next = structuredClone(score);
  next.parts = next.parts.filter((part) => part.id !== partId);
  next.ties = next.ties.filter((tie) => !removedNoteIds.has(tie.fromNoteId) && !removedNoteIds.has(tie.toNoteId));
  return stamp(next);
}

export function updatePart(score: ScoreDocument, partId: string, update: Partial<Pick<PartData, "name" | "shortName" | "muted" | "solo">>): ScoreDocument {
  const next = structuredClone(score);
  const part = next.parts.find((item) => item.id === partId);
  if (part) Object.assign(part, update);
  return stamp(next);
}

/** Replaces the concert key in all measures, preserving one global-score editing operation. */
export function setScoreKey(score: ScoreDocument, key: KeySignature): ScoreDocument {
  assertKeySignature(key);
  const next = structuredClone(score);
  next.measureOrder.forEach((measureId) => { next.measures[measureId].key = { ...key }; });
  return stamp(next);
}

/** Sets a concert-key change at a specific measure without mutating the source score. */
export function setMeasureKey(score: ScoreDocument, measureId: string, key: KeySignature): ScoreDocument {
  assertKeySignature(key);
  if (!score.measures[measureId]) return score;
  const next = structuredClone(score);
  next.measures[measureId].key = { ...key };
  return stamp(next);
}

export interface MeasureRangeChangeResult {
  score: ScoreDocument;
  changed: boolean;
  measureId: string | null;
  affectedMeasureIds: string[];
  error?: string;
}

function sameKey(first: KeySignature, second: KeySignature): boolean {
  return first.fifths === second.fifths && first.mode === second.mode;
}

function sameTime(first: MeasureMeta["time"], second: MeasureMeta["time"]): boolean {
  return first.numerator === second.numerator && first.denominator === second.denominator;
}

/**
 * Finds the effective-value run beginning at a chosen measure. Garak stores the
 * effective key and meter on every measure, while notation boundaries are
 * derived by comparing adjacent measures. Editing therefore continues until
 * the next already-existing boundary instead of erasing a later change.
 */
function measureRunFrom<T>(
  score: ScoreDocument,
  measureId: string,
  read: (measure: MeasureMeta) => T,
  equal: (first: T, second: T) => boolean,
): string[] {
  const startIndex = score.measureOrder.indexOf(measureId);
  const startMeasure = score.measures[measureId];
  if (startIndex < 0 || !startMeasure) return [];
  const initial = read(startMeasure);
  const ids: string[] = [];
  for (let index = startIndex; index < score.measureOrder.length; index += 1) {
    const candidateId = score.measureOrder[index];
    const candidate = score.measures[candidateId];
    if (!candidate || !equal(read(candidate), initial)) break;
    ids.push(candidateId);
  }
  return ids;
}

/** Sets a concert-key change from one measure through the next existing key-change boundary. */
export function setKeyFromMeasure(score: ScoreDocument, measureId: string, key: KeySignature): MeasureRangeChangeResult {
  try {
    assertKeySignature(key);
  } catch (error) {
    return {
      score,
      changed: false,
      measureId: null,
      affectedMeasureIds: [],
      error: error instanceof Error ? error.message : "Choose a valid concert key signature.",
    };
  }
  const affectedMeasureIds = measureRunFrom(score, measureId, (measure) => measure.key, sameKey);
  if (!affectedMeasureIds.length) {
    return { score, changed: false, measureId: null, affectedMeasureIds, error: "Choose a measure that exists in this score." };
  }
  if (sameKey(score.measures[measureId].key, key)) {
    return { score, changed: false, measureId, affectedMeasureIds: [] };
  }

  const next = structuredClone(score);
  affectedMeasureIds.forEach((id) => { next.measures[id].key = { ...key }; });
  return { score: stamp(next), changed: true, measureId, affectedMeasureIds };
}

/**
 * Sets a time-signature change without re-barring music. Every affected voice
 * is checked before cloning; if one would overflow, the exact source object is
 * returned so undo history and autosave cannot observe a partial edit.
 */
export function setTimeFromMeasure(
  score: ScoreDocument,
  measureId: string,
  time: MeasureMeta["time"],
): MeasureRangeChangeResult {
  if (!Number.isSafeInteger(time.numerator) || time.numerator <= 0 || time.numerator > 255 ||
    !Number.isSafeInteger(time.denominator) || time.denominator <= 0 ||
    !Number.isInteger(Math.log2(time.denominator))) {
    return {
      score,
      changed: false,
      measureId: null,
      affectedMeasureIds: [],
      error: "A time signature needs 1–255 whole-number beats and a power-of-two beat type.",
    };
  }
  const affectedMeasureIds = measureRunFrom(score, measureId, (measure) => measure.time, sameTime);
  if (!affectedMeasureIds.length) {
    return { score, changed: false, measureId: null, affectedMeasureIds, error: "Choose a measure that exists in this score." };
  }
  if (sameTime(score.measures[measureId].time, time)) {
    return { score, changed: false, measureId, affectedMeasureIds: [] };
  }

  const capacity = time.numerator * TICKS_PER_WHOLE / time.denominator;
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    return {
      score,
      changed: false,
      measureId,
      affectedMeasureIds: [],
      error: "That time signature cannot be represented safely.",
    };
  }
  const affected = new Set(affectedMeasureIds);
  for (const part of score.parts) {
    for (let staffIndex = 0; staffIndex < part.staves.length; staffIndex += 1) {
      const staff = part.staves[staffIndex];
      for (const affectedMeasureId of affectedMeasureIds) {
        const voices = staff.measures[affectedMeasureId]?.voices ?? [];
        for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex += 1) {
          const used = voiceTicks(voices[voiceIndex]);
          if (used > capacity) {
            const measureNumber = score.measures[affectedMeasureId]?.number ?? affectedMeasureId;
            return {
              score,
              changed: false,
              measureId,
              affectedMeasureIds: [],
              error: `Cannot change to ${time.numerator}/${time.denominator}: ${part.name}, staff ${staffIndex + 1}, measure ${measureNumber}, voice ${voiceIndex + 1} has more music than fits. Shorten the notes or rests in that measure, or choose a longer time signature.`,
            };
          }
        }
      }
    }
  }

  const next = structuredClone(score);
  next.measureOrder.forEach((id) => {
    if (affected.has(id)) next.measures[id].time = { ...time };
  });
  const validationError = validateScore(next)[0];
  if (validationError) {
    return {
      score,
      changed: false,
      measureId,
      affectedMeasureIds: [],
      error: `Cannot change to ${time.numerator}/${time.denominator}: ${validationError}`,
    };
  }
  return { score: stamp(next), changed: true, measureId, affectedMeasureIds };
}

function uniqueId(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let suffix = 2;
  while (used.has(`${preferred}-${suffix}`)) suffix += 1;
  const id = `${preferred}-${suffix}`;
  used.add(id);
  return id;
}

function collectScoreIds(score: ScoreDocument): Set<string> {
  const used = new Set<string>([score.id, ...score.measureOrder, ...score.ties.map((tie) => tie.id), ...(score.hairpins ?? []).map((span) => span.id)]);
  score.parts.forEach((part) => {
    used.add(part.id);
    part.staves.forEach((staff) => {
      used.add(staff.id);
      Object.values(staff.measures).forEach((measure) => measure.voices.forEach((voice) => {
        used.add(voice.id);
        voice.events.forEach((event) => {
          used.add(event.id);
          if (event.kind === "note") event.notes.forEach((note) => used.add(note.id));
        });
      }));
    });
  });
  return used;
}

function appendEmptyMeasure(score: ScoreDocument): string {
  const previousMeasureId = score.measureOrder.at(-1);
  if (!previousMeasureId) throw new Error("A score needs an existing measure before another measure can be appended.");
  const previousMeasure = score.measures[previousMeasureId];
  if (!previousMeasure) throw new Error("A score needs an existing measure before another measure can be appended.");

  const usedMeasureIds = new Set(Object.keys(score.measures));
  score.parts.forEach((part) => part.staves.forEach((staff) => Object.keys(staff.measures).forEach((id) => usedMeasureIds.add(id))));
  const nextNumber = Math.max(0, ...score.measureOrder.map((id) => score.measures[id]?.number ?? 0)) + 1;
  let serial = nextNumber;
  while (usedMeasureIds.has(`measure-${serial}`)) serial += 1;
  const measureId = `measure-${serial}`;

  const usedIds = collectScoreIds(score);

  score.measureOrder.push(measureId);
  score.measures[measureId] = {
    id: measureId,
    number: nextNumber,
    time: { ...previousMeasure.time },
    key: { ...previousMeasure.key },
  };
  score.parts.forEach((part) => part.staves.forEach((staff) => {
    const previousVoices = staff.measures[previousMeasureId]?.voices ?? [];
    const voiceCount = Math.max(1, previousVoices.length);
    staff.measures[measureId] = {
      voices: Array.from({ length: voiceCount }, (_, index) => ({
        id: uniqueId(`${staff.id}-${measureId}-v${index + 1}`, usedIds),
        events: [],
      })),
    };
  }));
  return measureId;
}

/** Adds one empty measure while carrying forward the effective score and staff structure. */
export function appendMeasure(score: ScoreDocument): ScoreDocument {
  const next = structuredClone(score);
  appendEmptyMeasure(next);
  const stamped = stamp(next);
  return validateScore(stamped).length ? score : stamped;
}

export type RemoveLastMeasureResult =
  | { score: ScoreDocument; removed: true; measureId: string; measureNumber: number }
  | { score: ScoreDocument; removed: false; measureId: string | null; error: string };

/** Removes only an empty, untied final measure and always preserves at least one measure. */
export function removeLastMeasure(score: ScoreDocument): RemoveLastMeasureResult {
  const measureId = score.measureOrder.at(-1) ?? null;
  if (!measureId || score.measureOrder.length <= 1) {
    return { score, removed: false, measureId, error: "A score must keep at least one measure." };
  }

  const events = score.parts.flatMap((part) => part.staves.flatMap((staff) =>
    (staff.measures[measureId]?.voices ?? []).flatMap((voice) => voice.events),
  ));
  const noteIds = new Set(events.flatMap((event) => event.kind === "note" ? event.notes.map((note) => note.id) : []));
  if (score.ties.some((tie) => noteIds.has(tie.fromNoteId) || noteIds.has(tie.toNoteId))) {
    return { score, removed: false, measureId, error: "Remove ties connected to the last measure before deleting it." };
  }
  if (events.length) {
    return { score, removed: false, measureId, error: "The last measure contains music. Empty it before deleting the measure." };
  }

  const next = structuredClone(score);
  next.measureOrder.pop();
  const measureNumber = next.measures[measureId].number;
  delete next.measures[measureId];
  next.parts.forEach((part) => part.staves.forEach((staff) => { delete staff.measures[measureId]; }));
  return { score: stamp(next), removed: true, measureId, measureNumber };
}

/** Finds the existing measure that the sequential-entry command will use, if one has room. */
export function findEventTargetMeasureId(
  score: ScoreDocument,
  partId: string,
  duration: DurationValue,
  staffIdOrIndex: StaffSelector = 0,
  fromMeasureId?: string,
): string | null {
  const part = score.parts.find((item) => item.id === partId);
  if (!part) return null;
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) return null;
  if (!Number.isSafeInteger(durationTicks(duration)) || durationTicks(duration) <= 0) return null;
  const start = fromMeasureId ? score.measureOrder.indexOf(fromMeasureId) : 0;
  if (start < 0) return null;
  return score.measureOrder.slice(start).find((measureId) => {
    const voice = getPrimaryVoice(part, measureId, staffIndex);
    return voiceTicks(voice) < measureCapacity(score.measures[measureId]);
  }) ?? null;
}

export function appendEvent(
  score: ScoreDocument,
  partId: string,
  event: MusicEvent,
  staffIdOrIndex: StaffSelector = 0,
  fromMeasureId?: string,
): { score: ScoreDocument; measureId: string | null; segmentCount?: number; error?: string } {
  const fail = (error: string) => ({ score, measureId: null, error });
  if (fromMeasureId && !score.measureOrder.includes(fromMeasureId)) return fail("The input measure is no longer available.");
  const sourceError = validateScore(score)[0];
  if (sourceError) return fail(`The note was not entered. ${sourceError}`);
  if (!Number.isSafeInteger(durationTicks(event.duration)) || durationTicks(event.duration) <= 0) return fail("Choose a supported note length.");
  const next = structuredClone(score);
  const part = next.parts.find((item) => item.id === partId);
  if (!part) return fail("Select an instrument first.");
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) return fail("Select a valid staff first.");
  let targetMeasureId = findEventTargetMeasureId(next, partId, event.duration, staffIndex, fromMeasureId);
  let source = score;
  if (!targetMeasureId) {
    const staffCount = next.parts.reduce((count, item) => count + item.staves.length, 0);
    if (next.measureOrder.length >= SCORE_VALIDATION_LIMITS.orderedMeasures
      || (next.measureOrder.length + 1) * staffCount > SCORE_VALIDATION_LIMITS.staffMeasureCells) return fail("This note needs more measures than the score safety limit allows.");
    targetMeasureId = appendEmptyMeasure(next);
    source = structuredClone(next);
  }
  const voice = part.staves[staffIndex].measures[targetMeasureId]?.voices[0];
  if (!voice) return fail("The selected staff is missing measure structure.");
  const remaining = measureCapacity(next.measures[targetMeasureId]) - voiceTicks(voice);
  voice.events.push(event);
  let segmentCount = 1;
  if (durationTicks(event.duration) > remaining) {
    const found = findExactEventTarget(next, partId, staffIndex, targetMeasureId, event.id);
    if (found.error !== undefined) return fail(found.error);
    const reflow = reflowTiedDuration(source, next, found.target, targetMeasureId, undefined, durationTicks(event.duration));
    if (reflow.error !== undefined) return fail(reflow.error);
    segmentCount = reflow.segmentCount;
  }
  const stamped = stamp(next);
  const validationError = validateScore(stamped)[0];
  return validationError
    ? fail(`The note was not entered. ${validationError}`)
    : { score: stamped, measureId: targetMeasureId, segmentCount };
}

/**
 * Starts at the clicked measure's tail. Overflow splits across barlines;
 * a full clicked measure is rejected rather than silently choosing another.
 */
export function appendEventToMeasure(
  score: ScoreDocument,
  partId: string,
  measureId: string,
  event: MusicEvent,
  staffIdOrIndex: StaffSelector = 0,
): { score: ScoreDocument; measureId: string | null; segmentCount?: number; error?: string } {
  const sourceMeasure = score.measures[measureId];
  if (!sourceMeasure || !score.measureOrder.includes(measureId)) {
    return { score, measureId: null, error: "The clicked measure is no longer available." };
  }

  const next = structuredClone(score);
  const part = next.parts.find((item) => item.id === partId);
  if (!part) return { score, measureId: null, error: "Select an instrument first." };
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) return { score, measureId: null, error: "Select a valid staff first." };
  const voice = part.staves[staffIndex].measures[measureId]?.voices[0];
  if (!voice) return { score, measureId: null, error: "The selected staff is missing measure structure." };

  const remainingTicks = measureCapacity(sourceMeasure) - voiceTicks(voice);
  if (durationTicks(event.duration) > remainingTicks) {
    if (remainingTicks > 0) return appendEvent(score, partId, event, staffIdOrIndex, measureId);
    return {
      score,
      measureId: null,
      error: `Measure ${sourceMeasure.number} does not have room for that duration. Choose a shorter value or click another measure.`,
    };
  }

  voice.events.push(event);
  const stamped = stamp(next);
  const validationError = validateScore(stamped)[0];
  return validationError
    ? { score, measureId: null, error: `The note was not entered because the score reached its safety limit. ${validationError}` }
    : { score: stamped, measureId };
}

export type AddChordToneResult =
  | {
      score: ScoreDocument;
      added: true;
      measureId: string;
      eventId: string;
      noteId: string;
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      added: false;
      measureId: string | null;
      eventId: string | null;
      noteId: null;
      error: string;
    };

/** Adds one written pitch to the selected staff's latest event without advancing musical time. */
export function addChordTone(
  score: ScoreDocument,
  partId: string,
  note: ScoreNote,
  staffIdOrIndex: StaffSelector = 0,
): AddChordToneResult {
  const part = score.parts.find((item) => item.id === partId);
  if (!part) {
    return { score, added: false, measureId: null, eventId: null, noteId: null, error: "Select an instrument first." };
  }
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) {
    return { score, added: false, measureId: null, eventId: null, noteId: null, error: "Select a valid staff first." };
  }

  let target: { measureId: string; eventIndex: number; event: MusicEvent } | null = null;
  for (let measureIndex = score.measureOrder.length - 1; measureIndex >= 0; measureIndex -= 1) {
    const measureId = score.measureOrder[measureIndex];
    const events = part.staves[staffIndex].measures[measureId]?.voices[0]?.events;
    if (!events?.length) continue;
    const eventIndex = events.length - 1;
    target = { measureId, eventIndex, event: events[eventIndex] };
    break;
  }

  if (!target) {
    return { score, added: false, measureId: null, eventId: null, noteId: null, error: "Enter a note before adding a chord tone." };
  }
  if (target.event.kind === "rest") {
    return {
      score,
      added: false,
      measureId: target.measureId,
      eventId: target.event.id,
      noteId: null,
      error: "The last event is a rest. Enter a note before adding a chord tone.",
    };
  }

  return addChordToneToEvent(score, partId, staffIdOrIndex, target.measureId, target.event.id, note);
}

export type RemoveLastChordToneResult =
  | {
      score: ScoreDocument;
      removed: true;
      measureId: string;
      eventId: string;
      removedNote: ScoreNote;
      remainingNoteCount: number;
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      removed: false;
      measureId: string | null;
      eventId: string | null;
      removedNote: null;
      remainingNoteCount: null;
      error: string;
    };

/** Removes only the latest tone from the selected staff's latest chord without advancing musical time. */
export function removeLastChordTone(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector = 0,
): RemoveLastChordToneResult {
  const part = score.parts.find((item) => item.id === partId);
  if (!part) {
    return {
      score,
      removed: false,
      measureId: null,
      eventId: null,
      removedNote: null,
      remainingNoteCount: null,
      error: "Select an instrument first.",
    };
  }
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) {
    return {
      score,
      removed: false,
      measureId: null,
      eventId: null,
      removedNote: null,
      remainingNoteCount: null,
      error: "Select a valid staff first.",
    };
  }

  let target: { measureId: string; eventIndex: number; event: MusicEvent } | null = null;
  for (let measureIndex = score.measureOrder.length - 1; measureIndex >= 0; measureIndex -= 1) {
    const measureId = score.measureOrder[measureIndex];
    const events = part.staves[staffIndex].measures[measureId]?.voices[0]?.events;
    if (!events?.length) continue;
    const eventIndex = events.length - 1;
    target = { measureId, eventIndex, event: events[eventIndex] };
    break;
  }

  if (!target) {
    return {
      score,
      removed: false,
      measureId: null,
      eventId: null,
      removedNote: null,
      remainingNoteCount: null,
      error: "There is no event on the selected staff. Enter a chord before removing a chord tone.",
    };
  }
  if (target.event.kind === "rest") {
    return {
      score,
      removed: false,
      measureId: target.measureId,
      eventId: target.event.id,
      removedNote: null,
      remainingNoteCount: null,
      error: "The last event is a rest. Select a chord before removing a chord tone.",
    };
  }
  if (target.event.notes.length < 2) {
    return {
      score,
      removed: false,
      measureId: target.measureId,
      eventId: target.event.id,
      removedNote: null,
      remainingNoteCount: null,
      error: "The last note event needs at least two tones before a chord tone can be removed.",
    };
  }

  const next = structuredClone(score);
  const nextEvent = next.parts.find((item) => item.id === partId)!
    .staves[staffIndex].measures[target.measureId].voices[0].events[target.eventIndex];
  if (nextEvent.kind !== "note" || nextEvent.notes.length < 2) {
    return {
      score,
      removed: false,
      measureId: target.measureId,
      eventId: target.event.id,
      removedNote: null,
      remainingNoteCount: null,
      error: "The last chord is not available for tone removal.",
    };
  }
  const removedNote = nextEvent.notes.pop()!;
  next.ties = next.ties.filter((tie) => tie.fromNoteId !== removedNote.id && tie.toNoteId !== removedNote.id);
  return {
    score: stamp(next),
    removed: true,
    measureId: target.measureId,
    eventId: target.event.id,
    removedNote,
    remainingNoteCount: nextEvent.notes.length,
  };
}

interface ExactEventTarget {
  partIndex: number;
  staffIndex: number;
  staffId: string;
  voiceIndex: number;
  eventIndex: number;
  event: MusicEvent;
}

type ExactEventTargetResult = { target: ExactEventTarget; error?: undefined } | { target?: undefined; error: string };

function findExactEventTarget(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
): ExactEventTargetResult {
  const partIndex = score.parts.findIndex((candidate) => candidate.id === partId);
  if (partIndex < 0) return { error: `Instrument part "${partId}" does not exist.` };
  const part = score.parts[partIndex];
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) {
    return { error: `Staff selector "${String(staffIdOrIndex)}" does not identify a staff on instrument part "${partId}".` };
  }
  if (!score.measureOrder.includes(measureId) || !score.measures[measureId]) {
    return { error: `Measure "${measureId}" does not exist in this score.` };
  }

  const staff = part.staves[staffIndex];
  const staffMeasure = staff.measures[measureId];
  if (!staffMeasure) return { error: `Staff "${staff.id}" is missing measure "${measureId}".` };
  const matches = staffMeasure.voices.flatMap((voice, voiceIndex) =>
    voice.events.flatMap((event, eventIndex) => event.id === eventId ? [{ voiceIndex, eventIndex, event }] : []),
  );
  if (!matches.length) return { error: `Event "${eventId}" does not exist in measure "${measureId}" on staff "${staff.id}".` };
  if (matches.length > 1) return { error: `Event ID "${eventId}" is ambiguous in measure "${measureId}" on staff "${staff.id}".` };
  return { target: { partIndex, staffIndex, staffId: staff.id, ...matches[0] } };
}

export interface EventNotationUpdate {
  duration?: DurationValue;
  pitch?: Pitch;
  /** Required when changing one pitch in a chord; omitted for single notes. */
  noteId?: string;
}

export type EditEventNotationResult =
  | { score: ScoreDocument; changed: boolean; durationReflow?: { segmentCount: number }; error?: undefined }
  | { score: ScoreDocument; changed: false; durationReflow?: undefined; error: string };

/** Includes the selected note and every note joined to it by incoming or outgoing ties. */
export function getTiedNoteIds(score: ScoreDocument, noteId: string): string[] {
  const exists = score.parts.some((part) => part.staves.some((staff) =>
    Object.values(staff.measures).some((measure) => measure.voices.some((voice) =>
      voice.events.some((event) => event.kind === "note" && event.notes.some((note) => note.id === noteId)),
    )),
  ));
  if (!exists) return [];
  const neighbors = new Map<string, string[]>();
  for (const tie of score.ties) {
    const from = neighbors.get(tie.fromNoteId) ?? [];
    from.push(tie.toNoteId);
    neighbors.set(tie.fromNoteId, from);
    const to = neighbors.get(tie.toNoteId) ?? [];
    to.push(tie.fromNoteId);
    neighbors.set(tie.toNoteId, to);
  }
  const connected = [noteId];
  const visited = new Set(connected);
  for (let index = 0; index < connected.length; index += 1) {
    for (const neighbor of neighbors.get(connected[index]) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      connected.push(neighbor);
    }
  }
  return connected;
}

const REFLOW_DURATIONS = ([1, 2, 4, 8, 16, 32, 64] as const).flatMap((base) =>
  ([0, 1, 2] as const).map((dots) => ({ duration: { base, dots }, ticks: durationTicks({ base, dots }) })),
).sort((left, right) => right.ticks - left.ticks);

/** Finds an exact notation, including small remainders where a greedy split fails. */
function reflowDurations(ticks: number): DurationValue[] | null {
  if (!Number.isSafeInteger(ticks) || ticks <= 0 || ticks % 15) return null;
  const exact = REFLOW_DURATIONS.find((choice) => choice.ticks === ticks);
  if (exact) return [{ ...exact.duration }];
  const largest = REFLOW_DURATIONS[0];
  const prefixCount = Math.max(0, Math.floor(ticks / largest.ticks) - 1);
  const remainingUnits = (ticks - prefixCount * largest.ticks) / 15;
  const counts = Array<number>(remainingUnits + 1).fill(Infinity);
  const choices = Array<number>(remainingUnits + 1).fill(-1);
  counts[0] = 0;
  for (let units = 1; units <= remainingUnits; units += 1) {
    REFLOW_DURATIONS.forEach((choice, index) => {
      const previous = units - choice.ticks / 15;
      if (previous >= 0 && counts[previous] + 1 < counts[units]) {
        counts[units] = counts[previous] + 1;
        choices[units] = index;
      }
    });
  }
  if (!Number.isFinite(counts[remainingUnits])) return null;
  const result: DurationValue[] = Array.from({ length: prefixCount }, () => ({ ...largest.duration }));
  for (let units = remainingUnits; units > 0;) {
    const choice = REFLOW_DURATIONS[choices[units]];
    result.push({ ...choice.duration });
    units -= choice.ticks / 15;
  }
  return result;
}

/** Mutates only an uncommitted clone. Original silent gaps remain part of the shifted timeline. */
function reflowTiedDuration(
  source: ScoreDocument,
  next: ScoreDocument,
  target: ExactEventTarget,
  measureId: string,
  rangeChange?: { eventTicks: ReadonlyMap<string, number>; gapScale: number; lastMeasureId: string },
  appendedTicks = 0,
): { segmentCount: number; eventIds: string[]; error?: undefined } | { error: string } {
  const firstMeasureIndex = source.measureOrder.indexOf(measureId);
  const sourceStaff = source.parts[target.partIndex].staves[target.staffIndex];
  const nextStaff = next.parts[target.partIndex].staves[target.staffIndex];
  const usedIds = collectScoreIds(next);
  let lastMeasureIndex = firstMeasureIndex;
  for (let index = firstMeasureIndex; index < source.measureOrder.length; index += 1) {
    if (sourceStaff.measures[source.measureOrder[index]].voices[target.voiceIndex]?.events.length) lastMeasureIndex = index;
  }
  const tokens: { event: MusicEvent; ticks: number }[] = [];
  for (let index = firstMeasureIndex; index <= lastMeasureIndex; index += 1) {
    const id = source.measureOrder[index];
    const sourceVoice = sourceStaff.measures[id].voices[target.voiceIndex];
    const nextVoice = nextStaff.measures[id].voices[target.voiceIndex];
    for (const event of nextVoice.events.slice(index === firstMeasureIndex ? target.eventIndex : 0)) {
      tokens.push({ event, ticks: rangeChange?.eventTicks.get(event.id) ?? durationTicks(event.duration) });
    }
    // New entry consumes the remaining space in its starting bar before shifting
    // later events. Duration edits instead preserve the original silent gaps.
    const gap = Math.max(0, measureCapacity(source.measures[id]) - voiceTicks(sourceVoice) - (index === firstMeasureIndex ? appendedTicks : 0));
    if (gap > 0 && index < lastMeasureIndex) {
      const factor = rangeChange && index < source.measureOrder.indexOf(rangeChange.lastMeasureId) ? rangeChange.gapScale : 1;
      tokens.push({ event: { id: uniqueId("reflow-rest", usedIds), kind: "rest", duration: { base: 4, dots: 0 } }, ticks: gap * factor });
    }
  }
  let position = voiceTicks({ id: "prefix", events: sourceStaff.measures[measureId].voices[target.voiceIndex].events.slice(0, target.eventIndex) });
  for (let index = firstMeasureIndex; index < next.measureOrder.length; index += 1) {
    const voice = nextStaff.measures[next.measureOrder[index]].voices[target.voiceIndex];
    voice.events = index === firstMeasureIndex ? voice.events.slice(0, target.eventIndex) : [];
  }
  let measureIndex = firstMeasureIndex;
  let emittedEvents = 0;
  let emittedNotes = 0;
  let selectedSegmentCount = 0;
  const selectedEventIds: string[] = [];
  const lastSegments = new Map<string, string>();
  const lastEventSegments = new Map<string, string>();
  const continuationTies: ScoreDocument["ties"] = [];
  const staffCount = next.parts.reduce((count, part) => count + part.staves.length, 0);
  for (const token of tokens) {
    let remaining = token.ticks;
    let segmentCount = 0;
    let previousNotes: ScoreNote[] | null = null;
    const originalNotes = token.event.kind === "note" ? token.event.notes : null;
    while (remaining > 0) {
      let currentId = next.measureOrder[measureIndex];
      if (position === measureCapacity(next.measures[currentId])) {
        measureIndex += 1;
        position = 0;
        if (measureIndex === next.measureOrder.length) {
          if (next.measureOrder.length >= SCORE_VALIDATION_LIMITS.orderedMeasures
            || (next.measureOrder.length + 1) * staffCount > SCORE_VALIDATION_LIMITS.staffMeasureCells) {
            return { error: "This duration needs more measures than the score safety limit allows." };
          }
          appendEmptyMeasure(next);
        }
        currentId = next.measureOrder[measureIndex];
      }
      const chunk = Math.min(remaining, measureCapacity(next.measures[currentId]) - position);
      const durations = reflowDurations(chunk);
      if (!durations) return { error: "This edit needs a split shorter than the supported note values. Choose a length or dot value that can be written exactly; no music was changed." };
      for (const duration of durations) {
        emittedEvents += 1;
        emittedNotes += token.event.kind === "note" ? token.event.notes.length : 0;
        if (emittedEvents > SCORE_VALIDATION_LIMITS.events || emittedNotes > SCORE_VALIDATION_LIMITS.notes) {
          return { error: "This duration creates more notation than the score safety limit allows." };
        }
        const segment = structuredClone(token.event);
        segment.duration = duration;
        if (token.event.rhythmGroupId || remaining > chunk || durations.length > 1 || segmentCount > 0) segment.rhythmGroupId = token.event.rhythmGroupId ?? token.event.id;
        if (segmentCount > 0) {
          segment.id = uniqueId("reflow-event", usedIds);
          delete segment.dynamic;
          if (segment.kind === "note") {
            delete segment.articulation;
            segment.notes = segment.notes.map((note) => ({ ...note, id: uniqueId("reflow-note", usedIds), accidentalDisplay: "auto" }));
          }
        }
        lastEventSegments.set(token.event.id, segment.id);
        if (segment.kind === "note" && originalNotes) {
          segment.notes.forEach((note, index) => {
            lastSegments.set(originalNotes[index].id, note.id);
            if (previousNotes) continuationTies.push({ id: uniqueId("reflow-tie", usedIds), fromNoteId: previousNotes[index].id, toNoteId: note.id });
          });
          previousNotes = segment.notes;
        }
        nextStaff.measures[currentId].voices[target.voiceIndex].events.push(segment);
        if (rangeChange?.eventTicks.has(token.event.id)) selectedEventIds.push(segment.id);
        position += durationTicks(duration);
        segmentCount += 1;
      }
      remaining -= chunk;
    }
    if (token.event.id === target.event.id) selectedSegmentCount = segmentCount;
  }
  next.ties = next.ties.map((tie) => ({ ...tie, fromNoteId: lastSegments.get(tie.fromNoteId) ?? tie.fromNoteId }));
  next.ties.push(...continuationTies);
  if (next.hairpins) next.hairpins = next.hairpins.map((span) => ({ ...span, endEventId: lastEventSegments.get(span.endEventId) ?? span.endEventId }));
  return { segmentCount: selectedSegmentCount, eventIds: selectedEventIds };
}

interface TimedVoiceEvent {
  event: MusicEvent;
  measureId: string;
  startTick: number;
  endTick: number;
}

function timedVoiceEvents(score: ScoreDocument, target: ExactEventTarget): TimedVoiceEvent[] {
  const staff = score.parts[target.partIndex].staves[target.staffIndex];
  const events: TimedVoiceEvent[] = [];
  let measureStart = 0;
  for (const measureId of score.measureOrder) {
    let position = measureStart;
    for (const event of staff.measures[measureId].voices[target.voiceIndex]?.events ?? []) {
      const endTick = position + durationTicks(event.duration);
      events.push({ event, measureId, startTick: position, endTick });
      position = endTick;
    }
    measureStart += measureCapacity(score.measures[measureId]);
  }
  return events;
}

function connectedMoveEvents(score: ScoreDocument, events: TimedVoiceEvent[], eventId: string): TimedVoiceEvent[] {
  const noteEvents = new Map(events.flatMap(({ event }) => event.kind === "note"
    ? event.notes.map((note) => [note.id, event.id] as const) : []));
  const neighbors = new Map<string, Set<string>>();
  for (const tie of score.ties) {
    const from = noteEvents.get(tie.fromNoteId);
    const to = noteEvents.get(tie.toNoteId);
    if (!from || !to) continue;
    if (!neighbors.has(from)) neighbors.set(from, new Set());
    if (!neighbors.has(to)) neighbors.set(to, new Set());
    neighbors.get(from)!.add(to);
    neighbors.get(to)!.add(from);
  }
  const queue = [eventId];
  const included = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    for (const neighbor of neighbors.get(queue[index]) ?? []) {
      if (included.has(neighbor)) continue;
      included.add(neighbor);
      queue.push(neighbor);
    }
  }
  return events.filter(({ event }) => included.has(event.id));
}

/** A horizontal move carries a whole chord and all events reached through its tones' ties. */
export function getEventMoveGroup(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
): { eventIds: string[]; startTick: number; endTick: number; selectedStartTick: number } | null {
  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) return null;
  const group = connectedMoveEvents(score, timedVoiceEvents(score, located.target), eventId);
  const selected = group.find(({ event }) => event.id === eventId);
  if (!selected) return null;
  return {
    eventIds: group.map(({ event }) => event.id),
    startTick: group[0].startTick,
    endTick: group[group.length - 1].endTick,
    selectedStartTick: selected.startTick,
  };
}

export interface EventRange {
  eventIds: string[];
  start: { measureId: string; eventId: string; tick: number };
  end: { measureId: string; eventId: string };
  startTick: number;
  endTick: number;
  expandedForTies: boolean;
  noteEventCount: number;
}

function findStaffEventTarget(score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventId: string): ExactEventTarget | null {
  const partIndex = score.parts.findIndex((part) => part.id === partId);
  if (partIndex < 0) return null;
  const staffIndex = resolveStaffIndex(score.parts[partIndex], staffIdOrIndex);
  if (staffIndex < 0) return null;
  const staff = score.parts[partIndex].staves[staffIndex];
  for (const measureId of score.measureOrder) {
    for (const [voiceIndex, voice] of (staff.measures[measureId]?.voices ?? []).entries()) {
      const eventIndex = voice.events.findIndex((event) => event.id === eventId);
      if (eventIndex >= 0) return { partIndex, staffIndex, staffId: staff.id, voiceIndex, eventIndex, event: voice.events[eventIndex] };
    }
  }
  return null;
}

/** Expands both endpoints until every chord's tie connections fit inside the interval. */
function contiguousTiedRange(score: ScoreDocument, events: TimedVoiceEvent[], first: number, last: number): TimedVoiceEvent[] {
  const noteIndices = new Map(events.flatMap(({ event }, index) => event.kind === "note"
    ? event.notes.map((note) => [note.id, index] as const) : []));
  const neighbors = new Map<number, number[]>();
  for (const tie of score.ties) {
    const from = noteIndices.get(tie.fromNoteId);
    const to = noteIndices.get(tie.toNoteId);
    if (from === undefined || to === undefined) continue;
    neighbors.set(from, [...(neighbors.get(from) ?? []), to]);
    neighbors.set(to, [...(neighbors.get(to) ?? []), from]);
  }
  let start = Math.min(first, last);
  let end = Math.max(first, last);
  const queue = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  for (let index = 0; index < queue.length; index += 1) {
    for (const neighbor of neighbors.get(queue[index]) ?? []) {
      while (neighbor < start) queue.push(--start);
      while (neighbor > end) queue.push(++end);
    }
  }
  return events.slice(start, end + 1);
}

/** A range is chronological, belongs to one voice, and always includes complete tie groups. */
export function getEventRange(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  startEventId: string,
  endEventId: string,
): EventRange | null {
  const target = findStaffEventTarget(score, partId, staffIdOrIndex, startEventId);
  if (!target) return null;
  const events = timedVoiceEvents(score, target);
  const first = events.findIndex(({ event }) => event.id === startEventId);
  const last = events.findIndex(({ event }) => event.id === endEventId);
  if (first < 0 || last < 0) return null;
  const group = contiguousTiedRange(score, events, first, last);
  const start = group[0];
  const end = group[group.length - 1];
  let measureStart = 0;
  for (const id of score.measureOrder) {
    if (id === start.measureId) break;
    measureStart += measureCapacity(score.measures[id]);
  }
  return {
    eventIds: group.map(({ event }) => event.id),
    start: { measureId: start.measureId, eventId: start.event.id, tick: start.startTick - measureStart },
    end: { measureId: end.measureId, eventId: end.event.id },
    startTick: start.startTick,
    endTick: end.endTick,
    expandedForTies: group.length > Math.abs(last - first) + 1,
    noteEventCount: group.filter(({ event }) => event.kind === "note").length,
  };
}

export type EventRangeEditResult =
  | { score: ScoreDocument; changed: boolean; selection: { measureId: string; eventId: string }; eventIds: string[]; error?: undefined }
  | { score: ScoreDocument; changed: false; selection?: undefined; eventIds?: undefined; error: string };

type PreparedEventRange = { target: ExactEventTarget; events: TimedVoiceEvent[]; group: TimedVoiceEvent[]; error?: undefined }
  | { target?: undefined; events?: undefined; group?: undefined; error: string };

function prepareEventRange(score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[]): PreparedEventRange {
  if (!Array.isArray(eventIds) || !eventIds.length || new Set(eventIds).size !== eventIds.length) {
    return { error: "Select a range of notes or rests first." };
  }
  const target = findStaffEventTarget(score, partId, staffIdOrIndex, eventIds[0]);
  if (!target) return { error: "The selected range is no longer available. Select the notes again." };
  const events = timedVoiceEvents(score, target);
  const indices = new Map(events.map(({ event }, index) => [event.id, index]));
  let first = events.length;
  let last = -1;
  for (const id of eventIds) {
    const index = indices.get(id);
    if (index === undefined) return { error: "Choose a range within one staff and voice. Some selected notes are no longer available." };
    first = Math.min(first, index);
    last = Math.max(last, index);
  }
  return { target, events, group: contiguousTiedRange(score, events, first, last) };
}

export function moveEventRangeToPosition(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[], targetMeasureId: string, targetTick: number,
): EventRangeEditResult {
  return transferEventRange(score, partId, staffIdOrIndex, eventIds, targetMeasureId, targetTick, "move");
}

/** The copy receives new event, note, and tie IDs, so later edits cannot alter the source. */
export function copyEventRangeToPosition(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[], targetMeasureId: string, targetTick: number,
): EventRangeEditResult {
  return transferEventRange(score, partId, staffIdOrIndex, eventIds, targetMeasureId, targetTick, "copy");
}

export type EventRangeDurationChange = { scale: 0.5 | 2; dots?: never } | { dots: DurationValue["dots"]; scale?: never };

export type EventRangeExpressionChange = { dynamic: DynamicMarking | null; articulation?: never }
  | { articulation: Articulation | null; dynamic?: never };

export type HairpinChange = Pick<HairpinSpan, "kind" | "from" | "to">;

/** A selected passage replaces touching hairpins as one undoable edit. Rests at either edge are skipped. */
export function setEventRangeHairpin(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[], change: HairpinChange | null,
): EventRangeEditResult {
  const fail = (error: string): EventRangeEditResult => ({ score, changed: false, error });
  if (change !== null && (!change || typeof change !== "object" || Array.isArray(change))) {
    return fail("Choose crescendo or diminuendo with start and end dynamics, or remove the hairpin.");
  }
  const sourceError = validateScore(score)[0];
  if (sourceError) return fail(`The hairpin was not changed. ${sourceError}`);
  const prepared = prepareEventRange(score, partId, staffIdOrIndex, eventIds);
  if (!prepared.target) return fail(prepared.error);
  const { target, group } = prepared;
  const notes = group.filter(({ event }) => event.kind === "note");
  if (!notes.length) return fail("Select at least one note. A crescendo or diminuendo needs sounding notes.");
  const first = notes[0];
  const last = notes.at(-1)!;
  const staffId = score.parts[target.partIndex].staves[target.staffIndex].id;
  const touching = timedHairpins(score).filter((span) => span.staffId === staffId && span.startTick < last.endTick && span.endTick > first.startTick);
  const selection = { measureId: group[0].measureId, eventId: group[0].event.id };
  const ids = group.map(({ event }) => event.id);
  if (!change && !touching.length) return { score, changed: false, selection, eventIds: ids };
  const next = structuredClone(score);
  const removed = new Set(touching.map((span) => span.id));
  next.hairpins = (next.hairpins ?? []).filter((span) => !removed.has(span.id));
  if (change) {
    const span: HairpinSpan = { id: touching[0]?.id ?? uniqueId("hairpin", collectScoreIds(score)),
      startEventId: first.event.id, endEventId: last.event.id, kind: change.kind, from: change.from, to: change.to };
    if (touching.length === 1 && ["startEventId", "endEventId", "kind", "from", "to"].every((key) => span[key as keyof HairpinSpan] === touching[0][key as keyof HairpinSpan])) {
      return { score, changed: false, selection, eventIds: ids };
    }
    next.hairpins.push(span);
  }
  const error = validateScore(next)[0];
  if (error) return fail(error);
  return { score: stamp(next), changed: true, selection, eventIds: ids };
}

/** Marks each written event in the complete tied range; articulations skip rests. */
export function setEventRangeExpression(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[], change: EventRangeExpressionChange,
): EventRangeEditResult {
  const fail = (error: string): EventRangeEditResult => ({ score, changed: false, error });
  if (!change || typeof change !== "object" || Array.isArray(change) || Object.keys(change).length !== 1
    || !("dynamic" in change
      ? change.dynamic === null || (change.dynamic !== undefined && DYNAMIC_MARKINGS.includes(change.dynamic))
      : "articulation" in change && (change.articulation === null || (change.articulation !== undefined && ARTICULATIONS.includes(change.articulation))))) {
    return fail("Choose a supported dynamic or articulation, or remove its marks.");
  }
  const sourceError = validateScore(score)[0];
  if (sourceError) return fail(`Expression was not changed because the score is invalid. ${sourceError}`);
  const prepared = prepareEventRange(score, partId, staffIdOrIndex, eventIds);
  if (!prepared.target) return fail(prepared.error);
  const { target, group } = prepared;
  const ids = group.map(({ event }) => event.id);
  const selection = { measureId: group[0].measureId, eventId: group[0].event.id };
  const changedIds = new Set(group.filter(({ event }) => change.dynamic !== undefined
    ? (event.dynamic ?? null) !== change.dynamic
    : event.kind === "note" && (event.articulation ?? null) !== change.articulation).map(({ event }) => event.id));
  if (!changedIds.size) return { score, changed: false, selection, eventIds: ids };
  const next = structuredClone(score);
  const staff = next.parts[target.partIndex].staves[target.staffIndex];
  for (const measureId of new Set(group.map((item) => item.measureId))) {
    for (const event of staff.measures[measureId].voices[target.voiceIndex].events) {
      if (!changedIds.has(event.id)) continue;
      if (change.dynamic !== undefined) {
        if (change.dynamic === null) delete event.dynamic;
        else event.dynamic = change.dynamic;
      } else if (event.kind === "note") {
        if (change.articulation === null) delete event.articulation;
        else event.articulation = change.articulation;
      }
    }
  }
  return { score: stamp(next), changed: true, selection, eventIds: ids };
}

/** Resize the passage once, then rebar it and all following music without breaking ties. */
export function changeEventRangeDuration(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[], change: EventRangeDurationChange,
): EventRangeEditResult {
  const fail = (error: string): EventRangeEditResult => ({ score, changed: false, error });
  if (!change || typeof change !== "object" || Array.isArray(change) || Object.keys(change).length !== 1
    || !("scale" in change ? change.scale === 0.5 || change.scale === 2 : [0, 1, 2].includes(change.dots))) {
    return fail("Choose twice or half the length, or zero, one, or two dots.");
  }
  const sourceError = validateScore(score)[0];
  if (sourceError) return fail(`The rhythm was not changed because the score is invalid. ${sourceError}`);
  const prepared = prepareEventRange(score, partId, staffIdOrIndex, eventIds);
  if (!prepared.target) return fail(prepared.error);
  const { group } = prepared;
  // A supplied endpoint can be in the middle of a tie chain. Reflow from the expanded start.
  const first = group[0];
  const target = findStaffEventTarget(score, partId, staffIdOrIndex, first.event.id)!;
  const eventTicks = new Map(group.map(({ event }) => [event.id, change.scale !== undefined
    ? durationTicks(event.duration) * change.scale
    : durationTicks({ base: event.duration.base, dots: change.dots })]));
  const selection = { measureId: first.measureId, eventId: first.event.id };
  if (group.every(({ event }) => eventTicks.get(event.id) === durationTicks(event.duration))) {
    return { score, changed: false, selection, eventIds: group.map(({ event }) => event.id) };
  }
  for (const ticks of eventTicks.values()) {
    if (!reflowDurations(ticks)) return fail("This change would need a note shorter than the supported 64th-note values. No music was changed.");
  }
  const next = structuredClone(score);
  const result = reflowTiedDuration(score, next, target, first.measureId, {
    eventTicks, gapScale: change.scale ?? 1, lastMeasureId: group[group.length - 1].measureId,
  });
  if (result.error !== undefined) return fail(result.error);
  const error = validateScore(next)[0];
  if (error) return fail(`The rhythm was not changed. ${error}`);
  return { score: stamp(next), changed: true, selection, eventIds: result.eventIds };
}

/** One common letter displacement preserves written intervals as well as sounding intervals. */
export function transposeEventRange(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[], semitones: number,
): EventRangeEditResult {
  const fail = (error: string): EventRangeEditResult => ({ score, changed: false, error });
  if (![-12, -1, 1, 12].includes(semitones)) return fail("Choose one semitone or one octave up or down.");
  const sourceError = validateScore(score)[0];
  if (sourceError) return fail(`The range was not transposed because the score is invalid. ${sourceError}`);
  const prepared = prepareEventRange(score, partId, staffIdOrIndex, eventIds);
  if (!prepared.target) return fail(prepared.error);
  const { target, group } = prepared;
  const ids = group.map(({ event }) => event.id);
  const selection = { measureId: group[0].measureId, eventId: group[0].event.id };
  const notes = group.flatMap(({ event }) => event.kind === "note" ? event.notes : []);
  if (!notes.length) return { score, changed: false, selection, eventIds: ids };

  // Octaves keep the original spelling. For a semitone, choose the common
  // spelling with fewer accidentals, without collapsing enharmonic chord tones.
  const displacements = Math.abs(semitones) === 12 ? [semitones / 12 * 7] : [0, semitones];
  let best: { pitches: Pitch[]; cost: number } | undefined;
  for (const displacement of displacements) {
    const pitches: Pitch[] = [];
    for (const note of notes) {
      const position = note.pitch.octave * 7 + LETTERS.indexOf(note.pitch.step) + displacement;
      const octave = Math.floor(position / 7);
      const step = LETTERS[((position % 7) + 7) % 7];
      const alter = writtenMidi(note.pitch) + semitones - writtenMidi({ step, alter: 0, octave });
      if (octave < -1 || octave > 9 || alter < -2 || alter > 2) break;
      pitches.push({ step, alter: alter as Pitch["alter"], octave });
    }
    if (pitches.length !== notes.length) continue;
    const cost = pitches.reduce((sum, pitch) => sum + pitch.alter ** 2, 0);
    if (!best || cost < best.cost) best = { pitches, cost };
  }
  if (!best) return fail("This change would exceed the supported pitch or accidental range. No notes were changed; choose a smaller step or a different range.");
  const pitchesById = new Map(notes.map((note, index) => [note.id, best.pitches[index]]));
  const next = structuredClone(score);
  const staff = next.parts[target.partIndex].staves[target.staffIndex];
  for (const { measureId, event } of group) {
    const nextEvent = staff.measures[measureId].voices[target.voiceIndex].events.find((candidate) => candidate.id === event.id)!;
    if (nextEvent.kind === "note") {
      for (const note of nextEvent.notes) note.pitch = pitchesById.get(note.id)!;
    }
  }
  const error = validateScore(next)[0];
  if (error) return fail(`The range was not transposed. ${error}`);
  return { score: stamp(next), changed: true, selection, eventIds: ids };
}

function transferEventRange(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[], targetMeasureId: string, targetTick: number, mode: "move" | "copy",
): EventRangeEditResult {
  const sourceError = validateScore(score)[0];
  if (sourceError) return { score, changed: false, error: `The range was not changed because the score is invalid. ${sourceError}` };
  const prepared = prepareEventRange(score, partId, staffIdOrIndex, eventIds);
  if (!prepared.target) return { score, changed: false, error: prepared.error };
  return transferEventGroup(score, prepared.target, prepared.events, prepared.group, prepared.group[0], targetMeasureId, targetTick, mode);
}

/** Delete replaces the selection with equal rests, preserving following music and dynamics. */
export function clearEventRange(
  score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector, eventIds: string[],
): EventRangeEditResult {
  const sourceError = validateScore(score)[0];
  if (sourceError) return { score, changed: false, error: `The range was not deleted because the score is invalid. ${sourceError}` };
  const prepared = prepareEventRange(score, partId, staffIdOrIndex, eventIds);
  if (!prepared.target) return { score, changed: false, error: prepared.error };
  const { target, group } = prepared;
  const ids = new Set(group.map(({ event }) => event.id));
  const noteIds = new Set(group.flatMap(({ event }) => event.kind === "note" ? event.notes.map((note) => note.id) : []));
  const selection = { measureId: group[0].measureId, eventId: group[0].event.id };
  if (!noteIds.size) return { score, changed: false, selection, eventIds: [...ids] };
  const next = structuredClone(score);
  const staff = next.parts[target.partIndex].staves[target.staffIndex];
  for (const measureId of new Set(group.map((entry) => entry.measureId))) {
    const voice = staff.measures[measureId].voices[target.voiceIndex];
    voice.events = voice.events.map((event): MusicEvent => ids.has(event.id) && event.kind === "note"
      ? { id: event.id, kind: "rest", duration: { ...event.duration }, ...(event.dynamic ? { dynamic: event.dynamic } : {}) }
      : event);
  }
  next.ties = next.ties.filter((tie) => !noteIds.has(tie.fromNoteId) && !noteIds.has(tie.toNoteId));
  removeOrphanHairpins(next);
  const error = validateScore(next)[0];
  if (error) return { score, changed: false, error: `The range was not deleted. ${error}` };
  return { score: stamp(next), changed: true, selection, eventIds: [...ids] };
}

export type MoveEventToPositionResult =
  | { score: ScoreDocument; changed: boolean; selection: { measureId: string; eventId: string }; movedEventCount: number; error?: undefined }
  | { score: ScoreDocument; changed: false; selection?: undefined; movedEventCount?: undefined; error: string };

/**
 * Moves one connected event group in the same voice. Unrelated notes keep their
 * absolute positions; rests and implicit silence can be replaced by the group.
 * Source gaps become rests, so moving never pulls later music to the left.
 */
export function moveEventToPosition(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  sourceMeasureId: string,
  eventId: string,
  targetMeasureId: string,
  targetTick: number,
): MoveEventToPositionResult {
  const fail = (error: string): MoveEventToPositionResult => ({ score, changed: false, error });
  const sourceError = validateScore(score)[0];
  if (sourceError) return fail(`The note was not moved because the score is invalid. ${sourceError}`);
  const located = findExactEventTarget(score, partId, staffIdOrIndex, sourceMeasureId, eventId);
  if (!located.target) return fail(located.error);
  const target = located.target;
  const events = timedVoiceEvents(score, target);
  const group = connectedMoveEvents(score, events, eventId);
  const selected = group.find(({ event }) => event.id === eventId)!;
  return transferEventGroup(score, target, events, group, selected, targetMeasureId, targetTick, "move");
}

type TransferEventGroupResult =
  | { score: ScoreDocument; changed: boolean; selection: { measureId: string; eventId: string }; movedEventCount: number; eventIds: string[]; error?: undefined }
  | { score: ScoreDocument; changed: false; selection?: undefined; movedEventCount?: undefined; eventIds?: undefined; error: string };

function transferEventGroup(
  score: ScoreDocument,
  target: ExactEventTarget,
  events: TimedVoiceEvent[],
  group: TimedVoiceEvent[],
  selected: TimedVoiceEvent,
  targetMeasureId: string,
  targetTick: number,
  mode: "move" | "copy",
): TransferEventGroupResult {
  const fail = (error: string): TransferEventGroupResult => ({ score, changed: false, error });
  const pastAction = mode === "copy" ? "copied" : "moved";
  if (!score.measureOrder.includes(targetMeasureId) || !score.measures[targetMeasureId]) {
    return fail("Choose a destination measure in this score.");
  }
  if (!Number.isSafeInteger(targetTick) || targetTick < 0 || targetTick >= measureCapacity(score.measures[targetMeasureId])) {
    return fail("Choose a beat position inside the destination measure.");
  }
  const movedIds = new Set(group.map(({ event }) => event.id));
  const measureStarts = new Map<string, number>();
  let scoreEnd = 0;
  for (const id of score.measureOrder) {
    measureStarts.set(id, scoreEnd);
    scoreEnd += measureCapacity(score.measures[id]);
  }
  const delta = measureStarts.get(targetMeasureId)! + targetTick - selected.startTick;
  if (!delta && mode === "move") return { score, changed: false, selection: { measureId: selected.measureId, eventId: selected.event.id }, movedEventCount: group.length, eventIds: [...movedIds] };
  const destinationStart = group[0].startTick + delta;
  const destinationEnd = group[group.length - 1].endTick + delta;
  if (destinationStart < 0) return fail("The connected notes would begin before the score. Move them to a later beat.");
  if (destinationEnd > SCORE_VALIDATION_LIMITS.timelineTicks) return fail(`This ${mode} exceeds the score timeline safety limit.`);
  const collision = events.find(({ event, startTick, endTick }) => event.kind === "note" && (mode === "copy" || !movedIds.has(event.id))
    && startTick < destinationEnd && endTick > destinationStart);
  if (collision) return fail(`That position overlaps another note in measure ${score.measures[collision.measureId].number}. Choose an empty beat or a rest; no music was ${pastAction}.`);
  const markedRest = events.find(({ event, startTick }) => event.kind === "rest" && event.dynamic && (mode === "copy" || !movedIds.has(event.id))
    && startTick >= destinationStart && startTick < destinationEnd);
  if (markedRest) return fail(`That position would replace a rest with a dynamic marking in measure ${score.measures[markedRest.measureId].number}. Choose another beat or remove that marking first; no music was ${pastAction}.`);

  const next = structuredClone(score);
  const staffCount = next.parts.reduce((count, part) => count + part.staves.length, 0);
  while (scoreEnd < destinationEnd) {
    if (next.measureOrder.length >= SCORE_VALIDATION_LIMITS.orderedMeasures
      || (next.measureOrder.length + 1) * staffCount > SCORE_VALIDATION_LIMITS.staffMeasureCells) {
      return fail(`This ${mode} needs more measures than the score safety limit allows.`);
    }
    const id = appendEmptyMeasure(next);
    measureStarts.set(id, scoreEnd);
    scoreEnd += measureCapacity(next.measures[id]);
  }
  const nextStaff = next.parts[target.partIndex].staves[target.staffIndex];
  const sourceStaff = score.parts[target.partIndex].staves[target.staffIndex];
  const usedIds = collectScoreIds(next);
  const affectedMeasures = new Set(mode === "move" ? group.map(({ measureId }) => measureId) : []);
  for (const id of next.measureOrder) {
    const start = measureStarts.get(id)!;
    if (start < destinationEnd && start + measureCapacity(next.measures[id]) > destinationStart) affectedMeasures.add(id);
  }
  const tokens: { event: MusicEvent; startTick: number; endTick: number }[] = [];
  for (const entry of events) {
    if (mode === "move" && movedIds.has(entry.event.id)) {
      tokens.push({ event: entry.event, startTick: entry.startTick + delta, endTick: entry.endTick + delta });
    } else if (entry.event.kind === "rest" && entry.startTick < destinationEnd && entry.endTick > destinationStart) {
      if (entry.startTick < destinationStart) tokens.push({ ...entry, endTick: destinationStart });
      if (entry.endTick > destinationEnd) tokens.push({ ...entry, startTick: destinationEnd });
    } else if (affectedMeasures.has(entry.measureId)) tokens.push(entry);
  }
  let selectedEventId = selected.event.id;
  if (mode === "copy") {
    const copiedNoteIds = new Map<string, string>();
    const copiedEventIds = new Map<string, string>();
    for (const [index, entry] of group.entries()) {
      const event = structuredClone(entry.event);
      event.id = uniqueId(`copy-event-${index + 1}`, usedIds);
      copiedEventIds.set(entry.event.id, event.id);
      if (entry.event.id === selected.event.id) selectedEventId = event.id;
      if (event.kind === "note") {
        event.notes = event.notes.map((note, noteIndex) => {
          const id = uniqueId(`copy-note-${index + 1}-${noteIndex + 1}`, usedIds);
          copiedNoteIds.set(note.id, id);
          return { ...note, id };
        });
      }
      tokens.push({ event, startTick: entry.startTick + delta, endTick: entry.endTick + delta });
    }
    for (const span of score.hairpins ?? []) {
      const startEventId = copiedEventIds.get(span.startEventId);
      const endEventId = copiedEventIds.get(span.endEventId);
      if (startEventId && endEventId) (next.hairpins ??= []).push({ ...span, id: uniqueId("copy-hairpin", usedIds), startEventId, endEventId });
    }
    for (const [index, tie] of score.ties.entries()) {
      const fromNoteId = copiedNoteIds.get(tie.fromNoteId);
      const toNoteId = copiedNoteIds.get(tie.toNoteId);
      if (fromNoteId && toNoteId) next.ties.push({ id: uniqueId(`copy-tie-${index + 1}`, usedIds), fromNoteId, toNoteId });
    }
  }
  tokens.sort((left, right) => left.startTick - right.startTick);
  const placed = new Map<string, { event: MusicEvent; startTick: number; endTick: number }[]>();
  for (const id of affectedMeasures) placed.set(id, []);
  const segmentCounts = new Map<string, number>();
  const previousNotes = new Map<string, ScoreNote[]>();
  const lastSegments = new Map<string, string>();
  const lastEventSegments = new Map<string, string>();
  const continuationTies: ScoreDocument["ties"] = [];
  let emittedEvents = 0;
  let emittedNotes = 0;
  const exactError = `This ${mode} needs a rest or split shorter than the supported note values. Choose a different beat position; no music was ${pastAction}.`;
  let measureIndex = 0;
  for (const token of tokens) {
    let position = token.startTick;
    while (position < token.endTick) {
      let id = next.measureOrder[measureIndex];
      while (position >= measureStarts.get(id)! + measureCapacity(next.measures[id])) {
        measureIndex += 1;
        id = next.measureOrder[measureIndex];
      }
      const measureStart = measureStarts.get(id)!;
      const measureEnd = measureStart + measureCapacity(next.measures[id]);
      const end = Math.min(token.endTick, measureEnd);
      const durations = reflowDurations(end - position);
      if (!durations) return fail(exactError);
      for (const duration of durations) {
        const count = segmentCounts.get(token.event.id) ?? 0;
        const segment = structuredClone(token.event);
        segment.duration = duration;
        if (count > 0) {
          segment.id = uniqueId("move-event", usedIds);
          delete segment.dynamic;
          if (segment.kind === "note") {
            delete segment.articulation;
            segment.notes = segment.notes.map((note) => ({ ...note, id: uniqueId("move-note", usedIds), accidentalDisplay: "auto" }));
          }
        }
        lastEventSegments.set(token.event.id, segment.id);
        if (segment.kind === "note" && token.event.kind === "note") {
          const previous = previousNotes.get(token.event.id);
          const originalNotes = token.event.notes;
          segment.notes.forEach((note, index) => {
            lastSegments.set(originalNotes[index].id, note.id);
            if (previous) continuationTies.push({ id: uniqueId("move-tie", usedIds), fromNoteId: previous[index].id, toNoteId: note.id });
          });
          previousNotes.set(token.event.id, segment.notes);
          emittedNotes += segment.notes.length;
        }
        emittedEvents += 1;
        if (emittedEvents > SCORE_VALIDATION_LIMITS.events || emittedNotes > SCORE_VALIDATION_LIMITS.notes) {
          return fail(`This ${mode} creates more notation than the score safety limit allows.`);
        }
        const endTick = position + durationTicks(duration);
        placed.get(id)!.push({ event: segment, startTick: position - measureStart, endTick: endTick - measureStart });
        segmentCounts.set(token.event.id, count + 1);
        position = endTick;
      }
    }
  }
  for (const id of affectedMeasures) {
    const voice = nextStaff.measures[id].voices[target.voiceIndex];
    const segments = placed.get(id)!;
    const originalVoice = sourceStaff.measures[id]?.voices[target.voiceIndex];
    const endTick = Math.max(originalVoice ? voiceTicks(originalVoice) : 0, segments.at(-1)?.endTick ?? 0);
    const result: MusicEvent[] = [];
    let position = 0;
    const fillGap = (ticks: number): boolean => {
      if (!ticks) return true;
      const durations = reflowDurations(ticks);
      if (!durations) return false;
      for (const duration of durations) result.push({ id: uniqueId("move-rest", usedIds), kind: "rest", duration });
      return true;
    };
    for (const segment of segments) {
      if (!fillGap(segment.startTick - position)) return fail(exactError);
      result.push(segment.event);
      position = segment.endTick;
    }
    if (!fillGap(endTick - position)) return fail(exactError);
    voice.events = result;
  }
  next.ties = next.ties.map((tie) => ({ ...tie, fromNoteId: lastSegments.get(tie.fromNoteId) ?? tie.fromNoteId }));
  next.ties.push(...continuationTies);
  if (next.hairpins) next.hairpins = next.hairpins.map((span) => ({ ...span, endEventId: lastEventSegments.get(span.endEventId) ?? span.endEventId }));
  const validationError = validateScore(next)[0];
  if (validationError) return fail(`The selection was not ${pastAction}. ${validationError}`);
  const eventIds = timedVoiceEvents(next, target)
    .filter(({ startTick, endTick }) => startTick >= destinationStart && endTick <= destinationEnd)
    .map(({ event }) => event.id);
  return { score: stamp(next), changed: true, selection: { measureId: targetMeasureId, eventId: selectedEventId }, movedEventCount: group.length, eventIds };
}

/** Resolve generated segments without merging manually authored ties or copied groups. */
export function eventRhythm(score: ScoreDocument, partId: string, staffId: StaffSelector, measureId: string, eventId: string) {
  const located = findExactEventTarget(score, partId, staffId, measureId, eventId);
  if (!located.target) return null;
  const target = located.target;
  const single = { measureId, eventId, duration: target.event.duration, eventIds: [eventId] };
  const groupId = target.event.rhythmGroupId;
  if (!groupId) return single;
  const events = timedVoiceEvents(score, target);
  const first = events.findIndex(({ event }) => event.id === groupId && event.rhythmGroupId === groupId);
  if (first < 0) return single;
  const group = [events[first]];
  for (let i = first + 1; i < events.length; i++) {
    const previous = group.at(-1)!;
    const current = events[i];
    if (current.event.rhythmGroupId !== groupId || previous.endTick !== current.startTick || current.event.kind !== previous.event.kind) break;
    if (previous.event.kind === "note" && current.event.kind === "note") {
      const nextNotes = current.event.notes;
      if (previous.event.notes.length !== nextNotes.length || !previous.event.notes.every((note, index) => score.ties.some(tie => tie.fromNoteId === note.id && tie.toNoteId === nextNotes[index].id))) break;
    }
    group.push(current);
  }
  if (!group.some(({ event }) => event.id === eventId)) return single;
  const ticks = group.reduce((sum, { event }) => sum + durationTicks(event.duration), 0);
  const duration = REFLOW_DURATIONS.find(choice => choice.ticks === ticks)?.duration;
  return duration ? { measureId: events[first].measureId, eventId: groupId, duration, eventIds: group.map(({event}) => event.id) } : single;
}

/** Pitch edits follow the whole tie chain; duration edits move later events in the same voice. */
export function editEventNotation(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
  update: EventNotationUpdate,
): EditEventNotationResult {
  if (!update || typeof update !== "object" || Array.isArray(update)
    || Object.keys(update).some((key) => key !== "duration" && key !== "pitch" && key !== "noteId")) {
    return { score, changed: false, error: "Choose a pitch or duration to edit." };
  }
  const { duration, pitch, noteId } = update;
  if (noteId !== undefined && (typeof noteId !== "string" || !noteId.length || pitch === undefined)) {
    return { score, changed: false, error: "A note ID must identify the note whose pitch you want to change." };
  }
  if (duration !== undefined && (!duration || ![1, 2, 4, 8, 16, 32, 64].includes(duration.base)
    || ![0, 1, 2].includes(duration.dots))) {
    return { score, changed: false, error: "Choose a valid note duration and zero, one, or two dots." };
  }
  if (pitch !== undefined && (!pitch || !LETTERS.includes(pitch.step)
    || !Number.isInteger(pitch.alter) || pitch.alter < -2 || pitch.alter > 2
    || !Number.isInteger(pitch.octave) || pitch.octave < -1 || pitch.octave > 9)) {
    return { score, changed: false, error: "Choose a pitch from A–G, an accidental from double flat to double sharp, and an octave from −1 to 9." };
  }

  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) return { score, changed: false, error: located.error };
  const target = located.target;
  let noteIndex = 0;
  if (pitch !== undefined) {
    if (target.event.kind !== "note") return { score, changed: false, error: "A rest has no pitch to change." };
    if (target.event.notes.length > 1 && noteId === undefined) {
      return { score, changed: false, error: "Select a chord tone before changing its pitch." };
    }
    noteIndex = noteId === undefined ? 0 : target.event.notes.findIndex((note) => note.id === noteId);
    if (noteIndex < 0) {
      return { score, changed: false, error: "The selected note is no longer in this event. Select a note again." };
    }
    if (target.event.notes.some((note, index) => index !== noteIndex
      && note.pitch.step === pitch.step && note.pitch.alter === pitch.alter && note.pitch.octave === pitch.octave)) {
      return { score, changed: false, error: "That written pitch is already in this chord. Choose a different pitch." };
    }
  }
  const rhythm = eventRhythm(score, partId, staffIdOrIndex, measureId, eventId)!;
  if (duration && rhythm.eventId !== eventId) {
    const anchor = findExactEventTarget(score, partId, staffIdOrIndex, rhythm.measureId, rhythm.eventId).target!;
    return editEventNotation(score, partId, staffIdOrIndex, rhythm.measureId, rhythm.eventId,
      pitch && anchor.event.kind === "note" ? { ...update, noteId: anchor.event.notes[noteIndex].id } : update);
  }
  const durationChanged = duration !== undefined
    && (duration.base !== rhythm.duration.base || duration.dots !== rhythm.duration.dots);
  const pitchChanged = pitch !== undefined && target.event.kind === "note"
    && (pitch.step !== target.event.notes[noteIndex].pitch.step || pitch.alter !== target.event.notes[noteIndex].pitch.alter
      || pitch.octave !== target.event.notes[noteIndex].pitch.octave);
  const changed = durationChanged || pitchChanged;
  const next = changed ? structuredClone(score) : score;
  let durationReflow: { segmentCount: number } | undefined;
  if (changed) {
    const voice = next.parts[target.partIndex].staves[target.staffIndex].measures[measureId].voices[target.voiceIndex];
    const event = voice.events[target.eventIndex];
    if (durationChanged && duration) {
      event.duration = { base: duration.base, dots: duration.dots };
      const removedIds = new Set(rhythm.eventIds.slice(1));
      const noteMap = new Map<string, string>();
      const staff = next.parts[target.partIndex].staves[target.staffIndex];
      for (const cell of Object.values(staff.measures)) {
        const items = cell.voices[target.voiceIndex].events;
        for (const removed of items) if (removedIds.has(removed.id) && removed.kind === "note" && event.kind === "note") removed.notes.forEach((note, index) => noteMap.set(note.id, event.notes[index].id));
        cell.voices[target.voiceIndex].events = items.filter(item => !removedIds.has(item.id));
      }
      next.ties = next.ties.map(tie => ({ ...tie, fromNoteId: noteMap.get(tie.fromNoteId) ?? tie.fromNoteId, toNoteId: noteMap.get(tie.toNoteId) ?? tie.toNoteId })).filter(tie => tie.fromNoteId !== tie.toNoteId);
      if (next.hairpins) next.hairpins = next.hairpins.map(span => ({ ...span, startEventId: removedIds.has(span.startEventId) ? event.id : span.startEventId, endEventId: removedIds.has(span.endEventId) ? event.id : span.endEventId }));
    }
    if (pitchChanged && pitch && event.kind === "note") {
      const tiedNoteIds = new Set(getTiedNoteIds(score, event.notes[noteIndex].id));
      for (const part of next.parts) {
        for (const staff of part.staves) {
          for (const measure of Object.values(staff.measures)) {
            for (const voice of measure.voices) {
              for (const tiedEvent of voice.events) {
                if (tiedEvent.kind !== "note") continue;
                for (const note of tiedEvent.notes) {
                  if (tiedNoteIds.has(note.id)) note.pitch = { step: pitch.step, alter: pitch.alter, octave: pitch.octave };
                }
              }
            }
          }
        }
      }
    }
    if (durationChanged) {
      const sourceError = validateScore(score)[0];
      if (sourceError) return { score, changed: false, error: `The event was not changed because the score is invalid. ${sourceError}` };
      const result = reflowTiedDuration(score, next, target, measureId);
      if (result.error !== undefined) return { score, changed: false, error: result.error };
      durationReflow = { segmentCount: result.segmentCount };
    }
  }
  const validationErrors = validateScore(next);
  if (validationErrors.some((error) => error.includes("duplicates written pitch"))) {
    return { score, changed: false, error: "That written pitch is already present in a chord connected by this tie. Choose a different pitch or remove that tie first." };
  }
  if (validationErrors.some((error) => /^Tie\b/.test(error))) {
    return { score, changed: false, error: "This edit would break a tie. Tied notes must keep the same written pitch and remain immediately adjacent. Remove the tie before making this change." };
  }
  if (validationErrors.length) {
    return { score, changed: false, error: `The event was not changed because the score is invalid. ${validationErrors[0]}` };
  }
  return { score: changed ? stamp(next) : score, changed, ...(durationReflow ? { durationReflow } : {}) };
}

export type NoteTieDirection = "incoming" | "outgoing";

/** Adds an adjacent matching tie, or removes only the selected note's tie in one direction. */
export function setNoteTie(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
  noteId: string,
  direction: NoteTieDirection,
  enabled: boolean,
): EditEventNotationResult {
  if ((direction !== "incoming" && direction !== "outgoing") || typeof enabled !== "boolean") {
    return { score, changed: false, error: "Choose an incoming or outgoing tie to add or remove." };
  }
  const sourceError = validateScore(score)[0];
  if (sourceError) return { score, changed: false, error: `The tie was not changed because the score is invalid. ${sourceError}` };
  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) return { score, changed: false, error: located.error };
  const target = located.target;
  const selectedNote = target.event.kind === "note" ? target.event.notes.find((note) => note.id === noteId) : undefined;
  if (!selectedNote) return { score, changed: false, error: "Select a note in this event to edit its ties. Rests cannot be tied." };
  const existing = score.ties.find((tie) => direction === "incoming" ? tie.toNoteId === noteId : tie.fromNoteId === noteId);
  if (Boolean(existing) === enabled) return { score, changed: false };
  if (!enabled && existing) {
    const next = structuredClone(score);
    next.ties = next.ties.filter((tie) => tie.id !== existing.id);
    return { score: stamp(next), changed: true };
  }

  const staff = score.parts[target.partIndex].staves[target.staffIndex];
  const timeline: { event: MusicEvent; measureId: string; start: number; end: number }[] = [];
  let measureStart = 0;
  for (const id of score.measureOrder) {
    let eventStart = measureStart;
    for (const event of staff.measures[id].voices[target.voiceIndex]?.events ?? []) {
      const end = eventStart + durationTicks(event.duration);
      timeline.push({ event, measureId: id, start: eventStart, end });
      eventStart = end;
    }
    measureStart += measureCapacity(score.measures[id]);
  }
  const targetIndex = timeline.findIndex((item) => item.measureId === measureId && item.event.id === eventId);
  const current = timeline[targetIndex];
  const neighbor = timeline[targetIndex + (direction === "incoming" ? -1 : 1)];
  if (!current || !neighbor) {
    return { score, changed: false, error: `There is no ${direction === "incoming" ? "previous" : "next"} note on this staff to tie. Enter an adjacent matching note first.` };
  }
  if (neighbor.event.kind !== "note") {
    return { score, changed: false, error: "A tie cannot cross a rest. Choose adjacent notes with the same written pitch." };
  }
  if (direction === "incoming" ? neighbor.end !== current.start : current.end !== neighbor.start) {
    return { score, changed: false, error: "A tie cannot cross empty time between measures. Fill the gap so the notes are immediately adjacent." };
  }
  const matchingNote = neighbor.event.notes.find((note) => note.pitch.step === selectedNote.pitch.step
    && note.pitch.alter === selectedNote.pitch.alter && note.pitch.octave === selectedNote.pitch.octave);
  if (!matchingNote) return { score, changed: false, error: "The adjacent event has no note with the same written pitch. Match their pitch before adding a tie." };
  const fromNoteId = direction === "incoming" ? matchingNote.id : selectedNote.id;
  const toNoteId = direction === "incoming" ? selectedNote.id : matchingNote.id;
  const next = structuredClone(score);
  next.ties.push({ id: uniqueId(`tie-${fromNoteId}-${toNoteId}`, collectScoreIds(next)), fromNoteId, toNoteId });
  const validationError = validateScore(next)[0];
  if (validationError) return { score, changed: false, error: `The tie could not be added. ${validationError}` };
  return { score: stamp(next), changed: true };
}

/** Adds a pitch to the selected event, including all intact automatic rhythm segments. */
export function addChordToneToEvent(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
  note: ScoreNote,
): AddChordToneResult {
  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) {
    return { score, added: false, measureId, eventId, noteId: null, error: located.error };
  }
  if (located.target.event.kind === "rest") {
    return {
      score,
      added: false,
      measureId,
      eventId,
      noteId: null,
      error: `Event "${eventId}" in measure "${measureId}" on staff "${located.target.staffId}" is a rest and cannot receive a chord tone.`,
    };
  }
  const sameWrittenPitch = located.target.event.notes.some((existing) =>
    existing.pitch.step === note.pitch.step
    && existing.pitch.alter === note.pitch.alter
    && existing.pitch.octave === note.pitch.octave,
  );
  if (sameWrittenPitch) {
    return { score, added: false, measureId, eventId, noteId: null, error: "That written pitch is already in the chord." };
  }
  const noteIdInUse = score.parts.some((candidatePart) => candidatePart.staves.some((staff) =>
    Object.values(staff.measures).some((measure) => measure.voices.some((voice) => voice.events.some((event) =>
      event.kind === "note" && event.notes.some((existing) => existing.id === note.id),
    ))),
  ));
  if (noteIdInUse) {
    return { score, added: false, measureId, eventId, noteId: null, error: "That chord-tone ID is already in use." };
  }

  const next = structuredClone(score);
  const rhythm = eventRhythm(score, partId, staffIdOrIndex, measureId, eventId);
  const eventIds = new Set(rhythm?.eventIds ?? [eventId]);
  const usedIds = collectScoreIds(next);
  usedIds.add(note.id);
  let previousNoteId: string | undefined;
  for (const { event } of timedVoiceEvents(next, located.target)) {
    if (!eventIds.has(event.id) || event.kind !== "note") continue;
    const addedNote = { ...structuredClone(note), id: event.id === eventId ? note.id : uniqueId(`${note.id}-continuation`, usedIds) };
    event.notes.push(addedNote);
    if (previousNoteId) next.ties.push({ id: uniqueId(`tie-${previousNoteId}-${addedNote.id}`, usedIds), fromNoteId: previousNoteId, toNoteId: addedNote.id });
    previousNoteId = addedNote.id;
  }
  const stamped = stamp(next);
  const validationError = validateScore(stamped)[0];
  return validationError
    ? { score, added: false, measureId, eventId, noteId: null, error: `The chord tone was not added because the score reached its safety limit. ${validationError}` }
    : { score: stamped, added: true, measureId, eventId, noteId: note.id };
}

/** Removes a selected tone, or the last tone by default, without changing the chord's duration. */
export function removeChordToneFromEvent(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
  noteId?: string,
): RemoveLastChordToneResult {
  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) {
    return { score, removed: false, measureId, eventId, removedNote: null, remainingNoteCount: null, error: located.error };
  }
  if (located.target.event.kind === "rest") {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedNote: null,
      remainingNoteCount: null,
      error: `Event "${eventId}" in measure "${measureId}" on staff "${located.target.staffId}" is a rest, not a chord.`,
    };
  }
  if (located.target.event.notes.length < 2) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedNote: null,
      remainingNoteCount: null,
      error: "The selected note event needs at least two tones before a chord tone can be removed.",
    };
  }

  const noteIndex = noteId === undefined
    ? located.target.event.notes.length - 1
    : located.target.event.notes.findIndex((note) => note.id === noteId);
  if (noteIndex < 0) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedNote: null,
      remainingNoteCount: null,
      error: "The selected note is no longer in this chord. Select a note again.",
    };
  }

  const next = structuredClone(score);
  const nextEvent = next.parts[located.target.partIndex].staves[located.target.staffIndex]
    .measures[measureId].voices[located.target.voiceIndex].events[located.target.eventIndex];
  if (nextEvent.kind !== "note" || nextEvent.notes.length < 2) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedNote: null,
      remainingNoteCount: null,
      error: `Event "${eventId}" is not available for chord-tone removal.`,
    };
  }
  const [removedNote] = nextEvent.notes.splice(noteIndex, 1);
  next.ties = next.ties.filter((tie) => tie.fromNoteId !== removedNote.id && tie.toNoteId !== removedNote.id);
  return {
    score: stamp(next),
    removed: true,
    measureId,
    eventId,
    removedNote,
    remainingNoteCount: nextEvent.notes.length,
  };
}

export type ClearEventToRestResult =
  | {
      score: ScoreDocument;
      changed: true;
      measureId: string;
      eventId: string;
      removedTieIds: string[];
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      changed: false;
      measureId: string;
      eventId: string;
      removedTieIds: [];
      error: string;
    };

/** Replaces exactly one selected note or chord with an equal-duration rest, preserving its timeline slot. */
export function clearEventToRest(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
): ClearEventToRestResult {
  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) {
    return { score, changed: false, measureId, eventId, removedTieIds: [], error: located.error };
  }
  if (located.target.event.kind === "rest") {
    return {
      score,
      changed: false,
      measureId,
      eventId,
      removedTieIds: [],
      error: `Event "${eventId}" in measure "${measureId}" on staff "${located.target.staffId}" is already a rest.`,
    };
  }

  const removedNoteIds = new Set(located.target.event.notes.map((note) => note.id));
  const removedTieIds = score.ties
    .filter((tie) => removedNoteIds.has(tie.fromNoteId) || removedNoteIds.has(tie.toNoteId))
    .map((tie) => tie.id);
  const next = structuredClone(score);
  const nextEvents = next.parts[located.target.partIndex].staves[located.target.staffIndex]
    .measures[measureId].voices[located.target.voiceIndex].events;
  const nextEvent = nextEvents[located.target.eventIndex];
  if (nextEvent.kind !== "note") {
    return {
      score,
      changed: false,
      measureId,
      eventId,
      removedTieIds: [],
      error: `Event "${eventId}" is not available for clearing to a rest.`,
    };
  }
  nextEvents[located.target.eventIndex] = {
    id: nextEvent.id,
    kind: "rest",
    duration: nextEvent.duration,
    ...(nextEvent.dynamic === undefined ? {} : { dynamic: nextEvent.dynamic }),
  };
  next.ties = next.ties.filter((tie) => !removedNoteIds.has(tie.fromNoteId) && !removedNoteIds.has(tie.toNoteId));
  return { score: stamp(next), changed: true, measureId, eventId, removedTieIds };
}

export type SetEventDynamicResult =
  | {
      score: ScoreDocument;
      changed: boolean;
      measureId: string;
      eventId: string;
      previousDynamic: DynamicMarking | null;
      dynamic: DynamicMarking | null;
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      changed: false;
      measureId: string;
      eventId: string;
      previousDynamic: null;
      dynamic: DynamicMarking | null;
      error: string;
    };

/** Attaches, replaces, or clears a dynamic on exactly one selected note or rest event. */
export function setEventDynamic(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
  dynamic: DynamicMarking | null,
): SetEventDynamicResult {
  if (dynamic !== null && !DYNAMIC_MARKINGS.includes(dynamic)) {
    return {
      score,
      changed: false,
      measureId,
      eventId,
      previousDynamic: null,
      dynamic,
      error: "Choose ppp, pp, p, mp, mf, f, ff, fff, or none.",
    };
  }
  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) {
    return { score, changed: false, measureId, eventId, previousDynamic: null, dynamic, error: located.error };
  }

  const previousDynamic = located.target.event.dynamic ?? null;
  if (previousDynamic === dynamic) {
    return { score, changed: false, measureId, eventId, previousDynamic, dynamic };
  }
  const next = structuredClone(score);
  const nextEvent = next.parts[located.target.partIndex].staves[located.target.staffIndex]
    .measures[measureId].voices[located.target.voiceIndex].events[located.target.eventIndex];
  if (dynamic === null) delete nextEvent.dynamic;
  else nextEvent.dynamic = dynamic;
  return { score: stamp(next), changed: true, measureId, eventId, previousDynamic, dynamic };
}

export type SetEventArticulationResult =
  | {
      score: ScoreDocument;
      changed: boolean;
      measureId: string;
      eventId: string;
      previousArticulation: Articulation | null;
      articulation: Articulation | null;
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      changed: false;
      measureId: string;
      eventId: string;
      previousArticulation: null;
      articulation: Articulation | null;
      error: string;
    };

/** Attaches, replaces, or clears an articulation on exactly one selected note event. */
export function setEventArticulation(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
  articulation: Articulation | null,
): SetEventArticulationResult {
  if (articulation !== null && !ARTICULATIONS.includes(articulation)) {
    return {
      score,
      changed: false,
      measureId,
      eventId,
      previousArticulation: null,
      articulation,
      error: "Choose staccato, tenuto, accent, marcato, or none.",
    };
  }
  const located = findExactEventTarget(score, partId, staffIdOrIndex, measureId, eventId);
  if (!located.target) {
    return { score, changed: false, measureId, eventId, previousArticulation: null, articulation, error: located.error };
  }
  if (located.target.event.kind !== "note") {
    return {
      score,
      changed: false,
      measureId,
      eventId,
      previousArticulation: null,
      articulation,
      error: `Event "${eventId}" in measure "${measureId}" on staff "${located.target.staffId}" is a rest and cannot have an articulation.`,
    };
  }

  const previousArticulation = located.target.event.articulation ?? null;
  if (previousArticulation === articulation) {
    return { score, changed: false, measureId, eventId, previousArticulation, articulation };
  }
  const next = structuredClone(score);
  const nextEvent = next.parts[located.target.partIndex].staves[located.target.staffIndex]
    .measures[measureId].voices[located.target.voiceIndex].events[located.target.eventIndex];
  if (nextEvent.kind !== "note") {
    return {
      score,
      changed: false,
      measureId,
      eventId,
      previousArticulation: null,
      articulation,
      error: `Event "${eventId}" is not available for articulation editing.`,
    };
  }
  if (articulation === null) delete nextEvent.articulation;
  else nextEvent.articulation = articulation;
  return { score: stamp(next), changed: true, measureId, eventId, previousArticulation, articulation };
}

export type SetLastEventDynamicResult =
  | {
      score: ScoreDocument;
      changed: boolean;
      measureId: string;
      eventId: string;
      previousDynamic: DynamicMarking | null;
      dynamic: DynamicMarking | null;
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      changed: false;
      measureId: string | null;
      eventId: string | null;
      previousDynamic: null;
      dynamic: DynamicMarking | null;
      error: string;
    };

/** Attaches, replaces, or clears a semantic dynamic on the selected staff's latest event. */
export function setLastEventDynamic(
  score: ScoreDocument,
  partId: string,
  dynamic: DynamicMarking | null,
  staffIdOrIndex: StaffSelector = 0,
): SetLastEventDynamicResult {
  if (dynamic !== null && !DYNAMIC_MARKINGS.includes(dynamic)) {
    return {
      score,
      changed: false,
      measureId: null,
      eventId: null,
      previousDynamic: null,
      dynamic,
      error: "Choose ppp, pp, p, mp, mf, f, ff, fff, or none.",
    };
  }
  const part = score.parts.find((item) => item.id === partId);
  if (!part) {
    return {
      score,
      changed: false,
      measureId: null,
      eventId: null,
      previousDynamic: null,
      dynamic,
      error: "Select an instrument first.",
    };
  }
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) {
    return {
      score,
      changed: false,
      measureId: null,
      eventId: null,
      previousDynamic: null,
      dynamic,
      error: "Select a valid staff first.",
    };
  }

  for (let measureIndex = score.measureOrder.length - 1; measureIndex >= 0; measureIndex -= 1) {
    const measureId = score.measureOrder[measureIndex];
    const events = part.staves[staffIndex].measures[measureId]?.voices[0]?.events;
    if (!events?.length) continue;
    const eventIndex = events.length - 1;
    const event = events[eventIndex];
    const previousDynamic = event.dynamic ?? null;
    if (previousDynamic === dynamic) {
      return { score, changed: false, measureId, eventId: event.id, previousDynamic, dynamic };
    }
    const next = structuredClone(score);
    const nextEvent = next.parts.find((item) => item.id === partId)!
      .staves[staffIndex].measures[measureId].voices[0].events[eventIndex];
    if (dynamic === null) delete nextEvent.dynamic;
    else nextEvent.dynamic = dynamic;
    return { score: stamp(next), changed: true, measureId, eventId: event.id, previousDynamic, dynamic };
  }

  return {
    score,
    changed: false,
    measureId: null,
    eventId: null,
    previousDynamic: null,
    dynamic,
    error: "Enter a note or rest before adding a dynamic.",
  };
}

export type SetLastNoteArticulationResult =
  | {
      score: ScoreDocument;
      changed: boolean;
      measureId: string;
      eventId: string;
      previousArticulation: Articulation | null;
      articulation: Articulation | null;
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      changed: false;
      measureId: string | null;
      eventId: string | null;
      previousArticulation: null;
      articulation: Articulation | null;
      error: string;
    };

/** Attaches, replaces, or clears one articulation on the selected staff's latest note event. */
export function setLastNoteArticulation(
  score: ScoreDocument,
  partId: string,
  articulation: Articulation | null,
  staffIdOrIndex: StaffSelector = 0,
): SetLastNoteArticulationResult {
  if (articulation !== null && !ARTICULATIONS.includes(articulation)) {
    return {
      score,
      changed: false,
      measureId: null,
      eventId: null,
      previousArticulation: null,
      articulation,
      error: "Choose staccato, tenuto, accent, marcato, or none.",
    };
  }
  const part = score.parts.find((item) => item.id === partId);
  if (!part) {
    return {
      score,
      changed: false,
      measureId: null,
      eventId: null,
      previousArticulation: null,
      articulation,
      error: "Select an instrument first.",
    };
  }
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) {
    return {
      score,
      changed: false,
      measureId: null,
      eventId: null,
      previousArticulation: null,
      articulation,
      error: "Select a valid staff first.",
    };
  }

  for (let measureIndex = score.measureOrder.length - 1; measureIndex >= 0; measureIndex -= 1) {
    const measureId = score.measureOrder[measureIndex];
    const events = part.staves[staffIndex].measures[measureId]?.voices[0]?.events;
    if (!events?.length) continue;
    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = events[eventIndex];
      if (event.kind !== "note") continue;
      const previousArticulation = event.articulation ?? null;
      if (previousArticulation === articulation) {
        return { score, changed: false, measureId, eventId: event.id, previousArticulation, articulation };
      }
      const next = structuredClone(score);
      const nextEvent = next.parts.find((item) => item.id === partId)!
        .staves[staffIndex].measures[measureId].voices[0].events[eventIndex];
      if (nextEvent.kind !== "note") {
        return {
          score,
          changed: false,
          measureId,
          eventId: event.id,
          previousArticulation: null,
          articulation,
          error: "The last note event is not available for articulation editing.",
        };
      }
      if (articulation === null) delete nextEvent.articulation;
      else nextEvent.articulation = articulation;
      return { score: stamp(next), changed: true, measureId, eventId: event.id, previousArticulation, articulation };
    }
  }

  return {
    score,
    changed: false,
    measureId: null,
    eventId: null,
    previousArticulation: null,
    articulation,
    error: "Enter a note before adding an articulation.",
  };
}

export type RemoveEventResult =
  | {
      score: ScoreDocument;
      removed: true;
      measureId: string;
      eventId: string;
      removedEvent: MusicEvent;
      removedTieIds: string[];
      error?: undefined;
    }
  | {
      score: ScoreDocument;
      removed: false;
      measureId: string;
      eventId: string;
      removedEvent: null;
      removedTieIds: [];
      error: string;
    };

/** Removes exactly one selected event and any ties connected to its note IDs. */
export function removeEvent(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector,
  measureId: string,
  eventId: string,
): RemoveEventResult {
  const part = score.parts.find((candidate) => candidate.id === partId);
  if (!part) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedEvent: null,
      removedTieIds: [],
      error: `Instrument part "${partId}" does not exist.`,
    };
  }

  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedEvent: null,
      removedTieIds: [],
      error: `Staff selector "${String(staffIdOrIndex)}" does not identify a staff on instrument part "${partId}".`,
    };
  }

  if (!score.measureOrder.includes(measureId) || !score.measures[measureId]) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedEvent: null,
      removedTieIds: [],
      error: `Measure "${measureId}" does not exist in this score.`,
    };
  }

  const staff = part.staves[staffIndex];
  const staffMeasure = staff.measures[measureId];
  if (!staffMeasure) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedEvent: null,
      removedTieIds: [],
      error: `Staff "${staff.id}" is missing measure "${measureId}".`,
    };
  }

  const matches = staffMeasure.voices.flatMap((voice, voiceIndex) =>
    voice.events.flatMap((event, eventIndex) => event.id === eventId ? [{ voiceIndex, eventIndex }] : []),
  );
  if (!matches.length) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedEvent: null,
      removedTieIds: [],
      error: `Event "${eventId}" does not exist in measure "${measureId}" on staff "${staff.id}".`,
    };
  }
  if (matches.length > 1) {
    return {
      score,
      removed: false,
      measureId,
      eventId,
      removedEvent: null,
      removedTieIds: [],
      error: `Event ID "${eventId}" is ambiguous in measure "${measureId}" on staff "${staff.id}".`,
    };
  }

  const [{ voiceIndex, eventIndex }] = matches;
  const next = structuredClone(score);
  const nextEvents = next.parts.find((candidate) => candidate.id === partId)!
    .staves[staffIndex].measures[measureId].voices[voiceIndex].events;
  const [removedEvent] = nextEvents.splice(eventIndex, 1);
  const removedNoteIds = new Set(removedEvent.kind === "note" ? removedEvent.notes.map((note) => note.id) : []);
  const removedTieIds = next.ties
    .filter((tie) => removedNoteIds.has(tie.fromNoteId) || removedNoteIds.has(tie.toNoteId))
    .map((tie) => tie.id);
  next.ties = next.ties.filter((tie) => !removedNoteIds.has(tie.fromNoteId) && !removedNoteIds.has(tie.toNoteId));

  return {
    score: stamp(next),
    removed: true,
    measureId,
    eventId,
    removedEvent,
    removedTieIds,
  };
}

export function removeLastEvent(score: ScoreDocument, partId: string, staffIdOrIndex: StaffSelector = 0): ScoreDocument {
  const next = structuredClone(score);
  const part = next.parts.find((item) => item.id === partId);
  if (!part) return score;
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) return score;
  for (let index = next.measureOrder.length - 1; index >= 0; index -= 1) {
    const events = part.staves[staffIndex].measures[next.measureOrder[index]]?.voices[0]?.events;
    if (!events) continue;
    if (events.length) {
      const [removed] = events.splice(events.length - 1, 1);
      if (removed.kind === "note") {
        const ids = new Set(removed.notes.map((note) => note.id));
        next.ties = next.ties.filter((tie) => !ids.has(tie.fromNoteId) && !ids.has(tie.toNoteId));
      }
      return stamp(next);
    }
  }
  return score;
}

export function toggleTieLastTwo(
  score: ScoreDocument,
  partId: string,
  staffIdOrIndex: StaffSelector = 0,
): { score: ScoreDocument; tied: boolean; error?: string } {
  const part = score.parts.find((item) => item.id === partId);
  if (!part) return { score, tied: false, error: "Select an instrument first." };
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) return { score, tied: false, error: "Select a valid staff first." };
  const events = score.measureOrder.flatMap((measureId) => getPrimaryVoice(part, measureId, staffIndex).events);
  const previous = events.at(-2);
  const current = events.at(-1);
  if (!previous || !current || previous.kind !== "note" || current.kind !== "note") {
    return { score, tied: false, error: "Enter two adjacent notes before adding a tie." };
  }
  const from = previous.notes[0];
  const to = current.notes[0];
  if (!from || !to || from.pitch.step !== to.pitch.step || from.pitch.alter !== to.pitch.alter || from.pitch.octave !== to.pitch.octave) {
    return { score, tied: false, error: "A tie connects two adjacent notes of the same written pitch." };
  }
  const next = structuredClone(score);
  const existing = next.ties.findIndex((tie) => tie.fromNoteId === from.id && tie.toNoteId === to.id);
  if (existing >= 0) {
    next.ties.splice(existing, 1);
    return { score: stamp(next), tied: false };
  }
  const tieId = uniqueId(`tie-${from.id}-${to.id}`, collectScoreIds(next));
  next.ties.push({ id: tieId, fromNoteId: from.id, toNoteId: to.id });
  const validationError = validateScore(next)[0];
  if (validationError) {
    return { score, tied: false, error: `Tie could not be added. ${validationError}` };
  }
  return { score: stamp(next), tied: true };
}

export function makeEvent(options: {
  id: string;
  pitch: Pitch;
  duration: DurationValue;
  rest: boolean;
  accidentalDisplay?: ScoreNote["accidentalDisplay"];
}): MusicEvent {
  if (options.rest) return { id: options.id, kind: "rest", duration: options.duration };
  return {
    id: options.id,
    kind: "note",
    duration: options.duration,
    notes: [{ id: `${options.id}-note-1`, pitch: options.pitch, accidentalDisplay: options.accidentalDisplay ?? "auto" }],
  };
}

export function transposePitchStep(pitch: Pitch, direction: 1 | -1): Pitch {
  const current = LETTERS.indexOf(pitch.step);
  const nextIndex = current + direction;
  const wrapped = (nextIndex + LETTERS.length) % LETTERS.length;
  const octave = pitch.octave + (nextIndex >= LETTERS.length ? 1 : nextIndex < 0 ? -1 : 0);
  return { ...pitch, step: LETTERS[wrapped], octave };
}

function stamp(score: ScoreDocument): ScoreDocument {
  removeOrphanHairpins(score);
  score.updatedAt = new Date().toISOString();
  return score;
}
