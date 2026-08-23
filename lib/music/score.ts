import { getInstrument, SCORE_TEMPLATES } from "./catalog";
import { assertKeySignature } from "./key-signatures";
import type { KeySignature } from "./key-signatures";
import type { Articulation, DurationValue, DynamicMarking, InstrumentSnapshot, MeasureMeta, MusicEvent, PartData, Pitch, ScoreDocument, ScoreNote, StaffSelector } from "./model";
import { ARTICULATIONS, DYNAMIC_MARKINGS, TICKS_PER_WHOLE, durationTicks, getPrimaryVoice, measureCapacity, resolveStaffIndex, validateScore, voiceTicks } from "./model";

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
  const measureOrder = ["measure-1", "measure-2", "measure-3", "measure-4"];
  const measures = Object.fromEntries(measureOrder.map((id, index) => [id, { id, number: index + 1, time: { numerator: 4, denominator: 4 }, key: { ...key } }]));
  const occurrences = new Map<string, number>();
  const parts = template.instruments.map((catalogId, index) => {
    const occurrence = (occurrences.get(catalogId) ?? 0) + 1;
    occurrences.set(catalogId, occurrence);
    const totalOccurrences = template.instruments.filter((candidate) => candidate === catalogId).length;
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
  return stamp(next);
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
              error: `Cannot change to ${time.numerator}/${time.denominator}: ${part.name}, staff ${staffIndex + 1}, measure ${measureNumber}, voice ${voiceIndex + 1} contains ${used} ticks but the new measure holds ${capacity}.`,
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
  const used = new Set<string>([score.id, ...score.measureOrder, ...score.ties.map((tie) => tie.id)]);
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
  return stamp(next);
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
): string | null {
  const part = score.parts.find((item) => item.id === partId);
  if (!part) return null;
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) return null;
  return score.measureOrder.find((measureId) => {
    const voice = getPrimaryVoice(part, measureId, staffIndex);
    return voiceTicks(voice) + durationTicks(duration) <= measureCapacity(score.measures[measureId]);
  }) ?? null;
}

export function appendEvent(
  score: ScoreDocument,
  partId: string,
  event: MusicEvent,
  staffIdOrIndex: StaffSelector = 0,
): { score: ScoreDocument; measureId: string | null; error?: string } {
  const next = structuredClone(score);
  const part = next.parts.find((item) => item.id === partId);
  if (!part) return { score, measureId: null, error: "Select an instrument first." };
  const staffIndex = resolveStaffIndex(part, staffIdOrIndex);
  if (staffIndex < 0) return { score, measureId: null, error: "Select a valid staff first." };

  let targetMeasureId = findEventTargetMeasureId(next, partId, event.duration, staffIndex) ?? undefined;

  if (!targetMeasureId) {
    const previousMeasureId = next.measureOrder.at(-1);
    const previousMeasure = previousMeasureId ? next.measures[previousMeasureId] : null;
    if (!previousMeasure || durationTicks(event.duration) > measureCapacity(previousMeasure)) {
      const meter = previousMeasure ? `${previousMeasure.time.numerator}/${previousMeasure.time.denominator}` : "current";
      return { score, measureId: null, error: `The selected duration is longer than a ${meter} measure.` };
    }
    targetMeasureId = appendEmptyMeasure(next);
  }

  const voice = part.staves[staffIndex].measures[targetMeasureId]?.voices[0];
  if (!voice) return { score, measureId: null, error: "The selected staff is missing measure structure." };
  voice.events.push(event);
  return { score: stamp(next), measureId: targetMeasureId };
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

  const sameWrittenPitch = target.event.notes.some((existing) =>
    existing.pitch.step === note.pitch.step &&
    existing.pitch.alter === note.pitch.alter &&
    existing.pitch.octave === note.pitch.octave,
  );
  if (sameWrittenPitch) {
    return {
      score,
      added: false,
      measureId: target.measureId,
      eventId: target.event.id,
      noteId: null,
      error: "That written pitch is already in the chord.",
    };
  }

  const noteIdInUse = score.parts.some((candidatePart) => candidatePart.staves.some((staff) =>
    Object.values(staff.measures).some((measure) => measure.voices.some((voice) => voice.events.some((event) =>
      event.kind === "note" && event.notes.some((existing) => existing.id === note.id),
    ))),
  ));
  if (noteIdInUse) {
    return {
      score,
      added: false,
      measureId: target.measureId,
      eventId: target.event.id,
      noteId: null,
      error: "That chord-tone ID is already in use.",
    };
  }

  const next = structuredClone(score);
  const nextEvent = next.parts.find((item) => item.id === partId)!
    .staves[staffIndex].measures[target.measureId].voices[0].events[target.eventIndex];
  if (nextEvent.kind !== "note") {
    return {
      score,
      added: false,
      measureId: target.measureId,
      eventId: target.event.id,
      noteId: null,
      error: "The last event is not available for chord entry.",
    };
  }
  nextEvent.notes.push(structuredClone(note));
  return {
    score: stamp(next),
    added: true,
    measureId: target.measureId,
    eventId: target.event.id,
    noteId: note.id,
  };
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
  const validationError = validateScore(next).find((error) => error.startsWith("Tie "));
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
  score.updatedAt = new Date().toISOString();
  return score;
}
