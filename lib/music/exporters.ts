import type { Articulation, Clef, MusicEvent, PartData, ScoreDocument, VoiceData } from "./model";
import { writtenKeyForPart } from "./key-signatures";
import {
  DEFAULT_MIDI_VELOCITY,
  DYNAMIC_VELOCITIES,
  durationTicks,
  measureCapacity,
  validateScore,
  writtenToSounding,
} from "./model";

const XML_TYPES = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd", 64: "64th" } as const;
const CLEFS: Record<Clef, { sign: string; line: number }> = {
  treble: { sign: "G", line: 2 },
  bass: { sign: "F", line: 4 },
  alto: { sign: "C", line: 3 },
  tenor: { sign: "C", line: 4 },
  percussion: { sign: "percussion", line: 3 },
};

/** Performance transforms shared by WebAudio playback and Standard MIDI export. */
export const ARTICULATION_VELOCITY_BONUSES: Readonly<Record<Articulation, number>> = Object.freeze({
  staccato: 0,
  tenuto: 0,
  accent: 14,
  marcato: 24,
});
export const STACCATO_GATE_RATIO = 0.5;

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

interface MusicXMLPartIds {
  part: string;
  instrument: string;
}

function musicXMLIdStem(value: string, fallback: string): string {
  const sanitized = value.normalize("NFKD").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `P-${sanitized}`;
}

function reserveMusicXMLId(stem: string, used: Set<string>): string {
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${stem}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function musicXMLPartIds(parts: readonly PartData[]): MusicXMLPartIds[] {
  const used = new Set<string>();
  const partIds = parts.map((part, partIndex) =>
    reserveMusicXMLId(musicXMLIdStem(part.id, `P${partIndex + 1}`), used));
  return partIds.map((partId) => ({
    part: partId,
    instrument: reserveMusicXMLId(`${partId}-i1`, used),
  }));
}

export function scoreToMusicXML(score: ScoreDocument): string {
  const errors = validateScore(score);
  if (errors.length) throw new Error(errors[0]);
  const midiRoutes = midiRoutesForParts(score.parts);
  const tiedFrom = new Set(score.ties.map((tie) => tie.fromNoteId));
  const tiedTo = new Set(score.ties.map((tie) => tie.toNoteId));
  const xmlIds = musicXMLPartIds(score.parts);
  const exportedTempo = Math.round(score.tempo);
  const partList = score.parts.map((part, partIndex) => `
    <score-part id="${xmlIds[partIndex].part}">
      <part-name>${xml(part.name)}</part-name>
      <part-abbreviation>${xml(part.shortName)}</part-abbreviation>
      <score-instrument id="${xmlIds[partIndex].instrument}"><instrument-name>${xml(part.instrument.name)}</instrument-name></score-instrument>
      <midi-device port="${midiRoutes[partIndex].port + 1}"/>
      <midi-instrument id="${xmlIds[partIndex].instrument}"><midi-channel>${midiRoutes[partIndex].channel + 1}</midi-channel><midi-program>${part.instrument.midiProgram + 1}</midi-program></midi-instrument>
    </score-part>`).join("");

  const parts = score.parts.map((part, partIndex) => {
    const multiStaff = part.staves.length > 1;
    const clefs = part.staves.map((staff, staffIndex) => {
      const clef = CLEFS[staff.clef];
      return `<clef${multiStaff ? ` number="${staffIndex + 1}"` : ""}><sign>${clef.sign}</sign><line>${clef.line}</line></clef>`;
    }).join("");
    const measures = score.measureOrder.map((measureId, measureIndex) => {
      const measure = score.measures[measureId];
      const previousMeasure = measureIndex ? score.measures[score.measureOrder[measureIndex - 1]] : null;
      const writtenKey = writtenKeyForPart(measure.key, part);
      const previousWrittenKey = previousMeasure ? writtenKeyForPart(previousMeasure.key, part) : null;
      const keyChanged = !previousWrittenKey || previousWrittenKey.fifths !== writtenKey.fifths || previousWrittenKey.mode !== writtenKey.mode;
      const timeChanged = !previousMeasure || previousMeasure.time.numerator !== measure.time.numerator || previousMeasure.time.denominator !== measure.time.denominator;
      const attributes = measureIndex === 0 || keyChanged || timeChanged ? `
        <attributes>
          ${measureIndex === 0 ? "<divisions>960</divisions>" : ""}
          ${keyChanged ? `<key><fifths>${writtenKey.fifths}</fifths><mode>${writtenKey.mode}</mode></key>` : ""}
          ${timeChanged ? `<time><beats>${measure.time.numerator}</beats><beat-type>${measure.time.denominator}</beat-type></time>` : ""}
          ${measureIndex === 0 && multiStaff ? `<staves>${part.staves.length}</staves>` : ""}
          ${measureIndex === 0 ? clefs : ""}
          ${measureIndex === 0 ? `<transpose><diatonic>${part.instrument.transposition.diatonic}</diatonic><chromatic>${part.instrument.transposition.chromatic}</chromatic><octave-change>${part.instrument.transposition.octaveChange}</octave-change></transpose>` : ""}
        </attributes>` : "";
      const tempoDirection = partIndex === 0 && measureIndex === 0 ? `
        <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${exportedTempo}</per-minute></metronome></direction-type><sound tempo="${exportedTempo}"/></direction>` : "";
      const measureDuration = measureCapacity(measure);
      const staffStreams = part.staves.map((_, staffIndex) => {
        const voice = getStaffPrimaryVoice(part, measureId, staffIndex);
        const voiceNumber = staffIndex + 1;
        const staffNumber = multiStaff ? staffIndex + 1 : undefined;
        const eventDuration = voice.events.reduce((sum, event) => sum + durationTicks(event.duration), 0);
        return {
          duration: measureDuration,
          notes: voice.events.length
            ? `${voice.events.map((event) => eventToXML(event, tiedFrom, tiedTo, voiceNumber, staffNumber)).join("")}${eventDuration < measureDuration ? forwardToXML(measureDuration - eventDuration, voiceNumber, staffNumber) : ""}`
            : fullMeasureRestToXML(measureDuration, voiceNumber, staffNumber),
        };
      });
      const notes = staffStreams.map((stream, staffIndex) =>
        `${staffIndex ? backupToXML(staffStreams[staffIndex - 1].duration) : ""}${stream.notes}`,
      ).join("");
      return `
      <measure number="${measure.number}">${attributes}${tempoDirection}${notes}
      </measure>`;
    }).join("");
    return `
  <part id="${xmlIds[partIndex].part}">${measures}
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

function getStaffPrimaryVoice(part: PartData, measureId: string, staffIndex: number): VoiceData {
  return part.staves[staffIndex]?.measures[measureId]?.voices[0] ?? {
    id: `${part.id}-${measureId}-staff-${staffIndex + 1}-v1`,
    events: [],
  };
}

function backupToXML(duration: number): string {
  return `
        <backup><duration>${duration}</duration></backup>`;
}

function forwardToXML(duration: number, voiceNumber: number, staffNumber?: number): string {
  const staff = staffNumber === undefined ? "" : `<staff>${staffNumber}</staff>`;
  return `
        <forward><duration>${duration}</duration><voice>${voiceNumber}</voice>${staff}</forward>`;
}

function fullMeasureRestToXML(duration: number, voiceNumber = 1, staffNumber?: number): string {
  const staff = staffNumber === undefined ? "" : `<staff>${staffNumber}</staff>`;
  return `
        <note><rest measure="yes"/><duration>${duration}</duration><voice>${voiceNumber}</voice>${staff}</note>`;
}

function eventToXML(
  event: MusicEvent,
  tiedFrom: Set<string>,
  tiedTo: Set<string>,
  voiceNumber = 1,
  staffNumber?: number,
): string {
  const type = XML_TYPES[event.duration.base];
  const duration = durationTicks(event.duration);
  const staff = staffNumber === undefined ? "" : `<staff>${staffNumber}</staff>`;
  const dots = "<dot/>".repeat(event.duration.dots);
  const direction = dynamicDirectionToXML(event, voiceNumber, staffNumber);
  if (event.kind === "rest") return `${direction}
        <note><rest/><duration>${duration}</duration><voice>${voiceNumber}</voice><type>${type}</type>${dots}${staff}</note>`;
  return direction + event.notes.map((note, noteIndex) => {
    const tieStart = tiedFrom.has(note.id);
    const tieStop = tiedTo.has(note.id);
    const accidental = note.pitch.alter === -2 ? "flat-flat" : note.pitch.alter === -1 ? "flat" : note.pitch.alter === 1 ? "sharp" : note.pitch.alter === 2 ? "double-sharp" : "natural";
    const notations = noteNotationsToXML(event, noteIndex, tieStart, tieStop);
    return `
        <note>${noteIndex ? "<chord/>" : ""}<pitch><step>${note.pitch.step}</step>${note.pitch.alter ? `<alter>${note.pitch.alter}</alter>` : ""}<octave>${note.pitch.octave}</octave></pitch><duration>${duration}</duration>${tieStop ? '<tie type="stop"/>' : ""}${tieStart ? '<tie type="start"/>' : ""}<voice>${voiceNumber}</voice><type>${type}</type>${dots}${note.accidentalDisplay === "force" ? `<accidental>${accidental}</accidental>` : ""}${staff}${notations}</note>`;
  }).join("");
}

function musicXMLArticulation(articulation: Articulation): string {
  if (articulation === "marcato") return '<strong-accent type="up"/>';
  return `<${articulation}/>`;
}

function noteNotationsToXML(
  event: Extract<MusicEvent, { kind: "note" }>,
  noteIndex: number,
  tieStart: boolean,
  tieStop: boolean,
): string {
  const tied = `${tieStop ? '<tied type="stop"/>' : ""}${tieStart ? '<tied type="start"/>' : ""}`;
  // Garak stores one articulation per event/chord, so emit it on the leading
  // MusicXML note only rather than duplicating it on every chord tone.
  const articulation = noteIndex === 0 && event.articulation
    ? `<articulations>${musicXMLArticulation(event.articulation)}</articulations>`
    : "";
  return tied || articulation ? `<notations>${tied}${articulation}</notations>` : "";
}

/**
 * A MusicXML direction applies to the first following note in the same voice.
 * The sound percentage is relative to MIDI's default forte velocity of 90.
 */
function dynamicDirectionToXML(event: MusicEvent, voiceNumber: number, staffNumber?: number): string {
  if (!event.dynamic) return "";
  const staff = staffNumber === undefined ? "" : `<staff>${staffNumber}</staff>`;
  const soundDynamics = Number((DYNAMIC_VELOCITIES[event.dynamic] * 100 / 90).toFixed(2));
  return `
        <direction placement="below"><direction-type><dynamics><${event.dynamic}/></dynamics></direction-type><voice>${voiceNumber}</voice>${staff}<sound dynamics="${soundDynamics}"/></direction>`;
}

export function encodeMidiVariableLength(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new RangeError("A MIDI variable-length value must be an integer from 0 through 0x0FFFFFFF.");
  }
  const bytes = [value % 0x80];
  let remaining = Math.floor(value / 0x80);
  while (remaining > 0) {
    bytes.unshift((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
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
  velocity: number;
  startTicks: number;
  durationTicks: number;
  articulation?: Articulation;
}

interface MidiRoute {
  /** Zero-based MIDI port/cable. MusicXML serializes this as a one-based port. */
  port: number;
  /** Zero-based channel within the port. Channel 9 is the General MIDI drum channel. */
  channel: number;
}

function midiRoutesForParts(parts: readonly PartData[]): MidiRoute[] {
  let melodicPartIndex = 0;
  let unpitchedPartIndex = 0;
  return parts.map((part) => {
    // Family alone is not sufficient: timpani, glockenspiel, and other pitched
    // percussion must retain ordinary melodic pitch and program semantics.
    if (part.instrument.clef === "percussion") {
      const port = unpitchedPartIndex++;
      if (port >= 16) throw new Error("MIDI export supports up to 16 independent unpitched-percussion parts.");
      return { port, channel: 9 };
    }

    const port = Math.floor(melodicPartIndex / 15);
    const channelSlot = melodicPartIndex % 15;
    melodicPartIndex += 1;
    if (port >= 16) throw new Error("MIDI export supports up to 240 pitched parts across 16 MIDI ports.");
    return { port, channel: channelSlot >= 9 ? channelSlot + 1 : channelSlot };
  });
}

function collectTimedNotes(score: ScoreDocument): TimedNote[] {
  const notes: TimedNote[] = [];
  score.parts.forEach((part) => {
    let measureStart = 0;
    const staffVelocities = new Map(part.staves.map((staff) => [staff.id, DEFAULT_MIDI_VELOCITY]));
    score.measureOrder.forEach((measureId) => {
      part.staves.forEach((staff, staffIndex) => {
        let cursor = measureStart;
        let velocity = staffVelocities.get(staff.id) ?? DEFAULT_MIDI_VELOCITY;
        getStaffPrimaryVoice(part, measureId, staffIndex).events.forEach((event) => {
          const ticks = durationTicks(event.duration);
          if (event.dynamic) velocity = DYNAMIC_VELOCITIES[event.dynamic];
          if (event.kind === "note") {
            const performedVelocity = Math.min(127, velocity + (event.articulation ? ARTICULATION_VELOCITY_BONUSES[event.articulation] : 0));
            event.notes.forEach((note) => notes.push({
              noteId: note.id,
              partId: part.id,
              midi: Math.max(0, Math.min(127, writtenToSounding(note.pitch, part.instrument.transposition))),
              velocity: performedVelocity,
              startTicks: cursor,
              durationTicks: ticks,
              articulation: event.articulation,
            }));
          }
          cursor += ticks;
        });
        staffVelocities.set(staff.id, velocity);
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
  return notes.filter((note) => !merged.has(note.noteId)).map((note) => note.articulation === "staccato"
    ? { ...note, durationTicks: Math.max(1, Math.round(note.durationTicks * STACCATO_GATE_RATIO)) }
    : note);
}

/**
 * MIDI note-off messages address only a channel and pitch, not the individual
 * note-on that created them. Merge overlapping ownership of the same key so a
 * shorter staff or part note cannot silence another note that is still sounding.
 * A later overlapping reattack is intentionally collapsed and cannot change the
 * earlier interval's velocity; exactly adjacent notes remain separate.
 */
function normalizeMidiNoteIntervals(score: ScoreDocument, notes: TimedNote[], routes: readonly MidiRoute[]): TimedNote[] {
  const routeByPart = new Map(score.parts.map((part, partIndex) => [part.id, routes[partIndex]]));
  const grouped = new Map<string, TimedNote[]>();
  notes.forEach((note) => {
    const route = routeByPart.get(note.partId) ?? { port: 0, channel: 0 };
    const key = `${route.port}:${route.channel}:${note.midi}`;
    const group = grouped.get(key);
    if (group) group.push(note);
    else grouped.set(key, [note]);
  });

  const normalized: TimedNote[] = [];
  grouped.forEach((group) => {
    const sorted = group
      .map((note) => ({ ...note }))
      .sort((first, second) => first.startTicks - second.startTicks || second.durationTicks - first.durationTicks);
    let current: TimedNote | undefined;
    sorted.forEach((note) => {
      if (!current) {
        current = note;
        return;
      }
      const currentEnd = current.startTicks + current.durationTicks;
      const noteEnd = note.startTicks + note.durationTicks;
      if (note.startTicks < currentEnd) {
        current.durationTicks = Math.max(currentEnd, noteEnd) - current.startTicks;
        if (note.startTicks === current.startTicks) current.velocity = Math.max(current.velocity, note.velocity);
        return;
      }
      normalized.push(current);
      current = note;
    });
    if (current) normalized.push(current);
  });
  return normalized;
}

function encodeTrack(events: MidiEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let previousTick = 0;
  for (const event of sorted) {
    data.push(...encodeMidiVariableLength(Math.max(0, event.tick - previousTick)), ...event.bytes);
    previousTick = event.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return chunk("MTrk", data);
}

export function scoreToMidi(score: ScoreDocument): Uint8Array {
  const errors = validateScore(score);
  if (errors.length) throw new Error(errors[0]);
  const midiRoutes = midiRoutesForParts(score.parts);
  const microseconds = Math.round(60_000_000 / score.tempo);
  const tempoEvents: MidiEvent[] = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (microseconds >>> 16) & 255, (microseconds >>> 8) & 255, microseconds & 255] },
  ];
  let scoreTick = 0;
  let previousTime: { numerator: number; denominator: number } | null = null;
  score.measureOrder.forEach((measureId) => {
    const measure = score.measures[measureId];
    const changed = !previousTime || previousTime.numerator !== measure.time.numerator || previousTime.denominator !== measure.time.denominator;
    if (changed) {
      tempoEvents.push({
        tick: Math.round(scoreTick / 2),
        order: 1,
        bytes: [0xff, 0x58, 0x04, measure.time.numerator, Math.log2(measure.time.denominator), 24, 8],
      });
    }
    previousTime = measure.time;
    scoreTick += measureCapacity(measure);
  });
  const tracks = [encodeTrack(tempoEvents)];

  const timedNotes = normalizeMidiNoteIntervals(score, collectTimedNotes(score), midiRoutes);
  score.parts.forEach((part, partIndex) => {
    const { channel, port } = midiRoutes[partIndex];
    const trackName = textBytes(part.name);
    const events: MidiEvent[] = [
      { tick: 0, order: 0, bytes: [0xff, 0x21, 0x01, port] },
      { tick: 0, order: 1, bytes: [0xff, 0x03, ...encodeMidiVariableLength(trackName.length), ...trackName] },
      { tick: 0, order: 2, bytes: [0xc0 | channel, Math.max(0, Math.min(127, part.instrument.midiProgram))] },
    ];
    timedNotes.filter((note) => note.partId === part.id).forEach((note) => {
      const start = Math.round(note.startTicks / 2);
      const end = Math.round((note.startTicks + note.durationTicks) / 2);
      events.push({ tick: start, order: 3, bytes: [0x90 | channel, note.midi, note.velocity] });
      events.push({ tick: Math.max(start + 1, end), order: 0, bytes: [0x80 | channel, note.midi, 0] });
    });
    tracks.push(encodeTrack(events));
  });

  const header = chunk("MThd", [...uint16(1), ...uint16(tracks.length), ...uint16(480)]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

export interface PlaybackNote { partId: string; midi: number; velocity: number; startSeconds: number; durationSeconds: number; }

export function collectPlaybackNotes(score: ScoreDocument): PlaybackNote[] {
  const secondsPerTick = 60 / score.tempo / 960;
  const hasSolo = score.parts.some((part) => part.solo);
  const audibleParts = new Set(score.parts.filter((part) => !part.muted && (!hasSolo || part.solo)).map((part) => part.id));
  return collectTimedNotes(score).filter((note) => audibleParts.has(note.partId)).map((note) => ({
    partId: note.partId,
    midi: note.midi,
    velocity: note.velocity,
    startSeconds: note.startTicks * secondsPerTick,
    durationSeconds: Math.max(.005, note.durationTicks * secondsPerTick * .9),
  }));
}

export function selectPlaybackWindow(input: readonly PlaybackNote[], limit = 600): {
  notes: PlaybackNote[];
  total: number;
  truncated: boolean;
} {
  const sorted = [...input].sort((first, second) =>
    first.startSeconds - second.startSeconds || first.partId.localeCompare(second.partId) || first.midi - second.midi,
  );
  if (!Number.isSafeInteger(limit) || limit < 1) return { notes: [], total: sorted.length, truncated: sorted.length > 0 };
  if (sorted.length <= limit) return { notes: sorted, total: sorted.length, truncated: false };

  const selected: PlaybackNote[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].startSeconds === sorted[start].startSeconds) end += 1;
    const onset = sorted.slice(start, end);
    if (selected.length + onset.length > limit) {
      if (!selected.length) {
        const queues = new Map<string, PlaybackNote[]>();
        onset.forEach((note) => queues.set(note.partId, [...(queues.get(note.partId) ?? []), note]));
        while (selected.length < limit && [...queues.values()].some((queue) => queue.length)) {
          queues.forEach((queue) => {
            const note = queue.shift();
            if (note && selected.length < limit) selected.push(note);
          });
        }
      }
      break;
    }
    selected.push(...onset);
    start = end;
  }
  return { notes: selected, total: sorted.length, truncated: true };
}
