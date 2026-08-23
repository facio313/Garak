import { getInstrument, SCORE_TEMPLATES } from "./catalog";
import type { DurationValue, InstrumentSnapshot, MusicEvent, PartData, Pitch, ScoreDocument } from "./model";
import { durationTicks, getPrimaryVoice, measureCapacity, voiceTicks } from "./model";

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
  const instrument = cloneInstrument(catalogId);
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
    staves: [{
      id: `${partId}-staff-1`,
      clef: instrument.clef,
      measures: Object.fromEntries(measureIds.map((measureId) => [measureId, { voices: [{ id: `${partId}-${measureId}-v1`, events: [] }] }])),
    }],
  };
}

export function createScore(templateId: string = "chamber", seedDemo = true): ScoreDocument {
  const template = SCORE_TEMPLATES.find((item) => item.id === templateId) ?? SCORE_TEMPLATES[2];
  const measureOrder = ["measure-1", "measure-2", "measure-3", "measure-4"];
  const measures = Object.fromEntries(measureOrder.map((id, index) => [id, { id, number: index + 1, time: { numerator: 4, denominator: 4 }, key: { fifths: 0, mode: "major" as const } }]));
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

export function appendEvent(score: ScoreDocument, partId: string, event: MusicEvent): { score: ScoreDocument; measureId: string | null; error?: string } {
  const next = structuredClone(score);
  const part = next.parts.find((item) => item.id === partId);
  if (!part) return { score, measureId: null, error: "Select an instrument first." };

  let targetMeasureId = next.measureOrder.find((measureId) => {
    const voice = getPrimaryVoice(part, measureId);
    return voiceTicks(voice) + durationTicks(event.duration) <= measureCapacity(next.measures[measureId]);
  });

  if (!targetMeasureId) {
    const number = next.measureOrder.length + 1;
    targetMeasureId = `measure-${number}`;
    const previous = next.measures[next.measureOrder[next.measureOrder.length - 1]];
    next.measureOrder.push(targetMeasureId);
    next.measures[targetMeasureId] = { id: targetMeasureId, number, time: { ...previous.time }, key: { ...previous.key } };
    next.parts.forEach((item) => {
      item.staves[0].measures[targetMeasureId!] = { voices: [{ id: `${item.id}-${targetMeasureId}-v1`, events: [] }] };
    });
  }

  const target = next.parts.find((item) => item.id === partId)!;
  target.staves[0].measures[targetMeasureId].voices[0].events.push(event);
  return { score: stamp(next), measureId: targetMeasureId };
}

export function removeLastEvent(score: ScoreDocument, partId: string): ScoreDocument {
  const next = structuredClone(score);
  const part = next.parts.find((item) => item.id === partId);
  if (!part) return score;
  for (let index = next.measureOrder.length - 1; index >= 0; index -= 1) {
    const events = part.staves[0].measures[next.measureOrder[index]].voices[0].events;
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

export function toggleTieLastTwo(score: ScoreDocument, partId: string): { score: ScoreDocument; tied: boolean; error?: string } {
  const part = score.parts.find((item) => item.id === partId);
  if (!part) return { score, tied: false, error: "Select an instrument first." };
  const events = score.measureOrder.flatMap((measureId) => getPrimaryVoice(part, measureId).events);
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

export function makeEvent(options: { id: string; pitch: Pitch; duration: DurationValue; rest: boolean }): MusicEvent {
  if (options.rest) return { id: options.id, kind: "rest", duration: options.duration };
  return {
    id: options.id,
    kind: "note",
    duration: options.duration,
    notes: [{ id: `${options.id}-note-1`, pitch: options.pitch, accidentalDisplay: options.pitch.alter === 0 ? "auto" : "force" }],
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
