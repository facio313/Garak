import assert from "node:assert/strict";
import test from "node:test";
import { collectPlaybackNotes, scoreToMidi, scoreToMusicXML } from "../lib/music/exporters";
import { importMusicXML } from "../lib/music/importers";
import { getPrimaryVoice, validateScore } from "../lib/music/model";
import { serializeNativeScore } from "../lib/music/native-format";
import { createScore, makeEvent, setTimeFromMeasure } from "../lib/music/score";

interface MidiMessage { tick: number; status: number; type?: number; data: number[] }

function readMidiTracks(bytes: Uint8Array): MidiMessage[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tracks: MidiMessage[][] = [];
  let cursor = 14;
  const variable = () => {
    let value = 0;
    let byte: number;
    do { byte = bytes[cursor++]; value = value * 128 + (byte & 0x7f); } while (byte & 0x80);
    return value;
  };
  while (cursor < bytes.length) {
    assert.equal(new TextDecoder().decode(bytes.subarray(cursor, cursor + 4)), "MTrk");
    const end = cursor + 8 + view.getUint32(cursor + 4);
    cursor += 8;
    let tick = 0;
    const messages: MidiMessage[] = [];
    while (cursor < end) {
      tick += variable();
      const status = bytes[cursor++];
      assert.ok(status >= 0x80, "export emits explicit MIDI statuses");
      const type = status === 0xff ? bytes[cursor++] : undefined;
      const length = status === 0xff ? variable() : (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
      const data = [...bytes.subarray(cursor, cursor + length)];
      cursor += length;
      messages.push({ tick, status, type, data });
    }
    assert.equal(cursor, end);
    tracks.push(messages);
  }
  assert.equal(tracks.length, view.getUint16(10));
  return tracks;
}

function exportFixture() {
  const empty = createScore("solo", false);
  const score = setTimeFromMeasure(empty, empty.measureOrder[1], { numerator: 3, denominator: 4 }).score;
  score.tempo = 72;
  score.metadata = { title: "First & last", subtitle: "", composer: "김 작곡", copyright: '© 2026 김 & "Studio" <Music>' };
  const first = makeEvent({ id: "export-chord-start", duration: { base: 2, dots: 0 }, pitch: { step: "C", alter: 0, octave: 4 }, rest: false });
  const last = makeEvent({ id: "export-chord-end", duration: { base: 4, dots: 0 }, pitch: { step: "C", alter: 0, octave: 4 }, rest: false });
  if (first.kind !== "note" || last.kind !== "note") assert.fail("Expected note fixtures");
  for (const event of [first, last]) event.notes.push({ id: `${event.id}-e`, pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  first.dynamic = "p";
  first.articulation = "tenuto";
  const rest = (id: string) => makeEvent({ id, duration: { base: 2, dots: 0 }, pitch: { step: "C", alter: 0, octave: 4 }, rest: true });
  getPrimaryVoice(score.parts[0], score.measureOrder[0]).events.push(rest("export-opening-rest"), first);
  getPrimaryVoice(score.parts[0], score.measureOrder[1]).events.push(last, rest("export-ending-rest"));
  score.ties = first.notes.map((note, index) => ({ id: `export-tie-${index}`, fromNoteId: note.id, toNoteId: last.notes[index].id }));
  score.hairpins = [{ id: "export-hairpin", startEventId: first.id, endEventId: last.id, kind: "crescendo", from: "p", to: "f" }];
  assert.deepEqual(validateScore(score), []);
  return score;
}

test("MusicXML retains copyright and preserves tied chord expression when reopened", () => {
  const score = exportFixture();
  const before = structuredClone(score);
  const exported = scoreToMusicXML(score);
  const reopened = importMusicXML(exported);
  assert.deepEqual(reopened.warnings, []);
  assert.equal(reopened.score.metadata.copyright, score.metadata.copyright);
  assert.equal(reopened.score.metadata.title, score.metadata.title);
  assert.equal(reopened.score.metadata.composer, score.metadata.composer);
  assert.equal(reopened.score.tempo, score.tempo);
  assert.equal(reopened.score.ties.length, 2);
  const performance = (input: typeof score) => collectPlaybackNotes(input).map(note => ({ ...note, partId: "part" }));
  assert.deepEqual(performance(reopened.score), performance(score));
  assert.deepEqual(JSON.parse(serializeNativeScore(score)), score);
  assert.deepEqual(score, before, "export never mutates the editable source");
});

test("MIDI preserves final rests and empty bars without retriggering tied chord tones", () => {
  const score = exportFixture();
  const tracks = readMidiTracks(scoreToMidi(score));
  for (const track of tracks) assert.deepEqual(track.at(-1), { tick: 13 * 480, status: 0xff, type: 0x2f, data: [] });
  const notes = tracks[1].filter(message => (message.status & 0xf0) === 0x90);
  assert.deepEqual(notes.map(({ tick, data }) => ({ tick, data })), [
    { tick: 2 * 480, data: [60, 56] },
    { tick: 2 * 480, data: [64, 56] },
  ]);
  assert.deepEqual(tracks[1].filter(message => (message.status & 0xf0) === 0x80).map(message => message.tick), [5 * 480, 5 * 480]);
});

test("an empty score exports its full MIDI duration instead of a zero-length file", () => {
  const score = createScore("solo", false);
  for (const track of readMidiTracks(scoreToMidi(score))) assert.deepEqual(track.at(-1), { tick: 16 * 480, status: 0xff, type: 0x2f, data: [] });
});
