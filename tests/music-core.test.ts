import assert from "node:assert/strict";
import test from "node:test";
import { INSTRUMENTS, getInstrument } from "../lib/music/catalog";
import { collectPlaybackNotes, scoreToMidi, scoreToMusicXML } from "../lib/music/exporters";
import { TICKS_PER_QUARTER, durationTicks, getPrimaryVoice, measureCapacity, validateScore, voiceTicks, writtenToSounding } from "../lib/music/model";
import type { Pitch, ScoreDocument } from "../lib/music/model";
import { appendEvent, createScore, makeEvent, toggleTieLastTwo } from "../lib/music/score";

test("duration and meter arithmetic stays exact", () => {
  assert.equal(durationTicks({ base: 1, dots: 0 }), TICKS_PER_QUARTER * 4);
  assert.equal(durationTicks({ base: 4, dots: 1 }), TICKS_PER_QUARTER * 1.5);
  const score = createScore("solo");
  const measure = score.measures[score.measureOrder[0]];
  measure.time = { numerator: 6, denominator: 8 };
  assert.equal(measureCapacity(measure), TICKS_PER_QUARTER * 3);
});

test("written C4 produces the correct sounding pitch for transposing instruments", () => {
  const c4: Pitch = { step: "C", alter: 0, octave: 4 };
  const cases: Array<[string, number]> = [
    ["piccolo", 72],
    ["clarinet-bb", 58],
    ["horn-f", 53],
    ["bass-clarinet", 46],
    ["double-bass", 48],
    ["glockenspiel", 84],
  ];
  for (const [id, expected] of cases) assert.equal(writtenToSounding(c4, getInstrument(id).transposition), expected, id);
});

test("templates share one score schema and preserve instrument snapshots", () => {
  const expected = new Map([["solo", 1], ["quartet", 4], ["chamber", 11], ["orchestra", 25]]);
  for (const [template, count] of expected) {
    const score = createScore(template);
    assert.equal(score.parts.length, count, template);
    assert.equal(score.format, "garak-score");
    assert.equal(score.schemaVersion, 1);
    assert.equal(validateScore(score).length, 0);
    assert.ok(score.parts.every((part) => part.instrument.catalogId && Number.isInteger(part.instrument.midiProgram)));
  }
});

test("note entry advances to the next measure without overflow", () => {
  let score = createScore("solo");
  for (const measureId of score.measureOrder) score.parts[0].staves[0].measures[measureId].voices[0].events = [];
  const durations = [{ base: 4, dots: 1 }, { base: 8, dots: 0 }, { base: 2, dots: 0 }] as const;
  durations.forEach((duration, index) => {
    const result = appendEvent(score, score.parts[0].id, makeEvent({ id: `test-${index}`, pitch: { step: "C", alter: 0, octave: 4 }, duration, rest: false }));
    assert.equal(result.error, undefined);
    score = result.score;
  });
  const firstMeasure = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  assert.equal(voiceTicks(firstMeasure), measureCapacity(score.measures[score.measureOrder[0]]));
  const overflowResult = appendEvent(score, score.parts[0].id, makeEvent({ id: "next", pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }));
  assert.equal(overflowResult.measureId, score.measureOrder[1]);
  assert.equal(getPrimaryVoice(overflowResult.score.parts[0], score.measureOrder[1]).events.length, 1);
});

test("validator rejects overflow but permits an incomplete draft", () => {
  const draft = createScore("solo");
  for (const measureId of draft.measureOrder) draft.parts[0].staves[0].measures[measureId].voices[0].events = [];
  assert.equal(validateScore(draft).length, 0);
  const voice = getPrimaryVoice(draft.parts[0], draft.measureOrder[0]);
  voice.events.push(
    makeEvent({ id: "whole", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false }),
    makeEvent({ id: "quarter", pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }),
  );
  assert.match(validateScore(draft).join("\n"), /exceeds its time signature/);
});

test("a tie connects adjacent matching pitches and round-trips to MusicXML", () => {
  let score = createScore("solo");
  for (const measureId of score.measureOrder) score.parts[0].staves[0].measures[measureId].voices[0].events = [];
  for (const id of ["from", "to"]) {
    score = appendEvent(score, score.parts[0].id, makeEvent({ id, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false })).score;
  }
  const result = toggleTieLastTwo(score, score.parts[0].id);
  assert.equal(result.error, undefined);
  assert.equal(result.tied, true);
  assert.equal(result.score.ties.length, 1);
  const xml = scoreToMusicXML(result.score);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tie type="stop"\/>/);
  const performance = collectPlaybackNotes(result.score);
  assert.equal(performance.length, 1);
  assert.equal(performance[0].midi, 60);
  assert.ok(performance[0].durationSeconds > .9);
  const untied = toggleTieLastTwo(result.score, score.parts[0].id);
  assert.equal(untied.tied, false);
  assert.equal(untied.score.ties.length, 0);
});

test("native JSON, MusicXML, and MIDI exports reflect the score model", () => {
  const score = createScore("quartet");
  const roundTrip = JSON.parse(JSON.stringify(score)) as ScoreDocument;
  assert.equal(validateScore(roundTrip).length, 0);
  assert.deepEqual(roundTrip, score);

  const musicXml = scoreToMusicXML(score);
  assert.match(musicXml, /^<\?xml version="1\.0"/);
  assert.match(musicXml, /<score-partwise version="4\.0">/);
  assert.equal((musicXml.match(/<score-part id=/g) ?? []).length, score.parts.length);
  assert.equal((musicXml.match(/<part id=/g) ?? []).length, score.parts.length);

  const midi = scoreToMidi(score);
  assert.equal(new TextDecoder().decode(midi.subarray(0, 4)), "MThd");
  assert.equal((midi[10] << 8) | midi[11], score.parts.length + 1);
  assert.ok(midi.length > 100);
});

test("instrument catalog IDs and MIDI programs are valid", () => {
  const ids = new Set(INSTRUMENTS.map((instrument) => instrument.catalogId));
  assert.equal(ids.size, INSTRUMENTS.length);
  assert.ok(INSTRUMENTS.length >= 45);
  assert.ok(INSTRUMENTS.every((instrument) => Number.isInteger(instrument.midiProgram) && instrument.midiProgram >= 0 && instrument.midiProgram <= 127));
});
