import { getInstrument, SCORE_TEMPLATES } from "./catalog";
import { assertKeySignature } from "./key-signatures";
import type { KeySignature } from "./key-signatures";
import type { DurationValue, InstrumentSnapshot, MusicEvent, PartData, Pitch, ScoreDocument, ScoreNote, StaffSelector } from "./model";
import { durationTicks, getPrimaryVoice, measureCapacity, resolveStaffIndex, voiceTicks } from "./model";

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
  next.parts.push(makePart(catalogId, next.parts.length, next.measureOrder));
  return stamp(next);
}

export function removeInstrument(score: ScoreDocument, partId: string): ScoreDocument {
  if (score.parts.length <= 1) return score;
  const next = structuredClone(score);
  next.parts = next.parts.filter((part) => part.id !== partId);
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

  const usedVoiceIds = new Set<string>();
  score.parts.forEach((part) => part.staves.forEach((staff) => Object.values(staff.measures).forEach((measure) => {
    measure.voices.forEach((voice) => usedVoiceIds.add(voice.id));
  })));

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
        id: uniqueId(`${staff.id}-${measureId}-v${index + 1}`, usedVoiceIds),
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
  next.ties.push({ id: `tie-${from.id}-${to.id}`, fromNoteId: from.id, toNoteId: to.id });
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
