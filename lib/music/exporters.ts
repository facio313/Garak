import type { Clef, MusicEvent, ScoreDocument } from "./model";
import { durationTicks, getPrimaryVoice, measureCapacity, validateScore, writtenToSounding } from "./model";

const XML_TYPES = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th" } as const;
const CLEFS: Record<Clef, { sign: string; line: number }> = {
  treble: { sign: "G", line: 2 },
  bass: { sign: "F", line: 4 },
  alto: { sign: "C", line: 3 },
  tenor: { sign: "C", line: 4 },
  percussion: { sign: "percussion", line: 3 },
};

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function scoreToMusicXML(score: ScoreDocument): string {
  const errors = validateScore(score);
  if (errors.length) throw new Error(errors[0]);
  const tiedFrom = new Set(score.ties.map((tie) => tie.fromNoteId));
  const tiedTo = new Set(score.ties.map((tie) => tie.toNoteId));
  const partList = score.parts.map((part) => `
    <score-part id="${xml(part.id)}">
      <part-name>${xml(part.name)}</part-name>
      <part-abbreviation>${xml(part.shortName)}</part-abbreviation>
      <score-instrument id="${xml(part.id)}-i1"><instrument-name>${xml(part.instrument.name)}</instrument-name></score-instrument>
      <midi-instrument id="${xml(part.id)}-i1"><midi-channel>1</midi-channel><midi-program>${part.instrument.midiProgram + 1}</midi-program></midi-instrument>
    </score-part>`).join("");

  const parts = score.parts.map((part) => {
    const clef = CLEFS[part.staves[0].clef];
    const measures = score.measureOrder.map((measureId, measureIndex) => {
      const measure = score.measures[measureId];
      const voice = getPrimaryVoice(part, measureId);
      const attributes = measureIndex === 0 ? `
        <attributes>
          <divisions>960</divisions>
          <key><fifths>${measure.key.fifths}</fifths><mode>${measure.key.mode}</mode></key>
          <time><beats>${measure.time.numerator}</beats><beat-type>${measure.time.denominator}</beat-type></time>
          <clef><sign>${clef.sign}</sign><line>${clef.line}</line></clef>
          <transpose><diatonic>${part.instrument.transposition.diatonic}</diatonic><chromatic>${part.instrument.transposition.chromatic}</chromatic><octave-change>${part.instrument.transposition.octaveChange}</octave-change></transpose>
        </attributes>` : "";
      const notes = voice.events.map((event) => eventToXML(event, tiedFrom, tiedTo)).join("");
      const implicit = voice.events.reduce((sum, event) => sum + durationTicks(event.duration), 0) < measureCapacity(measure) ? ' implicit="yes"' : "";
      return `
      <measure number="${measure.number}"${implicit}>${attributes}${notes}
      </measure>`;
    }).join("");
    return `
  <part id="${xml(part.id)}">${measures}
  </part>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${xml(score.metadata.title)}</work-title></work>
  <identification><creator type="composer">${xml(score.metadata.composer)}</creator><encoding><software>Garak Studio</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding></identification>
  <part-list>${partList}
  </part-list>${parts}
</score-partwise>`;
}

function eventToXML(event: MusicEvent, tiedFrom: Set<string>, tiedTo: Set<string>): string {
  const type = XML_TYPES[event.duration.base];
  const duration = durationTicks(event.duration);
  if (event.kind === "rest") return `
        <note><rest/><duration>${duration}</duration><voice>1</voice><type>${type}</type>${event.duration.dots ? "<dot/>" : ""}</note>`;
  return event.notes.map((note, noteIndex) => {
    const tieStart = tiedFrom.has(note.id);
    const tieStop = tiedTo.has(note.id);
    const accidental = note.pitch.alter === -2 ? "flat-flat" : note.pitch.alter === -1 ? "flat" : note.pitch.alter === 1 ? "sharp" : note.pitch.alter === 2 ? "double-sharp" : "natural";
    return `
        <note>${noteIndex ? "<chord/>" : ""}<pitch><step>${note.pitch.step}</step>${note.pitch.alter ? `<alter>${note.pitch.alter}</alter>` : ""}<octave>${note.pitch.octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${event.duration.dots ? "<dot/>" : ""}${note.accidentalDisplay === "force" ? `<accidental>${accidental}</accidental>` : ""}${tieStop ? '<tie type="stop"/>' : ""}${tieStart ? '<tie type="start"/>' : ""}${tieStart || tieStop ? `<notations>${tieStop ? '<tied type="stop"/>' : ""}${tieStart ? '<tied type="start"/>' : ""}</notations>` : ""}</note>`;
  }).join("");
}

function variableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function uint32(value: number): number[] { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function uint16(value: number): number[] { return [(value >>> 8) & 255, value & 255]; }
function textBytes(value: string): number[] { return Array.from(new TextEncoder().encode(value)); }
function chunk(id: string, data: number[]): number[] { return [...textBytes(id), ...uint32(data.length), ...data]; }

interface MidiEvent { tick: number; order: number; bytes: number[]; }

interface TimedNote {
  noteId: string;
  partId: string;
  midi: number;
  startTicks: number;
  durationTicks: number;
}

function collectTimedNotes(score: ScoreDocument): TimedNote[] {
  const notes: TimedNote[] = [];
  score.parts.forEach((part) => {
    let measureStart = 0;
    score.measureOrder.forEach((measureId) => {
      let cursor = measureStart;
      getPrimaryVoice(part, measureId).events.forEach((event) => {
        const ticks = durationTicks(event.duration);
        if (event.kind === "note") {
          event.notes.forEach((note) => notes.push({
            noteId: note.id,
            partId: part.id,
            midi: Math.max(0, Math.min(127, writtenToSounding(note.pitch, part.instrument.transposition))),
            startTicks: cursor,
            durationTicks: ticks,
          }));
        }
        cursor += ticks;
      });
      measureStart += measureCapacity(score.measures[measureId]);
    });
  });

  const byId = new Map(notes.map((note) => [note.noteId, note]));
  const outgoing = new Map(score.ties.map((tie) => [tie.fromNoteId, tie.toNoteId]));
  const incoming = new Set(score.ties.map((tie) => tie.toNoteId));
  const merged = new Set<string>();
  notes.forEach((root) => {
    if (incoming.has(root.noteId)) return;
    let tail = root;
    const visited = new Set([root.noteId]);
    while (outgoing.has(tail.noteId)) {
      const nextId = outgoing.get(tail.noteId)!;
      const next = byId.get(nextId);
      if (!next || visited.has(nextId) || next.partId !== root.partId || next.midi !== root.midi || tail.startTicks + tail.durationTicks !== next.startTicks) break;
      visited.add(nextId);
      root.durationTicks = next.startTicks + next.durationTicks - root.startTicks;
      merged.add(nextId);
      tail = next;
    }
  });
  return notes.filter((note) => !merged.has(note.noteId));
}

function encodeTrack(events: MidiEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let previousTick = 0;
  for (const event of sorted) {
    data.push(...variableLength(Math.max(0, event.tick - previousTick)), ...event.bytes);
    previousTick = event.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return chunk("MTrk", data);
}

export function scoreToMidi(score: ScoreDocument): Uint8Array {
  const errors = validateScore(score);
  if (errors.length) throw new Error(errors[0]);
  const microseconds = Math.round(60_000_000 / score.tempo);
  const tempoEvents: MidiEvent[] = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (microseconds >>> 16) & 255, (microseconds >>> 8) & 255, microseconds & 255] },
    { tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, score.measures[score.measureOrder[0]].time.numerator, Math.log2(score.measures[score.measureOrder[0]].time.denominator), 24, 8] },
  ];
  const tracks = [encodeTrack(tempoEvents)];

  const timedNotes = collectTimedNotes(score);
  score.parts.forEach((part, partIndex) => {
    const melodicChannel = partIndex % 15 >= 9 ? (partIndex % 15) + 1 : partIndex % 15;
    const channel = part.instrument.family === "Percussion" ? 9 : melodicChannel;
    const events: MidiEvent[] = [
      { tick: 0, order: 0, bytes: [0xff, 0x03, textBytes(part.name).length, ...textBytes(part.name)] },
      { tick: 0, order: 1, bytes: [0xc0 | channel, Math.max(0, Math.min(127, part.instrument.midiProgram))] },
    ];
    timedNotes.filter((note) => note.partId === part.id).forEach((note) => {
      const start = Math.round(note.startTicks / 2);
      const duration = Math.round(note.durationTicks / 2);
      events.push({ tick: start, order: 2, bytes: [0x90 | channel, note.midi, 82] });
      events.push({ tick: start + duration, order: 0, bytes: [0x80 | channel, note.midi, 0] });
    });
    tracks.push(encodeTrack(events));
  });

  const header = chunk("MThd", [...uint16(1), ...uint16(tracks.length), ...uint16(480)]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

export interface PlaybackNote { partId: string; midi: number; startSeconds: number; durationSeconds: number; }

export function collectPlaybackNotes(score: ScoreDocument): PlaybackNote[] {
  const secondsPerTick = 60 / score.tempo / 960;
  const hasSolo = score.parts.some((part) => part.solo);
  const audibleParts = new Set(score.parts.filter((part) => !part.muted && (!hasSolo || part.solo)).map((part) => part.id));
  return collectTimedNotes(score).filter((note) => audibleParts.has(note.partId)).map((note) => ({
    partId: note.partId,
    midi: note.midi,
    startSeconds: note.startTicks * secondsPerTick,
    durationSeconds: Math.max(.06, note.durationTicks * secondsPerTick * .9),
  }));
}
