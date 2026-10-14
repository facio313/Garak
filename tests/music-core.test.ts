import { metronomeNotes, countInForPosition, METRONOME_PART } from "../lib/music/metronome";
import { createLivePlayback } from "../lib/music/live-playback";
import { playbackNoteAtRate, createPlaybackQueue, clipPlaybackNote } from "../lib/music/playback-transport";
import { eventRhythm } from "../lib/music/score";
import assert from "node:assert/strict";
import test from "node:test";
import { FAMILIES, FAMILY_COLORS, INSTRUMENTS, SCORE_TEMPLATES, getInstrument } from "../lib/music/catalog";
import { keySignaturesEqual, resolveMeasureAccidentals, timeSignaturesEqual } from "../lib/music/engraving";
import { LIVE_ENGRAVING_LIMITS, measureLiveEngraving, planLiveEngraving } from "../lib/music/engraving-budget";
import { ARTICULATION_VELOCITY_BONUSES, collectPlaybackNotes, encodeMidiVariableLength, scoreToMidi, scoreToMusicXML, selectPlaybackWindow, STACCATO_GATE_RATIO } from "../lib/music/exporters";
import { KEY_SIGNATURES, concertToWrittenKey, createWrittenKeySignatureSnapshot, fifthsToVexFlowKey, keySignatureAlterForStep, keySignatureName, writtenKeyForPart } from "../lib/music/key-signatures";
import { getDefaultBeamGroups, getFullMeasureDuration } from "../lib/music/meter";
import { importMusicXML } from "../lib/music/importers";
import { ARTICULATIONS, DEFAULT_MIDI_VELOCITY, DURATION_LABELS, DYNAMIC_MARKINGS, DYNAMIC_VELOCITIES, TICKS_PER_QUARTER, durationTicks, eventCount, getPrimaryVoice, measureCapacity, nextAugmentationDotCount, validateScore, voiceTicks, writtenMidi, writtenToSounding } from "../lib/music/model";
import type { MusicEvent, Pitch, ScoreDocument, ScoreNote } from "../lib/music/model";
import { MAX_NATIVE_SCORE_BYTES, serializeNativeScore } from "../lib/music/native-format";
import { eventTimeline, timedHairpins } from "../lib/music/hairpins";
import { schedulePlaybackGain } from "../lib/music/playback-gain";
import { locatePlaybackPosition } from "../lib/music/playback-position";
import { addChordTone, addChordToneToEvent, addInstrument, appendEvent, appendMeasure, changeEventRangeDuration, clearEventRange, clearEventToRest, copyEventRangeToPosition, createScore, editEventNotation, findEventTargetMeasureId, getEventMoveGroup, getEventRange, getTiedNoteIds, makeEvent, moveEventRangeToPosition, moveEventToPosition, removeChordToneFromEvent, removeEvent, removeInstrument, removeLastChordTone, removeLastEvent, removeLastMeasure, setEventArticulation, setEventDynamic, setEventRangeExpression, setEventRangeHairpin, setKeyFromMeasure, setLastEventDynamic, setLastNoteArticulation, setMeasureKey, setNoteTie, setScoreKey, setTimeFromMeasure, toggleTieLastTwo, transposeEventRange } from "../lib/music/score";

test("new Solo scores use the chosen instrument's staff layout and transposition and round-trip after setup", () => {
  for (const catalogId of ["flute", "clarinet-bb", "piano", "organ"]) {
    const score = createScore("solo", { seedDemo: false, soloInstrumentId: catalogId });
    const instrument = getInstrument(catalogId);
    assert.equal(score.parts.length, 1);
    assert.equal(score.parts[0].instrument.catalogId, catalogId);
    assert.deepEqual(score.parts[0].instrument.transposition, instrument.transposition);
    assert.deepEqual(score.parts[0].staves.map((staff) => staff.clef), instrument.staffClefs ?? [instrument.clef]);
    const next = setTimeFromMeasure(score, score.measureOrder[0], { numerator: 6, denominator: 8 }).score;
    next.tempo = 72;
    assert.deepEqual(validateScore(next), []);
    const restored = JSON.parse(serializeNativeScore(next));
    assert.deepEqual(restored, next);
    for (const id of next.measureOrder) {
      assert.deepEqual(next.measures[id].time, { numerator: 6, denominator: 8 });
      for (const staff of next.parts[0].staves) assert.equal(staff.measures[id].voices[0].events.length, 0);
    }
  }
});

test("Solo instrument choices do not replace ensemble parts and invalid instruments are rejected", () => {
  assert.equal(createScore("solo", false).parts[0].instrument.catalogId, "piano");
  assert.deepEqual(createScore("quartet", { seedDemo: false, soloInstrumentId: "flute" }).parts.map((part) => part.instrument.catalogId), ["violin", "violin", "viola", "cello"]);
  assert.throws(() => createScore("solo", { seedDemo: false, soloInstrumentId: "not-an-instrument" }), /catalog/);
});

test("live engraving planning bounds the single-SVG renderer without mutating or truncating a score", () => {
  const score = createScore("solo", { seedDemo: false });
  score.measureOrder = Array.from({ length: LIVE_ENGRAVING_LIMITS.measures }, (_, index) => `budget-measure-${index}`);
  const exact = measureLiveEngraving(score, score.parts);
  assert.equal(exact.measures, LIVE_ENGRAVING_LIMITS.measures);
  assert.equal(exact.staffMeasureCells, LIVE_ENGRAVING_LIMITS.measures * 2);
  assert.equal(planLiveEngraving(score, "part", score.parts[0].id).kind, "safe");

  score.measureOrder.push("budget-measure-over");
  const beforeBlockedPlan = structuredClone(score);
  const blocked = planLiveEngraving(score, "part", score.parts[0].id);
  assert.equal(blocked.kind, "blocked");
  assert.ok(blocked.exceeded.includes("measures"));
  assert.deepEqual(score, beforeBlockedPlan);

  const manyParts = createScore("chamber", { seedDemo: false });
  manyParts.parts = Array.from({ length: LIVE_ENGRAVING_LIMITS.rows + 1 }, (_, index) => ({
    ...structuredClone(manyParts.parts[0]),
    id: `budget-part-${index}`,
  }));
  const fallback = planLiveEngraving(manyParts, "score", manyParts.parts[0].id);
  assert.equal(fallback.kind, "part-fallback");
  assert.equal(fallback.parts.length, 1);
  assert.ok(fallback.stats.rows > LIVE_ENGRAVING_LIMITS.rows);
  assert.equal(fallback.renderedStats.rows, 1);
  assert.ok(fallback.exceeded.includes("rows"));
});

test("score growth commands preserve the source identity at the staff-measure safety boundary", () => {
  const score = createScore("chamber", { seedDemo: false });
  score.parts = [{ ...score.parts[0], staves: [score.parts[0].staves[0]] }];
  score.measureOrder = Array.from({ length: 10_000 }, (_, index) => `limit-measure-${index + 1}`);
  score.measures = Object.fromEntries(score.measureOrder.map((id, index) => [id, {
    id,
    number: index + 1,
    time: { numerator: 4, denominator: 4 },
    key: { fifths: 0, mode: "major" },
  }]));
  const staff = score.parts[0].staves[0];
  staff.measures = Object.fromEntries(score.measureOrder.map((measureId, index) => [measureId, {
    voices: [{ id: `limit-voice-${index + 1}`, events: [] }],
  }]));
  assert.deepEqual(validateScore(score), []);
  assert.equal(addInstrument(score, "violin"), score, "adding a part must be rejected atomically");
  assert.equal(appendMeasure(score), score, "adding a measure must be rejected atomically");
  assert.deepEqual(validateScore(score), [], "rejected commands must not mutate the source");
});

test("native snapshots are compact and enforce a portable canonical byte ceiling", () => {
  const score = createScore("solo", { seedDemo: false });
  const compact = serializeNativeScore(score);
  assert.equal(compact, JSON.stringify(score));
  assert.ok(!compact.includes("\n"));

  const oversized = createScore("chamber", { seedDemo: false });
  oversized.parts = [{ ...oversized.parts[0], staves: [oversized.parts[0].staves[0]] }];
  oversized.measureOrder = Array.from({ length: 10_000 }, (_, index) => {
    const prefix = `portable-measure-${index}-`;
    return prefix + "m".repeat(256 - prefix.length);
  });
  oversized.measures = Object.fromEntries(oversized.measureOrder.map((id, index) => [id, {
    id,
    number: index + 1,
    time: { numerator: 4, denominator: 4 },
    key: { fifths: 0, mode: "major" },
  }]));
  const staff = oversized.parts[0].staves[0];
  staff.measures = Object.fromEntries(oversized.measureOrder.map((measureId, index) => {
    const prefix = `portable-voice-${index}-`;
    return [measureId, { voices: [{ id: prefix + "v".repeat(1_024 - prefix.length), events: [] }] }];
  }));
  assert.deepEqual(validateScore(oversized), [], "the aggregate byte ceiling must cover a shape that is otherwise schema-valid");
  assert.ok(JSON.stringify(oversized).length > MAX_NATIVE_SCORE_BYTES);
  assert.throws(() => serializeNativeScore(oversized), /20 MB portable native-snapshot limit/);
});

test("duration and meter arithmetic stays exact", () => {
  assert.equal(durationTicks({ base: 1, dots: 0 }), TICKS_PER_QUARTER * 4);
  assert.equal(durationTicks({ base: 4, dots: 1 }), TICKS_PER_QUARTER * 1.5);
  assert.equal(durationTicks({ base: 32, dots: 0 }), 120);
  assert.equal(durationTicks({ base: 32, dots: 2 }), 210);
  assert.equal(durationTicks({ base: 64, dots: 0 }), 60);
  assert.equal(durationTicks({ base: 64, dots: 1 }), 90);
  assert.equal(durationTicks({ base: 64, dots: 2 }), 105);
  for (const base of [1, 2, 4, 8, 16, 32, 64] as const) {
    for (const dots of [0, 1, 2] as const) {
      const expected = TICKS_PER_QUARTER * 4 * (2 ** (dots + 1) - 1) / (base * 2 ** dots);
      assert.equal(durationTicks({ base, dots }), expected, `${base} with ${dots} dots`);
      assert.ok(Number.isInteger(durationTicks({ base, dots })), `${base} with ${dots} dots must remain an integer tick count`);
    }
  }
  assert.equal(DURATION_LABELS[32], "Thirty-second");
  assert.equal(DURATION_LABELS[64], "Sixty-fourth");
  assert.deepEqual(
    ([0, 1, 2] as const).map((dots) => nextAugmentationDotCount(dots)),
    [1, 2, 0],
  );
  const score = createScore("solo");
  const measure = score.measures[score.measureOrder[0]];
  measure.time = { numerator: 6, denominator: 8 };
  assert.equal(measureCapacity(measure), TICKS_PER_QUARTER * 3);
});

test("playback seconds map to exact measure and denominator-beat boundaries across meter changes", () => {
  const score = createScore("solo", { seedDemo: false });
  score.tempo = 120;
  const [firstId, secondId, thirdId, fourthId] = score.measureOrder;
  score.measures[firstId].time = { numerator: 4, denominator: 4 };
  score.measures[secondId].time = { numerator: 6, denominator: 8 };
  score.measures[thirdId].time = { numerator: 3, denominator: 4 };
  score.measures[fourthId].time = { numerator: 5, denominator: 8 };

  assert.deepEqual(locatePlaybackPosition(score, -10), {
    measureId: firstId,
    measureNumber: score.measures[firstId].number,
    tickInMeasure: 0,
    measureProgress: 0,
    beat: 1,
  });
  assert.deepEqual(locatePlaybackPosition(score, Number.NaN), locatePlaybackPosition(score, 0));

  const firstBeatTwo = locatePlaybackPosition(score, 0.5);
  assert.equal(firstBeatTwo?.measureId, firstId);
  assert.equal(firstBeatTwo?.tickInMeasure, TICKS_PER_QUARTER);
  assert.equal(firstBeatTwo?.measureProgress, 0.25);
  assert.equal(firstBeatTwo?.beat, 2);

  const secondStart = locatePlaybackPosition(score, 2);
  assert.equal(secondStart?.measureId, secondId, "an exact barline belongs to the following measure");
  assert.equal(secondStart?.tickInMeasure, 0);
  assert.equal(secondStart?.measureProgress, 0);
  assert.equal(secondStart?.beat, 1);

  const secondBeatTwo = locatePlaybackPosition(score, 2.25);
  assert.equal(secondBeatTwo?.measureId, secondId);
  assert.equal(secondBeatTwo?.tickInMeasure, TICKS_PER_QUARTER / 2);
  assert.equal(secondBeatTwo?.beat, 2, "6/8 labels denominator eighth-note beats");

  const secondMidpoint = locatePlaybackPosition(score, 2.75);
  assert.equal(secondMidpoint?.measureId, secondId);
  assert.equal(secondMidpoint?.measureProgress, 0.5);
  assert.equal(secondMidpoint?.beat, 4);

  const thirdStart = locatePlaybackPosition(score, 3.5);
  assert.equal(thirdStart?.measureId, thirdId);
  assert.equal(thirdStart?.tickInMeasure, 0);
  assert.equal(thirdStart?.beat, 1);

  const fourthStart = locatePlaybackPosition(score, 5);
  assert.equal(fourthStart?.measureId, fourthId);
  assert.equal(fourthStart?.tickInMeasure, 0);
  assert.equal(fourthStart?.beat, 1);

  const beyondScore = locatePlaybackPosition(score, 999);
  assert.equal(beyondScore?.measureId, fourthId, "elapsed audio beyond the score clamps to its final measure");
  assert.equal(beyondScore?.tickInMeasure, measureCapacity(score.measures[fourthId]));
  assert.equal(beyondScore?.measureProgress, 1);
  assert.equal(beyondScore?.beat, 5);
});

test("playback position returns null when a score has no ordered measures", () => {
  const score = createScore("solo", { seedDemo: false });
  score.measureOrder = [];
  assert.equal(locatePlaybackPosition(score, 0), null);
});

test("meter helpers provide exact default beam groups and full-measure durations", () => {
  const cases = [
    [{ numerator: 2, denominator: 4 }, [1, 1]],
    [{ numerator: 3, denominator: 4 }, [1, 1, 1]],
    [{ numerator: 4, denominator: 4 }, [1, 1, 1, 1]],
    [{ numerator: 6, denominator: 8 }, [3, 3]],
    [{ numerator: 9, denominator: 8 }, [3, 3, 3]],
    [{ numerator: 12, denominator: 8 }, [3, 3, 3, 3]],
    [{ numerator: 5, denominator: 8 }, [2, 3]],
    [{ numerator: 7, denominator: 8 }, [2, 2, 3]],
  ] as const;

  for (const [meter, expectedGroupNumerators] of cases) {
    const groups = getDefaultBeamGroups(meter);
    assert.deepEqual(groups, expectedGroupNumerators.map((numerator) => ({ numerator, denominator: meter.denominator })));
    assert.equal(groups.reduce((total, group) => total + group.numerator, 0), meter.numerator);
    assert.ok(groups.every((group) => group.denominator === meter.denominator));
    assert.deepEqual(getFullMeasureDuration(meter), meter);
  }
});

test("meter helpers reject values that cannot form an exact rational meter", () => {
  for (const meter of [
    { numerator: 0, denominator: 4 },
    { numerator: -3, denominator: 4 },
    { numerator: 3.5, denominator: 4 },
    { numerator: 3, denominator: 0 },
    { numerator: 3, denominator: 4.5 },
    { numerator: Number.MAX_SAFE_INTEGER + 1, denominator: 4 },
  ]) {
    assert.throws(() => getDefaultBeamGroups(meter), RangeError);
    assert.throws(() => getFullMeasureDuration(meter), RangeError);
  }
});

test("catalog transposition presets map written C4 to the documented sounding pitch", () => {
  const c4: Pitch = { step: "C", alter: 0, octave: 4 };
  const cases: Array<[string, [number, number, number], number]> = [
    ["piccolo", [0, 0, 1], 72],
    ["bass-flute", [0, 0, -1], 48],
    ["contrabass-flute", [0, 0, -2], 36],
    ["oboe-damore", [-2, -3, 0], 57],
    ["english-horn", [-4, -7, 0], 53],
    ["clarinet-d", [1, 2, 0], 62],
    ["clarinet-eb", [2, 3, 0], 63],
    ["clarinet-bb", [-1, -2, 0], 58],
    ["basset-horn-f", [-4, -7, 0], 53],
    ["alto-clarinet-eb", [-5, -9, 0], 51],
    ["bass-clarinet", [-1, -2, -1], 46],
    ["contralto-clarinet-eb", [-5, -9, -1], 39],
    ["contrabass-clarinet-bb", [-1, -2, -2], 34],
    ["sopranino-sax", [2, 3, 0], 63],
    ["alto-sax", [-5, -9, 0], 51],
    ["tenor-sax", [-1, -2, -1], 46],
    ["baritone-sax", [-5, -9, -1], 39],
    ["bass-sax", [-1, -2, -2], 34],
    ["contrabass-sax", [-5, -9, -2], 27],
    ["piccolo-trumpet-bb", [-1, -2, 1], 70],
    ["piccolo-trumpet-a", [-2, -3, 1], 69],
    ["bass-trumpet-bb", [-1, -2, -1], 46],
    ["euphonium", [0, 0, 0], 60],
    ["euphonium-treble-bb", [-1, -2, -1], 46],
    ["tuba-bb", [0, 0, 0], 60],
    ["tuba-bb-treble", [-1, -2, -2], 34],
    ["tuba-eb", [0, 0, 0], 60],
    ["tuba-eb-treble", [-5, -9, -1], 39],
    ["celesta", [0, 0, 1], 72],
    ["guitar", [0, 0, -1], 48],
    ["electric-bass", [0, 0, -1], 48],
    ["double-bass", [0, 0, -1], 48],
    ["glockenspiel", [0, 0, 2], 84],
    ["crotales", [0, 0, 2], 84],
    ["tenor", [0, 0, -1], 48],
  ];
  for (const [id, [diatonic, chromatic, octaveChange], expectedMidi] of cases) {
    const instrument = getInstrument(id);
    assert.equal(instrument.catalogId, id, `missing catalog preset: ${id}`);
    assert.deepEqual(instrument.transposition, { diatonic, chromatic, octaveChange }, id);
    assert.equal(writtenToSounding(c4, instrument.transposition), expectedMidi, id);
  }
});

test("all -7..7 major and minor key signatures have stable metadata and VexFlow names", () => {
  assert.equal(KEY_SIGNATURES.length, 30);
  assert.equal(new Set(KEY_SIGNATURES.map(({ fifths, mode }) => `${fifths}:${mode}`)).size, 30);
  for (const mode of ["major", "minor"] as const) {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      const option = KEY_SIGNATURES.find((candidate) => candidate.fifths === fifths && candidate.mode === mode);
      assert.ok(option, `${fifths} ${mode}`);
      assert.equal(keySignatureName(option), option.label);
      assert.match(fifthsToVexFlowKey(fifths), /^[A-G](?:b|#)?$/);
    }
  }
  assert.equal(keySignatureName({ fifths: -7, mode: "major" }), "C♭ major");
  assert.equal(keySignatureName({ fifths: 7, mode: "minor" }), "A♯ minor");
  assert.equal(keySignatureAlterForStep({ fifths: 1, mode: "major" }, "F"), 1);
  assert.equal(keySignatureAlterForStep({ fifths: 1, mode: "major" }, "C"), 0);
  assert.equal(keySignatureAlterForStep({ fifths: -5, mode: "major" }, "G"), -1);
  assert.equal(keySignatureAlterForStep({ fifths: -5, mode: "major" }, "C"), 0);
  assert.throws(() => fifthsToVexFlowKey(8), RangeError);
});

test("new scores and immutable score commands preserve a selectable concert key", () => {
  const original = createScore("solo", { seedDemo: false, key: { fifths: -7, mode: "minor" } });
  assert.ok(original.measureOrder.every((measureId) => original.measures[measureId].key.fifths === -7));
  assert.ok(original.measureOrder.every((measureId) => original.measures[measureId].key.mode === "minor"));

  const globallyChanged = setScoreKey(original, { fifths: 7, mode: "major" });
  assert.notEqual(globallyChanged, original);
  assert.deepEqual(original.measures[original.measureOrder[0]].key, { fifths: -7, mode: "minor" });
  assert.ok(globallyChanged.measureOrder.every((measureId) => globallyChanged.measures[measureId].key.fifths === 7));

  const locallyChanged = setMeasureKey(globallyChanged, globallyChanged.measureOrder[1], { fifths: -3, mode: "minor" });
  assert.deepEqual(locallyChanged.measures[locallyChanged.measureOrder[1]].key, { fifths: -3, mode: "minor" });
  assert.deepEqual(globallyChanged.measures[globallyChanged.measureOrder[1]].key, { fifths: 7, mode: "major" });

  const roundTrip = JSON.parse(JSON.stringify(locallyChanged)) as ScoreDocument;
  assert.deepEqual(roundTrip, locallyChanged);
  assert.deepEqual(validateScore(roundTrip), []);
  assert.throws(() => createScore("solo", { key: { fifths: 8, mode: "major" } }), RangeError);
});

test("measure key and meter edits persist until the next existing change without erasing it", () => {
  const source = createScore("solo", { seedDemo: false });
  const [, secondId, thirdId, fourthId] = source.measureOrder;
  source.measures[fourthId].key = { fifths: -2, mode: "minor" };
  source.measures[fourthId].time = { numerator: 6, denominator: 8 };
  const snapshot = structuredClone(source);

  const keyed = setKeyFromMeasure(source, secondId, { fifths: 3, mode: "major" });
  assert.equal(keyed.changed, true);
  assert.deepEqual(keyed.affectedMeasureIds, [secondId, thirdId]);
  assert.deepEqual(source, snapshot, "a key change must preserve the undo snapshot");
  assert.deepEqual(keyed.score.measureOrder.map((id) => keyed.score.measures[id].key), [
    { fifths: 0, mode: "major" },
    { fifths: 3, mode: "major" },
    { fifths: 3, mode: "major" },
    { fifths: -2, mode: "minor" },
  ]);

  const metered = setTimeFromMeasure(keyed.score, secondId, { numerator: 3, denominator: 4 });
  assert.equal(metered.changed, true);
  assert.deepEqual(metered.affectedMeasureIds, [secondId, thirdId]);
  assert.deepEqual(metered.score.measureOrder.map((id) => metered.score.measures[id].time), [
    { numerator: 4, denominator: 4 },
    { numerator: 3, denominator: 4 },
    { numerator: 3, denominator: 4 },
    { numerator: 6, denominator: 8 },
  ]);

  const noChange = setTimeFromMeasure(metered.score, secondId, { numerator: 3, denominator: 4 });
  assert.equal(noChange.changed, false);
  assert.equal(noChange.score, metered.score);
  assert.deepEqual(noChange.affectedMeasureIds, []);
  assert.deepEqual(validateScore(metered.score), []);

  const midiBytes = [...scoreToMidi(metered.score)];
  const midiTimeSignatures: Array<[number, number]> = [];
  for (let index = 0; index <= midiBytes.length - 7; index += 1) {
    if (midiBytes[index] === 0xff && midiBytes[index + 1] === 0x58 && midiBytes[index + 2] === 0x04) {
      midiTimeSignatures.push([midiBytes[index + 3], midiBytes[index + 4]]);
    }
  }
  assert.deepEqual(midiTimeSignatures, [[4, 2], [3, 2], [6, 3]], "MIDI must emit each actual meter boundary with a log2 beat type");
});

test("a meter edit rejects every affected staff and voice overflow without any partial mutation", () => {
  const source = createScore("solo", { seedDemo: false });
  const [, secondId] = source.measureOrder;
  const lowerStaffMeasure = source.parts[0].staves[1].measures[secondId];
  lowerStaffMeasure.voices.push({
    id: "meter-overflow-voice-2",
    events: [makeEvent({
      id: "meter-overflow-whole",
      pitch: { step: "C", alter: 0, octave: 3 },
      duration: { base: 1, dots: 0 },
      rest: false,
    })],
  });
  const snapshot = structuredClone(source);

  const rejected = setTimeFromMeasure(source, secondId, { numerator: 3, denominator: 4 });
  assert.equal(rejected.changed, false);
  assert.equal(rejected.score, source, "rejection must return the exact source object");
  assert.deepEqual(rejected.affectedMeasureIds, []);
  assert.match(rejected.error ?? "", /Piano, staff 2, measure 2, voice 2/);
  assert.match(rejected.error ?? "", /Cannot change to 3\/4.*more music than fits.*Shorten the notes or rests/);
  assert.deepEqual(source, snapshot, "rejection must not modify any measure before discovering overflow");
  assert.ok(source.measureOrder.every((id) => source.measures[id].time.numerator === 4));

  const missing = setTimeFromMeasure(source, "missing-measure", { numerator: 3, denominator: 4 });
  assert.equal(missing.score, source);
  assert.match(missing.error ?? "", /measure that exists/i);
  const invalid = setTimeFromMeasure(source, secondId, { numerator: 0, denominator: 4 });
  assert.equal(invalid.score, source);
  assert.match(invalid.error ?? "", /1–255 whole-number/i);
  const midiOverflow = setTimeFromMeasure(source, secondId, { numerator: 256, denominator: 4 });
  assert.equal(midiOverflow.score, source);
  assert.match(midiOverflow.error ?? "", /1–255 whole-number/i);
  const nonBinaryBeatType = setTimeFromMeasure(source, secondId, { numerator: 1, denominator: 7 });
  assert.equal(nonBinaryBeatType.score, source);
  assert.match(nonBinaryBeatType.error ?? "", /power-of-two beat type/i);
  const fractionalTickCapacity = setTimeFromMeasure(source, secondId, { numerator: 1, denominator: 8192 });
  assert.equal(fractionalTickCapacity.score, source);
  assert.match(fractionalTickCapacity.error ?? "", /represented safely/i);
});

test("a meter edit atomically rejects a new gap between tied barline notes", () => {
  const source = createScore("solo", { seedDemo: false });
  const [firstMeasureId, secondMeasureId] = source.measureOrder;
  const first = makeEvent({
    id: "meter-tie-from-event",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 1, dots: 0 },
    rest: false,
  });
  const second = makeEvent({
    id: "meter-tie-to-event",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  });
  getPrimaryVoice(source.parts[0], firstMeasureId).events.push(first);
  getPrimaryVoice(source.parts[0], secondMeasureId).events.push(second);
  if (first.kind !== "note" || second.kind !== "note") assert.fail("meter tie fixtures must be note events");
  source.ties.push({ id: "meter-boundary-tie", fromNoteId: first.notes[0].id, toNoteId: second.notes[0].id });
  assert.deepEqual(validateScore(source), []);
  const snapshot = structuredClone(source);

  const rejected = setTimeFromMeasure(source, firstMeasureId, { numerator: 5, denominator: 4 });
  assert.equal(rejected.score, source);
  assert.equal(rejected.changed, false);
  assert.deepEqual(rejected.affectedMeasureIds, []);
  assert.match(rejected.error ?? "", /Cannot change to 5\/4.*Tie.*start tick.*end tick/i);
  assert.deepEqual(source, snapshot, "a rejected meter edit must leave the source and its tie untouched");
});

test("validator rejects malformed key signatures and transposition snapshots", () => {
  const score = createScore("solo");
  const measure = score.measures[score.measureOrder[0]];
  measure.key = { fifths: 8, mode: "major" };
  assert.match(validateScore(score).join("\n"), /invalid key signature/);

  measure.key = { fifths: 0.5, mode: "minor" };
  assert.match(validateScore(score).join("\n"), /invalid key signature/);

  (measure.key as { fifths: number; mode: string }).mode = "dorian";
  assert.match(validateScore(score).join("\n"), /invalid key signature/);

  measure.key = { fifths: 0, mode: "major" };
  score.parts[0].instrument.transposition.chromatic = Number.NaN;
  assert.match(validateScore(score).join("\n"), /invalid transposition snapshot/);
});

test("concert keys produce written keys for transposing instrument snapshots", () => {
  const concertC = { fifths: 0, mode: "major" as const };
  const cases: Array<[string, number]> = [
    ["piccolo", 0],
    ["clarinet-bb", 2],
    ["horn-f", 1],
    ["alto-sax", 3],
    ["clarinet-a", -3],
  ];
  for (const [catalogId, expectedFifths] of cases) {
    const instrument = getInstrument(catalogId);
    assert.deepEqual(concertToWrittenKey(concertC, instrument.transposition), { fifths: expectedFifths, mode: "major" }, catalogId);
    const snapshot = createWrittenKeySignatureSnapshot(concertC, instrument);
    assert.deepEqual(snapshot.writtenKey, { fifths: expectedFifths, mode: "major" }, catalogId);
    assert.notEqual(snapshot.transposition, instrument.transposition);
  }

  assert.deepEqual(concertToWrittenKey({ fifths: 7, mode: "major" }, getInstrument("clarinet-bb").transposition), { fifths: -3, mode: "major" });
  assert.deepEqual(concertToWrittenKey({ fifths: -7, mode: "minor" }, getInstrument("clarinet-a").transposition), { fifths: 2, mode: "minor" });
});

test("MusicXML exports each part's written key and measure-level key changes", () => {
  let score = createScore("solo", { seedDemo: false, key: { fifths: 0, mode: "major" } });
  score = addInstrument(score, "clarinet-bb");
  for (const measureId of score.measureOrder.slice(1)) {
    score = setMeasureKey(score, measureId, { fifths: -3, mode: "minor" });
  }
  const musicXml = scoreToMusicXML(score);
  const pianoPart = musicXml.match(/<part id="part-1-piano">([\s\S]*?)<\/part>/)?.[1] ?? "";
  const clarinetPart = musicXml.match(/<part id="part-2-clarinet-bb">([\s\S]*?)<\/part>/)?.[1] ?? "";

  assert.match(pianoPart, /<key><fifths>0<\/fifths><mode>major<\/mode><\/key>/);
  assert.match(pianoPart, /<key><fifths>-3<\/fifths><mode>minor<\/mode><\/key>/);
  assert.match(clarinetPart, /<key><fifths>2<\/fifths><mode>major<\/mode><\/key>/);
  assert.match(clarinetPart, /<key><fifths>-1<\/fifths><mode>minor<\/mode><\/key>/);
  assert.match(clarinetPart, /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><octave-change>0<\/octave-change><\/transpose>/);
  assert.equal((clarinetPart.match(/<key>/g) ?? []).length, 2);
});

test("MusicXML rejects XML 1.0 forbidden characters with their exact code point", () => {
  const forbidden = [
    ["NUL", "\u0000", "U+0000"],
    ["vertical tab", "\u000b", "U+000B"],
    ["unit separator", "\u001f", "U+001F"],
    ["lone high surrogate", "\ud800", "U+D800"],
    ["lone low surrogate", "\udfff", "U+DFFF"],
    ["BMP noncharacter", "\ufffe", "U+FFFE"],
  ] as const;

  for (const [name, character, codePoint] of forbidden) {
    const score = createScore("solo", { seedDemo: false });
    score.metadata.title = `Before${character}After`;
    assert.deepEqual(validateScore(score), [], `${name} remains structurally valid until the format-specific export boundary`);
    assert.throws(
      () => scoreToMusicXML(score),
      {
        name: "Error",
        message: `MusicXML text contains XML 1.0 forbidden character ${codePoint}.`,
      },
      name,
    );
  }
});

test("MusicXML preserves allowed XML 1.0 whitespace and emoji while escaping markup characters", () => {
  const score = createScore("solo", { seedDemo: false });
  score.metadata.title = "Tab\tLine\nReturn\rEmoji 😀 & < > \" '";

  const musicXml = scoreToMusicXML(score);
  assert.ok(musicXml.includes("<work-title>Tab\tLine\nReturn\rEmoji 😀 &amp; &lt; &gt; &quot; &apos;</work-title>"));
  assert.doesNotMatch(musicXml, /Emoji 😀 & < > "/);
});

test("MusicXML part-list assigns pitched channels without using unpitched channel 10", () => {
  let score = createScore("solo", { seedDemo: false });
  for (let index = 0; index < 9; index += 1) score = addInstrument(score, "flute");
  score = addInstrument(score, "snare-drum");

  const musicXml = scoreToMusicXML(score);
  const channels = score.parts.map((part) => {
    const scorePart = musicXml.match(new RegExp(`<score-part id="${part.id}">([\\s\\S]*?)<\\/score-part>`))?.[1] ?? "";
    return Number(scorePart.match(/<midi-channel>(\d+)<\/midi-channel>/)?.[1]);
  });

  assert.deepEqual(channels.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
  assert.equal(channels[10], 10);
  assert.ok(score.parts.slice(0, 10).every((part) => part.instrument.clef !== "percussion"));
  assert.equal(score.parts[10].instrument.clef, "percussion");
});

test("the full orchestra uses independent MIDI ports without treating pitched timpani as drums", () => {
  const score = createScore("orchestra", { seedDemo: false });
  const musicXml = scoreToMusicXML(score);
  const routes = score.parts.map((part) => {
    const scorePart = musicXml.match(new RegExp(`<score-part id="${part.id}">([\\s\\S]*?)<\\/score-part>`))?.[1] ?? "";
    return {
      part,
      port: Number(scorePart.match(/<midi-device port="(\d+)"\/>/)?.[1]),
      channel: Number(scorePart.match(/<midi-channel>(\d+)<\/midi-channel>/)?.[1]),
      program: Number(scorePart.match(/<midi-program>(\d+)<\/midi-program>/)?.[1]),
    };
  });
  const pitchedRoutes = routes.filter(({ part }) => part.instrument.clef !== "percussion");
  assert.equal(new Set(pitchedRoutes.map(({ port, channel }) => `${port}:${channel}`)).size, pitchedRoutes.length,
    "each pitched orchestral part needs an independent port/channel program slot");
  assert.ok(pitchedRoutes.every(({ channel }) => channel !== 10));
  assert.ok(routes.some(({ port }) => port === 2), "a 25-part orchestra must use a second MIDI port");

  const timpani = routes.find(({ part }) => part.instrument.catalogId === "timpani");
  const unpitched = routes.find(({ part }) => part.instrument.clef === "percussion");
  assert.ok(timpani);
  assert.notEqual(timpani.channel, 10, "pitched timpani must keep melodic pitch and program semantics");
  assert.equal(timpani.program, timpani.part.instrument.midiProgram + 1);
  assert.ok(unpitched);
  assert.equal(unpitched.channel, 10);

  const midiBytes = [...scoreToMidi(score)];
  const midiPorts: number[] = [];
  for (let index = 0; index <= midiBytes.length - 4; index += 1) {
    if (midiBytes[index] === 0xff && midiBytes[index + 1] === 0x21 && midiBytes[index + 2] === 0x01) {
      midiPorts.push(midiBytes[index + 3]);
    }
  }
  assert.deepEqual(midiPorts, routes.map(({ port }) => port - 1),
    "every SMF part track must declare the same zero-based MIDI port as MusicXML");
});

test("MusicXML export maps opaque part IDs to safe unique XML IDs across every reference", () => {
  let score = createScore("solo", { seedDemo: false });
  score = addInstrument(score, "flute");
  score = addInstrument(score, "oboe");
  score = addInstrument(score, "bassoon");
  [score.parts[0].id, score.parts[1].id, score.parts[2].id, score.parts[3].id] = [
    "Section A",
    "9 lead",
    "Section@A",
    "Section A-i1",
  ];

  const musicXml = scoreToMusicXML(score);
  const scorePartIds = [...musicXml.matchAll(/<score-part id="([^"]+)"/g)].map((match) => match[1]);
  const bodyPartIds = [...musicXml.matchAll(/\n {2}<part id="([^"]+)"/g)].map((match) => match[1]);
  const scoreInstrumentIds = [...musicXml.matchAll(/<score-instrument id="([^"]+)"/g)].map((match) => match[1]);
  const midiInstrumentIds = [...musicXml.matchAll(/<midi-instrument id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(scorePartIds, ["Section-A", "P-9-lead", "Section-A-2", "Section-A-i1"]);
  assert.deepEqual(bodyPartIds, scorePartIds, "part bodies must reuse the part-list mapping");
  assert.deepEqual(midiInstrumentIds, scoreInstrumentIds, "MIDI instrument references must target the generated score-instrument IDs");
  assert.equal(scoreInstrumentIds[0], "Section-A-i1-2", "instrument IDs must not collide with any generated part ID");
  assert.ok([...scorePartIds, ...scoreInstrumentIds].every((id) => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id)));
  assert.equal(new Set([...scorePartIds, ...scoreInstrumentIds]).size, score.parts.length * 2);
});

test("MusicXML exports empty measures as complete rests with the active meter duration", () => {
  const score = createScore("solo", { seedDemo: false });
  score.parts[0].staves = [score.parts[0].staves[0]];
  score.measures[score.measureOrder[0]].time = { numerator: 6, denominator: 8 };
  score.measures[score.measureOrder[1]].time = { numerator: 5, denominator: 8 };
  const musicXml = scoreToMusicXML(score);
  const pianoPart = musicXml.match(/<part id="part-1-piano">([\s\S]*?)<\/part>/)?.[1] ?? "";
  const firstMeasure = pianoPart.match(/<measure number="1"[^>]*>([\s\S]*?)<\/measure>/)?.[0] ?? "";
  const secondMeasure = pianoPart.match(/<measure number="2"[^>]*>([\s\S]*?)<\/measure>/)?.[0] ?? "";

  assert.equal((pianoPart.match(/<rest measure="yes"\/>/g) ?? []).length, score.measureOrder.length);
  assert.doesNotMatch(pianoPart, /implicit="yes"/);
  assert.match(firstMeasure, /<note><rest measure="yes"\/><duration>2880<\/duration><voice>1<\/voice><\/note>/);
  assert.match(secondMeasure, /<note><rest measure="yes"\/><duration>2400<\/duration><voice>1<\/voice><\/note>/);
  assert.doesNotMatch(firstMeasure, /<rest measure="yes"\/>[\s\S]*?<type>/);
  assert.doesNotMatch(pianoPart, /<staves>|<staff>|<clef number=/);
});

test("MusicXML note data keeps pitch, dot, accidental display, and tie ordering consistent", () => {
  const score = createScore("solo", { seedDemo: false });
  score.parts[0].staves = [score.parts[0].staves[0]];
  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  voice.events = [
    makeEvent({ id: "auto-sharp", pitch: { step: "F", alter: 1, octave: 4 }, duration: { base: 8, dots: 1 }, rest: false }),
    makeEvent({ id: "forced-natural", pitch: { step: "F", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false, accidentalDisplay: "force" }),
    makeEvent({ id: "hidden-flat", pitch: { step: "B", alter: -1, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false, accidentalDisplay: "hide" }),
    makeEvent({ id: "tie-from", pitch: { step: "C", alter: 0, octave: 5 }, duration: { base: 4, dots: 0 }, rest: false }),
    makeEvent({ id: "tie-to", pitch: { step: "C", alter: 0, octave: 5 }, duration: { base: 4, dots: 0 }, rest: false }),
  ];
  score.ties = [{ id: "tie-test", fromNoteId: "tie-from-note-1", toNoteId: "tie-to-note-1" }];

  const musicXml = scoreToMusicXML(score);
  const firstMeasure = musicXml.match(/<measure number="1"[^>]*>([\s\S]*?)<\/measure>/)?.[0] ?? "";
  const notes = [...firstMeasure.matchAll(/<note>([\s\S]*?)<\/note>/g)].map((match) => match[0]);

  assert.equal(notes.length, 5);
  assert.match(notes[0], /<pitch><step>F<\/step><alter>1<\/alter><octave>4<\/octave><\/pitch><duration>720<\/duration><voice>1<\/voice><type>eighth<\/type><dot\/>/);
  assert.doesNotMatch(notes[0], /<accidental>/);
  assert.match(notes[1], /<pitch><step>F<\/step><octave>4<\/octave><\/pitch>[\s\S]*<accidental>natural<\/accidental>/);
  assert.match(notes[2], /<pitch><step>B<\/step><alter>-1<\/alter><octave>4<\/octave><\/pitch>/);
  assert.doesNotMatch(notes[2], /<accidental>/);
  assert.match(notes[3], /<duration>960<\/duration><tie type="start"\/><voice>1<\/voice>/);
  assert.match(notes[3], /<notations><tied type="start"\/><\/notations>/);
  assert.match(notes[4], /<duration>960<\/duration><tie type="stop"\/><voice>1<\/voice>/);
  assert.match(notes[4], /<notations><tied type="stop"\/><\/notations>/);
});

test("MusicXML exports 32nd and 64th values with every augmentation dot", () => {
  const score = createScore("solo", { seedDemo: false });
  score.parts[0].staves = [score.parts[0].staves[0]];
  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  voice.events = [
    makeEvent({ id: "double-dotted-32nd", pitch: { step: "C", alter: 0, octave: 5 }, duration: { base: 32, dots: 2 }, rest: false }),
    makeEvent({ id: "double-dotted-64th-rest", pitch: { step: "C", alter: 0, octave: 5 }, duration: { base: 64, dots: 2 }, rest: true }),
    makeEvent({ id: "plain-64th", pitch: { step: "D", alter: 0, octave: 5 }, duration: { base: 64, dots: 0 }, rest: false }),
  ];

  const musicXml = scoreToMusicXML(score);
  const firstMeasure = musicXml.match(/<measure number="1"[^>]*>([\s\S]*?)<\/measure>/)?.[0] ?? "";
  const notes = [...firstMeasure.matchAll(/<note>([\s\S]*?)<\/note>/g)].map((match) => match[0]);

  assert.equal(notes.length, 3);
  assert.match(notes[0], /<duration>210<\/duration><voice>1<\/voice><type>32nd<\/type><dot\/><dot\/>/);
  assert.match(notes[1], /<rest\/><duration>105<\/duration><voice>1<\/voice><type>64th<\/type><dot\/><dot\/>/);
  assert.match(notes[2], /<duration>60<\/duration><voice>1<\/voice><type>64th<\/type>/);
  assert.doesNotMatch(notes[2], /<dot\/>/);
});

test("MusicXML emits key mode and time changes only at their measure boundaries", () => {
  let score = createScore("solo", { seedDemo: false });
  const [, secondId, thirdId] = score.measureOrder;
  score = setKeyFromMeasure(score, secondId, { fifths: 0, mode: "minor" }).score;
  score = setTimeFromMeasure(score, thirdId, { numerator: 6, denominator: 8 }).score;

  const musicXml = scoreToMusicXML(score);
  const pianoPart = musicXml.match(/<part id="part-1-piano">([\s\S]*?)<\/part>/)?.[1] ?? "";
  const measures = [...pianoPart.matchAll(/<measure number="\d+"[^>]*>([\s\S]*?)<\/measure>/g)].map((match) => match[0]);

  assert.equal(measures.length, 4);
  assert.match(measures[0], /<key><fifths>0<\/fifths><mode>major<\/mode><\/key>/);
  assert.match(measures[0], /<time><beats>4<\/beats><beat-type>4<\/beat-type><\/time>/);
  assert.match(measures[1], /<key><fifths>0<\/fifths><mode>minor<\/mode><\/key>/);
  assert.doesNotMatch(measures[1], /<time>/);
  assert.doesNotMatch(measures[2], /<key>/);
  assert.match(measures[2], /<time><beats>6<\/beats><beat-type>8<\/beat-type><\/time>/);
  assert.doesNotMatch(measures[3], /<attributes>/);
  assert.equal((pianoPart.match(/<key>/g) ?? []).length, 2);
  assert.equal((pianoPart.match(/<time>/g) ?? []).length, 2);
  assert.equal((pianoPart.match(/<attributes>/g) ?? []).length, 3);
});

test("multi-staff export preserves both primary voices, empty staves, ties, playback, and MIDI", () => {
  const score = createScore("solo", { seedDemo: false });
  const part = score.parts[0];
  part.staves = [part.staves[0]];
  part.staves.push({
    id: `${part.id}-staff-2`,
    clef: "bass",
    measures: Object.fromEntries(score.measureOrder.map((measureId) => [measureId, {
      voices: [{ id: `${part.id}-${measureId}-staff-2-v1`, events: [] }],
    }])),
  });

  const [firstMeasureId, secondMeasureId] = score.measureOrder;
  const tieFrom = makeEvent({
    id: "upper-tie-from",
    pitch: { step: "C", alter: 0, octave: 5 },
    duration: { base: 1, dots: 0 },
    rest: false,
  });
  const tieTo = makeEvent({
    id: "upper-tie-to",
    pitch: { step: "C", alter: 0, octave: 5 },
    duration: { base: 1, dots: 0 },
    rest: false,
  });
  const lowerNote = makeEvent({
    id: "lower-whole-note",
    pitch: { step: "C", alter: 0, octave: 3 },
    duration: { base: 1, dots: 0 },
    rest: false,
  });
  if (tieFrom.kind !== "note" || tieTo.kind !== "note") assert.fail("Expected note events for the staff tie fixture.");

  part.staves[0].measures[firstMeasureId].voices[0].events = [tieFrom];
  part.staves[0].measures[secondMeasureId].voices[0].events = [tieTo];
  part.staves[1].measures[firstMeasureId].voices[0].events = [lowerNote];
  score.ties = [{ id: "upper-staff-tie", fromNoteId: tieFrom.notes[0].id, toNoteId: tieTo.notes[0].id }];

  const musicXml = scoreToMusicXML(score);
  const pianoPart = musicXml.match(/<part id="part-1-piano">([\s\S]*?)<\/part>/)?.[1] ?? "";
  const measures = [...pianoPart.matchAll(/<measure number="\d+"[^>]*>([\s\S]*?)<\/measure>/g)].map((match) => match[0]);

  assert.equal(measures.length, score.measureOrder.length);
  assert.match(measures[0], /<staves>2<\/staves>/);
  assert.match(measures[0], /<clef number="1"><sign>G<\/sign><line>2<\/line><\/clef>/);
  assert.match(measures[0], /<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.match(measures[0], /<step>C<\/step><octave>5<\/octave>[\s\S]*?<tie type="start"\/><voice>1<\/voice><type>whole<\/type><staff>1<\/staff><notations><tied type="start"\/><\/notations>/);
  assert.match(measures[0], /<backup><duration>3840<\/duration><\/backup>[\s\S]*?<step>C<\/step><octave>3<\/octave>[\s\S]*?<voice>2<\/voice><type>whole<\/type><staff>2<\/staff>/);
  assert.match(measures[1], /<tie type="stop"\/><voice>1<\/voice><type>whole<\/type><staff>1<\/staff><notations><tied type="stop"\/><\/notations>/);
  assert.match(measures[1], /<backup><duration>3840<\/duration><\/backup>[\s\S]*?<note><rest measure="yes"\/><duration>3840<\/duration><voice>2<\/voice><staff>2<\/staff><\/note>/);
  assert.deepEqual(
    [...pianoPart.matchAll(/<backup><duration>(\d+)<\/duration><\/backup>/g)].map((match) => Number(match[1])),
    [3840, 3840, 3840, 3840],
  );

  const playback = collectPlaybackNotes(score).sort((first, second) => first.midi - second.midi);
  assert.deepEqual(playback.map((note) => note.midi), [48, 72]);
  assert.ok(playback.find((note) => note.midi === 72)!.durationSeconds > playback.find((note) => note.midi === 48)!.durationSeconds);

  const midi = scoreToMidi(score);
  const includesNoteOn = (pitch: number) => [...midi].some((byte, index) => byte === 0x90 && midi[index + 1] === pitch && midi[index + 2] === 82);
  assert.equal(includesNoteOn(48), true);
  assert.equal(includesNoteOn(72), true);
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

test("removing a part cleans only its ties and re-adding an existing catalog instrument keeps every ID unique", () => {
  const source = createScore("orchestra", { seedDemo: false });
  const removedPart = source.parts[0];
  const retainedPart = source.parts.at(-1)!;
  const measureId = source.measureOrder[0];
  const removedVoice = getPrimaryVoice(removedPart, measureId);
  const retainedVoice = getPrimaryVoice(retainedPart, measureId);
  const removedFirst = makeEvent({ id: "removed-part-first", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const removedSecond = makeEvent({ id: "removed-part-second", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const retainedFirst = makeEvent({ id: "retained-part-first", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  const retainedSecond = makeEvent({ id: "retained-part-second", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  if (removedFirst.kind !== "note" || removedSecond.kind !== "note" || retainedFirst.kind !== "note" || retainedSecond.kind !== "note") {
    assert.fail("Expected note fixtures.");
  }
  removedVoice.events.push(removedFirst, removedSecond);
  retainedVoice.events.push(retainedFirst, retainedSecond);
  source.ties.push(
    { id: "removed-part-tie", fromNoteId: removedFirst.notes[0].id, toNoteId: removedSecond.notes[0].id },
    { id: "retained-part-tie", fromNoteId: retainedFirst.notes[0].id, toNoteId: retainedSecond.notes[0].id },
  );
  const snapshot = structuredClone(source);

  const removed = removeInstrument(source, removedPart.id);
  assert.deepEqual(source, snapshot, "part removal must preserve its undo snapshot");
  assert.deepEqual(removed.ties.map((tie) => tie.id), ["retained-part-tie"]);
  assert.deepEqual(validateScore(removed), []);

  const readded = addInstrument(removed, retainedPart.instrument.catalogId);
  assert.deepEqual(validateScore(readded), []);
  assert.equal(new Set(readded.parts.map((part) => part.id)).size, readded.parts.length);
  assert.doesNotThrow(() => scoreToMusicXML(readded));
  assert.doesNotThrow(() => scoreToMidi(readded));
});

test("grand-staff instruments create complete staff structures without changing saved instrument snapshots", () => {
  const expectedLayouts = new Map([
    ["piano", ["treble", "bass"]],
    ["harp", ["treble", "bass"]],
    ["celesta", ["treble", "bass"]],
    ["harpsichord", ["treble", "bass"]],
    ["accordion", ["treble", "bass"]],
    ["harmonium", ["treble", "bass"]],
    ["bandoneon", ["treble", "bass"]],
    ["organ", ["treble", "bass", "bass"]],
  ] as const);
  for (const [catalogId, clefs] of expectedLayouts) {
    assert.deepEqual(getInstrument(catalogId).staffClefs, clefs, catalogId);
  }
  assert.equal(getInstrument("violin").staffClefs, undefined);

  const solo = createScore("solo", { seedDemo: false });
  const piano = solo.parts[0];
  assert.deepEqual(piano.staves.map((staff) => staff.clef), ["treble", "bass"]);
  assert.equal("staffClefs" in piano.instrument, false, "the schema-v1 snapshot remains backward-compatible");
  assert.ok(piano.staves.every((staff) => solo.measureOrder.every((measureId) => staff.measures[measureId]?.voices.length === 1)));
  const allIds = piano.staves.flatMap((staff) => [staff.id, ...Object.values(staff.measures).flatMap((measure) => measure.voices.map((voice) => voice.id))]);
  assert.equal(new Set(allIds).size, allIds.length);

  const withOrgan = addInstrument(solo, "organ");
  assert.deepEqual(withOrgan.parts.at(-1)!.staves.map((staff) => staff.clef), ["treble", "bass", "bass"]);
  const orchestraHarp = createScore("orchestra", { seedDemo: false }).parts.find((part) => part.instrument.catalogId === "harp");
  assert.deepEqual(orchestraHarp?.staves.map((staff) => staff.clef), ["treble", "bass"]);
  assert.deepEqual(validateScore(JSON.parse(JSON.stringify(withOrgan))), []);
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

test("staff-targeted entry, deletion, ties, counts, and auto-append stay isolated", () => {
  let score = createScore("solo", { seedDemo: false });
  const partId = score.parts[0].id;
  const upperStaffId = score.parts[0].staves[0].id;
  const lowerStaffId = score.parts[0].staves[1].id;
  const firstMeasureId = score.measureOrder[0];
  assert.equal(getPrimaryVoice(score.parts[0], firstMeasureId), getPrimaryVoice(score.parts[0], firstMeasureId, 0));

  for (const id of ["lower-from", "lower-to"]) {
    const result = appendEvent(score, partId, makeEvent({
      id,
      pitch: { step: "C", alter: 0, octave: 3 },
      duration: { base: 4, dots: 0 },
      rest: false,
    }), lowerStaffId);
    assert.equal(result.error, undefined);
    assert.equal(result.measureId, firstMeasureId);
    score = result.score;
  }
  assert.equal(getPrimaryVoice(score.parts[0], firstMeasureId, 0).events.length, 0);
  assert.equal(getPrimaryVoice(score.parts[0], firstMeasureId, 1).events.length, 2);
  assert.equal(eventCount(score, partId, upperStaffId), 0);
  assert.equal(eventCount(score, partId, lowerStaffId), 2);
  assert.equal(eventCount(score), 2);
  assert.equal(findEventTargetMeasureId(score, partId, { base: 4, dots: 0 }, lowerStaffId), firstMeasureId);

  const tied = toggleTieLastTwo(score, partId, 1);
  assert.equal(tied.error, undefined);
  assert.equal(tied.tied, true);
  assert.equal(tied.score.ties.length, 1);
  const removed = removeLastEvent(tied.score, partId, lowerStaffId);
  assert.equal(eventCount(removed, partId, lowerStaffId), 1);
  assert.equal(eventCount(removed, partId, upperStaffId), 0);
  assert.equal(removed.ties.length, 0, "deleting from the selected staff also removes its tie");

  const invalid = appendEvent(removed, partId, makeEvent({
    id: "invalid-staff",
    pitch: { step: "D", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  }), "missing-staff");
  assert.equal(invalid.score, removed);
  assert.equal(invalid.measureId, null);
  assert.match(invalid.error ?? "", /valid staff/);
  assert.equal(findEventTargetMeasureId(removed, partId, { base: 4, dots: 0 }, "missing-staff"), null);

  const autoAppend = createScore("solo", { seedDemo: false });
  const autoPart = autoAppend.parts[0];
  const autoLowerId = autoPart.staves[1].id;
  autoAppend.measureOrder.forEach((measureId, index) => {
    getPrimaryVoice(autoPart, measureId, 1).events.push(makeEvent({
      id: `lower-full-${index}`,
      pitch: { step: "C", alter: 0, octave: 3 },
      duration: { base: 1, dots: 0 },
      rest: false,
    }));
  });
  const appended = appendEvent(autoAppend, autoPart.id, makeEvent({
    id: "lower-auto-append",
    pitch: { step: "D", alter: 0, octave: 3 },
    duration: { base: 4, dots: 0 },
    rest: false,
  }), autoLowerId);
  assert.equal(appended.error, undefined);
  assert.equal(appended.score.measureOrder.length, 5);
  assert.equal(getPrimaryVoice(appended.score.parts[0], appended.measureId!, 0).events.length, 0);
  assert.equal(getPrimaryVoice(appended.score.parts[0], appended.measureId!, 1).events.length, 1);
  assert.ok(appended.score.parts[0].staves.every((staff) => staff.measures[appended.measureId!]?.voices.length === 1));
});

test("selected event removal deletes the exact middle event, preserves other cells, and cleans only connected ties", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const upperStaff = part.staves[0];
  const lowerStaff = part.staves[1];
  const [otherMeasureId, targetMeasureId] = source.measureOrder;
  const before = makeEvent({ id: "selected-before", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  const target = makeEvent({ id: "selected-middle", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  const after = makeEvent({ id: "selected-after", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  const otherMeasureEvent = makeEvent({ id: "other-measure-event", pitch: { step: "F", alter: 0, octave: 3 }, duration: { base: 2, dots: 0 }, rest: false });
  const upperFrom = makeEvent({ id: "upper-unrelated-from", pitch: { step: "G", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const upperTo = makeEvent({ id: "upper-unrelated-to", pitch: { step: "G", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (before.kind !== "note" || target.kind !== "note" || after.kind !== "note" || upperFrom.kind !== "note" || upperTo.kind !== "note") {
    assert.fail("Expected note fixtures for selected event removal.");
  }

  getPrimaryVoice(part, targetMeasureId, 1).events.push(before, target, after);
  getPrimaryVoice(part, otherMeasureId, 1).events.push(otherMeasureEvent);
  getPrimaryVoice(part, targetMeasureId, 0).events.push(upperFrom, upperTo);
  source.ties.push(
    { id: "selected-incoming-tie", fromNoteId: before.notes[0].id, toNoteId: target.notes[0].id },
    { id: "selected-outgoing-tie", fromNoteId: target.notes[0].id, toNoteId: after.notes[0].id },
    { id: "upper-unrelated-tie", fromNoteId: upperFrom.notes[0].id, toNoteId: upperTo.notes[0].id },
  );
  const snapshot = structuredClone(source);

  const result = removeEvent(source, part.id, lowerStaff.id, targetMeasureId, target.id);
  assert.equal(result.error, undefined);
  assert.equal(result.removed, true);
  assert.equal(result.measureId, targetMeasureId);
  assert.equal(result.eventId, target.id);
  assert.equal(result.removedEvent.id, target.id);
  assert.deepEqual(result.removedTieIds, ["selected-incoming-tie", "selected-outgoing-tie"]);
  assert.notEqual(result.score, source);
  assert.deepEqual(source, snapshot, "selected deletion must preserve the source as an undo snapshot");
  assert.deepEqual(
    getPrimaryVoice(result.score.parts[0], targetMeasureId, 1).events.map((event) => event.id),
    [before.id, after.id],
    "the surrounding events remain in order",
  );
  assert.deepEqual(
    getPrimaryVoice(result.score.parts[0], otherMeasureId, 1),
    getPrimaryVoice(source.parts[0], otherMeasureId, 1),
    "another measure on the selected staff is preserved",
  );
  assert.deepEqual(
    getPrimaryVoice(result.score.parts[0], targetMeasureId, 0),
    getPrimaryVoice(source.parts[0], targetMeasureId, 0),
    "the other staff in the selected measure is preserved",
  );
  assert.deepEqual(result.score.ties.map((tie) => tie.id), ["upper-unrelated-tie"]);
  assert.deepEqual(validateScore(result.score), []);
  assert.equal(upperStaff.id, result.score.parts[0].staves[0].id);
});

test("selected event removal returns concrete identity-preserving errors for invalid selectors", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staff = part.staves[1];
  const measureId = source.measureOrder[0];
  const event = makeEvent({ id: "existing-selected-event", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(part, measureId, 1).events.push(event);

  const failures = [
    { result: removeEvent(source, "missing-part", staff.id, measureId, event.id), error: /instrument part "missing-part" does not exist/i },
    { result: removeEvent(source, part.id, "missing-staff", measureId, event.id), error: /staff selector "missing-staff".*part/i },
    { result: removeEvent(source, part.id, staff.id, "missing-measure", event.id), error: /measure "missing-measure" does not exist/i },
    { result: removeEvent(source, part.id, staff.id, measureId, "missing-event"), error: /event "missing-event".*measure.*staff/i },
  ];

  failures.forEach(({ result, error }) => {
    assert.equal(result.removed, false);
    assert.equal(result.score, source, "a failed selected deletion must preserve score identity");
    assert.equal(result.removedEvent, null);
    assert.deepEqual(result.removedTieIds, []);
    assert.match(result.error, error);
  });
  assert.deepEqual(getPrimaryVoice(source.parts[0], measureId, 1).events.map((candidate) => candidate.id), [event.id]);
});

test("clearing a selected chord to a rest preserves its timeline slot and removes only its connected ties", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const upperStaff = part.staves[0];
  const lowerStaff = part.staves[1];
  const [targetMeasureId, otherMeasureId] = source.measureOrder;
  const before = makeEvent({ id: "clear-before", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  const target = makeEvent({ id: "clear-target-chord", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 8, dots: 1 }, rest: false });
  const after = makeEvent({ id: "clear-after", pitch: { step: "E", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  const otherMeasureEvent = makeEvent({ id: "clear-other-measure", pitch: { step: "F", alter: 0, octave: 3 }, duration: { base: 2, dots: 0 }, rest: false });
  const upperFrom = makeEvent({ id: "clear-upper-from", pitch: { step: "G", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const upperTo = makeEvent({ id: "clear-upper-to", pitch: { step: "G", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (before.kind !== "note" || target.kind !== "note" || after.kind !== "note" || upperFrom.kind !== "note" || upperTo.kind !== "note") {
    assert.fail("Expected note fixtures for exact clear-to-rest.");
  }
  target.notes.push({
    id: "clear-target-chord-note-2",
    pitch: { step: "E", alter: 0, octave: 3 },
    accidentalDisplay: "auto",
  });
  target.dynamic = "ff";
  target.articulation = "marcato";
  const targetVoice = getPrimaryVoice(part, targetMeasureId, 1);
  targetVoice.events.push(before, target, after);
  getPrimaryVoice(part, otherMeasureId, 1).events.push(otherMeasureEvent);
  getPrimaryVoice(part, targetMeasureId, 0).events.push(upperFrom, upperTo);
  source.ties.push(
    { id: "clear-selected-incoming", fromNoteId: before.notes[0].id, toNoteId: target.notes[0].id },
    { id: "clear-selected-outgoing", fromNoteId: target.notes[1].id, toNoteId: after.notes[0].id },
    { id: "clear-upper-unrelated", fromNoteId: upperFrom.notes[0].id, toNoteId: upperTo.notes[0].id },
  );
  assert.deepEqual(validateScore(source), []);
  const snapshot = structuredClone(source);
  const ticksBefore = voiceTicks(targetVoice);
  const targetOnsetBefore = targetVoice.events.slice(0, 1).reduce((sum, event) => sum + durationTicks(event.duration), 0);
  const afterOnsetBefore = targetVoice.events.slice(0, 2).reduce((sum, event) => sum + durationTicks(event.duration), 0);

  const result = clearEventToRest(source, part.id, lowerStaff.id, targetMeasureId, target.id);
  assert.equal(result.error, undefined);
  assert.equal(result.changed, true);
  assert.equal(result.measureId, targetMeasureId);
  assert.equal(result.eventId, target.id);
  assert.deepEqual(result.removedTieIds, ["clear-selected-incoming", "clear-selected-outgoing"]);
  assert.notEqual(result.score, source);
  assert.notEqual(result.score.updatedAt, source.updatedAt, "a successful clear stamps its cloned score");
  assert.deepEqual(source, snapshot, "clear-to-rest must preserve the source as an undo snapshot");

  const nextVoice = getPrimaryVoice(result.score.parts[0], targetMeasureId, 1);
  assert.deepEqual(nextVoice.events.map((event) => event.id), [before.id, target.id, after.id]);
  const rest = nextVoice.events[1];
  assert.equal(rest.kind, "rest");
  assert.deepEqual(rest.duration, target.duration, "the replacement rest keeps the chord's full rhythmic value");
  assert.equal(rest.dynamic, "ff", "an event-level dynamic survives note-to-rest conversion");
  assert.equal(Object.hasOwn(rest, "notes"), false);
  assert.equal(Object.hasOwn(rest, "articulation"), false);
  assert.equal(voiceTicks(nextVoice), ticksBefore);
  assert.equal(nextVoice.events.slice(0, 1).reduce((sum, event) => sum + durationTicks(event.duration), 0), targetOnsetBefore);
  assert.equal(
    nextVoice.events.slice(0, 2).reduce((sum, event) => sum + durationTicks(event.duration), 0),
    afterOnsetBefore,
    "the following note keeps its onset instead of closing the deleted time gap",
  );
  assert.deepEqual(
    getPrimaryVoice(result.score.parts[0], otherMeasureId, 1),
    getPrimaryVoice(source.parts[0], otherMeasureId, 1),
    "another measure on the selected staff is unchanged",
  );
  assert.deepEqual(
    getPrimaryVoice(result.score.parts[0], targetMeasureId, 0),
    getPrimaryVoice(source.parts[0], targetMeasureId, 0),
    "the other staff in the selected measure is unchanged",
  );
  assert.deepEqual(result.score.ties.map((tie) => tie.id), ["clear-upper-unrelated"]);
  assert.equal(upperStaff.id, result.score.parts[0].staves[0].id);
  assert.deepEqual(validateScore(result.score), []);
});

test("clear-to-rest rejects rests, invalid selectors, missing cells, and ambiguous events without changing identity", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staff = part.staves[1];
  const measureId = source.measureOrder[0];
  const note = makeEvent({ id: "clear-existing-note", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  const rest = makeEvent({ id: "clear-existing-rest", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: true });
  getPrimaryVoice(part, measureId, 1).events.push(note, rest);

  const failures = [
    { result: clearEventToRest(source, "missing-part", staff.id, measureId, note.id), error: /instrument part "missing-part" does not exist/i },
    { result: clearEventToRest(source, part.id, "missing-staff", measureId, note.id), error: /staff selector "missing-staff".*part/i },
    { result: clearEventToRest(source, part.id, staff.id, "missing-measure", note.id), error: /measure "missing-measure" does not exist/i },
    { result: clearEventToRest(source, part.id, staff.id, measureId, "missing-event"), error: /event "missing-event".*measure.*staff/i },
    { result: clearEventToRest(source, part.id, staff.id, measureId, rest.id), error: /already a rest/i },
  ];
  for (const { result, error } of failures) {
    assert.equal(result.changed, false);
    assert.equal(result.score, source, "every failed clear-to-rest request preserves score identity");
    assert.deepEqual(result.removedTieIds, []);
    assert.match(result.error, error);
  }

  const missingStaffMeasure = structuredClone(source);
  delete missingStaffMeasure.parts[0].staves[1].measures[measureId];
  const missingCell = clearEventToRest(missingStaffMeasure, part.id, staff.id, measureId, note.id);
  assert.equal(missingCell.changed, false);
  assert.equal(missingCell.score, missingStaffMeasure);
  assert.deepEqual(missingCell.removedTieIds, []);
  assert.match(missingCell.error, /staff.*is missing measure/i);

  const ambiguous = structuredClone(source);
  ambiguous.parts[0].staves[1].measures[measureId].voices.push({
    id: "clear-duplicate-voice",
    events: [structuredClone(note)],
  });
  const duplicate = clearEventToRest(ambiguous, part.id, staff.id, measureId, note.id);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.score, ambiguous);
  assert.deepEqual(duplicate.removedTieIds, []);
  assert.match(duplicate.error, /event id.*ambiguous/i);
  assert.deepEqual(getPrimaryVoice(source.parts[0], measureId, 1).events, [note, rest]);
});

test("event notation editing preserves identity and expression while updating exported and played music", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staffId = part.staves[1].id;
  const measureId = source.measureOrder[0];
  const note = makeEvent({ id: "edit-note", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false, accidentalDisplay: "force" });
  if (note.kind !== "note") assert.fail("Expected a note fixture.");
  note.dynamic = "p";
  note.articulation = "staccato";
  const following = makeEvent({ id: "edit-following", pitch: { step: "G", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(part, measureId, 1).events.push(note, following);
  const snapshot = structuredClone(source);
  const update = { pitch: { step: "E", alter: -1, octave: 3 } as Pitch, duration: { base: 8, dots: 1 } as const };

  const result = editEventNotation(source, part.id, staffId, measureId, note.id, update);
  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(source, snapshot, "the previous score remains an immutable undo snapshot");
  const events = getPrimaryVoice(result.score.parts[0], measureId, 1).events;
  assert.deepEqual(events.map((event) => event.id), [note.id, following.id]);
  assert.deepEqual(events[0], { ...note, duration: update.duration, notes: [{ ...note.notes[0], pitch: update.pitch }] });
  assert.deepEqual(events[1], following);
  assert.notEqual(events[0].duration, update.duration);
  assert.deepEqual(getPrimaryVoice(result.score.parts[0], measureId, 0), getPrimaryVoice(part, measureId, 0));
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(result.score)), result.score, "the edited native file retains every event and expression property");
  assert.match(scoreToMusicXML(result.score), /<step>E<\/step><alter>-1<\/alter><octave>3<\/octave>/);
  const playback = collectPlaybackNotes(result.score);
  assert.deepEqual(playback.map((item) => item.midi), [51, 55]);
  assert.equal(playback[0].notatedDurationSeconds, 60 / source.tempo * .75);
  assert.equal(playback[1].startSeconds, playback[0].notatedDurationSeconds, "following events move with the edited duration");
  const unchanged = editEventNotation(result.score, part.id, 1, measureId, note.id, update);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.error, undefined);
  assert.equal(unchanged.score, result.score, "choosing the same notation must not create an undo entry");
});

test("event notation editing supports rest and chord durations without treating them as single pitches", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const measureId = source.measureOrder[0];
  const rest = makeEvent({ id: "edit-rest", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: true });
  const chord = makeEvent({ id: "edit-chord", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (chord.kind !== "note") assert.fail("Expected a chord fixture.");
  chord.notes.push({ id: "edit-chord-third", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  getPrimaryVoice(part, measureId).events.push(rest, chord);
  for (const event of [rest, chord]) {
    const pitchRejected = editEventNotation(source, part.id, 0, measureId, event.id, { pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 } });
    assert.equal(pitchRejected.changed, false);
    assert.equal(pitchRejected.score, source, "mixed pitch/duration edits must fail atomically");
    assert.match(pitchRejected.error ?? "", event.kind === "rest" ? /rest has no pitch/i : /select a chord tone/i);
    const duration = editEventNotation(source, part.id, 0, measureId, event.id, { duration: { base: 8, dots: 2 } });
    assert.equal(duration.changed, true);
    assert.equal(duration.error, undefined);
    const edited = getPrimaryVoice(duration.score.parts[0], measureId).events.find((candidate) => candidate.id === event.id);
    assert.deepEqual(edited, { ...event, duration: { base: 8, dots: 2 } });
    assert.deepEqual(validateScore(duration.score), []);
  }
});

test("event notation edits reject invalid targets, updates and invalid scores atomically; overflow reflows", () => {
  const source = createScore("solo");
  const part = source.parts[0];
  const staffId = part.staves[0].id;
  const measureId = source.measureOrder[0];
  const eventId = getPrimaryVoice(part, measureId).events[0].id;
  const snapshot = structuredClone(source);
  const validUpdate = { duration: { base: 8, dots: 0 } as const };
  const rejected = [
    editEventNotation(source, "missing", staffId, measureId, eventId, validUpdate),
    editEventNotation(source, part.id, "missing", measureId, eventId, validUpdate),
    editEventNotation(source, part.id, staffId, "missing", eventId, validUpdate),
    editEventNotation(source, part.id, staffId, measureId, "missing", validUpdate),
  ];
  for (const update of [null, [], { unsupported: true }, { duration: null }, { duration: { base: 3, dots: 0 } }, { duration: { base: 4, dots: 3 } }, { pitch: null }, { pitch: { step: "H", alter: 0, octave: 4 } }, { pitch: { step: "C", alter: .5, octave: 4 } }, { pitch: { step: "C", alter: 0, octave: 10 } }]) {
    rejected.push(editEventNotation(source, part.id, staffId, measureId, eventId, update as Parameters<typeof editEventNotation>[5]));
  }
  for (const result of rejected) {
    assert.equal(result.changed, false);
    assert.equal(result.score, source);
    assert.ok(result.error);
  }
  const overflow = editEventNotation(source, part.id, staffId, measureId, eventId, { duration: { base: 2, dots: 0 }, pitch: { step: "D", alter: 0, octave: 4 } });
  assert.equal(overflow.changed, true);
  assert.deepEqual(validateScore(overflow.score), []);
  assert.deepEqual(source, snapshot);
  const invalidScore = structuredClone(source);
  invalidScore.tempo = -1;
  const invalidResult = editEventNotation(invalidScore, part.id, staffId, measureId, eventId, validUpdate);
  assert.equal(invalidResult.score, invalidScore);
  assert.equal(invalidResult.changed, false);
  assert.match(invalidResult.error ?? "", /score is invalid/);
});

test("event notation edits follow connected pitches and reflow duration changes across tied barlines", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const measureId = source.measureOrder[0];
  const nextMeasureId = source.measureOrder[1];
  const first = makeEvent({ id: "edit-tie-first", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false });
  const second = makeEvent({ id: "edit-tie-second", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false });
  const third = makeEvent({ id: "edit-tie-third", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (first.kind !== "note" || second.kind !== "note" || third.kind !== "note") assert.fail("Expected tie fixtures.");
  getPrimaryVoice(part, measureId).events.push(first, second);
  getPrimaryVoice(part, nextMeasureId).events.push(third);
  source.ties.push({ id: "edit-internal-tie", fromNoteId: first.notes[0].id, toNoteId: second.notes[0].id });
  const allowed = editEventNotation(source, part.id, 0, measureId, first.id, { duration: { base: 4, dots: 0 } });
  assert.equal(allowed.changed, true, "a same-measure tie remains adjacent when both later onset and source end move together");
  assert.deepEqual(allowed.score.ties, source.ties);
  assert.deepEqual(validateScore(allowed.score), []);
  source.ties.push({ id: "edit-cross-measure-tie", fromNoteId: second.notes[0].id, toNoteId: third.notes[0].id });
  const snapshot = structuredClone(source);
  assert.deepEqual(validateScore(source), []);
  const repitched = editEventNotation(source, part.id, 0, measureId, second.id, { pitch: { step: "D", alter: 0, octave: 4 } });
  assert.equal(repitched.changed, true);
  assert.deepEqual(repitched.score.ties, source.ties);
  for (const event of repitched.score.measureOrder.flatMap((id) => getPrimaryVoice(repitched.score.parts[0], id).events)) {
    if (event.kind === "note") assert.equal(event.notes[0].pitch.step, "D");
  }
  assert.deepEqual(validateScore(repitched.score), []);
  for (const [id, update] of [
    [second.id, { duration: { base: 4, dots: 0 } }],
    [first.id, { duration: { base: 4, dots: 0 } }],
  ] as const) {
    const result = editEventNotation(source, part.id, 0, measureId, id, update);
    assert.equal(result.changed, true);
    assert.deepEqual(result.durationReflow, { segmentCount: 1 });
    assert.deepEqual(result.score.ties, source.ties);
    assert.deepEqual(validateScore(result.score), []);
    assert.deepEqual(source, snapshot, "reflow must leave the original score available to Undo");
  }
});

test("editing a chosen chord tone preserves its ID, other tones, timing, expression and round-trip meaning", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const measureId = source.measureOrder[0];
  const chord = makeEvent({ id: "editable-chord", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false });
  if (chord.kind !== "note") assert.fail("Expected a chord fixture.");
  chord.notes.push(
    { id: "editable-third", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "force" },
    { id: "editable-fifth", pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "auto" },
  );
  chord.dynamic = "p";
  chord.articulation = "tenuto";
  const next = makeEvent({ id: "editable-following", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (next.kind !== "note") assert.fail("Expected a following note.");
  getPrimaryVoice(part, measureId, 1).events.push(chord, next);
  source.ties.push({ id: "editable-root-tie", fromNoteId: chord.notes[0].id, toNoteId: next.notes[0].id });
  const snapshot = structuredClone(source);
  const pitch: Pitch = { step: "F", alter: 1, octave: 4 };
  const result = editEventNotation(source, part.id, part.staves[1].id, measureId, chord.id, { noteId: "editable-third", pitch });
  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(source, snapshot);
  const edited = getPrimaryVoice(result.score.parts[0], measureId, 1).events[0];
  assert.deepEqual(edited, { ...chord, notes: [chord.notes[0], { ...chord.notes[1], pitch }, chord.notes[2]] });
  assert.deepEqual(result.score.ties, source.ties, "a tie on another tone stays intact");
  assert.equal(voiceTicks(getPrimaryVoice(result.score.parts[0], measureId, 1)), voiceTicks(getPrimaryVoice(part, measureId, 1)));
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(result.score)), result.score);
  assert.match(scoreToMusicXML(result.score), /<chord\/><pitch><step>F<\/step><alter>1<\/alter><octave>4<\/octave>/);
  const beforePlayback = collectPlaybackNotes(source);
  const afterPlayback = collectPlaybackNotes(result.score);
  const originalTone = beforePlayback.find((item) => item.midi === 64)!;
  const editedTone = afterPlayback.find((item) => item.midi === 66)!;
  assert.ok(editedTone);
  assert.equal(editedTone.startSeconds, originalTone.startSeconds);
  assert.equal(editedTone.notatedDurationSeconds, originalTone.notatedDurationSeconds);
  assert.deepEqual(afterPlayback.filter((item) => item.midi !== 66), beforePlayback.filter((item) => item.midi !== 64));
  const same = editEventNotation(result.score, part.id, 1, measureId, chord.id, { noteId: "editable-third", pitch });
  assert.equal(same.changed, false);
  assert.equal(same.score, result.score);
  const explicitSingle = editEventNotation(result.score, part.id, 1, measureId, next.id, { noteId: next.notes[0].id, pitch: next.notes[0].pitch });
  assert.equal(explicitSingle.score, result.score, "single notes accept an explicit matching note ID too");
  assert.equal(explicitSingle.error, undefined);
});

test("chord pitch edits reject invalid tone IDs and duplicate pitches while preserving connected pitches", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const measureId = source.measureOrder[0];
  const chord = makeEvent({ id: "reject-chord", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const following = makeEvent({ id: "reject-following", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (chord.kind !== "note" || following.kind !== "note") assert.fail("Expected note fixtures.");
  chord.notes.push({ id: "reject-third", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  getPrimaryVoice(part, measureId).events.push(chord, following);
  source.ties.push({ id: "reject-tie", fromNoteId: chord.notes[0].id, toNoteId: following.notes[0].id });
  const snapshot = structuredClone(source);
  const pitch: Pitch = { step: "D", alter: 0, octave: 4 };
  const invalidUpdates = [
    { pitch },
    { pitch, noteId: "missing" },
    { pitch, noteId: "" },
    { pitch, noteId: null },
    { pitch, noteId: 7 },
    { noteId: "reject-third" },
    { noteId: "reject-third", duration: { base: 8, dots: 0 } },
    { noteId: "reject-third", pitch: chord.notes[0].pitch, duration: { base: 8, dots: 0 } },
  ];
  for (const update of invalidUpdates) {
    const result = editEventNotation(source, part.id, 0, measureId, chord.id, update as Parameters<typeof editEventNotation>[5]);
    assert.equal(result.changed, false);
    assert.equal(result.score, source);
    assert.ok(result.error);
  }
  assert.match(editEventNotation(source, part.id, 0, measureId, chord.id, { noteId: "reject-third", pitch: chord.notes[0].pitch }).error ?? "", /already in this chord/);
  const tiedEdit = editEventNotation(source, part.id, 0, measureId, chord.id, { noteId: chord.notes[0].id, pitch, duration: { base: 8, dots: 0 } });
  assert.equal(tiedEdit.changed, true);
  const tiedEvents = getPrimaryVoice(tiedEdit.score.parts[0], measureId).events;
  for (const event of tiedEvents) {
    if (event.kind === "note") assert.deepEqual(event.notes[0].pitch, pitch);
  }
  assert.deepEqual(tiedEdit.score.ties, source.ties);
  const wrongSingle = editEventNotation(source, part.id, 0, measureId, following.id, { noteId: "reject-third", pitch });
  assert.equal(wrongSingle.score, source);
  assert.equal(wrongSingle.changed, false);
  assert.deepEqual(source, snapshot);
});

test("an exact middle chord-tone pitch edit follows a long tied chain across barlines without changing other tones or playback timing", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const chain = Array.from({ length: 12 }, (_, index) => {
    const event = makeEvent({ id: `long-tied-${index}`, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
    if (event.kind !== "note") assert.fail("Expected a note fixture.");
    event.dynamic = "p";
    event.articulation = "tenuto";
    getPrimaryVoice(part, source.measureOrder[Math.floor(index / 4)], 1).events.push(event);
    return event;
  });
  chain[11].notes.push({ id: "untied-chord-tone", pitch: { step: "D", alter: 0, octave: 4 }, accidentalDisplay: "force" });
  for (let index = 1; index < chain.length; index += 1) {
    source.ties.push({ id: `long-tie-${index}`, fromNoteId: chain[index - 1].notes[0].id, toNoteId: chain[index].notes[0].id });
  }
  const chainIds = chain.map((event) => event.notes[0].id);
  chain[6].notes.unshift({ id: "untied-middle-chord-tone", pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "force" });
  const disconnected = makeEvent({ id: "untied-same-pitch", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(part, source.measureOrder[3], 1).events.push(disconnected);
  const snapshot = structuredClone(source);
  assert.deepEqual(new Set(getTiedNoteIds(source, chainIds[6])), new Set(chainIds));
  assert.deepEqual(getTiedNoteIds(source, "missing"), []);
  assert.deepEqual(getTiedNoteIds(source, "untied-chord-tone"), ["untied-chord-tone"]);
  for (const index of [0, 6, 11]) {
    const rejected = editEventNotation(source, part.id, 1, source.measureOrder[Math.floor(index / 4)], chain[index].id, {
      noteId: chainIds[index], pitch: { step: "D", alter: 0, octave: 4 },
    });
    assert.equal(rejected.changed, false);
    assert.equal(rejected.score, source, "a duplicate at either end of the chain must reject the complete edit");
    assert.match(rejected.error ?? "", /already.*chord/i);
  }
  const pitch: Pitch = { step: "E", alter: -1, octave: 4 };
  const result = editEventNotation(source, part.id, part.staves[1].id, source.measureOrder[1], chain[6].id, { noteId: chainIds[6], pitch });
  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(result.score.ties, source.ties);
  for (let index = 0; index < chain.length; index += 1) {
    const actual: MusicEvent = getPrimaryVoice(result.score.parts[0], source.measureOrder[Math.floor(index / 4)], 1).events[index % 4];
    assert.deepEqual(actual, { ...chain[index], notes: chain[index].notes.map((note) => note.id === chainIds[index] ? { ...note, pitch } : note) });
  }
  assert.deepEqual(getPrimaryVoice(result.score.parts[0], source.measureOrder[3], 1).events, [disconnected]);
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(result.score)), result.score);
  const projectPlayback = (score: ScoreDocument) => collectPlaybackNotes(score).map(({ midi, startSeconds, notatedDurationSeconds }) => ({ midi, startSeconds, notatedDurationSeconds }));
  const playback = projectPlayback(result.score);
  const sustained = playback.filter((note) => note.midi === 63);
  assert.equal(sustained.length, 1);
  assert.equal(sustained[0].notatedDurationSeconds, 12 * 60 / source.tempo);
  const imported = importMusicXML(scoreToMusicXML(result.score));
  assert.deepEqual(imported.warnings, []);
  assert.equal(imported.score.ties.length, source.ties.length);
  assert.deepEqual(validateScore(imported.score), []);
  assert.deepEqual(projectPlayback(imported.score), playback, "MusicXML reopening preserves the tied sound and the independent chord tone");
});

test("dotted tied-duration growth splits the selected chord and shifted successors while preserving sound and other staves", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2, m3] = source.measureOrder;
  const prefix = makeEvent({ id: "reflow-prefix", pitch: { step: "G", alter: 0, octave: 3 }, duration: { base: 2, dots: 1 }, rest: true });
  getPrimaryVoice(part, m1).events.push(prefix);
  const chords = ["reflow-chord-first", "reflow-chord-middle", "reflow-chord-last"].map((id, index) => {
    const event = makeEvent({ id, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: index === 1 ? 1 : 4, dots: 0 }, rest: false, accidentalDisplay: "force" });
    if (event.kind !== "note") assert.fail("Expected chord fixtures.");
    event.notes.push({ id: `${id}-third`, pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
    event.dynamic = "p";
    event.articulation = "tenuto";
    getPrimaryVoice(part, [m1, m2, m3][index]).events.push(event);
    return event;
  });
  for (let index = 0; index < 2; index += 1) for (let tone = 0; tone < 2; tone += 1) {
    source.ties.push({ id: `original-reflow-tie-${index}-${tone}`, fromNoteId: chords[index].notes[tone].id, toNoteId: chords[index + 1].notes[tone].id });
  }
  getPrimaryVoice(part, m2, 1).events.push(makeEvent({ id: "reflow-other-staff", pitch: { step: "A", alter: 0, octave: 2 }, duration: { base: 1, dots: 0 }, rest: false }));
  const snapshot = structuredClone(source);
  const result = editEventNotation(source, part.id, 0, m1, chords[0].id, { duration: { base: 2, dots: 1 } });
  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.durationReflow, { segmentCount: 2 });
  assert.deepEqual(source, snapshot);
  assert.deepEqual(result.score.parts[0].staves[1], part.staves[1]);
  const firstSegment = getPrimaryVoice(result.score.parts[0], m1).events[1];
  assert.deepEqual(firstSegment, { ...chords[0], rhythmGroupId: chords[0].id }, "the first segment keeps original IDs, expression and its one-quarter slot");
  const allEvents = result.score.measureOrder.flatMap((id) => getPrimaryVoice(result.score.parts[0], id).events);
  assert.ok(allEvents.some((event) => event.id === chords[1].id));
  assert.ok(allEvents.some((event) => event.id === chords[2].id));
  for (const tie of source.ties) {
    const retained: ScoreDocument["ties"][number] | undefined = result.score.ties.find((candidate) => candidate.id === tie.id);
    assert.ok(retained);
    assert.equal(retained.toNoteId, tie.toNoteId);
    if (tie.fromNoteId === chords[0].notes[0].id || tie.fromNoteId === chords[1].notes[0].id) assert.notEqual(retained.fromNoteId, tie.fromNoteId, "outgoing ties move to the final segment");
  }
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(result.score)), result.score);
  const project = (score: ScoreDocument) => collectPlaybackNotes(score).map(({ midi, startSeconds, notatedDurationSeconds }) => ({ midi, startSeconds, notatedDurationSeconds }));
  const playback = project(result.score);
  for (const midi of [60, 64]) {
    const tone = playback.filter((item) => item.midi === midi);
    assert.equal(tone.length, 1);
    assert.equal(tone[0].startSeconds, 3 * 60 / source.tempo);
    assert.equal(tone[0].notatedDurationSeconds, 8 * 60 / source.tempo);
  }
  const reopened = importMusicXML(scoreToMusicXML(result.score));
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(project(reopened.score), playback);
});

test("shortening a tied note preserves implicit silence and repairs later linked notes shifted over a barline", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2] = source.measureOrder;
  const groups = ["C", "D"].map((step, group) => [0, 1].map((index) => {
    const event = makeEvent({ id: `gap-chain-${group}-${index}`, pitch: { step: step as Pitch["step"], alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
    if (event.kind !== "note") assert.fail("Expected note fixtures.");
    getPrimaryVoice(part, group === 0 ? m1 : m2).events.push(event);
    return event;
  }));
  for (const [index, group] of groups.entries()) source.ties.push({ id: `gap-chain-tie-${index}`, fromNoteId: group[0].notes[0].id, toNoteId: group[1].notes[0].id });
  const result = editEventNotation(source, part.id, 0, m1, groups[0][0].id, { duration: { base: 8, dots: 0 } });
  assert.equal(result.changed, true);
  const playback = collectPlaybackNotes(result.score);
  const first = playback.find((note) => note.midi === 60)!;
  const later = playback.find((note) => note.midi === 62)!;
  assert.equal(first.notatedDurationSeconds, 1.5 * 60 / source.tempo);
  assert.equal(later.startSeconds, 3.5 * 60 / source.tempo);
  assert.equal(later.startSeconds - first.notatedDurationSeconds, 2 * 60 / source.tempo, "the original two-beat silent gap stays two beats long");
  assert.equal(later.notatedDurationSeconds, 2 * 60 / source.tempo);
  const rests = result.score.measureOrder.flatMap((id) => getPrimaryVoice(result.score.parts[0], id).events).filter((event) => event.kind === "rest");
  assert.equal(rests.reduce((sum, rest) => sum + durationTicks(rest.duration), 0), 2 * TICKS_PER_QUARTER);
  assert.deepEqual(validateScore(result.score), []);
  const untiedPrefix = createScore("solo", { seedDemo: false });
  const prefixPart = untiedPrefix.parts[0];
  const rest = makeEvent({ id: "untied-reflow-prefix", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: true });
  const from = makeEvent({ id: "untied-prefix-from", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 1 }, rest: false });
  const to = makeEvent({ id: "untied-prefix-to", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (from.kind !== "note" || to.kind !== "note") assert.fail("Expected tied notes.");
  getPrimaryVoice(prefixPart, m1).events.push(rest, from);
  getPrimaryVoice(prefixPart, m2).events.push(to);
  untiedPrefix.ties.push({ id: "untied-prefix-tie", fromNoteId: from.notes[0].id, toNoteId: to.notes[0].id });
  const repaired = editEventNotation(untiedPrefix, prefixPart.id, 0, m1, rest.id, { duration: { base: 8, dots: 0 } });
  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.durationReflow, { segmentCount: 1 });
  assert.deepEqual(validateScore(repaired.score), []);
  const repairedPlayback = collectPlaybackNotes(repaired.score);
  assert.equal(repairedPlayback.length, 1);
  assert.equal(repairedPlayback[0].startSeconds, .5 * 60 / source.tempo);
  assert.equal(repairedPlayback[0].notatedDurationSeconds, 4 * 60 / source.tempo);
});

test("tied duration growth adds only needed shared measure structure and keeps existing other-staff music", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const notes = source.measureOrder.map((measureId, index) => {
    const event = makeEvent({ id: `extend-chain-${index}`, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false });
    if (event.kind !== "note") assert.fail("Expected tied notes.");
    getPrimaryVoice(part, measureId).events.push(event);
    return event;
  });
  for (let index = 1; index < notes.length; index += 1) source.ties.push({ id: `extend-tie-${index}`, fromNoteId: notes[index - 1].notes[0].id, toNoteId: notes[index].notes[0].id });
  const lastId = source.measureOrder.at(-1)!;
  source.measures[lastId].key = { fifths: 2, mode: "major" };
  getPrimaryVoice(part, lastId, 1).events.push(makeEvent({ id: "preserved-lower-note", pitch: { step: "G", alter: 0, octave: 2 }, duration: { base: 4, dots: 0 }, rest: false }));
  const result = editEventNotation(source, part.id, 0, lastId, notes.at(-1)!.id, { duration: { base: 1, dots: 2 } });
  assert.equal(result.changed, true);
  assert.deepEqual(result.durationReflow, { segmentCount: 2 });
  assert.equal(result.score.measureOrder.length, source.measureOrder.length + 1);
  const newId = result.score.measureOrder.at(-1)!;
  assert.deepEqual(result.score.measures[newId].key, source.measures[lastId].key);
  for (const id of source.measureOrder) assert.deepEqual(result.score.parts[0].staves[1].measures[id], part.staves[1].measures[id]);
  assert.deepEqual(getPrimaryVoice(result.score.parts[0], newId, 1).events, []);
  assert.deepEqual(validateScore(result.score), []);
  const sustained = collectPlaybackNotes(result.score).find((note) => note.midi === 60)!;
  assert.equal(sustained.notatedDurationSeconds, 19 * 60 / source.tempo);
});

test("unrepresentable tied splits and measure safety limits reject the whole duration edit", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2] = source.measureOrder;
  for (const [index, duration] of ([{ base: 2, dots: 0 }, { base: 4, dots: 1 }, { base: 16, dots: 2 }] as const).entries()) {
    getPrimaryVoice(part, m1).events.push(makeEvent({ id: `exact-prefix-${index}`, pitch: { step: "G", alter: 0, octave: 4 }, duration, rest: true }));
  }
  const from = makeEvent({ id: "tiny-tie-from", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 64, dots: 0 }, rest: false });
  const to = makeEvent({ id: "tiny-tie-to", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 64, dots: 0 }, rest: false });
  if (from.kind !== "note" || to.kind !== "note") assert.fail("Expected tied notes.");
  getPrimaryVoice(part, m1).events.push(from);
  getPrimaryVoice(part, m2).events.push(to);
  source.ties.push({ id: "tiny-tie", fromNoteId: from.notes[0].id, toNoteId: to.notes[0].id });
  const snapshot = structuredClone(source);
  const rejected = editEventNotation(source, part.id, 0, m1, from.id, { duration: { base: 64, dots: 2 } });
  assert.equal(rejected.changed, false);
  assert.equal(rejected.score, source);
  assert.match(rejected.error ?? "", /written exactly/);
  assert.deepEqual(source, snapshot);
  const bounded = createScore("solo", { seedDemo: false });
  bounded.measureOrder = Array.from({ length: 5_000 }, (_, index) => `limit-measure-${index}`);
  bounded.measures = Object.fromEntries(bounded.measureOrder.map((id, index) => [id, { ...source.measures[m1], id, number: index + 1 }]));
  for (const staff of bounded.parts[0].staves) staff.measures = Object.fromEntries(bounded.measureOrder.map((id) => [id, { voices: [{ id: `${staff.id}-${id}`, events: [] }] }]));
  const beforeId = bounded.measureOrder.at(-2)!;
  const lastId = bounded.measureOrder.at(-1)!;
  const start = makeEvent({ id: "limit-tie-from", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false });
  const end = makeEvent({ id: "limit-tie-to", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false });
  if (start.kind !== "note" || end.kind !== "note") assert.fail("Expected tied notes.");
  getPrimaryVoice(bounded.parts[0], beforeId).events.push(start);
  getPrimaryVoice(bounded.parts[0], lastId).events.push(end);
  bounded.ties.push({ id: "limit-tie", fromNoteId: start.notes[0].id, toNoteId: end.notes[0].id });
  assert.deepEqual(validateScore(bounded), []);
  const tooLarge = editEventNotation(bounded, bounded.parts[0].id, 0, lastId, end.id, { duration: { base: 1, dots: 2 } });
  assert.equal(tooLarge.changed, false);
  assert.equal(tooLarge.score, bounded);
  assert.match(tooLarge.error ?? "", /safety limit/);
  assert.equal(bounded.measureOrder.length, 5_000);
});

test("selected-note tie controls add matching chord tones in either direction and remove only one side", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const firstMeasure = source.measureOrder[0];
  const secondMeasure = source.measureOrder[1];
  const notes = ["tie-control-first", "tie-control-middle", "tie-control-last"].map((id, index) => {
    const event = makeEvent({ id, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: index < 2 ? 2 : 4, dots: 0 }, rest: false });
    if (event.kind !== "note") assert.fail("Expected a note fixture.");
    event.notes.push({ id: `${id}-third`, pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
    getPrimaryVoice(part, index < 2 ? firstMeasure : secondMeasure, 1).events.push(event);
    return event;
  });
  const snapshot = structuredClone(source);
  const incoming = setNoteTie(source, part.id, part.staves[1].id, firstMeasure, notes[1].id, notes[1].notes[0].id, "incoming", true);
  assert.equal(incoming.changed, true);
  assert.deepEqual(incoming.score.ties.map(({ fromNoteId, toNoteId }) => ({ fromNoteId, toNoteId })), [{ fromNoteId: notes[0].notes[0].id, toNoteId: notes[1].notes[0].id }]);
  const outgoing = setNoteTie(incoming.score, part.id, 1, firstMeasure, notes[1].id, notes[1].notes[0].id, "outgoing", true);
  assert.equal(outgoing.changed, true, "a fully occupied preceding measure permits a barline tie");
  const third = setNoteTie(outgoing.score, part.id, 1, firstMeasure, notes[1].id, notes[1].notes[1].id, "incoming", true);
  assert.equal(third.changed, true, "a chord's selected non-root tone finds the matching adjacent tone");
  const duplicate = setNoteTie(third.score, part.id, 1, firstMeasure, notes[1].id, notes[1].notes[0].id, "outgoing", true);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.score, third.score);
  const removed = setNoteTie(third.score, part.id, 1, firstMeasure, notes[1].id, notes[1].notes[0].id, "incoming", false);
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.score.ties, third.score.ties.filter((tie) => tie.toNoteId !== notes[1].notes[0].id));
  assert.deepEqual(new Set(getTiedNoteIds(removed.score, notes[1].notes[0].id)), new Set([notes[1].notes[0].id, notes[2].notes[0].id]));
  const last = setNoteTie(removed.score, part.id, 1, firstMeasure, notes[1].id, notes[1].notes[0].id, "outgoing", false);
  assert.equal(last.changed, true);
  assert.deepEqual(last.score.ties, [third.score.ties[2]], "the other chord tone's tie remains intact");
  const noop = setNoteTie(last.score, part.id, 1, firstMeasure, notes[1].id, notes[1].notes[0].id, "incoming", false);
  assert.equal(noop.score, last.score);
  assert.equal(noop.changed, false);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(validateScore(last.score), []);
  assert.deepEqual(getPrimaryVoice(last.score.parts[0], firstMeasure, 1).events, notes.slice(0, 2));
});

test("selected-note ties reject rests, measure gaps, other staves or voices and invalid targets without changing the score", () => {
  const base = createScore("solo", { seedDemo: false });
  const part = base.parts[0];
  const measureId = base.measureOrder[0];
  const note = makeEvent({ id: "tie-boundary-note", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (note.kind !== "note") assert.fail("Expected a note fixture.");
  getPrimaryVoice(part, measureId).events.push(note);
  const makeNext = (id: string, rest = false) => makeEvent({ id, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest });
  const fixtures: { score: ScoreDocument; error: RegExp }[] = [];
  const rest = structuredClone(base);
  getPrimaryVoice(rest.parts[0], measureId).events.push(makeNext("tie-boundary-rest", true), makeNext("tie-after-rest"));
  fixtures.push({ score: rest, error: /cannot cross a rest/i });
  const gap = structuredClone(base);
  getPrimaryVoice(gap.parts[0], base.measureOrder[1]).events.push(makeNext("tie-after-gap"));
  fixtures.push({ score: gap, error: /cannot cross empty time/i });
  const mismatch = structuredClone(base);
  getPrimaryVoice(mismatch.parts[0], measureId).events.push(makeEvent({ id: "tie-wrong-pitch", pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }));
  fixtures.push({ score: mismatch, error: /same written pitch/i });
  const otherStaff = structuredClone(base);
  getPrimaryVoice(otherStaff.parts[0], measureId, 1).events.push(makeNext("other-staff-rest", true), makeNext("other-staff-match"));
  fixtures.push({ score: otherStaff, error: /no next note on this staff/i });
  const otherVoice = structuredClone(base);
  otherVoice.parts[0].staves[0].measures[measureId].voices.push({ id: "unsupported-second-voice", events: [makeNext("other-voice-rest", true), makeNext("other-voice-match")] });
  fixtures.push({ score: otherVoice, error: /score is invalid.*voice/i });
  for (const { score, error } of fixtures) {
    const snapshot = structuredClone(score);
    const result = setNoteTie(score, part.id, 0, measureId, note.id, note.notes[0].id, "outgoing", true);
    assert.equal(result.changed, false);
    assert.equal(result.score, score);
    assert.match(result.error ?? "", error);
    assert.deepEqual(score, snapshot);
  }
  for (const result of [
    setNoteTie(base, "missing", 0, measureId, note.id, note.notes[0].id, "outgoing", true),
    setNoteTie(base, part.id, "missing", measureId, note.id, note.notes[0].id, "outgoing", true),
    setNoteTie(base, part.id, 0, measureId, note.id, "missing", "outgoing", true),
    setNoteTie(base, part.id, 0, measureId, note.id, note.notes[0].id, "incoming", true),
    setNoteTie(base, part.id, 0, measureId, note.id, note.notes[0].id, "invalid" as "incoming", true),
  ]) {
    assert.equal(result.changed, false);
    assert.equal(result.score, base);
    assert.ok(result.error);
  }
});

test("removing a chosen chord tone keeps other tones and ties and refuses to remove the final note", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const measureId = source.measureOrder[0];
  const chords = ["remove-targeted", "remove-following"].map((id) => {
    const event = makeEvent({ id, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
    if (event.kind !== "note") assert.fail("Expected chord fixtures.");
    event.notes.push(
      { id: `${id}-third`, pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" },
      { id: `${id}-fifth`, pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "auto" },
    );
    event.dynamic = "p";
    event.articulation = "accent";
    return event;
  });
  getPrimaryVoice(part, measureId, 1).events.push(...chords);
  for (let index = 0; index < 3; index += 1) {
    source.ties.push({ id: `targeted-tie-${index}`, fromNoteId: chords[0].notes[index].id, toNoteId: chords[1].notes[index].id });
  }
  const snapshot = structuredClone(source);
  const missing = removeChordToneFromEvent(source, part.id, 1, measureId, chords[0].id, "missing");
  assert.equal(missing.score, source);
  assert.equal(missing.removed, false);
  assert.ok(missing.error);
  const result = removeChordToneFromEvent(source, part.id, part.staves[1].id, measureId, chords[0].id, chords[0].notes[1].id);
  assert.equal(result.removed, true);
  assert.equal(result.remainingNoteCount, 2);
  assert.deepEqual(result.removedNote, chords[0].notes[1]);
  assert.deepEqual(getPrimaryVoice(result.score.parts[0], measureId, 1).events, [{ ...chords[0], notes: [chords[0].notes[0], chords[0].notes[2]] }, chords[1]]);
  assert.deepEqual(result.score.ties, [source.ties[0], source.ties[2]]);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(validateScore(result.score), []);
  const next = removeChordToneFromEvent(result.score, part.id, 1, measureId, chords[0].id, chords[0].notes[0].id);
  assert.equal(next.remainingNoteCount, 1);
  assert.deepEqual(next.score.ties, [source.ties[2]]);
  const final = removeChordToneFromEvent(next.score, part.id, 1, measureId, chords[0].id, chords[0].notes[2].id);
  assert.equal(final.removed, false);
  assert.equal(final.score, next.score);
  assert.match(final.error ?? "", /at least two tones/);
  const legacy = removeChordToneFromEvent(source, part.id, 1, measureId, chords[0].id);
  assert.equal(legacy.removedNote?.id, chords[0].notes[2].id, "omitting the note ID keeps last-tone deletion compatible");
});

test("chord-tone entry preserves rhythm, written pitches, immutable undo snapshots, playback, and MusicXML", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staffId = part.staves[1].id;
  const staffIndex = 1;
  const measureId = source.measureOrder[2];
  source.measures[measureId].key = { fifths: 1, mode: "major" };
  const voice = getPrimaryVoice(part, measureId, staffIndex);
  voice.events.push(
    makeEvent({ id: "chord-leading-rest", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: true }),
    makeEvent({ id: "chord-anchor", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false }),
  );
  const sourceSnapshot = structuredClone(source);
  const sourceEvent = voice.events.at(-1)!;
  const ticksBefore = voiceTicks(voice);

  const automaticTone: ScoreNote = {
    id: "chord-tone-f-sharp",
    pitch: { step: "F", alter: 1, octave: 4 },
    accidentalDisplay: "auto",
  };
  const automatic = addChordTone(source, part.id, automaticTone, staffId);
  assert.equal(automatic.error, undefined);
  assert.equal(automatic.added, true);
  assert.equal(automatic.measureId, measureId);
  assert.equal(automatic.eventId, "chord-anchor");
  assert.equal(automatic.noteId, automaticTone.id);
  assert.notEqual(automatic.score, source);
  assert.deepEqual(source, sourceSnapshot, "the undo snapshot must not be mutated");

  const automaticEvent = getPrimaryVoice(automatic.score.parts[0], measureId, staffIndex).events.at(-1)!;
  if (sourceEvent.kind !== "note" || automaticEvent.kind !== "note") assert.fail("Expected chord note events.");
  assert.notEqual(automaticEvent, sourceEvent);
  assert.equal(sourceEvent.notes.length, 1);
  assert.equal(automaticEvent.notes.length, 2);
  assert.equal(automaticEvent.notes[1].id, automaticTone.id);
  assert.notEqual(automaticEvent.notes[1], automaticTone, "the caller-owned note must be cloned");
  assert.deepEqual(automaticEvent.duration, sourceEvent.duration);
  assert.equal(voiceTicks(getPrimaryVoice(automatic.score.parts[0], measureId, staffIndex)), ticksBefore);

  const forcedNaturalTone: ScoreNote = {
    id: "chord-tone-f-natural",
    pitch: { step: "F", alter: 0, octave: 4 },
    accidentalDisplay: "force",
  };
  const forced = addChordTone(automatic.score, part.id, forcedNaturalTone, staffId);
  assert.equal(forced.error, undefined);
  assert.equal(forced.added, true);
  assert.equal(forced.measureId, measureId);
  const forcedEvent = getPrimaryVoice(forced.score.parts[0], measureId, staffIndex).events.at(-1)!;
  if (forcedEvent.kind !== "note") assert.fail("Expected a chord note event.");
  assert.equal(forcedEvent.notes.length, 3);
  assert.equal(forcedEvent.notes[2].accidentalDisplay, "force");
  assert.equal(automaticEvent.notes.length, 2, "the prior state remains a valid one-step undo snapshot");
  assert.equal(voiceTicks(getPrimaryVoice(forced.score.parts[0], measureId, staffIndex)), ticksBefore);

  const playback = collectPlaybackNotes(forced.score).sort((first, second) => first.midi - second.midi);
  assert.deepEqual(playback.map((note) => note.midi), [60, 65, 66]);
  assert.ok(playback[0].startSeconds > 0, "the chord keeps the anchor event's non-zero onset");
  assert.ok(playback.every((note) => note.startSeconds === playback[0].startSeconds));
  assert.ok(playback.every((note) => note.durationSeconds === playback[0].durationSeconds));

  const musicXml = scoreToMusicXML(forced.score);
  const measureNumber = forced.score.measures[measureId].number;
  const xmlMeasure = musicXml.match(new RegExp(`<measure number="${measureNumber}"[^>]*>([\\s\\S]*?)<\\/measure>`))?.[0] ?? "";
  assert.equal((xmlMeasure.match(/<chord\/>/g) ?? []).length, 2);
  assert.match(xmlMeasure, /<note><chord\/><pitch><step>F<\/step><alter>1<\/alter><octave>4<\/octave><\/pitch>/);
  assert.match(xmlMeasure, /<note><chord\/><pitch><step>F<\/step><octave>4<\/octave><\/pitch>[\s\S]*?<accidental>natural<\/accidental>/);

  const duplicate = addChordTone(forced.score, part.id, {
    id: "different-id-same-written-pitch",
    pitch: { ...automaticTone.pitch },
    accidentalDisplay: "force",
  }, staffId);
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.score, forced.score);
  assert.equal(duplicate.measureId, measureId);
  assert.equal(duplicate.eventId, "chord-anchor");
  assert.match(duplicate.error, /written pitch.*already/i);

  const empty = createScore("solo", { seedDemo: false });
  const noEvent = addChordTone(empty, empty.parts[0].id, automaticTone, empty.parts[0].staves[1].id);
  assert.equal(noEvent.added, false);
  assert.equal(noEvent.score, empty);
  assert.equal(noEvent.measureId, null);
  assert.match(noEvent.error, /note before adding a chord tone/i);

  const afterRest = createScore("solo", { seedDemo: false });
  const restMeasureId = afterRest.measureOrder[3];
  getPrimaryVoice(afterRest.parts[0], restMeasureId, 1).events.push(
    makeEvent({ id: "last-rest", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: true }),
  );
  const restError = addChordTone(afterRest, afterRest.parts[0].id, automaticTone, afterRest.parts[0].staves[1].id);
  assert.equal(restError.added, false);
  assert.equal(restError.score, afterRest);
  assert.equal(restError.measureId, restMeasureId);
  assert.equal(restError.eventId, "last-rest");
  assert.match(restError.error, /last event is a rest/i);
});

test("chord entry from either automatic segment preserves the complete rhythm and later dot edits", () => {
  for (const fromTail of [false, true]) {
    const empty = createScore("solo", { seedDemo: false });
    const base = setTimeFromMeasure(empty, empty.measureOrder[0], { numerator: 3, denominator: 4 }).score;
    const partId = base.parts[0].id;
    const [firstId, secondId] = base.measureOrder;
    const seed = makeEvent({ id: "split-chord-seed", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false });
    const entered = appendEvent(base, partId, seed).score;
    const tail = getPrimaryVoice(entered.parts[0], secondId).events[0];
    const source = structuredClone(entered);
    const tone: ScoreNote = { id: "split-added-e", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" };
    const added = fromTail ? addChordTone(entered, partId, tone) : addChordToneToEvent(entered, partId, 0, firstId, seed.id, tone);
    assert.equal(added.added, true);
    assert.deepEqual(entered, source, "chord entry preserves the undo snapshot");
    assert.deepEqual(validateScore(added.score), []);
    assert.equal(added.score.ties.length, 2);
    const rhythm = eventRhythm(added.score, partId, 0, fromTail ? secondId : firstId, fromTail ? tail.id : seed.id)!;
    assert.deepEqual(rhythm.duration, { base: 1, dots: 0 });
    assert.equal(rhythm.eventIds.length, 2);
    const dotted = editEventNotation(added.score, partId, 0, rhythm.measureId, rhythm.eventId, { duration: { base: 1, dots: 1 } });
    assert.equal(dotted.changed, true);
    assert.deepEqual(validateScore(dotted.score), []);
    const expected = [60, 64].map(midi => ({ midi, startSeconds: 0, notatedDurationSeconds: 6 * 60 / base.tempo }));
    const project = (score: ScoreDocument) => collectPlaybackNotes(score).map(({ midi, startSeconds, notatedDurationSeconds }) => ({ midi, startSeconds, notatedDurationSeconds }));
    assert.deepEqual(project(dotted.score), expected);
    assert.deepEqual(project(importMusicXML(scoreToMusicXML(dotted.score)).score), expected);
    assert.deepEqual(JSON.parse(serializeNativeScore(dotted.score)), dotted.score);
    const duplicate = addChordToneToEvent(added.score, partId, 0, firstId, seed.id, { ...tone, id: "duplicate-pitch" });
    assert.equal(duplicate.added, false);
    assert.equal(duplicate.score, added.score);
  }
});

test("adding a chord tone to a manually tied note does not extend it into its neighbor", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const measureId = source.measureOrder[0];
  const notes = ["manual-a", "manual-b"].map(id => makeEvent({ id, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false }));
  if (notes[0].kind !== "note" || notes[1].kind !== "note") assert.fail("Expected notes");
  getPrimaryVoice(part, measureId).events = notes;
  source.ties.push({ id: "manual-tie", fromNoteId: notes[0].notes[0].id, toNoteId: notes[1].notes[0].id });
  const result = addChordToneToEvent(source, part.id, 0, measureId, notes[0].id, { id: "manual-added-e", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  assert.equal(result.added, true);
  assert.deepEqual(result.score.ties, source.ties);
  assert.deepEqual(getPrimaryVoice(result.score.parts[0], measureId).events[1], notes[1]);
  assert.deepEqual(collectPlaybackNotes(result.score).map(({ midi, notatedDurationSeconds }) => [midi, notatedDurationSeconds]), [[60, 4 * 60 / source.tempo], [64, 2 * 60 / source.tempo]]);
});

test("exact chord-tone edits stay attached to a selected seed even when a later measure ends in a rest", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staffId = part.staves[0].id;
  const [seedMeasureId, laterMeasureId] = source.measureOrder;
  const seed = makeEvent({
    id: "first-fit-chord-seed",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  });
  const laterRest = makeEvent({
    id: "later-trailing-rest",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: true,
  });
  getPrimaryVoice(part, seedMeasureId).events.push(seed);
  getPrimaryVoice(part, laterMeasureId).events.push(laterRest);
  const snapshot = structuredClone(source);
  const tone: ScoreNote = {
    id: "exact-selected-tone",
    pitch: { step: "E", alter: 0, octave: 4 },
    accidentalDisplay: "auto",
  };

  const added = addChordToneToEvent(source, part.id, staffId, seedMeasureId, seed.id, tone);
  assert.equal(added.added, true);
  assert.equal(added.measureId, seedMeasureId);
  assert.equal(added.eventId, seed.id);
  assert.deepEqual(source, snapshot, "exact chord entry must preserve its undo snapshot");
  const seededChord = getPrimaryVoice(added.score.parts[0], seedMeasureId).events[0];
  if (seededChord.kind !== "note") assert.fail("Expected the selected seed to remain a note event.");
  assert.deepEqual(seededChord.notes.map((note) => note.pitch.step), ["C", "E"]);
  assert.equal(getPrimaryVoice(added.score.parts[0], laterMeasureId).events[0].id, laterRest.id);

  const removed = removeChordToneFromEvent(added.score, part.id, staffId, seedMeasureId, seed.id);
  assert.equal(removed.removed, true);
  assert.equal(removed.removedNote.id, tone.id);
  assert.equal(removed.remainingNoteCount, 1);
  const restoredSeed = getPrimaryVoice(removed.score.parts[0], seedMeasureId).events[0];
  if (restoredSeed.kind !== "note") assert.fail("Expected chord-tone deletion to preserve the note event.");
  assert.equal(restoredSeed.notes.length, 1);

  const rejectedRest = addChordToneToEvent(source, part.id, staffId, laterMeasureId, laterRest.id, tone);
  assert.equal(rejectedRest.added, false);
  assert.equal(rejectedRest.score, source);
  assert.match(rejectedRest.error, /rest.*cannot receive a chord tone/i);
  const rejectedMissing = removeChordToneFromEvent(source, part.id, staffId, seedMeasureId, "missing-event");
  assert.equal(rejectedMissing.removed, false);
  assert.equal(rejectedMissing.score, source);
  assert.match(rejectedMissing.error, /does not exist/i);
});

test("last chord-tone removal is immutable, rhythm-safe, staff-targeted, and cleans only connected ties", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staffIndex = 1;
  const staffId = part.staves[staffIndex].id;
  const measureId = source.measureOrder[1];
  const voice = getPrimaryVoice(part, measureId, staffIndex);
  const leadC = makeEvent({ id: "remove-chord-lead-c", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false });
  const leadG = makeEvent({ id: "remove-chord-lead-g", pitch: { step: "G", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false });
  const chord = makeEvent({ id: "remove-chord-anchor", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false });
  const unrelatedFrom = makeEvent({ id: "unrelated-tie-from", pitch: { step: "C", alter: 0, octave: 5 }, duration: { base: 1, dots: 0 }, rest: false });
  const unrelatedTo = makeEvent({ id: "unrelated-tie-to", pitch: { step: "C", alter: 0, octave: 5 }, duration: { base: 4, dots: 0 }, rest: false });
  if (leadC.kind !== "note" || leadG.kind !== "note" || chord.kind !== "note" ||
    unrelatedFrom.kind !== "note" || unrelatedTo.kind !== "note") assert.fail("Expected note events for chord removal.");
  chord.notes.push(
    { id: "remove-chord-e", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" },
    { id: "remove-chord-g", pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "force" },
  );
  voice.events.push(leadC, leadG, chord);
  getPrimaryVoice(part, source.measureOrder[0], 0).events.push(unrelatedFrom);
  getPrimaryVoice(part, measureId, 0).events.push(unrelatedTo);
  source.ties = [
    { id: "unrelated-chord-tie", fromNoteId: unrelatedFrom.notes[0].id, toNoteId: unrelatedTo.notes[0].id },
    { id: "incoming-removed-tone-tie", fromNoteId: leadG.notes[0].id, toNoteId: chord.notes[2].id },
  ];

  const sourceSnapshot = structuredClone(source);
  const ticksBefore = voiceTicks(voice);
  const eventsBefore = voice.events.length;
  const playbackBefore = collectPlaybackNotes(source);
  const chordStartBefore = Math.max(...playbackBefore.map((note) => note.startSeconds));
  const chordPlaybackBefore = playbackBefore.filter((note) => note.startSeconds === chordStartBefore);
  const xmlBefore = scoreToMusicXML(source);

  const result = removeLastChordTone(source, part.id, staffId);
  assert.equal(result.error, undefined);
  assert.equal(result.removed, true);
  assert.equal(result.measureId, measureId);
  assert.equal(result.eventId, chord.id);
  assert.equal(result.removedNote.id, "remove-chord-g");
  assert.equal(result.removedNote.pitch.step, "G");
  assert.equal(result.remainingNoteCount, 2);
  assert.notEqual(result.score, source);
  assert.deepEqual(source, sourceSnapshot, "the source remains a valid one-step undo snapshot");

  const nextVoice = getPrimaryVoice(result.score.parts[0], measureId, staffIndex);
  const nextEvent = nextVoice.events.at(-1)!;
  if (nextEvent.kind !== "note") assert.fail("Expected the chord event to remain a note event.");
  assert.equal(nextVoice.events.length, eventsBefore, "removing a tone must not remove its event");
  assert.equal(nextEvent.id, chord.id);
  assert.deepEqual(nextEvent.duration, chord.duration);
  assert.deepEqual(nextEvent.notes.map((note) => note.id), [chord.notes[0].id, "remove-chord-e"]);
  assert.equal(voiceTicks(nextVoice), ticksBefore);
  assert.deepEqual(result.score.ties.map((tie) => tie.id), ["unrelated-chord-tie"]);
  assert.equal(source.ties.length, 2, "tie cleanup must not mutate the undo snapshot");

  const playbackAfter = collectPlaybackNotes(result.score);
  const chordStartAfter = Math.max(...playbackAfter.map((note) => note.startSeconds));
  const chordPlaybackAfter = playbackAfter.filter((note) => note.startSeconds === chordStartAfter);
  assert.equal(chordStartAfter, chordStartBefore, "the chord onset must not move");
  assert.deepEqual(
    chordPlaybackAfter.map((note) => ({ midi: note.midi, durationSeconds: note.durationSeconds })),
    chordPlaybackBefore.filter((note) => note.midi !== 67).map((note) => ({ midi: note.midi, durationSeconds: note.durationSeconds })),
    "remaining chord tones keep simultaneous playback and duration",
  );
  const xmlAfter = scoreToMusicXML(result.score);
  assert.equal((xmlBefore.match(/<chord\/>/g) ?? []).length, 2);
  assert.equal((xmlAfter.match(/<chord\/>/g) ?? []).length, 1);
  assert.match(xmlAfter, /<duration>1920<\/duration>[\s\S]*?<type>half<\/type>/);
  assert.doesNotMatch(xmlAfter, /remove-chord-g/);

  const toSingle = removeLastChordTone(result.score, part.id, staffIndex);
  if (!toSingle.removed) assert.fail(toSingle.error);
  assert.equal(toSingle.removed, true);
  assert.equal(toSingle.remainingNoteCount, 1);
  const singleTone = removeLastChordTone(toSingle.score, part.id, staffId);
  assert.equal(singleTone.removed, false);
  assert.equal(singleTone.score, toSingle.score);
  assert.equal(singleTone.measureId, measureId);
  assert.equal(singleTone.eventId, chord.id);
  assert.match(singleTone.error, /at least two tones/i);

  const empty = createScore("solo", { seedDemo: false });
  const emptyResult = removeLastChordTone(empty, empty.parts[0].id, empty.parts[0].staves[1].id);
  assert.equal(emptyResult.removed, false);
  assert.equal(emptyResult.score, empty);
  assert.equal(emptyResult.measureId, null);
  assert.match(emptyResult.error, /no event/i);

  const afterRest = createScore("solo", { seedDemo: false });
  const restMeasureId = afterRest.measureOrder[3];
  getPrimaryVoice(afterRest.parts[0], restMeasureId, 1).events.push(
    makeEvent({ id: "remove-chord-rest", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: true }),
  );
  const restResult = removeLastChordTone(afterRest, afterRest.parts[0].id, afterRest.parts[0].staves[1].id);
  assert.equal(restResult.removed, false);
  assert.equal(restResult.score, afterRest);
  assert.equal(restResult.measureId, restMeasureId);
  assert.equal(restResult.eventId, "remove-chord-rest");
  assert.match(restResult.error, /last event is a rest/i);

  const invalidPart = removeLastChordTone(source, "missing-part", staffId);
  assert.equal(invalidPart.removed, false);
  assert.equal(invalidPart.score, source);
  assert.match(invalidPart.error, /instrument/i);
  const invalidStaff = removeLastChordTone(source, part.id, "missing-staff");
  assert.equal(invalidStaff.removed, false);
  assert.equal(invalidStaff.score, source);
  assert.match(invalidStaff.error, /valid staff/i);
});

test("explicit measure append inherits meter and key across every part, staff, and voice without ID collisions", () => {
  const score = createScore("quartet", { seedDemo: false });
  const previousMeasureId = score.measureOrder.at(-1)!;
  score.measures[previousMeasureId].time = { numerator: 7, denominator: 8 };
  score.measures[previousMeasureId].key = { fifths: -4, mode: "minor" };

  const extraStaff = structuredClone(score.parts[0].staves[0]);
  extraStaff.id = `${score.parts[0].id}-staff-2`;
  Object.entries(extraStaff.measures).forEach(([measureId, measure]) => {
    measure.voices = [{ id: `${extraStaff.id}-${measureId}-v1`, events: [] }];
  });
  score.parts[0].staves.push(extraStaff);

  score.measures["measure-5"] = { id: "measure-5", number: 99, time: { numerator: 4, denominator: 4 }, key: { fifths: 0, mode: "major" } };
  const previousVoiceCounts = score.parts.flatMap((part) => part.staves.map((staff) => staff.measures[previousMeasureId].voices.length));
  const appended = appendMeasure(score);
  const newMeasureId = appended.measureOrder.at(-1)!;

  assert.equal(newMeasureId, "measure-6");
  assert.equal(score.measureOrder.length, 4, "source score stays immutable");
  assert.deepEqual(appended.measures[newMeasureId].time, { numerator: 7, denominator: 8 });
  assert.deepEqual(appended.measures[newMeasureId].key, { fifths: -4, mode: "minor" });
  assert.equal(appended.measures[newMeasureId].number, 5);
  const newStaffMeasures = appended.parts.flatMap((part) => part.staves.map((staff) => staff.measures[newMeasureId]));
  assert.ok(newStaffMeasures.every(Boolean));
  assert.deepEqual(newStaffMeasures.map((measure) => measure.voices.length), previousVoiceCounts);
  assert.ok(newStaffMeasures.every((measure) => measure.voices.every((voice) => voice.events.length === 0)));
  const voiceIds = appended.parts.flatMap((part) => part.staves.flatMap((staff) => Object.values(staff.measures).flatMap((measure) => measure.voices.map((voice) => voice.id))));
  assert.equal(new Set(voiceIds).size, voiceIds.length);

  const appendedAgain = appendMeasure(appended);
  assert.notEqual(appendedAgain.measureOrder.at(-1), newMeasureId);

  const adversarial = createScore("solo", { seedDemo: false });
  const collidingVoiceId = `${adversarial.parts[0].staves[0].id}-measure-5-v1`;
  getPrimaryVoice(adversarial.parts[0], adversarial.measureOrder[0]).events.push(makeEvent({
    id: collidingVoiceId,
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  }));
  assert.deepEqual(validateScore(adversarial), []);
  const safelyAppended = appendMeasure(adversarial);
  const addedMeasureId = safelyAppended.measureOrder.at(-1)!;
  assert.notEqual(getPrimaryVoice(safelyAppended.parts[0], addedMeasureId).id, collidingVoiceId);
  assert.deepEqual(validateScore(safelyAppended), []);
});

test("automatic event entry reuses the complete append-measure path", () => {
  const score = createScore("solo", { seedDemo: false });
  const part = score.parts[0];
  const extraStaff = structuredClone(part.staves[0]);
  extraStaff.id = `${part.id}-staff-${part.staves.length + 1}`;
  Object.entries(extraStaff.measures).forEach(([measureId, measure]) => {
    measure.voices = [{ id: `${extraStaff.id}-${measureId}-v1`, events: [] }];
  });
  part.staves.push(extraStaff);
  score.measureOrder.forEach((measureId, index) => {
    getPrimaryVoice(part, measureId).events.push(makeEvent({ id: `full-${index}`, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false }));
  });

  const result = appendEvent(score, part.id, makeEvent({ id: "automatic-new-measure", pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }));
  assert.equal(result.error, undefined);
  assert.equal(result.score.measureOrder.length, 5);
  assert.equal(result.measureId, result.score.measureOrder.at(-1));
  assert.ok(result.score.parts[0].staves.every((staff) => staff.measures[result.measureId!]?.voices.length === 1));
  assert.equal(getPrimaryVoice(result.score.parts[0], result.measureId!).events.length, 1);
});

test("event entry splits a note longer than the meter and preserves its held duration", () => {
  const score = createScore("solo", { seedDemo: false });
  score.measureOrder.forEach((measureId) => { score.measures[measureId].time = { numerator: 6, denominator: 8 }; });
  const original = structuredClone(score);
  const result = appendEvent(score, score.parts[0].id, makeEvent({ id: "long-entry", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false }));
  assert.equal(result.error, undefined);
  assert.equal(result.measureId, score.measureOrder[0]);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.score.ties.length, 1);
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(score, original, "one Undo snapshot must retain the untouched source");
  assert.equal(collectPlaybackNotes(result.score).length, 1);
  assert.equal(collectPlaybackNotes(result.score)[0].notatedDurationSeconds, 4 * 60 / score.tempo);
});

test("entry fills the remaining beat, shifts following tied chords, and preserves other staves", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2, m3] = source.measureOrder;
  getPrimaryVoice(part, m1).events.push(makeEvent({ id: "entry-prefix", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 1 }, rest: true }));
  const first = makeEvent({ id: "following-first", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false });
  const last = makeEvent({ id: "following-last", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false });
  assert.equal(first.kind, "note"); assert.equal(last.kind, "note");
  if (first.kind !== "note" || last.kind !== "note") return;
  first.notes.push({ id: "following-first-g", pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  last.notes.push({ id: "following-last-g", pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  getPrimaryVoice(part, m2).events.push(first);
  getPrimaryVoice(part, m3).events.push(last);
  first.notes.forEach((note, index) => source.ties.push({ id: `following-tie-${index}`, fromNoteId: note.id, toNoteId: last.notes[index].id }));
  const original = structuredClone(source);
  const result = appendEvent(source, part.id, makeEvent({ id: "bar-crossing-entry", pitch: { step: "C", alter: 0, octave: 5 }, duration: { base: 2, dots: 0 }, rest: false }));
  assert.equal(result.error, undefined);
  assert.equal(result.measureId, m1, "entry must use the next free beat instead of skipping to a later bar");
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(source, original);
  assert.deepEqual(result.score.parts[0].staves[1], original.parts[0].staves[1]);
  const notes = collectPlaybackNotes(result.score).sort((a, b) => a.midi - b.midi);
  assert.equal(notes.length, 3, "split chords must remain single sustained tones");
  const beat = 60 / source.tempo;
  assert.deepEqual(notes.map((note) => [note.midi, note.startSeconds / beat, note.notatedDurationSeconds / beat]), [[60, 5, 6], [67, 5, 6], [72, 3, 2]]);
});

test("entry from a chosen measure advances beyond full bars without returning to earlier blanks", () => {
  const score = createScore("solo", { seedDemo: false });
  const part = score.parts[0];
  const chosen = score.measureOrder[2];
  getPrimaryVoice(part, chosen).events.push(makeEvent({ id: "chosen-full", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false }));
  const result = appendEvent(score, part.id, makeEvent({ id: "next-after-tab", pitch: { step: "E", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }), 0, chosen);
  assert.equal(result.error, undefined);
  assert.equal(result.measureId, score.measureOrder[3]);
  assert.equal(getPrimaryVoice(result.score.parts[0], score.measureOrder[0]).events.length, 0);
  const invalid = appendEvent(score, part.id, makeEvent({ id: "missing-input", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }), 0, "missing-measure");
  assert.equal(invalid.score, score);
  assert.match(invalid.error ?? "", /no longer available/);
});

test("entry rejects an unnotatable split atomically", () => {
  const score = createScore("solo", { seedDemo: false });
  score.measureOrder.forEach(id => { score.measures[id].time = { numerator: 2, denominator: 64 }; });
  getPrimaryVoice(score.parts[0], score.measureOrder[0]).events.push(makeEvent({ id: "tiny-prefix", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 64, dots: 2 }, rest: true }));
  const original = structuredClone(score);
  const result = appendEvent(score, score.parts[0].id, makeEvent({ id: "tiny-remainder", pitch: { step: "E", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }));
  assert.equal(result.score, score);
  assert.match(result.error ?? "", /split shorter/);
  assert.deepEqual(score, original);
});

test("last-measure removal deletes only empty structure and preserves at least one measure", () => {
  const score = appendMeasure(createScore("quartet", { seedDemo: false }));
  const removedMeasureId = score.measureOrder.at(-1)!;
  const removed = removeLastMeasure(score);
  if (!removed.removed) assert.fail(removed.error);
  assert.equal(removed.removed, true);
  assert.equal(removed.measureId, removedMeasureId);
  assert.equal(score.measureOrder.length, 5, "source score stays immutable");
  assert.equal(removed.score.measureOrder.length, 4);
  assert.equal(removed.score.measures[removedMeasureId], undefined);
  assert.ok(removed.score.parts.every((part) => part.staves.every((staff) => staff.measures[removedMeasureId] === undefined)));

  let oneMeasure = removed.score;
  while (oneMeasure.measureOrder.length > 1) {
    const result = removeLastMeasure(oneMeasure);
    if (!result.removed) assert.fail(result.error);
    assert.equal(result.removed, true);
    oneMeasure = result.score;
  }
  const minimumBlocked = removeLastMeasure(oneMeasure);
  assert.equal(minimumBlocked.removed, false);
  assert.equal(minimumBlocked.score, oneMeasure);
  if (minimumBlocked.removed) assert.fail("Expected the minimum-measure guard.");
  assert.match(minimumBlocked.error, /at least one measure/);
});

test("last-measure removal refuses music in any voice and ties touching that measure", () => {
  const occupied = appendMeasure(createScore("quartet", { seedDemo: false }));
  const occupiedMeasureId = occupied.measureOrder.at(-1)!;
  occupied.parts.at(-1)!.staves[0].measures[occupiedMeasureId].voices.push({
    id: "occupied-secondary-voice",
    events: [{ id: "occupied-rest", kind: "rest", duration: { base: 4, dots: 0 } }],
  });
  const occupiedResult = removeLastMeasure(occupied);
  assert.equal(occupiedResult.removed, false);
  assert.equal(occupiedResult.score, occupied);
  if (occupiedResult.removed) assert.fail("Expected occupied measure refusal.");
  assert.match(occupiedResult.error, /contains music/);

  const tied = appendMeasure(createScore("solo", { seedDemo: false }));
  const firstMeasureId = tied.measureOrder[0];
  const lastMeasureId = tied.measureOrder.at(-1)!;
  const firstEvent = makeEvent({ id: "tie-origin", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const lastEvent = makeEvent({ id: "tie-destination", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(tied.parts[0], firstMeasureId).events.push(firstEvent);
  getPrimaryVoice(tied.parts[0], lastMeasureId).events.push(lastEvent);
  if (firstEvent.kind !== "note" || lastEvent.kind !== "note") assert.fail("Expected note events.");
  tied.ties.push({ id: "last-measure-tie", fromNoteId: firstEvent.notes[0].id, toNoteId: lastEvent.notes[0].id });
  const tiedResult = removeLastMeasure(tied);
  assert.equal(tiedResult.removed, false);
  assert.equal(tiedResult.score, tied);
  if (tiedResult.removed) assert.fail("Expected tie refusal.");
  assert.match(tiedResult.error, /ties connected/);
});

test("key-aware entry preserves automatic versus explicitly forced accidental intent", () => {
  const score = createScore("solo", { seedDemo: false, key: { fifths: 0, mode: "major" } });
  const part = score.parts[0];
  getPrimaryVoice(part, score.measureOrder[0]).events.push(
    makeEvent({ id: "full-first-measure", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false }),
  );
  score.measures[score.measureOrder[1]].key = { fifths: 1, mode: "major" };
  const targetMeasureId = findEventTargetMeasureId(score, part.id, { base: 4, dots: 0 });
  assert.equal(targetMeasureId, score.measureOrder[1]);
  const writtenKey = writtenKeyForPart(score.measures[targetMeasureId].key, part);

  const automatic = makeEvent({
    id: "automatic-f-sharp",
    pitch: { step: "F", alter: keySignatureAlterForStep(writtenKey, "F"), octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  });
  const forcedNatural = makeEvent({
    id: "forced-f-natural",
    pitch: { step: "F", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
    accidentalDisplay: "force",
  });
  if (automatic.kind !== "note" || forcedNatural.kind !== "note") assert.fail("Expected note events.");
  assert.equal(automatic.notes[0].pitch.alter, 1);
  assert.equal(automatic.notes[0].accidentalDisplay, "auto");
  assert.equal(forcedNatural.notes[0].pitch.alter, 0);
  assert.equal(forcedNatural.notes[0].accidentalDisplay, "force");
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

  const lowerStaffDraft = createScore("solo", { seedDemo: false });
  const lowerVoice = getPrimaryVoice(lowerStaffDraft.parts[0], lowerStaffDraft.measureOrder[0], 1);
  lowerVoice.events.push(
    makeEvent({ id: "lower-whole", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 1, dots: 0 }, rest: false }),
    makeEvent({ id: "lower-quarter", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false }),
  );
  assert.match(validateScore(lowerStaffDraft).join("\n"), /staff 2, measure 1 exceeds/);
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

  const gap = createScore("solo", { seedDemo: false });
  const gapVoice1 = getPrimaryVoice(gap.parts[0], gap.measureOrder[0]);
  const gapVoice2 = getPrimaryVoice(gap.parts[0], gap.measureOrder[1]);
  gapVoice1.events.push(makeEvent({ id: "gap-from", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }));
  gapVoice2.events.push(makeEvent({ id: "gap-to", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }));
  const rejectedGap = toggleTieLastTwo(gap, gap.parts[0].id);
  assert.equal(rejectedGap.score, gap);
  assert.equal(rejectedGap.tied, false);
  assert.match(rejectedGap.error ?? "", /start tick must exactly equal.*end tick/i);
  assert.deepEqual(gap.ties, []);

  const idCollision = createScore("solo", { seedDemo: false });
  const collisionVoice = getPrimaryVoice(idCollision.parts[0], idCollision.measureOrder[0]);
  const collisionFrom = makeEvent({ id: "collision-from-event", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const collisionTo = makeEvent({ id: "collision-to-event", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (collisionFrom.kind !== "note" || collisionTo.kind !== "note") assert.fail("Expected tie collision notes.");
  collisionFrom.notes[0].id = "n1";
  collisionTo.notes[0].id = "n2";
  collisionVoice.events.push(collisionFrom, collisionTo);
  getPrimaryVoice(idCollision.parts[0], idCollision.measureOrder[0], 1).events.push({
    id: "tie-n1-n2",
    kind: "rest",
    duration: { base: 4, dots: 0 },
  });
  assert.deepEqual(validateScore(idCollision), []);
  const collisionTie = toggleTieLastTwo(idCollision, idCollision.parts[0].id);
  assert.equal(collisionTie.error, undefined);
  assert.equal(collisionTie.score.ties[0].id, "tie-n1-n2-2");
  assert.deepEqual(validateScore(collisionTie.score), []);
});

test("semantic dynamics attach immutably to the latest selected-staff event without changing rhythm or identity", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staffId = part.staves[1].id;
  const measureId = source.measureOrder[2];
  const voice = getPrimaryVoice(part, measureId, 1);
  voice.events.push(makeEvent({
    id: "dynamic-anchor",
    pitch: { step: "C", alter: 0, octave: 3 },
    duration: { base: 8, dots: 2 },
    rest: false,
  }));
  const snapshot = structuredClone(source);
  const ticksBefore = voiceTicks(voice);

  const attached = setLastEventDynamic(source, part.id, "mf", staffId);
  assert.equal(attached.error, undefined);
  assert.equal(attached.changed, true);
  assert.equal(attached.measureId, measureId);
  assert.equal(attached.eventId, "dynamic-anchor");
  assert.equal(attached.previousDynamic, null);
  assert.equal(attached.dynamic, "mf");
  assert.notEqual(attached.score, source);
  assert.deepEqual(source, snapshot, "the source remains a one-step undo snapshot");
  const attachedEvent = getPrimaryVoice(attached.score.parts[0], measureId, 1).events[0];
  assert.equal(attachedEvent.id, "dynamic-anchor");
  assert.deepEqual(attachedEvent.duration, { base: 8, dots: 2 });
  assert.equal(attachedEvent.dynamic, "mf");
  assert.equal(voiceTicks(getPrimaryVoice(attached.score.parts[0], measureId, 1)), ticksBefore);

  const replaced = setLastEventDynamic(attached.score, part.id, "fff", staffId);
  assert.equal(replaced.error, undefined);
  assert.equal(replaced.changed, true);
  assert.equal(replaced.previousDynamic, "mf");
  assert.equal(getPrimaryVoice(replaced.score.parts[0], measureId, 1).events[0].dynamic, "fff");

  const unchanged = setLastEventDynamic(replaced.score, part.id, "fff", staffId);
  assert.equal(unchanged.error, undefined);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.score, replaced.score, "a semantic no-op must not create undo history");

  const cleared = setLastEventDynamic(replaced.score, part.id, null, staffId);
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.changed, true);
  assert.equal(cleared.previousDynamic, "fff");
  assert.equal(Object.hasOwn(getPrimaryVoice(cleared.score.parts[0], measureId, 1).events[0], "dynamic"), false);
  assert.equal(validateScore(JSON.parse(JSON.stringify(cleared.score))).length, 0, "native JSON keeps the optional dynamic field valid");

  const empty = createScore("solo", { seedDemo: false });
  const missing = setLastEventDynamic(empty, empty.parts[0].id, "p", empty.parts[0].staves[1].id);
  assert.equal(missing.changed, false);
  assert.equal(missing.score, empty);
  if (!missing.error) assert.fail("Expected the empty-staff dynamic guard.");
  assert.match(missing.error, /note or rest before adding a dynamic/i);
});

test("articulations attach immutably to the latest selected-staff note while skipping trailing rests", () => {
  assert.deepEqual(ARTICULATIONS, ["staccato", "tenuto", "accent", "marcato"]);
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staffId = part.staves[1].id;
  const noteMeasureId = source.measureOrder[1];
  const restMeasureId = source.measureOrder[2];
  const note = makeEvent({
    id: "articulation-note",
    pitch: { step: "C", alter: 0, octave: 3 },
    duration: { base: 8, dots: 1 },
    rest: false,
  });
  getPrimaryVoice(part, noteMeasureId, 1).events.push(note);
  getPrimaryVoice(part, restMeasureId, 1).events.push(makeEvent({
    id: "trailing-rest",
    pitch: { step: "C", alter: 0, octave: 3 },
    duration: { base: 4, dots: 0 },
    rest: true,
  }));
  const snapshot = structuredClone(source);
  const ticksBefore = voiceTicks(getPrimaryVoice(part, noteMeasureId, 1));

  const attached = setLastNoteArticulation(source, part.id, "staccato", staffId);
  assert.equal(attached.error, undefined);
  assert.equal(attached.changed, true);
  assert.equal(attached.measureId, noteMeasureId);
  assert.equal(attached.eventId, "articulation-note");
  assert.equal(attached.previousArticulation, null);
  assert.notEqual(attached.score, source);
  assert.deepEqual(source, snapshot, "the command must preserve the undo snapshot");
  const attachedNote = getPrimaryVoice(attached.score.parts[0], noteMeasureId, 1).events[0];
  const trailingRest = getPrimaryVoice(attached.score.parts[0], restMeasureId, 1).events[0];
  assert.equal(attachedNote.kind, "note");
  if (attachedNote.kind !== "note") assert.fail("Expected an articulated note.");
  assert.equal(attachedNote.articulation, "staccato");
  assert.equal(Object.hasOwn(trailingRest, "articulation"), false);
  assert.equal(voiceTicks(getPrimaryVoice(attached.score.parts[0], noteMeasureId, 1)), ticksBefore);

  const replaced = setLastNoteArticulation(attached.score, part.id, "marcato", 1);
  assert.equal(replaced.error, undefined);
  assert.equal(replaced.changed, true);
  assert.equal(replaced.previousArticulation, "staccato");
  const replacedNote = getPrimaryVoice(replaced.score.parts[0], noteMeasureId, 1).events[0];
  if (replacedNote.kind !== "note") assert.fail("Expected an articulated note.");
  assert.equal(replacedNote.articulation, "marcato");

  const unchanged = setLastNoteArticulation(replaced.score, part.id, "marcato", staffId);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.score, replaced.score, "a no-op must not create an undo snapshot");

  const cleared = setLastNoteArticulation(replaced.score, part.id, null, staffId);
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.changed, true);
  const clearedNote = getPrimaryVoice(cleared.score.parts[0], noteMeasureId, 1).events[0];
  assert.equal(Object.hasOwn(clearedNote, "articulation"), false);
  assert.deepEqual(validateScore(JSON.parse(JSON.stringify(cleared.score))), []);

  const empty = createScore("solo", { seedDemo: false });
  const missing = setLastNoteArticulation(empty, empty.parts[0].id, "accent", empty.parts[0].staves[1].id);
  assert.equal(missing.changed, false);
  assert.equal(missing.score, empty);
  assert.match(missing.error ?? "", /note before adding an articulation/i);

  const invalid = setLastNoteArticulation(source, part.id, "fermata" as never, staffId);
  assert.equal(invalid.changed, false);
  assert.equal(invalid.score, source);
  assert.match(invalid.error ?? "", /staccato.*tenuto.*accent.*marcato/i);
});

test("selected-event dynamics update exactly one note or rest with immutable, identity-preserving outcomes", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const upperStaff = part.staves[0];
  const lowerStaff = part.staves[1];
  const [otherMeasureId, targetMeasureId] = source.measureOrder;
  const before = makeEvent({ id: "dynamic-before", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 8, dots: 0 }, rest: false });
  const target = makeEvent({ id: "dynamic-target-rest", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: true });
  const after = makeEvent({ id: "dynamic-after", pitch: { step: "E", alter: 0, octave: 3 }, duration: { base: 8, dots: 0 }, rest: false });
  const otherStaffEvent = makeEvent({ id: "dynamic-other-staff", pitch: { step: "F", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const otherMeasureEvent = makeEvent({ id: "dynamic-other-measure", pitch: { step: "G", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(part, targetMeasureId, 1).events.push(before, target, after);
  getPrimaryVoice(part, targetMeasureId, 0).events.push(otherStaffEvent);
  getPrimaryVoice(part, otherMeasureId, 1).events.push(otherMeasureEvent);
  const snapshot = structuredClone(source);
  const ticksBefore = voiceTicks(getPrimaryVoice(part, targetMeasureId, 1));

  const attached = setEventDynamic(source, part.id, lowerStaff.id, targetMeasureId, target.id, "ff");
  assert.equal(attached.error, undefined);
  assert.equal(attached.changed, true);
  assert.equal(attached.measureId, targetMeasureId);
  assert.equal(attached.eventId, target.id);
  assert.equal(attached.previousDynamic, null);
  assert.equal(attached.dynamic, "ff");
  assert.notEqual(attached.score, source);
  assert.notEqual(attached.score.updatedAt, source.updatedAt, "a successful edit stamps the cloned score");
  assert.deepEqual(source, snapshot, "a successful exact edit preserves the source as an undo snapshot");
  const attachedEvents = getPrimaryVoice(attached.score.parts[0], targetMeasureId, 1).events;
  assert.equal(attachedEvents[0].dynamic, undefined);
  assert.equal(attachedEvents[1].id, target.id);
  assert.equal(attachedEvents[1].dynamic, "ff", "a middle rest accepts an event-level dynamic");
  assert.equal(attachedEvents[2].dynamic, undefined);
  assert.equal(getPrimaryVoice(attached.score.parts[0], targetMeasureId, 0).events[0].dynamic, undefined);
  assert.equal(getPrimaryVoice(attached.score.parts[0], otherMeasureId, 1).events[0].dynamic, undefined);
  assert.equal(voiceTicks(getPrimaryVoice(attached.score.parts[0], targetMeasureId, 1)), ticksBefore);

  const unchanged = setEventDynamic(attached.score, part.id, 1, targetMeasureId, target.id, "ff");
  assert.equal(unchanged.error, undefined);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.previousDynamic, "ff");
  assert.equal(unchanged.score, attached.score, "an exact semantic no-op does not create undo history or restamp");

  const cleared = setEventDynamic(attached.score, part.id, lowerStaff.id, targetMeasureId, target.id, null);
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.changed, true);
  assert.equal(cleared.previousDynamic, "ff");
  assert.equal(Object.hasOwn(getPrimaryVoice(cleared.score.parts[0], targetMeasureId, 1).events[1], "dynamic"), false);
  assert.deepEqual(validateScore(JSON.parse(JSON.stringify(cleared.score))), []);

  const failures = [
    { result: setEventDynamic(source, "missing-part", lowerStaff.id, targetMeasureId, target.id, "p"), error: /instrument part "missing-part" does not exist/i },
    { result: setEventDynamic(source, part.id, "missing-staff", targetMeasureId, target.id, "p"), error: /staff selector "missing-staff".*part/i },
    { result: setEventDynamic(source, part.id, lowerStaff.id, "missing-measure", target.id, "p"), error: /measure "missing-measure" does not exist/i },
    { result: setEventDynamic(source, part.id, lowerStaff.id, targetMeasureId, "missing-event", "p"), error: /event "missing-event" does not exist.*staff/i },
    { result: setEventDynamic(source, part.id, lowerStaff.id, targetMeasureId, target.id, "forte" as never), error: /ppp.*fff.*none/i },
  ];
  for (const { result, error } of failures) {
    assert.equal(result.changed, false);
    assert.equal(result.score, source, "every validation failure preserves score identity");
    assert.match(result.error ?? "", error);
  }

  const missingStaffMeasure = structuredClone(source);
  delete missingStaffMeasure.parts[0].staves[1].measures[targetMeasureId];
  const missingCell = setEventDynamic(missingStaffMeasure, part.id, lowerStaff.id, targetMeasureId, target.id, "p");
  assert.equal(missingCell.changed, false);
  assert.equal(missingCell.score, missingStaffMeasure);
  assert.match(missingCell.error ?? "", /staff.*is missing measure/i);

  const ambiguous = structuredClone(source);
  ambiguous.parts[0].staves[1].measures[targetMeasureId].voices.push({
    id: "dynamic-duplicate-voice",
    events: [structuredClone(target)],
  });
  const duplicate = setEventDynamic(ambiguous, part.id, lowerStaff.id, targetMeasureId, target.id, "p");
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.score, ambiguous);
  assert.match(duplicate.error ?? "", /event id.*ambiguous/i);
  assert.equal(upperStaff.id, source.parts[0].staves[0].id);
});

test("selected-event articulations update only the exact note and reject rests or ambiguous targets", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const upperStaff = part.staves[0];
  const lowerStaff = part.staves[1];
  const [otherMeasureId, targetMeasureId] = source.measureOrder;
  const before = makeEvent({ id: "articulation-before", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 8, dots: 0 }, rest: false });
  const target = makeEvent({ id: "articulation-target", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 1 }, rest: false });
  const rest = makeEvent({ id: "articulation-rest", pitch: { step: "E", alter: 0, octave: 3 }, duration: { base: 8, dots: 0 }, rest: true });
  const otherStaffEvent = makeEvent({ id: "articulation-other-staff", pitch: { step: "F", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const otherMeasureEvent = makeEvent({ id: "articulation-other-measure", pitch: { step: "G", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(part, targetMeasureId, 1).events.push(before, target, rest);
  getPrimaryVoice(part, targetMeasureId, 0).events.push(otherStaffEvent);
  getPrimaryVoice(part, otherMeasureId, 1).events.push(otherMeasureEvent);
  const snapshot = structuredClone(source);
  const ticksBefore = voiceTicks(getPrimaryVoice(part, targetMeasureId, 1));

  const attached = setEventArticulation(source, part.id, lowerStaff.id, targetMeasureId, target.id, "accent");
  assert.equal(attached.error, undefined);
  assert.equal(attached.changed, true);
  assert.equal(attached.measureId, targetMeasureId);
  assert.equal(attached.eventId, target.id);
  assert.equal(attached.previousArticulation, null);
  assert.equal(attached.articulation, "accent");
  assert.notEqual(attached.score, source);
  assert.notEqual(attached.score.updatedAt, source.updatedAt, "a successful edit stamps the cloned score");
  assert.deepEqual(source, snapshot, "articulation editing leaves the source untouched");
  const attachedEvents = getPrimaryVoice(attached.score.parts[0], targetMeasureId, 1).events;
  assert.equal(attachedEvents[0].kind, "note");
  if (attachedEvents[0].kind !== "note" || attachedEvents[1].kind !== "note") assert.fail("Expected note fixtures.");
  assert.equal(attachedEvents[0].articulation, undefined);
  assert.equal(attachedEvents[1].articulation, "accent", "only the selected middle note changes");
  assert.equal(getPrimaryVoice(attached.score.parts[0], targetMeasureId, 0).events[0].kind, "note");
  const attachedOtherStaffEvent = getPrimaryVoice(attached.score.parts[0], targetMeasureId, 0).events[0];
  const attachedOtherMeasureEvent = getPrimaryVoice(attached.score.parts[0], otherMeasureId, 1).events[0];
  if (attachedOtherStaffEvent.kind !== "note" || attachedOtherMeasureEvent.kind !== "note") assert.fail("Expected note fixtures.");
  assert.equal(attachedOtherStaffEvent.articulation, undefined);
  assert.equal(attachedOtherMeasureEvent.articulation, undefined);
  assert.equal(voiceTicks(getPrimaryVoice(attached.score.parts[0], targetMeasureId, 1)), ticksBefore);

  const unchanged = setEventArticulation(attached.score, part.id, 1, targetMeasureId, target.id, "accent");
  assert.equal(unchanged.error, undefined);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.previousArticulation, "accent");
  assert.equal(unchanged.score, attached.score, "an exact articulation no-op preserves identity");

  const replaced = setEventArticulation(attached.score, part.id, lowerStaff.id, targetMeasureId, target.id, "marcato");
  assert.equal(replaced.error, undefined);
  assert.equal(replaced.changed, true);
  assert.equal(replaced.previousArticulation, "accent");
  const replacedEvent = getPrimaryVoice(replaced.score.parts[0], targetMeasureId, 1).events[1];
  if (replacedEvent.kind !== "note") assert.fail("Expected the selected note.");
  assert.equal(replacedEvent.articulation, "marcato");

  const cleared = setEventArticulation(replaced.score, part.id, lowerStaff.id, targetMeasureId, target.id, null);
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.changed, true);
  assert.equal(cleared.previousArticulation, "marcato");
  const clearedEvent = getPrimaryVoice(cleared.score.parts[0], targetMeasureId, 1).events[1];
  assert.equal(Object.hasOwn(clearedEvent, "articulation"), false);
  assert.deepEqual(validateScore(JSON.parse(JSON.stringify(cleared.score))), []);

  const failures = [
    { result: setEventArticulation(source, "missing-part", lowerStaff.id, targetMeasureId, target.id, "tenuto"), error: /instrument part "missing-part" does not exist/i },
    { result: setEventArticulation(source, part.id, "missing-staff", targetMeasureId, target.id, "tenuto"), error: /staff selector "missing-staff".*part/i },
    { result: setEventArticulation(source, part.id, lowerStaff.id, "missing-measure", target.id, "tenuto"), error: /measure "missing-measure" does not exist/i },
    { result: setEventArticulation(source, part.id, lowerStaff.id, targetMeasureId, "missing-event", "tenuto"), error: /event "missing-event" does not exist.*staff/i },
    { result: setEventArticulation(source, part.id, lowerStaff.id, targetMeasureId, rest.id, "tenuto"), error: /rest.*cannot have an articulation/i },
    { result: setEventArticulation(source, part.id, lowerStaff.id, targetMeasureId, target.id, "fermata" as never), error: /staccato.*tenuto.*accent.*marcato.*none/i },
  ];
  for (const { result, error } of failures) {
    assert.equal(result.changed, false);
    assert.equal(result.score, source, "every invalid articulation request preserves score identity");
    assert.match(result.error ?? "", error);
  }

  const ambiguous = structuredClone(source);
  ambiguous.parts[0].staves[1].measures[targetMeasureId].voices.push({
    id: "articulation-duplicate-voice",
    events: [structuredClone(target)],
  });
  const duplicate = setEventArticulation(ambiguous, part.id, lowerStaff.id, targetMeasureId, target.id, "tenuto");
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.score, ambiguous);
  assert.match(duplicate.error ?? "", /event id.*ambiguous/i);
  assert.equal(upperStaff.id, source.parts[0].staves[0].id);
});

test("articulation performance, MIDI, and MusicXML share bounded semantics", () => {
  assert.equal(STACCATO_GATE_RATIO, 0.5);
  assert.deepEqual(ARTICULATION_VELOCITY_BONUSES, { staccato: 0, tenuto: 0, accent: 14, marcato: 24 });
  const score = createScore("solo", { seedDemo: false });
  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  const normal = makeEvent({ id: "art-normal", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false });
  const staccato = makeEvent({ id: "art-staccato", pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false });
  const tenuto = makeEvent({ id: "art-tenuto", pitch: { step: "E", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false });
  const accent = makeEvent({ id: "art-accent", pitch: { step: "F", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false });
  const marcato = makeEvent({ id: "art-marcato", pitch: { step: "G", alter: 0, octave: 4 }, duration: { base: 8, dots: 0 }, rest: false });
  if (staccato.kind !== "note" || tenuto.kind !== "note" || accent.kind !== "note" || marcato.kind !== "note") assert.fail("Expected note events.");
  staccato.articulation = "staccato";
  tenuto.articulation = "tenuto";
  accent.articulation = "accent";
  marcato.articulation = "marcato";
  marcato.dynamic = "fff";
  voice.events.push(normal, staccato, tenuto, accent, marcato);
  assert.deepEqual(validateScore(score), []);

  const playback = new Map(collectPlaybackNotes(score).map((item) => [item.midi, item]));
  const normalPlayback = playback.get(60)!;
  assert.equal(playback.get(62)!.durationSeconds, normalPlayback.durationSeconds * STACCATO_GATE_RATIO);
  assert.equal(playback.get(62)!.notatedDurationSeconds, normalPlayback.notatedDurationSeconds, "staccato changes the sound gate, not the engraved cursor span");
  assert.equal(playback.get(64)!.durationSeconds, normalPlayback.durationSeconds, "tenuto retains the normal Garak gate");
  assert.equal(playback.get(65)!.velocity, DEFAULT_MIDI_VELOCITY + ARTICULATION_VELOCITY_BONUSES.accent);
  assert.equal(playback.get(67)!.velocity, 127, "marcato velocity is clamped to MIDI's maximum");

  const midi = [...scoreToMidi(score)];
  const contains = (needle: number[]) => midi.some((_, index) => needle.every((byte, offset) => midi[index + offset] === byte));
  assert.ok(contains([0x90, 65, DEFAULT_MIDI_VELOCITY + ARTICULATION_VELOCITY_BONUSES.accent]));
  assert.ok(contains([0x90, 67, 127]));

  const xml = scoreToMusicXML(score);
  assert.match(xml, /<articulations><staccato\/><\/articulations>/);
  assert.match(xml, /<articulations><tenuto\/><\/articulations>/);
  assert.match(xml, /<articulations><accent\/><\/articulations>/);
  assert.match(xml, /<articulations><strong-accent type="up"\/><\/articulations>/);
});

test("VexFlow 5 articulation modifiers preserve StaveNote ticks", async () => {
  const { Articulation, ModifierPosition, StaveNote } = await import("vexflow");
  const codes = ["a.", "a-", "a>", "a^"];
  for (const code of codes) {
    const note = new StaveNote({ keys: ["c/4"], duration: "q" });
    const ticksBefore = note.getTicks().value();
    note.addModifier(new Articulation(code).setPosition(ModifierPosition.ABOVE), 0);
    assert.equal(note.getTicks().value(), ticksBefore, `${code} must be a zero-duration engraving modifier`);
  }
});

test("MusicXML merges articulation and tie data in one notations element", () => {
  const score = createScore("solo", { seedDemo: false });
  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  const first = makeEvent({ id: "art-tie-first", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const second = makeEvent({ id: "art-tie-second", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  if (first.kind !== "note") assert.fail("Expected a note event.");
  first.articulation = "accent";
  first.notes.push({ id: "art-tie-chord-tone", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  voice.events.push(first, second);
  const tied = toggleTieLastTwo(score, score.parts[0].id);
  assert.equal(tied.error, undefined);
  const xml = scoreToMusicXML(tied.score);
  assert.match(xml, /<notations><tied type="start"\/><articulations><accent\/><\/articulations><\/notations>/);
  assert.equal((xml.match(/<articulations>/g) ?? []).length, 1, "one event-level articulation is emitted only on the leading chord note");
  assert.doesNotMatch(xml, /<\/notations>\s*<notations>/, "a note never receives sibling notations containers");
});

test("tie-chain playback and MIDI intentionally use only the root articulation and velocity", () => {
  const tiedQuarterChain = (staccatoIndex: number | null = null) => {
    const score = createScore("solo", { seedDemo: false });
    score.tempo = 60;
    const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
    const noteEvent = (index: number) => {
      const event = makeEvent({
        id: `rooted-tie-event-${index}`,
        pitch: { step: "C", alter: 0, octave: 4 },
        duration: { base: 4, dots: 0 },
        rest: false,
      });
      if (event.kind !== "note") throw new Error("Expected a tied note event.");
      return event;
    };
    const events = [noteEvent(1), noteEvent(2), noteEvent(3)];
    if (staccatoIndex !== null) events[staccatoIndex].articulation = "staccato";
    voice.events.push(...events);
    score.ties.push(
      { id: "rooted-tie-1-2", fromNoteId: events[0].notes[0].id, toNoteId: events[1].notes[0].id },
      { id: "rooted-tie-2-3", fromNoteId: events[1].notes[0].id, toNoteId: events[2].notes[0].id },
    );
    assert.deepEqual(validateScore(score), []);
    return { score, events };
  };
  const countBytes = (bytes: readonly number[], needle: readonly number[]): number =>
    bytes.reduce((count, _byte, index) => count + (needle.every((value, offset) => bytes[index + offset] === value) ? 1 : 0), 0);
  const assertMidiGate = (score: ScoreDocument, deltaTicks: number) => {
    const midi = [...scoreToMidi(score)];
    const noteOff = [...encodeMidiVariableLength(deltaTicks), 0x80, 60, 0];
    assert.equal(countBytes(midi, noteOff), 1, `the merged C4 note-off must occur after ${deltaTicks} MIDI ticks`);
  };

  const normal = tiedQuarterChain();
  const rootStaccato = tiedQuarterChain(0);
  const middleStaccato = tiedQuarterChain(1);
  const lastStaccato = tiedQuarterChain(2);
  const normalPlayback = collectPlaybackNotes(normal.score);
  const rootPlayback = collectPlaybackNotes(rootStaccato.score);
  const middlePlayback = collectPlaybackNotes(middleStaccato.score);
  const lastPlayback = collectPlaybackNotes(lastStaccato.score);
  assert.equal(normalPlayback.length, 1, "three tied notes become one performed attack");
  assert.equal(normalPlayback[0].durationSeconds, 2.7);
  assert.equal(normalPlayback[0].notatedDurationSeconds, 3, "a tied chain keeps its complete notated transport span");
  assert.equal(rootPlayback[0].durationSeconds, 1.35, "root staccato halves the merged chain before the common 90% live gate");
  assert.equal(rootPlayback[0].notatedDurationSeconds, normalPlayback[0].notatedDurationSeconds, "root staccato cannot shorten the playhead timeline");
  assert.equal(middlePlayback[0].durationSeconds, normalPlayback[0].durationSeconds, "middle-destination staccato is visual/XML metadata only");
  assert.equal(lastPlayback[0].durationSeconds, normalPlayback[0].durationSeconds, "terminal-destination staccato is visual/XML metadata only");

  assertMidiGate(normal.score, 1_440);
  assertMidiGate(rootStaccato.score, 720);
  assertMidiGate(middleStaccato.score, 1_440);
  assertMidiGate(lastStaccato.score, 1_440);

  [rootStaccato, middleStaccato, lastStaccato].forEach(({ score, events }, markedIndex) => {
    const xml = scoreToMusicXML(score);
    const pitchedNotes = [...xml.matchAll(/<note>([\s\S]*?)<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"))
      .slice(0, 3);
    assert.equal(pitchedNotes.length, 3);
    pitchedNotes.forEach((note, noteIndex) => {
      assert.equal(note.includes("<staccato/>"), noteIndex === markedIndex, "MusicXML preserves the destination mark at its source note");
    });
    events.forEach((event, eventIndex) => {
      assert.equal(event.articulation, eventIndex === markedIndex ? "staccato" : undefined, "performance/export must not mutate SVG-facing score data");
    });
  });

  const rootedPriority = tiedQuarterChain();
  rootedPriority.events[0].dynamic = "p";
  rootedPriority.events[0].articulation = "accent";
  rootedPriority.events[1].dynamic = "fff";
  rootedPriority.events[1].articulation = "staccato";
  rootedPriority.events[2].articulation = "marcato";
  const priorityPlayback = collectPlaybackNotes(rootedPriority.score);
  const expectedRootVelocity = DYNAMIC_VELOCITIES.p + ARTICULATION_VELOCITY_BONUSES.accent;
  assert.equal(priorityPlayback.length, 1);
  assert.equal(priorityPlayback[0].velocity, expectedRootVelocity, "a later tied destination cannot replace the one real attack velocity");
  assert.equal(priorityPlayback[0].durationSeconds, normalPlayback[0].durationSeconds, "a later tied staccato cannot replace the root accent gate policy");
  const priorityMidi = [...scoreToMidi(rootedPriority.score)];
  assert.equal(countBytes(priorityMidi, [0x90, 60, expectedRootVelocity]), 1);
  assertMidiGate(rootedPriority.score, 1_440);
  const priorityXml = scoreToMusicXML(rootedPriority.score);
  assert.equal((priorityXml.match(/<accent\/>/g) ?? []).length, 1);
  assert.equal((priorityXml.match(/<staccato\/>/g) ?? []).length, 1);
  assert.equal((priorityXml.match(/<strong-accent type="up"\/>/g) ?? []).length, 1);
});

test("dynamic marks propagate independently per staff through playback, MIDI velocity, and MusicXML directions", () => {
  assert.deepEqual(DYNAMIC_MARKINGS, ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"]);
  assert.equal(DEFAULT_MIDI_VELOCITY, DYNAMIC_VELOCITIES.mf);
  const score = createScore("solo", { seedDemo: false });
  const part = score.parts[0];
  const firstMeasureId = score.measureOrder[0];
  const secondMeasureId = score.measureOrder[1];
  const upper = getPrimaryVoice(part, firstMeasureId, 0);
  const lower = getPrimaryVoice(part, firstMeasureId, 1);
  const upperEvents = [
    makeEvent({ id: "dynamic-p-c", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }),
    makeEvent({ id: "dynamic-p-d", pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }),
    makeEvent({ id: "dynamic-ff-rest", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: true }),
    makeEvent({ id: "dynamic-ff-e", pitch: { step: "E", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }),
  ];
  upperEvents[0].dynamic = "p";
  upperEvents[2].dynamic = "ff";
  upper.events.push(...upperEvents);
  const acrossMeasure = makeEvent({ id: "dynamic-ff-g", pitch: { step: "G", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(part, secondMeasureId, 0).events.push(acrossMeasure);

  const lowerEvents = [
    makeEvent({ id: "dynamic-ppp-c3", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false }),
    makeEvent({ id: "dynamic-ppp-d3", pitch: { step: "D", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false }),
  ];
  lowerEvents[0].dynamic = "ppp";
  lower.events.push(...lowerEvents);

  assert.equal(validateScore(score).length, 0);
  const playback = collectPlaybackNotes(score);
  const velocityByMidi = new Map(playback.map((note) => [note.midi, note.velocity]));
  assert.equal(velocityByMidi.get(60), DYNAMIC_VELOCITIES.p);
  assert.equal(velocityByMidi.get(62), DYNAMIC_VELOCITIES.p, "p persists to the next upper-staff event");
  assert.equal(velocityByMidi.get(64), DYNAMIC_VELOCITIES.ff, "a dynamic on a rest affects the next note");
  assert.equal(velocityByMidi.get(67), DYNAMIC_VELOCITIES.ff, "ff persists across a barline on the same staff");
  assert.equal(velocityByMidi.get(48), DYNAMIC_VELOCITIES.ppp);
  assert.equal(velocityByMidi.get(50), DYNAMIC_VELOCITIES.ppp, "the lower staff keeps its independent dynamic state");

  const musicXml = scoreToMusicXML(score);
  assert.equal((musicXml.match(/<direction placement="below">/g) ?? []).length, 3);
  assert.match(musicXml, /<direction placement="below"><direction-type><dynamics><p\/><\/dynamics><\/direction-type><voice>1<\/voice><staff>1<\/staff><sound dynamics="62\.22"\/><\/direction>[\s\S]*?<note><pitch><step>C<\/step>/);
  assert.match(musicXml, /<direction placement="below"><direction-type><dynamics><ff\/><\/dynamics><\/direction-type><voice>1<\/voice><staff>1<\/staff><sound dynamics="124\.44"\/><\/direction>\s*<note><rest\/>/);
  assert.match(musicXml, /<direction placement="below"><direction-type><dynamics><ppp\/><\/dynamics><\/direction-type><voice>2<\/voice><staff>2<\/staff><sound dynamics="35\.56"\/><\/direction>/);

  const midi = [...scoreToMidi(score)];
  const hasBytes = (needle: number[]) => midi.some((_, index) => needle.every((byte, offset) => midi[index + offset] === byte));
  assert.ok(hasBytes([0x90, 60, DYNAMIC_VELOCITIES.p]));
  assert.ok(hasBytes([0x90, 62, DYNAMIC_VELOCITIES.p]));
  assert.ok(hasBytes([0x90, 64, DYNAMIC_VELOCITIES.ff]));
  assert.ok(hasBytes([0x90, 67, DYNAMIC_VELOCITIES.ff]));
  assert.ok(hasBytes([0x90, 48, DYNAMIC_VELOCITIES.ppp]));
  assert.ok(hasBytes([0x90, 50, DYNAMIC_VELOCITIES.ppp]));
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

test("MIDI track names use variable-length byte counts for ASCII boundaries and Unicode", () => {
  const encodedLengthAfterTrackNameMeta = (name: string): number[] => {
    const score = createScore("solo", { seedDemo: false });
    score.parts[0].name = name;
    const midi = scoreToMidi(score);
    const index = [...midi].findIndex((byte, offset) => byte === 0xff && midi[offset + 1] === 0x03);
    assert.ok(index >= 0, "expected a track-name meta event");
    const bytes: number[] = [];
    let cursor = index + 2;
    do {
      bytes.push(midi[cursor]);
    } while ((midi[cursor++] & 0x80) !== 0);
    return bytes;
  };

  assert.deepEqual(encodedLengthAfterTrackNameMeta("A".repeat(127)), [0x7f]);
  assert.deepEqual(encodedLengthAfterTrackNameMeta("A".repeat(128)), [0x81, 0x00]);
  assert.deepEqual(encodedLengthAfterTrackNameMeta("가".repeat(50)), [0x81, 0x16]);
});

test("MIDI variable-length encoding is total at every legal SMF boundary and rejects overflow", () => {
  assert.deepEqual(encodeMidiVariableLength(0), [0x00]);
  assert.deepEqual(encodeMidiVariableLength(0x7f), [0x7f]);
  assert.deepEqual(encodeMidiVariableLength(0x80), [0x81, 0x00]);
  assert.deepEqual(encodeMidiVariableLength(0x0fffffff), [0xff, 0xff, 0xff, 0x7f]);
  for (const invalid of [-1, 1.5, 0x10000000, Number.MAX_SAFE_INTEGER, Number.NaN]) {
    assert.throws(() => encodeMidiVariableLength(invalid), RangeError);
  }
});

test("MIDI merges overlapping ownership of one channel pitch without clipping the longer note", () => {
  const score = createScore("solo", { seedDemo: false });
  const [upperStaff, lowerStaff] = score.parts[0].staves;
  const measureId = score.measureOrder[0];
  upperStaff.measures[measureId].voices[0].events = [makeEvent({
    id: "overlap-upper-quarter",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  })];
  lowerStaff.measures[measureId].voices[0].events = [makeEvent({
    id: "overlap-lower-half",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 2, dots: 0 },
    rest: false,
  })];

  assert.equal(collectPlaybackNotes(score).length, 2, "WebAudio retains the two semantic staff notes");
  const midi = [...scoreToMidi(score)];
  const countSequence = (needle: number[]) => midi.reduce(
    (count, _, index) => count + Number(needle.every((byte, offset) => midi[index + offset] === byte)),
    0,
  );
  assert.equal(countSequence([0x90, 60, DEFAULT_MIDI_VELOCITY]), 1);
  assert.equal(countSequence([0x80, 60, 0]), 1);
  assert.equal(countSequence([0x87, 0x40, 0x80, 60, 0]), 1, "the single note-off remains at the half-note boundary");
});

test("MIDI overlap normalization never leaks a later dynamic backward in time", () => {
  const score = createScore("solo", { seedDemo: false });
  const [upperStaff, lowerStaff] = score.parts[0].staves;
  const measureId = score.measureOrder[0];
  const sustained = makeEvent({
    id: "quiet-sustained-c",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 1, dots: 0 },
    rest: false,
  });
  const leadingRest = makeEvent({
    id: "late-loud-leading-rest",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 2, dots: 0 },
    rest: true,
  });
  const lateLoud = makeEvent({
    id: "late-loud-c",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 2, dots: 0 },
    rest: false,
  });
  sustained.dynamic = "p";
  lateLoud.dynamic = "ff";
  upperStaff.measures[measureId].voices[0].events = [sustained];
  lowerStaff.measures[measureId].voices[0].events = [leadingRest, lateLoud];

  const playback = collectPlaybackNotes(score).sort((first, second) => first.startSeconds - second.startSeconds);
  assert.deepEqual(playback.map((note) => note.velocity), [DYNAMIC_VELOCITIES.p, DYNAMIC_VELOCITIES.ff]);
  const midi = [...scoreToMidi(score)];
  const noteOns = midi.filter((byte, index) => byte === 0x90 && midi[index + 1] === 60).map((_, index) => index);
  assert.equal(noteOns.length, 1, "the SMF compromise drops the overlapping reattack to preserve note-off ownership");
  assert.ok(midi.some((byte, index) => byte === 0x90 && midi[index + 1] === 60 && midi[index + 2] === DYNAMIC_VELOCITIES.p));
  assert.ok(!midi.some((byte, index) => byte === 0x90 && midi[index + 1] === 60 && midi[index + 2] === DYNAMIC_VELOCITIES.ff));
});

test("MIDI quantizes adjacent double-dotted 64th boundaries without overlap", () => {
  const score = createScore("solo", { seedDemo: false });
  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  voice.events = [0, 1, 2].map((index) => makeEvent({
    id: `quantized-dd64-${index}`,
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 64, dots: 2 },
    rest: false,
  }));

  const midi = [...scoreToMidi(score)];
  const contains = (needle: number[]) => midi.some((_, index) => needle.every((byte, offset) => midi[index + offset] === byte));
  assert.equal(midi.filter((byte, index) => byte === 0x90 && midi[index + 1] === 60).length, 3);
  assert.equal(midi.filter((byte, index) => byte === 0x80 && midi[index + 1] === 60).length, 3);
  assert.ok(contains([0x35, 0x80, 60, 0, 0x00, 0x90, 60, DEFAULT_MIDI_VELOCITY]), "tick 53 is one shared off/on boundary");
  assert.ok(contains([0x34, 0x80, 60, 0, 0x00, 0x90, 60, DEFAULT_MIDI_VELOCITY]), "tick 105 is one shared off/on boundary");
});

test("live playback articulates consecutive 64th notes at normal and fast tempos", () => {
  for (const tempo of [96, 300]) {
    const score = createScore("solo", { seedDemo: false });
    score.tempo = tempo;
    const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
    voice.events = [0, 1].map((index) => makeEvent({
      id: `live-64-${tempo}-${index}`,
      pitch: { step: index ? "D" : "C", alter: 0, octave: 4 },
      duration: { base: 64, dots: 0 },
      rest: false,
    }));
    const notes = collectPlaybackNotes(score).sort((first, second) => first.startSeconds - second.startSeconds);
    assert.equal(notes.length, 2);
    assert.ok(notes[0].durationSeconds < notes[1].startSeconds - notes[0].startSeconds, `${tempo} BPM gates before the next onset`);
    assert.ok(notes[0].durationSeconds >= .005);
  }
});

test("part-scoped live playback traverses only the visible part while preserving global mute and solo rules", () => {
  const score = createScore("chamber", { seedDemo: false });
  const measureId = score.measureOrder[0];
  const [visiblePart, hiddenPart] = score.parts;
  getPrimaryVoice(visiblePart, measureId).events = [makeEvent({
    id: "visible-part-note",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  })];
  getPrimaryVoice(hiddenPart, measureId).events = [makeEvent({
    id: "hidden-part-note",
    pitch: { step: "G", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  })];

  const visibleOnly = collectPlaybackNotes(score, [visiblePart.id]);
  assert.equal(visibleOnly.length, 1);
  assert.equal(visibleOnly[0].partId, visiblePart.id);
  assert.ok(!visibleOnly.some((note) => note.partId === hiddenPart.id));

  hiddenPart.solo = true;
  assert.deepEqual(collectPlaybackNotes(score, [visiblePart.id]), [], "a hidden solo flag must retain the score's global audition semantics");
});

test("bounded live playback is chronological and fair across simultaneous parts", () => {
  const input = ["part-a", "part-b"].flatMap((partId) => Array.from({ length: 350 }, (_, onset) => ({
    partId,
    midi: partId === "part-a" ? 60 : 67,
    velocity: DEFAULT_MIDI_VELOCITY,
    startSeconds: onset,
    durationSeconds: .5,
    notatedDurationSeconds: .5,
  })));
  const selection = selectPlaybackWindow(input, 600);
  assert.equal(selection.total, 700);
  assert.equal(selection.truncated, true);
  assert.equal(selection.notes.length, 600);
  assert.equal(selection.notes.filter((note) => note.partId === "part-a").length, 300);
  assert.equal(selection.notes.filter((note) => note.partId === "part-b").length, 300);
  assert.equal(Math.max(...selection.notes.map((note) => note.startSeconds)), 299);
  assert.ok(selection.notes.every((note, index) => !index || note.startSeconds >= selection.notes[index - 1].startSeconds));
});

test("instrument catalog is broad, internally valid, and exactly addressable", () => {
  const ids = new Set(INSTRUMENTS.map((instrument) => instrument.catalogId));
  assert.equal(ids.size, INSTRUMENTS.length);
  assert.ok(INSTRUMENTS.length >= 85, `expected at least 85 presets, received ${INSTRUMENTS.length}`);

  for (const instrument of INSTRUMENTS) {
    assert.match(instrument.catalogId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(instrument.name.trim());
    assert.ok(instrument.shortName.trim());
    assert.ok(FAMILIES.includes(instrument.family));
    assert.equal(instrument.color, FAMILY_COLORS[instrument.family]);
    assert.ok(Number.isInteger(instrument.midiProgram) && instrument.midiProgram >= 0 && instrument.midiProgram <= 127, instrument.catalogId);
    assert.ok(Object.values(instrument.transposition).every(Number.isInteger), instrument.catalogId);
    assert.equal(getInstrument(instrument.catalogId), instrument);
  }

  assert.equal(getInstrument("not-a-real-instrument").catalogId, "flute");
  assert.deepEqual(SCORE_TEMPLATES.map((template) => template.id), ["solo", "quartet", "chamber", "orchestra"]);
  assert.ok(SCORE_TEMPLATES.every((template) => template.instruments.every((catalogId) => ids.has(catalogId))));

  const minimumFamilySizes: Record<string, number> = {
    Woodwinds: 25,
    Brass: 25,
    Percussion: 20,
    Keyboards: 8,
    Voices: 10,
    Strings: 10,
  };
  for (const [family, minimum] of Object.entries(minimumFamilySizes)) {
    const count = INSTRUMENTS.filter((instrument) => instrument.family === family).length;
    assert.ok(count >= minimum, `${family}: expected at least ${minimum}, received ${count}`);
  }

  const requiredPresets = [
    "bass-flute", "contrabass-flute", "oboe-damore", "bass-oboe",
    "clarinet-d", "clarinet-c", "basset-clarinet-a", "basset-horn-f", "alto-clarinet-eb", "contralto-clarinet-eb", "contrabass-clarinet-bb",
    "sopranino-sax", "bass-sax", "contrabass-sax",
    "piccolo-trumpet-bb", "piccolo-trumpet-a", "bass-trumpet-c", "bass-trumpet-bb", "flugelhorn-bb",
    "baritone-horn-bass-clef", "baritone-horn-treble-bb", "euphonium-treble-bb", "tenor-trombone-treble-bb", "contrabass-trombone",
    "tuba-c", "tuba-bb", "tuba-f", "tuba-eb", "tuba-bb-treble", "tuba-eb-treble",
    "acoustic-guitar-steel", "electric-guitar-clean", "electric-bass", "mandolin", "ukulele", "harp",
    "electric-piano-1", "electric-piano-2", "clavinet", "accordion", "harmonium", "bandoneon",
    "crotales", "bell-lyre", "steel-drums", "triangle", "tambourine", "castanets", "woodblock", "temple-blocks", "claves",
    "maracas", "guiro", "bongos", "congas", "timbales", "tom-toms", "taiko-drum", "tam-tam", "suspended-cymbal", "drum-set",
    "mezzo-soprano", "contralto", "countertenor", "bass-baritone", "boy-soprano", "children-choir", "womens-choir", "mens-choir", "satb-choir-single-staff",
  ];
  assert.deepEqual(requiredPresets.filter((catalogId) => !ids.has(catalogId)), []);
});

function engravingNote(
  id: string,
  step: Pitch["step"],
  alter: Pitch["alter"],
  octave = 4,
  accidentalDisplay: "auto" | "force" | "hide" = "auto",
): MusicEvent {
  return {
    id: `${id}-event`,
    kind: "note",
    duration: { base: 4, dots: 0 },
    notes: [{ id, pitch: { step, alter, octave }, accidentalDisplay }],
  };
}

test("G major accidental state suppresses implied and repeated accidentals", () => {
  const events = [
    engravingNote("f-sharp-implied", "F", 1),
    engravingNote("f-sharp-repeat", "F", 1),
    engravingNote("f-natural", "F", 0),
    engravingNote("f-natural-repeat", "F", 0),
    engravingNote("f-sharp-return", "F", 1),
  ];

  assert.deepEqual(
    [...resolveMeasureAccidentals(events, { fifths: 1, mode: "major" })],
    [
      ["f-natural", "n"],
      ["f-sharp-return", "#"],
    ],
  );
});

test("accidental state is independent by written octave", () => {
  const events = [
    engravingNote("f4-natural", "F", 0, 4),
    engravingNote("f5-sharp-implied", "F", 1, 5),
    engravingNote("f5-natural", "F", 0, 5),
    engravingNote("f4-natural-repeat", "F", 0, 4),
  ];

  assert.deepEqual(
    [...resolveMeasureAccidentals(events, { fifths: 1, mode: "major" })],
    [
      ["f4-natural", "n"],
      ["f5-natural", "n"],
    ],
  );
});

test("accidental state resets at each measure boundary", () => {
  const firstMeasure = resolveMeasureAccidentals(
    [engravingNote("measure-1-f-natural", "F", 0)],
    { fifths: 1, mode: "major" },
  );
  const secondMeasure = resolveMeasureAccidentals(
    [engravingNote("measure-2-f-natural", "F", 0)],
    { fifths: 1, mode: "major" },
  );

  assert.deepEqual([...firstMeasure], [["measure-1-f-natural", "n"]]);
  assert.deepEqual([...secondMeasure], [["measure-2-f-natural", "n"]]);
});

test("force prints an accidental and hide suppresses it while preserving note state", () => {
  assert.deepEqual(
    [...resolveMeasureAccidentals(
      [engravingNote("forced-f-sharp", "F", 1, 4, "force")],
      { fifths: 1, mode: "major" },
    )],
    [["forced-f-sharp", "#"]],
  );

  assert.deepEqual(
    [...resolveMeasureAccidentals(
      [
        engravingNote("hidden-f-natural", "F", 0, 4, "hide"),
        engravingNote("after-hidden-f-sharp", "F", 1),
      ],
      { fifths: 1, mode: "major" },
    )],
    [["after-hidden-f-sharp", "#"]],
  );
});

test("automatic tied destinations do not establish accidental state for later re-attacks", () => {
  const cMajor = { fifths: 0, mode: "major" as const };

  assert.deepEqual(
    [...resolveMeasureAccidentals(
      [
        engravingNote("auto-tie-destination", "F", 1),
        engravingNote("attack-after-auto-tie", "F", 1),
      ],
      cMajor,
      new Set(["auto-tie-destination"]),
    )],
    [["attack-after-auto-tie", "#"]],
  );

  assert.deepEqual(
    [...resolveMeasureAccidentals(
      [
        engravingNote("forced-tie-destination", "F", 1, 4, "force"),
        engravingNote("attack-after-forced-tie", "F", 1),
      ],
      cMajor,
      new Set(["forced-tie-destination"]),
    )],
    [["forced-tie-destination", "#"]],
  );

  assert.deepEqual(
    [...resolveMeasureAccidentals(
      [
        engravingNote("hidden-tie-destination", "F", 1, 4, "hide"),
        engravingNote("attack-after-hidden-tie", "F", 1),
      ],
      cMajor,
      new Set(["hidden-tie-destination"]),
    )],
    [["attack-after-hidden-tie", "#"]],
  );
});

test("signature comparison helpers follow printed engraving semantics", () => {
  assert.equal(timeSignaturesEqual({ numerator: 4, denominator: 4 }, { numerator: 4, denominator: 4 }), true);
  assert.equal(timeSignaturesEqual({ numerator: 4, denominator: 4 }, { numerator: 2, denominator: 2 }), false);
  assert.equal(timeSignaturesEqual({ numerator: 3, denominator: 4 }, { numerator: 4, denominator: 4 }), false);

  assert.equal(keySignaturesEqual({ fifths: 0, mode: "major" }, { fifths: 0, mode: "minor" }), true);
  assert.equal(keySignaturesEqual({ fifths: 1, mode: "major" }, { fifths: 1, mode: "minor" }), true);
  assert.equal(keySignaturesEqual({ fifths: 0, mode: "major" }, { fifths: 1, mode: "major" }), false);
});

test("horizontal moves consume rests, leave source rests, and keep unrelated notes at their original beats", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2] = source.measureOrder;
  const make = (id: string, step: Pitch["step"], rest = false) => makeEvent({ id, pitch: { step, alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest });
  const rest = make("move-existing-rest", "C", true);
  const moving = make("move-single", "C");
  const stationary = make("move-stationary", "E");
  getPrimaryVoice(part, m1).events.push(rest, moving, stationary);
  const nextBar = make("move-next-bar", "G");
  getPrimaryVoice(part, m2).events.push(nextBar);
  const snapshot = structuredClone(source);
  const moved = moveEventToPosition(source, part.id, 0, m1, moving.id, m1, 3 * TICKS_PER_QUARTER);
  assert.equal(moved.error, undefined);
  assert.equal(moved.changed, true);
  assert.equal(moved.movedEventCount, 1);
  assert.deepEqual(moved.selection, { measureId: m1, eventId: moving.id });
  assert.deepEqual(source, snapshot);
  const events = getPrimaryVoice(moved.score.parts[0], m1).events;
  assert.deepEqual(events.map((event) => event.kind), ["rest", "rest", "note", "note"]);
  assert.deepEqual(events[0], rest, "an unconsumed rest keeps its identity and notation");
  assert.deepEqual(events[2], stationary);
  assert.deepEqual(events[3], moving);
  assert.deepEqual(getPrimaryVoice(moved.score.parts[0], m2), getPrimaryVoice(part, m2));
  assert.equal(collectPlaybackNotes(moved.score).find((note) => note.midi === 64)!.startSeconds, 2 * 60 / source.tempo);
  const back = moveEventToPosition(moved.score, part.id, 0, m1, moving.id, m1, 0);
  assert.equal(back.error, undefined);
  assert.deepEqual(getPrimaryVoice(back.score.parts[0], m1).events[0], moving);
  assert.equal(collectPlaybackNotes(back.score).find((note) => note.midi === 64)!.startSeconds, 2 * 60 / source.tempo);
  const unchanged = moveEventToPosition(back.score, part.id, 0, m1, moving.id, m1, 0);
  assert.equal(unchanged.score, back.score);
  assert.equal(unchanged.changed, false);
  assert.deepEqual(validateScore(back.score), []);
});

test("horizontal chord moves transitively carry every linked event, split across bars, and round-trip the same tied sound", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2] = source.measureOrder;
  getPrimaryVoice(part, m1).events.push(makeEvent({ id: "move-chain-prefix", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: true }));
  const pairs: [Pitch["step"], Pitch["step"]][] = [["C", "E"], ["C", "G"], ["G", "B"]];
  const chords = pairs.map(([step, other], index) => {
    const event = makeEvent({ id: `move-chain-${index}`, pitch: { step, alter: 0, octave: 4 }, duration: index ? { base: 4, dots: 0 } : { base: 2, dots: 1 }, rest: false });
    if (event.kind !== "note") assert.fail("Expected a chord fixture.");
    event.notes.push({ id: `move-chain-tone-${index}`, pitch: { step: other, alter: 0, octave: 4 }, accidentalDisplay: "force" });
    event.dynamic = "p";
    event.articulation = "tenuto";
    getPrimaryVoice(part, index ? m2 : m1).events.push(event);
    return event;
  });
  source.ties.push(
    { id: "move-existing-tie-c", fromNoteId: chords[0].notes[0].id, toNoteId: chords[1].notes[0].id },
    { id: "move-existing-tie-g", fromNoteId: chords[1].notes[1].id, toNoteId: chords[2].notes[0].id },
  );
  getPrimaryVoice(part, m2, 1).events.push(makeEvent({ id: "move-other-staff", pitch: { step: "A", alter: 0, octave: 2 }, duration: { base: 2, dots: 0 }, rest: false }));
  assert.deepEqual(getEventMoveGroup(source, part.id, 0, m2, chords[1].id), {
    eventIds: chords.map((chord) => chord.id), startTick: 960, endTick: 5760, selectedStartTick: 3840,
  });
  const snapshot = structuredClone(source);
  const moved = moveEventToPosition(source, part.id, 0, m2, chords[1].id, m2, TICKS_PER_QUARTER / 2);
  assert.equal(moved.error, undefined);
  assert.equal(moved.movedEventCount, 3);
  assert.deepEqual(moved.selection, { measureId: m2, eventId: chords[1].id });
  assert.deepEqual(source, snapshot);
  assert.deepEqual(moved.score.parts[0].staves[1], part.staves[1]);
  const all = moved.score.measureOrder.flatMap((id) => getPrimaryVoice(moved.score.parts[0], id).events);
  for (const chord of chords) {
    const first = all.find((event) => event.id === chord.id)!;
    assert.equal(first.kind, "note");
    assert.equal(first.dynamic, "p");
    if (first.kind === "note") {
      assert.equal(first.articulation, "tenuto");
      assert.deepEqual(first.notes, chord.notes);
    }
  }
  const continuation = all.filter((event) => event.kind === "note" && !chords.some((chord) => chord.id === event.id));
  assert.equal(continuation.length, 2);
  assert.ok(continuation.every((event) => event.dynamic === undefined && event.kind === "note" && event.articulation === undefined));
  assert.equal(moved.score.ties.length, 6);
  for (const tie of source.ties) {
    const preserved: ScoreDocument["ties"][number] = moved.score.ties.find((candidate) => candidate.id === tie.id)!;
    assert.equal(preserved.toNoteId, tie.toNoteId);
  }
  const project = (score: ScoreDocument) => collectPlaybackNotes(score)
    .map(({ midi, startSeconds, notatedDurationSeconds }) => ({ midi, startSeconds, notatedDurationSeconds }))
    .sort((left, right) => left.midi - right.midi || left.startSeconds - right.startSeconds);
  const expected = project(source).map((note) => ({ ...note, startSeconds: note.startSeconds + (note.midi === 45 ? 0 : 0.5 * 60 / source.tempo) }));
  assert.deepEqual(project(moved.score), expected);
  assert.deepEqual(validateScore(moved.score), []);
  assert.deepEqual(project(JSON.parse(serializeNativeScore(moved.score))), expected);
  const reopened = importMusicXML(scoreToMusicXML(moved.score));
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(project(reopened.score), expected);
  const overlap = moveEventToPosition(moved.score, part.id, 0, m2, chords[1].id, m2, 0);
  assert.equal(overlap.error, undefined, "moving a group partly over its own source must be allowed");
  assert.deepEqual(project(overlap.score), project(source));
});

test("horizontal moves reject collisions, negative linked starts, and unrepresentable beats atomically", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2] = source.measureOrder;
  const notes = ["C", "C", "E"].map((step, index) => makeEvent({ id: `move-atomic-${index}`, pitch: { step: step as Pitch["step"], alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false }));
  getPrimaryVoice(part, m1).events.push(...notes);
  if (notes[0].kind !== "note" || notes[1].kind !== "note") assert.fail("Expected tied notes.");
  source.ties.push({ id: "move-atomic-tie", fromNoteId: notes[0].notes[0].id, toNoteId: notes[1].notes[0].id });
  const snapshot = structuredClone(source);
  const collision = moveEventToPosition(source, part.id, 0, m1, notes[0].id, m1, TICKS_PER_QUARTER);
  assert.match(collision.error ?? "", /overlaps another note/);
  const negative = moveEventToPosition(source, part.id, 0, m1, notes[1].id, m1, 0);
  assert.match(negative.error ?? "", /before the score/);
  const exact = moveEventToPosition(source, part.id, 0, m1, notes[0].id, m2, 15);
  assert.match(exact.error ?? "", /supported note values/);
  const invalid = [
    moveEventToPosition(source, part.id, 0, m1, notes[0].id, m2, -1),
    moveEventToPosition(source, part.id, 0, m1, notes[0].id, m2, NaN),
    moveEventToPosition(source, part.id, 0, m1, notes[0].id, m2, measureCapacity(source.measures[m2])),
    moveEventToPosition(source, part.id, 0, m1, notes[0].id, "missing", 0),
    moveEventToPosition(source, part.id, 0, m2, notes[0].id, m1, 0),
  ];
  for (const result of [collision, negative, exact, ...invalid]) {
    assert.ok(result.error);
    assert.equal(result.score, source);
    assert.equal(result.changed, false);
  }
  assert.deepEqual(source, snapshot);
});

test("horizontal moves honor destination meter, extend the score only as needed, and preserve other music", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staff = part.staves[0];
  const [m1, m2, , m4] = source.measureOrder;
  source.measures[m4].time = { numerator: 3, denominator: 8 };
  const moving = makeEvent({ id: "move-upper-voice", pitch: { step: "F", alter: 1, octave: 5 }, duration: { base: 2, dots: 1 }, rest: false });
  getPrimaryVoice(part, m1).events.push(moving);
  getPrimaryVoice(part, m2).events.push(makeEvent({ id: "move-primary-voice", pitch: { step: "D", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false }));
  getPrimaryVoice(part, m4, 1).events.push(makeEvent({ id: "move-lower-voice", pitch: { step: "A", alter: 0, octave: 2 }, duration: { base: 4, dots: 0 }, rest: false }));
  const moved = moveEventToPosition(source, part.id, staff.id, m1, moving.id, m4, TICKS_PER_QUARTER);
  assert.equal(moved.error, undefined);
  assert.equal(moved.score.measureOrder.length, source.measureOrder.length + 2);
  assert.deepEqual(moved.score.parts[0].staves[0].measures[m2].voices[0], staff.measures[m2].voices[0]);
  for (const id of source.measureOrder) assert.deepEqual(moved.score.parts[0].staves[1].measures[id], part.staves[1].measures[id]);
  assert.deepEqual(moved.score.measures[moved.score.measureOrder.at(-1)!].time, { numerator: 3, denominator: 8 });
  assert.equal(moved.score.ties.length, 2);
  assert.equal(collectPlaybackNotes(moved.score).find((note) => note.midi === 78)!.notatedDurationSeconds, 3 * 60 / source.tempo);
  assert.deepEqual(validateScore(moved.score), []);
});


test("horizontal moves preserve dynamic markings on destination rests instead of silently replacing them", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2] = source.measureOrder;
  const moving = makeEvent({ id: "move-near-marked-rest", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const markedRest = makeEvent({ id: "move-marked-rest", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: true });
  markedRest.dynamic = "ff";
  getPrimaryVoice(part, m1).events.push(moving);
  getPrimaryVoice(part, m2).events.push(markedRest);
  const snapshot = structuredClone(source);
  const replacesMarking = moveEventToPosition(source, part.id, 0, m1, moving.id, m2, 0);
  assert.match(replacesMarking.error ?? "", /rest with a dynamic marking/);
  assert.equal(replacesMarking.score, source);
  assert.equal(replacesMarking.changed, false);
  assert.deepEqual(source, snapshot);
  const afterMarking = moveEventToPosition(source, part.id, 0, m1, moving.id, m2, TICKS_PER_QUARTER);
  assert.equal(afterMarking.error, undefined, "the portion after a rest's marking remains usable");
  const destination = getPrimaryVoice(afterMarking.score.parts[0], m2).events;
  assert.equal(destination[0].id, markedRest.id);
  assert.equal(destination[0].dynamic, "ff");
  assert.deepEqual(destination[0].duration, { base: 4, dots: 0 });
  assert.deepEqual(destination[1], moving);
  assert.equal(destination[2].dynamic, undefined, "a residual rest must not duplicate the marking");
  assert.deepEqual(validateScore(afterMarking.score), []);
});


function rangeFixture() {
  const score = createScore("solo", { seedDemo: false });
  const part = score.parts[0];
  const [m1, m2, m3, m4] = score.measureOrder;
  const note = (id: string, step: Pitch["step"], rest = false) => makeEvent({ id, pitch: { step, alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest });
  const chords = [["C", "E"], ["C", "G"], ["G", "B"]].map(([first, second], index) => {
    const event = note(`range-chord-${index}`, first as Pitch["step"]);
    if (event.kind !== "note") assert.fail("Expected chord fixture.");
    event.notes.push({ id: `range-tone-${index}`, pitch: { step: second as Pitch["step"], alter: 0, octave: 4 }, accidentalDisplay: "force" });
    return event;
  });
  const rest = note("range-rest", "C", true);
  rest.dynamic = "p";
  const tail = note("range-tail", "D");
  const stationary = note("range-stationary", "F");
  getPrimaryVoice(part, m1).events.push(...chords, rest);
  getPrimaryVoice(part, m2).events.push(tail, stationary);
  score.ties.push(
    { id: "range-tie-c", fromNoteId: chords[0].notes[0].id, toNoteId: chords[1].notes[0].id },
    { id: "range-tie-g", fromNoteId: chords[1].notes[1].id, toNoteId: chords[2].notes[0].id },
  );
  getPrimaryVoice(part, m1, 1).events.push(note("range-lower-staff", "A"));
  return { score, part, m1, m2, m3, m4, chords, rest, tail, stationary, note };
}

function rangePlayback(score: ScoreDocument) {
  return collectPlaybackNotes(score)
    .map(({ midi, startSeconds, notatedDurationSeconds }) => ({ midi, startSeconds, notatedDurationSeconds }))
    .sort((left, right) => left.startSeconds - right.startSeconds || left.midi - right.midi || left.notatedDurationSeconds - right.notatedDurationSeconds);
}

test("event ranges include endpoints, whole chords, intervening rests and transitive ties in either selection direction", () => {
  const { score, part, m1, m2, chords, rest, tail } = rangeFixture();
  const selected = getEventRange(score, part.id, 0, chords[1].id, tail.id);
  assert.deepEqual(selected, {
    eventIds: [...chords.map((event) => event.id), rest.id, tail.id],
    start: { measureId: m1, eventId: chords[0].id, tick: 0 },
    end: { measureId: m2, eventId: tail.id },
    startTick: 0, endTick: 5 * TICKS_PER_QUARTER, expandedForTies: true, noteEventCount: 4,
  });
  assert.deepEqual(getEventRange(score, part.id, 0, tail.id, chords[1].id), selected);
  const single = getEventRange(score, part.id, 0, chords[1].id, chords[1].id)!;
  assert.deepEqual(single.eventIds, chords.map((event) => event.id), "different chord tones can extend a range in both directions");
  assert.equal(single.expandedForTies, true);
  const exact = getEventRange(score, part.id, 0, chords[0].id, tail.id)!;
  assert.equal(exact.expandedForTies, false);
  assert.equal(getEventRange(score, part.id, 0, chords[0].id, "range-lower-staff"), null);
  assert.equal(getEventRange(score, part.id, "missing-staff", chords[0].id, tail.id), null);
  assert.equal(getEventRange(score, part.id, 0, "missing-event", tail.id), null);
  assert.deepEqual(validateScore(score), []);
});

test("moving a range is atomic, preserves rests and expressions, splits barlines, and survives native and MusicXML reopen", () => {
  const { score, part, m1, m2, m3, chords, rest, tail, stationary } = rangeFixture();
  chords[0].dynamic = "mf";
  chords[0].articulation = "tenuto";
  const before = structuredClone(score);
  const ids = getEventRange(score, part.id, 0, chords[1].id, tail.id)!.eventIds;
  const moved = moveEventRangeToPosition(score, part.id, 0, ids, m3, TICKS_PER_QUARTER / 2);
  assert.equal(moved.error, undefined);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.selection, { measureId: m3, eventId: chords[0].id });
  assert.deepEqual(score, before);
  assert.deepEqual(moved.score.parts[0].staves[1], part.staves[1]);
  const sourceEvents = getPrimaryVoice(moved.score.parts[0], m1).events;
  assert.ok(sourceEvents.every((event) => event.kind === "rest"));
  assert.equal(voiceTicks(getPrimaryVoice(moved.score.parts[0], m1)), 4 * TICKS_PER_QUARTER);
  assert.deepEqual(getPrimaryVoice(moved.score.parts[0], m2).events.at(-1), stationary);
  const allEvents = moved.score.measureOrder.flatMap((id) => getPrimaryVoice(moved.score.parts[0], id).events);
  assert.deepEqual(allEvents.find((event) => event.id === chords[0].id), chords[0]);
  const movedRest = allEvents.find((event) => event.id === rest.id)!;
  assert.equal(movedRest.dynamic, "p");
  assert.equal(durationTicks(movedRest.duration), TICKS_PER_QUARTER / 2);
  assert.equal(moved.eventIds!.length, ids.length + 1, "a rest crossing the bar is included as two selected segments");
  assert.deepEqual(moved.score.ties, score.ties);
  const delay = 8.5 * 60 / score.tempo;
  const expected = rangePlayback(score).map((note) => ({ ...note, startSeconds: note.startSeconds + (note.midi === 69 || note.midi === 65 ? 0 : delay) }))
    .sort((left, right) => left.startSeconds - right.startSeconds || left.midi - right.midi);
  assert.deepEqual(rangePlayback(moved.score), expected);
  assert.deepEqual(validateScore(moved.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(moved.score)), moved.score);
  const reopened = importMusicXML(scoreToMusicXML(moved.score));
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(rangePlayback(reopened.score), expected);
  const back = moveEventRangeToPosition(moved.score, part.id, 0, moved.eventIds!, m1, 0);
  assert.equal(back.error, undefined);
  assert.deepEqual(rangePlayback(back.score), rangePlayback(score));
});

test("range copies preserve the source, use independent IDs and ties, and reopen with the same music", () => {
  const { score, part, m1, m2, chords } = rangeFixture();
  const before = structuredClone(score);
  const copied = copyEventRangeToPosition(score, part.id, part.staves[0].id, [chords[1].id], m2, 3.5 * TICKS_PER_QUARTER);
  assert.equal(copied.error, undefined);
  assert.deepEqual(score, before);
  assert.deepEqual(copied.score.parts[0].staves[0].measures[m1], part.staves[0].measures[m1]);
  assert.deepEqual(copied.score.parts[0].staves[1], part.staves[1]);
  const originalEventIds = new Set(chords.map((event) => event.id));
  const originalNoteIds = new Set(chords.flatMap((event) => event.notes.map((note) => note.id)));
  assert.ok(copied.eventIds!.every((id) => !originalEventIds.has(id)));
  assert.equal(copied.eventIds!.length, 4, "the first copied chord splits across the barline");
  const copiedEvents = copied.score.measureOrder.flatMap((id) => getPrimaryVoice(copied.score.parts[0], id).events)
    .filter((event) => copied.eventIds!.includes(event.id));
  assert.ok(copiedEvents.every((event) => event.kind === "note" && event.notes.every((note) => !originalNoteIds.has(note.id))));
  assert.deepEqual(copied.score.ties.slice(0, score.ties.length), score.ties);
  assert.equal(copied.score.ties.length, score.ties.length * 2 + 2, "copy retains both internal ties and adds two ties for the split chord");
  const delay = 7.5 * 60 / score.tempo;
  const original = rangePlayback(score);
  const expected = [...original, ...original.filter((note) => note.startSeconds < 3 * 60 / score.tempo && note.midi !== 69)
    .map((note) => ({ ...note, startSeconds: note.startSeconds + delay }))]
    .sort((left, right) => left.startSeconds - right.startSeconds || left.midi - right.midi || left.notatedDurationSeconds - right.notatedDurationSeconds);
  assert.deepEqual(rangePlayback(copied.score), expected);
  assert.deepEqual(validateScore(copied.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(copied.score)), copied.score);
  const reopened = importMusicXML(scoreToMusicXML(copied.score));
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(rangePlayback(reopened.score), expected);
  const first = copiedEvents[0];
  if (first.kind !== "note") assert.fail("Expected copied chord.");
  const edited = editEventNotation(copied.score, part.id, 0, copied.selection!.measureId, first.id, { noteId: first.notes[0].id, pitch: { step: "D", alter: 0, octave: 4 } });
  assert.equal(edited.error, undefined);
  assert.deepEqual(edited.score.parts[0].staves[0].measures[m1], part.staves[0].measures[m1], "editing a copied tie chain cannot alter its source");
});

test("range edits reject occupied destinations, marked rests, stale or mixed selections without changing music", () => {
  const { score, part, m1, m2, m3, chords, rest, tail } = rangeFixture();
  const before = structuredClone(score);
  const collision = moveEventRangeToPosition(score, part.id, 0, [chords[0].id], m2, 0);
  assert.match(collision.error ?? "", /overlaps another note/);
  const copyOntoSelf = copyEventRangeToPosition(score, part.id, 0, [chords[1].id], m1, 0);
  assert.match(copyOntoSelf.error ?? "", /overlaps another note/);
  const marked = moveEventRangeToPosition(score, part.id, 0, [tail.id], m1, 3 * TICKS_PER_QUARTER);
  assert.match(marked.error ?? "", /rest with a dynamic marking/);
  const exact = copyEventRangeToPosition(score, part.id, 0, [chords[1].id], m3, 15);
  assert.match(exact.error ?? "", /supported note values/);
  const invalid = [
    moveEventRangeToPosition(score, part.id, 0, [], m3, 0),
    moveEventRangeToPosition(score, part.id, 0, [chords[0].id, chords[0].id], m3, 0),
    copyEventRangeToPosition(score, part.id, 0, [chords[0].id, "range-lower-staff"], m3, 0),
    copyEventRangeToPosition(score, part.id, 0, ["missing-event"], m3, 0),
    moveEventRangeToPosition(score, part.id, 0, [rest.id], m3, -1),
    clearEventRange(score, part.id, 0, [chords[0].id, "missing-event"]),
  ];
  for (const result of [collision, copyOntoSelf, marked, exact, ...invalid]) {
    assert.ok(result.error);
    assert.equal(result.score, score);
    assert.equal(result.changed, false);
  }
  assert.deepEqual(score, before);
  const selfOverlap = moveEventRangeToPosition(score, part.id, 0, [chords[1].id], m1, TICKS_PER_QUARTER / 2);
  assert.match(selfOverlap.error ?? "", /rest with a dynamic marking/, "self overlap is allowed, but the marked following rest is still protected");
  delete rest.dynamic;
  const allowed = moveEventRangeToPosition(score, part.id, 0, [chords[1].id], m1, TICKS_PER_QUARTER / 2);
  assert.equal(allowed.error, undefined);
  assert.deepEqual(validateScore(allowed.score), []);
});

test("deleting a range clears all connected chords to equal rests while preserving dynamics, unrelated ties and beat positions", () => {
  const { score, part, m1, m2, chords, rest, tail, stationary, note } = rangeFixture();
  chords[0].dynamic = "ff";
  const lower = getPrimaryVoice(part, m1, 1).events[0];
  const lowerNext = note("range-lower-next", "A");
  if (lower.kind !== "note" || lowerNext.kind !== "note") assert.fail("Expected notes.");
  getPrimaryVoice(part, m1, 1).events.push(lowerNext);
  const lowerTie = { id: "range-unrelated-tie", fromNoteId: lower.notes[0].id, toNoteId: lowerNext.notes[0].id };
  score.ties.push(lowerTie);
  const before = structuredClone(score);
  const cleared = clearEventRange(score, part.id, 0, [chords[1].id, tail.id]);
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.changed, true);
  assert.deepEqual(score, before);
  assert.deepEqual(cleared.score.parts[0].staves[1], part.staves[1]);
  assert.deepEqual(cleared.score.ties, [lowerTie]);
  const firstBar = getPrimaryVoice(cleared.score.parts[0], m1).events;
  assert.deepEqual(firstBar.map((event) => event.id), [...chords.map((event) => event.id), rest.id]);
  assert.ok(firstBar.every((event) => event.kind === "rest" && durationTicks(event.duration) === TICKS_PER_QUARTER));
  assert.equal(firstBar[0].dynamic, "ff");
  assert.deepEqual(firstBar[3], rest);
  const secondBar = getPrimaryVoice(cleared.score.parts[0], m2).events;
  assert.equal(secondBar[0].kind, "rest");
  assert.deepEqual(secondBar[1], stationary);
  assert.equal(collectPlaybackNotes(cleared.score).find((entry) => entry.midi === 65)!.startSeconds, 5 * 60 / score.tempo);
  assert.deepEqual(validateScore(cleared.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(cleared.score)), cleared.score);
  const reopened = importMusicXML(scoreToMusicXML(cleared.score));
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(rangePlayback(reopened.score), rangePlayback(cleared.score));
  const alreadyEmpty = clearEventRange(cleared.score, part.id, 0, cleared.eventIds!);
  assert.equal(alreadyEmpty.changed, false);
  assert.equal(alreadyEmpty.score, cleared.score);
});


test("ranges retain implicit bar gaps when the destination needs extra measures and preserve other staves", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [m1, m2, , m4] = source.measureOrder;
  const make = (id: string, step: Pitch["step"]) => makeEvent({ id, pitch: { step, alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const first = make("range-upper-first", "C");
  const second = make("range-upper-second", "E");
  getPrimaryVoice(part, m1).events.push(first);
  getPrimaryVoice(part, m2).events.push(second);
  const untouched = make("range-destination-primary", "G");
  getPrimaryVoice(part, m4, 1).events.push(untouched);
  assert.deepEqual(validateScore(source), []);
  const selected = getEventRange(source, part.id, 0, first.id, second.id)!;
  assert.equal(selected.endTick - selected.startTick, 5 * TICKS_PER_QUARTER);
  const copied = copyEventRangeToPosition(source, part.id, 0, selected.eventIds, m4, 0);
  assert.equal(copied.error, undefined);
  assert.equal(copied.score.measureOrder.length, 5);
  assert.deepEqual(copied.score.parts[0].staves[1].measures[m4], part.staves[1].measures[m4]);
  assert.equal(copied.eventIds!.length, 2, "trailing silence may stay implicit without creating extra notation");
  const destination = getPrimaryVoice(copied.score.parts[0], m4);
  assert.deepEqual(destination.events.map((event) => [event.kind, durationTicks(event.duration)]), [["note", 960]]);
  const copiedRange = getEventRange(copied.score, part.id, 0, copied.eventIds![0], copied.eventIds![1])!;
  assert.equal(copiedRange.endTick - copiedRange.startTick, 5 * TICKS_PER_QUARTER, "the three silent beats between notes are preserved across the barline");
  const last = getPrimaryVoice(copied.score.parts[0], copied.score.measureOrder[4]);
  assert.equal(last.events[0].kind, "note");
  assert.deepEqual(validateScore(copied.score), []);
  assert.deepEqual(copied.score.parts[0].staves[0].measures[m1], part.staves[0].measures[m1]);
  assert.deepEqual(copied.score.parts[0].staves[0].measures[m2], part.staves[0].measures[m2]);
});


test("range expression changes whole tied chords and rests without changing notation or other staves", () => {
  const { score, part, m1, m2, chords, tail, stationary } = rangeFixture();
  chords[0].articulation = "tenuto";
  const original = structuredClone(score);
  const result = setEventRangeExpression(score, part.id, 0, [chords[1].id, tail.id], { dynamic: "ff" });
  assert.equal(result.error, undefined);
  assert.equal(result.changed, true);
  assert.deepEqual(score, original);
  assert.deepEqual(result.score.ties, score.ties);
  assert.deepEqual(result.score.parts[0].staves[1], part.staves[1]);
  assert.deepEqual(result.score.measures, score.measures);
  assert.equal(result.eventIds!.length, 5, "the complete tie chain and intervening rest are included");
  assert.equal(result.selection!.eventId, chords[0].id);
  for (const measureId of [m1, m2]) {
    const source = getPrimaryVoice(part, measureId).events;
    for (const [index, next] of getPrimaryVoice(result.score.parts[0], measureId).events.entries()) {
      if (next.id === stationary.id) { assert.deepEqual(next, stationary); continue; }
      assert.equal(next.dynamic, "ff");
      assert.deepEqual({ ...next, dynamic: source[index].dynamic }, { ...source[index], dynamic: source[index].dynamic });
    }
  }
  assert.deepEqual(validateScore(result.score), []);
  assert.equal(setEventRangeExpression(result.score, part.id, 0, result.eventIds!, { dynamic: "ff" }).score, result.score);
});

test("range articulation skips rests, preserves tie performance and round-trips expression through native and MusicXML", () => {
  const { score, part, m1, chords, tail } = rangeFixture();
  const dynamic = setEventRangeExpression(score, part.id, 0, [chords[1].id, tail.id], { dynamic: "mp" });
  const result = setEventRangeExpression(dynamic.score, part.id, 0, dynamic.eventIds!, { articulation: "accent" });
  assert.equal(result.error, undefined);
  const events = result.score.measureOrder.flatMap((id) => getPrimaryVoice(result.score.parts[0], id).events);
  for (const event of events.filter((item) => result.eventIds!.includes(item.id))) {
    if (event.kind === "rest") assert.equal("articulation" in event, false);
    else assert.equal(event.articulation, "accent");
    assert.equal(event.dynamic, "mp");
  }
  assert.equal(getPrimaryVoice(result.score.parts[0], m1).events[3].kind, "rest");
  assert.deepEqual(result.score.ties, score.ties);
  const timing = (doc: ScoreDocument) => collectPlaybackNotes(doc).map((note) => [note.midi, note.startSeconds, note.notatedDurationSeconds]);
  assert.deepEqual(timing(result.score), timing(score), "tied continuations never add another attack or change rhythmic span");
  const native = JSON.parse(serializeNativeScore(result.score)) as ScoreDocument;
  assert.deepEqual(native, result.score);
  const imported = importMusicXML(scoreToMusicXML(result.score));
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(validateScore(imported.score), []);
  const expression = (doc: ScoreDocument) => doc.measureOrder.flatMap((id) => getPrimaryVoice(doc.parts[0], id).events.map((event) => [event.kind, event.dynamic ?? null, event.kind === "note" ? event.articulation ?? null : null]));
  assert.deepEqual(expression(imported.score), expression(result.score));
  assert.deepEqual(timing(imported.score), timing(result.score));
  assert.equal(imported.score.ties.length, result.score.ties.length);
});

test("range expression removes only its own marks and treats rest-only articulation as unchanged", () => {
  const { score, part, m1, chords, rest } = rangeFixture();
  chords.forEach((event) => { event.dynamic = "p"; event.articulation = "staccato"; });
  const cleared = setEventRangeExpression(score, part.id, 0, [chords[1].id], { articulation: null });
  assert.equal(cleared.error, undefined);
  const notes = getPrimaryVoice(cleared.score.parts[0], m1).events.slice(0, 3);
  assert.ok(notes.every((event) => !("articulation" in event) && event.dynamic === "p"));
  assert.deepEqual(cleared.score.ties, score.ties);
  const noDynamics = setEventRangeExpression(cleared.score, part.id, 0, cleared.eventIds!, { dynamic: null });
  assert.ok(getPrimaryVoice(noDynamics.score.parts[0], m1).events.slice(0, 3).every((event) => !("dynamic" in event)));
  assert.equal(getPrimaryVoice(noDynamics.score.parts[0], m1).events[3].dynamic, "p", "an unselected rest keeps its mark");
  assert.equal(setEventRangeExpression(noDynamics.score, part.id, 0, noDynamics.eventIds!, { dynamic: null }).score, noDynamics.score);
  assert.equal(setEventRangeExpression(score, part.id, 0, [rest.id], { articulation: "tenuto" }).score, score);
  const restDynamic = setEventRangeExpression(score, part.id, 0, [rest.id], { dynamic: "fff" });
  assert.equal(getPrimaryVoice(restDynamic.score.parts[0], m1).events[3].dynamic, "fff");
  assert.deepEqual(validateScore(restDynamic.score), []);
});

test("invalid range expression commands reject atomically", () => {
  const { score, part, chords } = rangeFixture();
  const original = structuredClone(score);
  for (const ids of [[], ["missing"], [chords[0].id, "range-lower-staff"], [chords[0].id, chords[0].id]]) {
    const result = setEventRangeExpression(score, part.id, 0, ids, { dynamic: "f" });
    assert.ok(result.error);
    assert.equal(result.score, score);
  }
  for (const change of [{}, { dynamic: "forte" }, { articulation: "fermata" }, { dynamic: undefined }, { dynamic: "f", articulation: "accent" }]) {
    const result = setEventRangeExpression(score, part.id, 0, [chords[0].id], change as never);
    assert.ok(result.error);
    assert.equal(result.score, score);
  }
  assert.deepEqual(score, original);
  const invalid = structuredClone(score);
  invalid.ties[0].toNoteId = "missing";
  const result = setEventRangeExpression(invalid, part.id, 0, [chords[0].id], { dynamic: "f" });
  assert.match(result.error!, /score is invalid/);
  assert.equal(result.score, invalid);
});

test("range transposition preserves every chord interval, tied note ID, expression and rhythm", () => {
  const { score, part, m1, m2, chords, tail, stationary } = rangeFixture();
  chords[0].dynamic = "ff";
  chords[0].articulation = "accent";
  const before = structuredClone(score);
  const result = transposeEventRange(score, part.id, 0, [chords[1].id, tail.id], 1);
  assert.equal(result.error, undefined);
  assert.equal(result.changed, true);
  assert.deepEqual(score, before);
  assert.deepEqual(result.score.ties, score.ties);
  assert.deepEqual(result.score.parts[0].staves[1], part.staves[1]);
  assert.deepEqual(result.score.measures, score.measures, "transposing a passage does not change the key signature");
  assert.deepEqual(getPrimaryVoice(result.score.parts[0], m2).events[1], stationary);
  const selectedIds = new Set(result.eventIds);
  const letter = (pitch: Pitch) => pitch.octave * 7 + "CDEFGAB".indexOf(pitch.step);
  const letterDeltas = new Set<number>();
  for (const measureId of [m1, m2]) {
    const source = getPrimaryVoice(part, measureId).events;
    const changed: MusicEvent[] = getPrimaryVoice(result.score.parts[0], measureId).events;
    assert.equal(source.length, changed.length);
    for (const [index, event] of source.entries()) {
      const next = changed[index];
      if (!selectedIds.has(event.id) || event.kind === "rest") { assert.deepEqual(next, event); continue; }
      if (next.kind !== "note") assert.fail("Expected preserved chord.");
      assert.deepEqual({ ...next, notes: event.notes }, event, "only note pitches change");
      for (const [tone, note] of event.notes.entries()) {
        assert.deepEqual({ ...next.notes[tone], pitch: note.pitch }, note);
        assert.equal(writtenMidi(next.notes[tone].pitch) - writtenMidi(note.pitch), 1);
        letterDeltas.add(letter(next.notes[tone].pitch) - letter(note.pitch));
      }
    }
  }
  assert.equal(letterDeltas.size, 1, "one letter displacement preserves written chord intervals too");
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(JSON.parse(serializeNativeScore(result.score)), result.score);
  const reopened = importMusicXML(scoreToMusicXML(result.score));
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(rangePlayback(reopened.score), rangePlayback(result.score));
});

test("octave transposition retains enharmonic spelling and moving back restores all notation", () => {
  const { score, part, m1, chords } = rangeFixture();
  chords[0].notes[1].pitch = { step: "F", alter: -1, octave: 4 };
  const source = structuredClone(score);
  const up = transposeEventRange(score, part.id, 0, [chords[1].id], 12);
  assert.equal(up.error, undefined);
  const moved = getPrimaryVoice(up.score.parts[0], m1).events[0];
  if (moved.kind !== "note") assert.fail("Expected chord.");
  assert.deepEqual(moved.notes[1].pitch, { step: "F", alter: -1, octave: 5 });
  const down = transposeEventRange(up.score, part.id, 0, up.eventIds!, -12);
  assert.equal(down.error, undefined);
  assert.deepEqual({ ...down.score, updatedAt: source.updatedAt }, source);
});

test("semitone transposition handles octave boundaries and does not collapse enharmonic chord tones", () => {
  const score = createScore("solo", false);
  const part = score.parts[0];
  const measureId = score.measureOrder[0];
  const chord = makeEvent({ id: "enharmonic-range", pitch: { step: "B", alter: 0, octave: 3 }, duration: { base: 2, dots: 0 }, rest: false });
  if (chord.kind !== "note") assert.fail("Expected chord.");
  chord.notes.push({ id: "enharmonic-range-other", pitch: { step: "C", alter: -1, octave: 4 }, accidentalDisplay: "force" });
  getPrimaryVoice(part, measureId).events.push(chord);
  for (const semitones of [-1, 1]) {
    const result = transposeEventRange(score, part.id, 0, [chord.id], semitones);
    assert.equal(result.error, undefined);
    const changed = getPrimaryVoice(result.score.parts[0], measureId).events[0];
    if (changed.kind !== "note") assert.fail("Expected chord.");
    assert.equal(changed.notes.length, 2);
    assert.notDeepEqual(changed.notes[0].pitch, changed.notes[1].pitch);
    assert.ok(changed.notes.every((note, index) => writtenMidi(note.pitch) === writtenMidi(chord.notes[index].pitch) + semitones));
    assert.deepEqual(validateScore(result.score), []);
  }
});

test("range transposition rejects invalid or out-of-range changes atomically and leaves rest-only ranges alone", () => {
  const { score, part, m1, chords, rest } = rangeFixture();
  chords[0].notes[1].pitch = { step: "B", alter: 2, octave: 9 };
  const before = structuredClone(score);
  for (const semitones of [1, 12, 0, 2, NaN, Infinity]) {
    const result = transposeEventRange(score, part.id, 0, [chords[1].id], semitones);
    assert.ok(result.error);
    assert.equal(result.score, score);
    assert.equal(result.changed, false);
  }
  const stale = transposeEventRange(score, part.id, 0, ["missing"], -1);
  assert.ok(stale.error);
  assert.equal(stale.score, score);
  const mixed = transposeEventRange(score, part.id, 0, [chords[1].id, "range-lower-staff"], -1);
  assert.ok(mixed.error);
  const empty = transposeEventRange(score, part.id, 0, [rest.id], 1);
  assert.equal(empty.error, undefined);
  assert.equal(empty.changed, false);
  assert.equal(empty.score, score);
  assert.deepEqual(score, before);
  const lower = structuredClone(score);
  const note = getPrimaryVoice(lower.parts[0], m1).events[0];
  if (note.kind !== "note") assert.fail("Expected chord.");
  note.notes[1].pitch = { step: "C", alter: -2, octave: -1 };
  const tooLow = transposeEventRange(lower, part.id, 0, [chords[1].id], -1);
  assert.ok(tooLow.error);
  assert.equal(tooLow.score, lower);
});


function rhythmRangeFixture() {
  const score = createScore("solo", false);
  const part = score.parts[0];
  const [m1, m2] = score.measureOrder;
  const prefix = makeEvent({ id: "rhythm-prefix", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: true });
  const first = makeEvent({ id: "rhythm-first", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const second = makeEvent({ id: "rhythm-second", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false });
  if (first.kind !== "note" || second.kind !== "note") assert.fail("Expected chords.");
  first.notes.push({ id: "rhythm-e", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "force" });
  second.notes.push({ id: "rhythm-g", pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "force" });
  first.dynamic = "f";
  second.articulation = "accent";
  const tail = makeEvent({ id: "rhythm-tail", pitch: { step: "B", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  getPrimaryVoice(part, m1).events.push(prefix, first, second);
  getPrimaryVoice(part, m2).events.push(tail);
  getPrimaryVoice(part, m1, 1).events.push(makeEvent({ id: "rhythm-bass", pitch: { step: "A", alter: 0, octave: 3 }, duration: { base: 1, dots: 0 }, rest: false }));
  score.ties.push({ id: "rhythm-original-tie", fromNoteId: first.notes[0].id, toNoteId: second.notes[0].id });
  return { score, part, m1, m2, first, second, tail };
}

test("range length scaling rebars whole chords, preserves ties and expressions, and shifts following music once", () => {
  const { score, part, m1, first, second } = rhythmRangeFixture();
  const before = structuredClone(score);
  const doubled = changeEventRangeDuration(score, part.id, 0, [second.id], { scale: 2 });
  assert.equal(doubled.error, undefined);
  assert.deepEqual(score, before);
  assert.equal(doubled.eventIds!.length, 3, "the second chord crosses a barline and splits once");
  assert.equal(doubled.score.ties.length, 3, "one original tie plus two continuation ties");
  assert.ok(doubled.score.ties.some(tie => tie.id === "rhythm-original-tie"));
  assert.deepEqual(doubled.score.parts[0].staves[1], part.staves[1]);
  const firstBar = getPrimaryVoice(doubled.score.parts[0], m1).events;
  assert.deepEqual(firstBar[0], getPrimaryVoice(part, m1).events[0]);
  assert.equal(firstBar[1].id, first.id);
  assert.equal(firstBar[1].dynamic, "f");
  if (firstBar[2].kind !== "note") assert.fail("Expected split chord.");
  assert.equal(firstBar[2].articulation, "accent");
  const secondsPerBeat = 60 / score.tempo;
  const playback = rangePlayback(doubled.score);
  assert.equal(playback.find(note => note.midi === 60)!.notatedDurationSeconds, 6 * secondsPerBeat);
  assert.equal(playback.find(note => note.midi === 67)!.notatedDurationSeconds, 4 * secondsPerBeat);
  assert.equal(playback.find(note => note.midi === 71)!.startSeconds, 7 * secondsPerBeat);
  assert.deepEqual(validateScore(doubled.score), []);
  const halved = changeEventRangeDuration(doubled.score, part.id, 0, doubled.eventIds!, { scale: 0.5 });
  assert.equal(halved.error, undefined);
  assert.deepEqual(rangePlayback(halved.score), rangePlayback(score));
  assert.deepEqual(JSON.parse(serializeNativeScore(doubled.score)), doubled.score);
  const reopened = importMusicXML(scoreToMusicXML(doubled.score));
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(rangePlayback(reopened.score), playback);
});

test("bulk dots preserve tied chords across bars, support removing dots, and reject no music when already applied", () => {
  const { score, part, first, second } = rhythmRangeFixture();
  const dotted = changeEventRangeDuration(score, part.id, 0, [first.id, second.id], { dots: 1 });
  assert.equal(dotted.error, undefined);
  assert.deepEqual(validateScore(dotted.score), []);
  assert.equal(rangePlayback(dotted.score).find(n => n.midi === 60)!.notatedDurationSeconds, 4.5 * 60 / score.tempo);
  assert.equal(rangePlayback(dotted.score).find(n => n.midi === 71)!.startSeconds, 5.5 * 60 / score.tempo);
  assert.ok(dotted.score.ties.some(tie => tie.id === "rhythm-original-tie"));
  const again = changeEventRangeDuration(dotted.score, part.id, 0, dotted.eventIds!, { dots: 1 });
  assert.equal(again.changed, false);
  assert.equal(again.score, dotted.score);
  const removed = changeEventRangeDuration(dotted.score, part.id, 0, dotted.eventIds!, { dots: 0 });
  assert.equal(removed.error, undefined);
  assert.deepEqual(validateScore(removed.score), []);
  const twiceDotted = changeEventRangeDuration(score, part.id, 0, [second.id], { dots: 2 });
  assert.equal(twiceDotted.error, undefined);
  assert.deepEqual(validateScore(twiceDotted.score), []);
  assert.equal(rangePlayback(twiceDotted.score).find(n => n.midi === 60)!.notatedDurationSeconds, 5.25 * 60 / score.tempo);
  assert.deepEqual(rangePlayback(importMusicXML(scoreToMusicXML(twiceDotted.score)).score), rangePlayback(twiceDotted.score));
});

test("range scaling includes silent gaps and rests, crosses changed meters and adds measures without altering other staves", () => {
  const score = createScore("solo", false);
  const part = score.parts[0];
  const [m1,m2,m3] = score.measureOrder;
  score.measures[m2].time = { numerator: 3, denominator: 4 };
  const make = (id: string, rest: boolean) => makeEvent({ id, pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest });
  const a=make("rhythm-gap-a",false), r=make("rhythm-gap-r",true), b=make("rhythm-gap-b",false);
  getPrimaryVoice(part,m1).events.push(a,r);
  getPrimaryVoice(part,m3).events.push(b);
  const doubled=changeEventRangeDuration(score,part.id,0,[a.id,b.id],{scale:2});
  assert.equal(doubled.error,undefined);
  const range=getEventRange(doubled.score,part.id,0,doubled.eventIds![0],doubled.eventIds!.at(-1)!)!;
  assert.equal(range.endTick-range.startTick,16*TICKS_PER_QUARTER);
  assert.equal(doubled.score.measureOrder.length,5);
  assert.deepEqual(validateScore(doubled.score),[]);
  for(const id of score.measureOrder) assert.deepEqual(doubled.score.parts[0].staves[1].measures[id],part.staves[1].measures[id]);
  const selectedRest=getPrimaryVoice(doubled.score.parts[0],m1).events.find(e=>e.id===r.id)!;
  assert.equal(durationTicks(selectedRest.duration),2*TICKS_PER_QUARTER);
});

test("bulk rhythm changes reject unsupported small values and invalid selections without partial changes", () => {
  const {score,part,m1,first}=rhythmRangeFixture();
  const tiny=makeEvent({id:"rhythm-tiny",pitch:{step:"D",alter:0,octave:4},duration:{base:64,dots:0},rest:false});
  getPrimaryVoice(part,score.measureOrder[2]).events.push(tiny);
  const before=structuredClone(score);
  const failed=changeEventRangeDuration(score,part.id,0,[first.id,tiny.id],{scale:0.5});
  assert.ok(failed.error);
  assert.equal(failed.score,score);
  assert.equal(failed.changed,false);
  for (const ids of [[],["missing"],[first.id,"rhythm-bass"],[first.id,first.id]]) {
    const result=changeEventRangeDuration(score,part.id,0,ids,{scale:2});
    assert.ok(result.error);
    assert.equal(result.score,score);
  }
  const rest=getPrimaryVoice(part,m1).events[0];
  const changed=changeEventRangeDuration(score,part.id,0,[rest.id],{dots:1});
  assert.equal(changed.error,undefined);
  assert.equal(getPrimaryVoice(changed.score.parts[0],m1).events[0].duration.dots,1);
  assert.deepEqual(score,before);
});


test("hairpin insert, reverse, replace and remove keep chords, complete tie chains, and unrelated music intact", () => {
  const { score, part, chords, tail, rest } = rangeFixture();
  const before = structuredClone(score);
  const added = setEventRangeHairpin(score, part.id, 0, [chords[1].id, tail.id], { kind: "crescendo", from: "p", to: "f" });
  assert.equal(added.error, undefined);
  assert.deepEqual(score, before);
  assert.deepEqual(added.score.parts, score.parts);
  assert.deepEqual(added.score.ties, score.ties);
  assert.deepEqual(added.eventIds, [...chords.map((event) => event.id), rest.id, tail.id]);
  assert.equal(added.score.hairpins?.[0].startEventId, chords[0].id);
  assert.equal(added.score.hairpins?.[0].endEventId, tail.id);
  assert.deepEqual(validateScore(added.score), []);
  assert.equal(setEventRangeHairpin(added.score, part.id, 0, added.eventIds!, { kind: "crescendo", from: "p", to: "f" }).score, added.score);
  const edited = setEventRangeHairpin(added.score, part.id, 0, [chords[1].id], { kind: "diminuendo", from: "ff", to: "pp" });
  assert.equal(edited.score.hairpins?.length, 1, "a touching span is replaced as a whole, never stacked");
  assert.equal(edited.score.hairpins?.[0].endEventId, chords[2].id);
  const removed = setEventRangeHairpin(edited.score, part.id, 0, [chords[1].id], null);
  assert.equal(removed.error, undefined);
  assert.deepEqual(removed.score.hairpins, []);
  assert.deepEqual(removed.score.parts, before.parts);
  assert.deepEqual(removed.score.ties, before.ties);
  assert.equal(setEventRangeHairpin(removed.score, part.id, 0, [chords[1].id], null).score, removed.score);
});

test("hairpin gain follows the timeline throughout held ties without extra attacks and respects staff isolation", () => {
  const { score, part, chords, tail, stationary } = rangeFixture();
  const changed = setEventRangeHairpin(score, part.id, 0, [chords[1].id, tail.id], { kind: "crescendo", from: "p", to: "ff" }).score;
  const played = collectPlaybackNotes(changed);
  assert.deepEqual(rangePlayback(changed), rangePlayback(score));
  const c = played.find((note) => note.midi === 60)!;
  const e = played.find((note) => note.midi === 64)!;
  const a = played.find((note) => note.midi === 69)!;
  assert.equal(c.velocity, 56);
  assert.equal(c.notatedDurationSeconds, 1.25);
  assert.equal(c.velocityEnvelope?.[0].velocity, e.velocityEnvelope?.[0].velocity);
  assert.ok(c.velocityEnvelope!.at(-1)!.velocity > c.velocity);
  assert.equal(a.velocityEnvelope, undefined);
  assert.equal(a.velocity, 82);
  const last = played.find((note) => note.midi === 65)!;
  assert.equal(last.velocity, 112, "the target persists after the span despite an earlier mark inside it");
  const marked = setEventRangeExpression(changed, part.id, 0, [stationary.id], { dynamic: "pp" });
  assert.equal(collectPlaybackNotes(marked.score).find((note) => note.midi === 65)!.velocity, 44);
  const calls: { type: string; value: number; time: number }[] = [];
  const gain = {
    setValueAtTime: (value: number, time: number) => { calls.push({ type: "set", value, time }); return gain; },
    exponentialRampToValueAtTime: (value: number, time: number) => { calls.push({ type: "exp", value, time }); return gain; },
    linearRampToValueAtTime: (value: number, time: number) => { calls.push({ type: "linear", value, time }); return gain; },
  };
  schedulePlaybackGain(gain, c, 10);
  assert.equal(calls.filter((call) => call.type === "set").length, 1, "a tie has only one attack");
  assert.ok(calls.at(-2)!.value > calls[1].value, "sustain grows instead of only changing the initial note velocity");
  assert.equal(calls.at(-1)!.value, .0001, "release prevents clicks");
  assert.ok(calls.every((call, i) => i === 0 || call.time > calls[i - 1].time));
  const softer = setEventRangeHairpin(changed, part.id, 0, [chords[1].id, tail.id], { kind: "diminuendo", from: "ff", to: "p" }).score;
  calls.length = 0;
  schedulePlaybackGain(gain, collectPlaybackNotes(softer).find((note) => note.midi === 60)!, 10);
  assert.ok(calls.at(-2)!.value < calls[1].value, "diminuendo reduces held-note gain");
});

test("hairpins round-trip native and standard MusicXML wedges with exact playback levels and ties", () => {
  const { score, part, chords, tail } = rangeFixture();
  const added = setEventRangeHairpin(score, part.id, 0, [chords[0].id, tail.id], { kind: "crescendo", from: "ppp", to: "fff" }).score;
  const native = JSON.parse(serializeNativeScore(added));
  assert.deepEqual(validateScore(native), []);
  assert.deepEqual(native.hairpins, added.hairpins);
  const xml = scoreToMusicXML(added);
  assert.match(xml, /<wedge type="crescendo"/);
  assert.match(xml, /<wedge type="stop"/);
  const imported = importMusicXML(xml);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(validateScore(imported.score), []);
  assert.equal(imported.score.ties.length, added.ties.length);
  assert.deepEqual(imported.score.hairpins?.map(({ kind, from, to }) => ({ kind, from, to })), [{ kind: "crescendo", from: "ppp", to: "fff" }]);
  const sound = (doc: ScoreDocument) => collectPlaybackNotes(doc).map((note) => ({ ...note, partId: "part" }));
  assert.deepEqual(sound(imported.score), sound(added));
  assert.deepEqual(sound(native), sound(added));
});

test("hairpin anchors follow bar splits, range move/copy, transpose and deletion", () => {
  const { score, part, m3, m4, chords } = rangeFixture();
  const added = setEventRangeHairpin(score, part.id, 0, [chords[1].id], { kind: "diminuendo", from: "f", to: "p" });
  const moved = moveEventRangeToPosition(added.score, part.id, 0, added.eventIds!, m3, 3 * 960);
  assert.equal(moved.error, undefined);
  assert.deepEqual(validateScore(moved.score), []);
  const span = timedHairpins(moved.score)[0];
  assert.equal(span.startTick, 11 * 960);
  assert.equal(span.endTick, 14 * 960);
  assert.deepEqual(rangePlayback(moved.score), rangePlayback(moveEventRangeToPosition(score, part.id, 0, added.eventIds!, m3, 3 * 960).score));
  const copied = copyEventRangeToPosition(added.score, part.id, 0, added.eventIds!, m4, 2 * 960);
  assert.equal(copied.error, undefined);
  assert.equal(copied.score.hairpins?.length, 2);
  assert.equal(new Set(copied.score.hairpins?.map((item) => item.id)).size, 2);
  assert.deepEqual(validateScore(copied.score), []);
  const stretched = changeEventRangeDuration(copied.score, part.id, 0, copied.eventIds!, { scale: 2 });
  assert.equal(stretched.error, undefined);
  const ranges = timedHairpins(stretched.score);
  assert.equal(ranges[1].endTick - ranges[1].startTick, 6 * 960);
  const transposed = transposeEventRange(stretched.score, part.id, 0, stretched.eventIds!, 12);
  assert.deepEqual(transposed.score.hairpins, stretched.score.hairpins);
  const cleared = clearEventRange(transposed.score, part.id, 0, transposed.eventIds!);
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.score.hairpins?.length, 1);
  assert.deepEqual(validateScore(cleared.score), []);
  const timeline = eventTimeline(stretched.score);
  assert.ok(timeline.get(ranges[1].endEventId)!.endTick === ranges[1].endTick);
});

test("malformed, reversed, cross-staff, overlapping or rest-only hairpins fail without partial edits", () => {
  const { score, part, chords, tail, rest } = rangeFixture();
  for (const change of [undefined, false, [], { kind: "crescendo", from: "ff", to: "p" }, { kind: "diminuendo", from: "p", to: "p" }, { kind: "bad", from: "p", to: "f" }]) {
    const result = setEventRangeHairpin(score, part.id, 0, [chords[0].id], change as never);
    assert.ok(result.error);
    assert.equal(result.score, score);
  }
  assert.ok(setEventRangeHairpin(score, part.id, 0, [rest.id], { kind: "crescendo", from: "p", to: "f" }).error);
  const valid = setEventRangeHairpin(score, part.id, 0, [chords[0].id, tail.id], { kind: "crescendo", from: "p", to: "f" }).score;
  for (const endpoint of ["missing", rest.id, "range-lower-staff"]) {
    const invalid = structuredClone(valid);
    invalid.hairpins![0].endEventId = endpoint;
    assert.ok(validateScore(invalid).length);
  }
  const reversed = structuredClone(valid);
  [reversed.hairpins![0].startEventId, reversed.hairpins![0].endEventId] = [tail.id, chords[0].id];
  assert.ok(validateScore(reversed).some((error) => error.includes("precede")));
  const overlap = structuredClone(valid);
  overlap.hairpins!.push({ ...overlap.hairpins![0], id: "overlap" });
  assert.ok(validateScore(overlap).some((error) => error.includes("overlap")));
  assert.ok(validateScore({ ...valid, hairpins: null }).some((error) => error.includes("array")));
});

test("untied chords reflow and split rhythm dots cycle across native reopen without changing manual ties", () => {
  let score = createScore("solo", { seedDemo: false });
  const part = score.parts[0], mid = score.measureOrder[0];
  const voice = getPrimaryVoice(part, mid);
  for (let i=0;i<2;i++) voice.events.push(makeEvent({ id: `rhythm-${i}`, pitch: {step:"C",alter:0,octave:4},duration:{base:2,dots:0},rest:false }));
  const seed=voice.events[1];
  if(seed.kind!=="note") assert.fail();
  seed.notes.push({id:"rhythm-third",pitch:{step:"E",alter:0,octave:4},accidentalDisplay:"auto"});
  const grown=editEventNotation(score,part.id,0,mid,seed.id,{duration:{base:1,dots:0}});
  assert.equal(grown.changed,true);assert.equal(grown.durationReflow?.segmentCount,2);
  grown.score.ties.push({ id: "manual-edge", fromNoteId: voice.events[0].kind === "note" ? voice.events[0].notes[0].id : "", toNoteId: seed.notes[0].id });
  score=JSON.parse(serializeNativeScore(grown.score));
  for(const dots of [1,2,0] as const){
    const rhythm: NonNullable<ReturnType<typeof eventRhythm>> = eventRhythm(score,part.id,0,mid,seed.id)!;
    assert.equal(rhythm.duration.base,1);
    const result=editEventNotation(score,part.id,0,mid,seed.id,{duration:{...rhythm.duration,dots}});
    assert.equal(result.error,undefined); score=JSON.parse(serializeNativeScore(result.score));
    assert.deepEqual(eventRhythm(score,part.id,0,mid,seed.id)?.duration,{base:1,dots});
    assert.deepEqual(validateScore(score),[]);
    assert.ok(score.ties.some(tie => tie.id === "manual-edge"));
    const total=score.measureOrder.reduce((sum,id)=>sum+voiceTicks(getPrimaryVoice(score.parts[0],id)),0);
    assert.equal(total,durationTicks({base:2,dots:0})+durationTicks({base:1,dots}));
  }
});

test("unsupported MusicXML notation is reported before an editable copy loses it", () => {
  const xml=`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><notations><slur type="start"/><fermata/></notations><lyric><text>la</text></lyric></note><barline><repeat direction="backward"/></barline></measure></part></score-partwise>`;
  const imported=importMusicXML(xml);
  for(const label of ["slur","lyrics","fermata","repeat barline"]) assert.ok(imported.warnings.some(message=>message.includes(label)&&message.includes("measure 1")&&message.includes("omitted")));
});

test("rolling playback schedules every chord tone beyond 600 without repeats or a total cap", () => {
  const notes=Array.from({length: 1400}, (_,i)=>({partId:"p",midi:60+i%2,velocity:90,startSeconds:Math.floor(i/2)*.05,durationSeconds:.04,notatedDurationSeconds:.05}));
  const queue=createPlaybackQueue(notes,0,35,false);
  const emitted=[];
  for(let t=0;t<35.5;t+=.05) emitted.push(...queue.take(t));
  assert.equal(emitted.length,1400);
  assert.deepEqual(emitted.map(n=>[n.startSeconds,n.midi]),notes.map(n=>[n.startSeconds,n.midi]));
  assert.equal(queue.position(100),35);
});

test("range start clips a sustained tie and interpolates its current hairpin dynamic", () => {
  const note={partId:"p",midi:60,velocity:40,startSeconds:0,durationSeconds:8,notatedDurationSeconds:8,velocityEnvelope:[{offsetSeconds:0,velocity:40},{offsetSeconds:8,velocity:120}]};
  const clipped=clipPlaybackNote(note,2,6)!;
  assert.equal(clipped.startSeconds,0); assert.equal(clipped.durationSeconds,4);
  assert.equal(clipped.velocity,60);
  assert.deepEqual(clipped.velocityEnvelope,[{offsetSeconds:0,velocity:60},{offsetSeconds:4,velocity:100}]);
  const queue=createPlaybackQueue([note],2,6,true);
  assert.equal(queue.take(0).length,1);
  assert.equal(queue.take(1).length,0,"tied sustain must not retrigger at scheduler windows");
  const next=queue.take(3.8);assert.equal(next.length,1);assert.equal(next[0].startSeconds,4);
  assert.equal(next[0].durationSeconds,4);assert.equal(queue.position(4.1),2.0999999999999996);
  assert.equal(queue.take(4.1).length,0,"next pass must be scheduled only once");
  const resumed=queue.take(13);assert.equal(resumed.length,1);assert.equal(resumed[0].startSeconds,13);assert.equal(resumed[0].velocity,70);
});

test("seeking inside a loop resumes all sustained chord tones at the current dynamic and keeps the original loop", () => {
  const notes = [60, 64, 67].map(midi => ({partId:"p", midi, velocity:40, startSeconds:0, durationSeconds:8, notatedDurationSeconds:8, velocityEnvelope:[{offsetSeconds:0,velocity:40},{offsetSeconds:8,velocity:120}]}));
  const queue = createPlaybackQueue(notes, 0, 8, true);
  const seek = queue.take(3);
  assert.deepEqual(seek.map(note => [note.midi, note.startSeconds, note.durationSeconds, note.velocity]), [[60,3,5,70],[64,3,5,70],[67,3,5,70]]);
  assert.equal(queue.take(3).length, 0, "a frozen clock cannot schedule duplicate attacks");
  assert.equal(queue.take(6).length, 0, "sustained ties continue without retriggering");
  const next = queue.take(7.8);
  assert.deepEqual(next.map(note => [note.midi, note.startSeconds, note.velocity]), [[60,8,40],[64,8,40],[67,8,40]]);
  assert.equal(queue.position(8), 0);
});

test("practice speed scales chord/tie and hairpin timing without changing pitch, velocity or source", () => {
  const note = {partId:"p", midi:64, velocity:60, startSeconds:4, durationSeconds:8, notatedDurationSeconds:8, velocityEnvelope:[{offsetSeconds:0,velocity:60},{offsetSeconds:8,velocity:100}]};
  for (const rate of [.25,.5,.75,1,1.25,1.5,2]) {
    const scaled = playbackNoteAtRate(note, rate);
    assert.equal(scaled.startSeconds, 4/rate); assert.equal(scaled.durationSeconds, 8/rate);
    assert.equal(scaled.midi,64); assert.equal(scaled.velocity,60);
    assert.deepEqual(scaled.velocityEnvelope,[{offsetSeconds:0,velocity:60},{offsetSeconds:8/rate,velocity:100}]);
  }
  assert.equal(note.durationSeconds,8); assert.equal(note.velocityEnvelope[1].offsetSeconds,8);
  assert.throws(()=>playbackNoteAtRate(note,0));
});


test("live speed changes retain sounding chord oscillators and gain without a new attack, including frozen audio clocks and loops", () => {
  let now = 0;
  const nodes: { starts: number[]; stops: number[]; gainCalls: string[]; frequency: {value:number} }[] = [];
  let latest: typeof nodes[number];
  const context = {
    get currentTime() { return now; },
    createOscillator() {
      latest = {starts:[],stops:[],gainCalls:[],frequency:{value:0}}; nodes.push(latest);
      const node = latest;
      return { frequency:node.frequency, type:"sine", start(t:number){node.starts.push(t);}, stop(t:number){node.stops.push(t);}, connect(gain:unknown){return gain;}, disconnect(){}, onended:null };
    },
    createGain() {
      const node=latest;
      return {connect(){return {};},disconnect(){},gain:{setValueAtTime(){node.gainCalls.push("attack");}, exponentialRampToValueAtTime(){node.gainCalls.push("ramp");},linearRampToValueAtTime(){node.gainCalls.push("linear");},cancelAndHoldAtTime(){node.gainCalls.push("hold");}}};
    },
  };
  const notes=[60,64,67].map(midi=>({partId:"p",midi,velocity:60,startSeconds:0,durationSeconds:8,notatedDurationSeconds:8,velocityEnvelope:[{offsetSeconds:0,velocity:60},{offsetSeconds:8,velocity:100}]}));
  const live=createLivePlayback(context as unknown as AudioContext, {} as AudioNode, notes,0,8,true,1,0,new Map());
  live.schedule(); assert.equal(nodes.length,3);
  now=2.08; const position=live.position(); live.setRate(.5);
  assert.equal(live.position(),position); assert.equal(nodes.length,3);
  for(const node of nodes){assert.equal(node.starts.length,1);assert.equal(node.gainCalls.filter(call=>call==="attack").length,1);assert.equal(node.gainCalls.filter(call=>call==="hold").length,1);assert.ok(Math.abs(node.stops.at(-1)!-14.08)<1e-9);}
  // A paused AudioContext has a frozen currentTime; repeated changes must not advance it.
  live.setRate(2); assert.equal(live.position(),position); assert.equal(nodes.length,3);
  now=3.08; assert.ok(Math.abs(live.position()-4)<1e-9);
  live.schedule(); assert.equal(nodes.length,3);
  now=4.9; live.schedule(); assert.equal(nodes.length,6,"only the next loop gets new attacks");
  const future=nodes.slice(3);
  live.setRate(.75);
  assert.equal(nodes.length,6,"future voices cancelled and deferred beyond the new lookahead");
  for(const node of future) assert.equal(node.stops.at(-1),now);
  for(const node of nodes.slice(0,3)) assert.equal(node.starts.length,1);
});


test("metronome follows changing meters and count-in uses the starting measure", () => {
  const score=createScore("solo",{seedDemo:false}); score.tempo=120;
  const ids=score.measureOrder.slice(0,3); score.measureOrder=ids;
  score.measures[ids[0]].time={numerator:3,denominator:4};
  score.measures[ids[1]].time={numerator:6,denominator:8};
  score.measures[ids[2]].time={numerator:2,denominator:2};
  const clicks=metronomeNotes(score);
  assert.deepEqual(clicks.map(n=>n.startSeconds),[0,.5,1,1.5,1.75,2,2.25,2.5,2.75,3,4]);
  assert.ok(clicks.every(n=>n.partId===METRONOME_PART));
  assert.equal(clicks.filter(n=>n.midi===96).length,3);
  assert.equal(countInForPosition(score,1.5).beats,6);
  assert.equal(countInForPosition(score,1.5).duration,1.5);
  assert.equal(countInForPosition(score,3).beatSeconds,1);
});

test("count-in precedes music once, keeps a continuous rate clock, then loops without another count-in", () => {
  let now=0;
  const starts: {frequency:number,time:number}[]=[];
  const context={get currentTime(){return now;},createOscillator(){const frequency={value:0};return {frequency,type:"sine",onended:null,connect(gain:unknown){return gain;},disconnect(){},start(time:number){starts.push({frequency:frequency.value,time});},stop(){}};},createGain(){return {connect(){return {};},disconnect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},cancelAndHoldAtTime(){}}};}};
  const note={partId:"p",midi:60,velocity:80,startSeconds:0,durationSeconds:1.8,notatedDurationSeconds:2};
  const count={duration:2,notes:[0,.5,1,1.5].map(startSeconds=>({...note,partId:METRONOME_PART,midi:96,startSeconds,durationSeconds:.045,notatedDurationSeconds:.045}))};
  const live=createLivePlayback(context as unknown as AudioContext,{} as AudioNode,[note],0,2,true,1,0,new Map(),count);
  live.schedule(); assert.equal(starts.length,1); assert.equal(live.elapsed(),-2);assert.equal(live.position(),0);
  now=.58;live.schedule();const position=live.elapsed();live.setRate(.5);assert.equal(live.elapsed(),position);
  for(now=.68;now<7;now+=.1) live.schedule();
  const music=starts.filter(n=>Math.abs(n.frequency-261.625565)<.001);
  assert.equal(music.length,1);assert.ok(Math.abs(music[0].time-3.58)<1e-8);
  assert.equal(starts.filter(n=>n.frequency>2000).length,4,"only one bar of count-in clicks");
  now=7.4;live.schedule();assert.equal(starts.filter(n=>Math.abs(n.frequency-261.625565)<.001).length,2);
  assert.equal(starts.filter(n=>n.frequency>2000).length,4);
});

test("metronome and count-in route to independent click gains without touching music voices", () => {
  let now=0;
  const destinations: unknown[]=[];
  const context={get currentTime(){return now;},createOscillator(){return {frequency:{value:0},type:"sine",onended:null,connect(gain:unknown){return gain;},disconnect(){},start(){},stop(){}};},createGain(){return {connect(target:unknown){destinations.push(target);return target;},disconnect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},cancelAndHoldAtTime(){}}};}};
  const music={} as AudioNode, metro={} as AudioNode, count={} as AudioNode;
  const note={partId:"p",midi:60,velocity:80,startSeconds:0,durationSeconds:2,notatedDurationSeconds:2};
  const click={...note,partId:METRONOME_PART,midi:96,durationSeconds:.045,notatedDurationSeconds:.045};
  const live=createLivePlayback(context as unknown as AudioContext,music,[note,click],0,2,true,1,0,new Map(),{duration:1,notes:[click]},{metronome:metro,countIn:count});
  live.schedule(); assert.deepEqual(destinations,[count]);
  now=1.08;live.schedule();assert.deepEqual(destinations,[count,music,metro]);
  now=1.5;live.setRate(.5);
  assert.equal(destinations.filter(target=>target===music).length,1,"click controls and rate changes keep the sustained music path intact");
});

test("each-loop count-in separates passes, preserves score position, and retimes the remaining count", () => {
  let now=0;
  const starts:{frequency:number,time:number}[]=[];
  const context={get currentTime(){return now;},createOscillator(){const frequency={value:0};return {frequency,type:"sine",onended:null,connect(gain:unknown){return gain;},disconnect(){},start(time:number){starts.push({frequency:frequency.value,time});},stop(){}};},createGain(){return {connect(){return {};},disconnect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},cancelAndHoldAtTime(){}}};}};
  const note={partId:"p",midi:60,velocity:80,startSeconds:10,durationSeconds:2,notatedDurationSeconds:2};
  const count={duration:1.5,notes:[0,.5,1].map(startSeconds=>({...note,partId:METRONOME_PART,midi:96,startSeconds,durationSeconds:.045,notatedDurationSeconds:.045}))};
  const live=createLivePlayback(context as unknown as AudioContext,{} as AudioNode,[note],10,12,true,1,0,new Map(),count,undefined,count);
  live.schedule(); assert.deepEqual(live.countInProgress(),{bar:1,bars:1,beat:1,beats:3});
  for(now=.18;now<4.08;now+=.1) live.schedule();
  now=4.08;live.schedule();assert.equal(live.position(),10);assert.deepEqual(live.countInProgress(),{bar:1,bars:1,beat:2,beats:3});
  live.setRate(2); assert.equal(live.position(),10); assert.deepEqual(live.countInProgress(),{bar:1,bars:1,beat:2,beats:3});
  now=4.4;live.schedule();
  const music=starts.filter(n=>Math.abs(n.frequency-261.625565)<.001);
  assert.equal(music.length,2);assert.ok(Math.abs(music[0].time-1.58)<1e-8);assert.ok(Math.abs(music[1].time-4.58)<1e-8);
  now=4.68;assert.equal(live.countInProgress(),null);assert.ok(Math.abs(live.position()-10.2)<1e-8);
});

test("live loop toggles preserve current voices, finish an active count, and handle paused speed changes", () => {
  let now=0;
  const nodes:{frequency:{value:number};starts:number[];stops:number[]}[]=[];
  const context={get currentTime(){return now;},createOscillator(){const node={frequency:{value:0},starts:[] as number[],stops:[] as number[]};nodes.push(node);return {...node,type:"sine",onended:null,connect(gain:unknown){return gain;},disconnect(){},start(t:number){node.starts.push(t);},stop(t:number){node.stops.push(t);}};},createGain(){return {connect(){return {};},disconnect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},cancelAndHoldAtTime(){}}};}};
  const note={partId:"p",midi:60,velocity:80,startSeconds:0,durationSeconds:2,notatedDurationSeconds:2};
  const count={duration:1,notes:[0,.5].map(startSeconds=>({...note,partId:METRONOME_PART,midi:96,startSeconds,durationSeconds:.045,notatedDurationSeconds:.045}))};
  const live=createLivePlayback(context as unknown as AudioContext,{} as AudioNode,[note],0,2,true,1,0,new Map());
  live.schedule(); const original=nodes[0];
  now=1.88;live.schedule();const previouslyScheduled=nodes[1];
  live.setRepeatCountIn(count);
  assert.equal(original.starts.length,1);assert.deepEqual(original.stops,[2.08]);
  assert.equal(previouslyScheduled.stops.at(-1),now,"the next pass must not overlap the newly enabled count");
  now=2.38;live.schedule();assert.deepEqual(live.countInProgress(),{bar:1,bars:1,beat:1,beats:2});
  live.setRepeatCountIn(undefined);assert.deepEqual(live.countInProgress(),{bar:1,bars:1,beat:1,beats:2},"turning off must finish a count already started");
  const frozen=live.elapsed();live.setRate(2);assert.equal(live.elapsed(),frozen);
  now=2.7;live.schedule(); now=2.83;assert.equal(live.countInProgress(),null);assert.ok(Math.abs(live.position()-.2)<1e-8);
  now=3.4;live.schedule();
  const audibleMusic=nodes.filter(n=>Math.abs(n.frequency.value-261.625565)<.001 && n.stops.at(-1)!>n.starts[0]).map(n=>n.starts[0]);
  assert.equal(audibleMusic.length,3);
  assert.ok(Math.abs(audibleMusic[1]-2.73)<1e-8);assert.ok(Math.abs(audibleMusic[2]-3.73)<1e-8,"following repeats must have no count gap");
});

test("two-bar count-in accents each bar in different meters and scales with practice speed", () => {
  const score=createScore("solo",{seedDemo:false}); score.tempo=120;
  for (const time of [{numerator:4,denominator:4},{numerator:6,denominator:8},{numerator:2,denominator:2}]) {
    score.measures[score.measureOrder[0]].time=time;
    const single=countInForPosition(score,0), double=countInForPosition(score,0,2);
    assert.equal(double.duration,single.duration*2);
    assert.equal(double.beats,time.numerator*2);
    assert.deepEqual(double.notes.filter(n=>n.midi===96).map(n=>n.startSeconds),[0,single.duration]);
    for(const rate of [.5,2]) assert.equal(playbackNoteAtRate(double.notes[time.numerator],rate).startSeconds,single.duration/rate);
  }
});

test("changing count length finishes the active count before using the new length, even paused and retimed", () => {
  let now=0;
  const context={get currentTime(){return now;},createOscillator(){return {frequency:{value:0},type:"sine",onended:null,connect(gain:unknown){return gain;},disconnect(){},start(){},stop(){}};},createGain(){return {connect(){return {};},disconnect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},cancelAndHoldAtTime(){}}};}};
  const score=createScore("solo",{seedDemo:false});score.tempo=120;score.measures[score.measureOrder[0]].time={numerator:6,denominator:8};
  const single=countInForPosition(score,0), double=countInForPosition(score,0,2);
  const live=createLivePlayback(context as unknown as AudioContext,{} as AudioNode,[],0,2,true,1,0,new Map(),double,undefined,single);
  live.schedule();live.setRepeatCountIn(double);
  assert.deepEqual(live.countInProgress(),{bar:1,bars:2,beat:1,beats:6},"initial count is immutable");
  now=5.33;live.schedule();assert.deepEqual(live.countInProgress(),{bar:1,bars:2,beat:2,beats:6});
  live.setRepeatCountIn(single);live.setRepeatCountIn(double);live.setRepeatCountIn(single);
  const frozen=live.elapsed();live.setRate(2);assert.equal(live.elapsed(),frozen);
  assert.deepEqual(live.countInProgress(),{bar:1,bars:2,beat:2,beats:6},"active two bars finish after repeated edits");
  now=6.83;live.schedule();assert.equal(live.countInProgress(),null);
  now=7.83;live.schedule();assert.deepEqual(live.countInProgress(),{bar:1,bars:1,beat:2,beats:6},"next gap uses one bar");
});


test("count-in display resets beats at each bar and keeps active meter through rate, pause and loops", () => {
  let now=0;
  const context={get currentTime(){return now;},createOscillator(){return {frequency:{value:0},type:"sine",onended:null,connect(gain:unknown){return gain;},disconnect(){},start(){},stop(){}};},createGain(){return {connect(){return {};},disconnect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},cancelAndHoldAtTime(){}}};}} as unknown as AudioContext;
  const score=createScore("solo",{seedDemo:false});score.tempo=60;
  score.measures[score.measureOrder[0]].time={numerator:6,denominator:8};
  const count=countInForPosition(score,0,2);
  const live=createLivePlayback(context,{} as AudioNode,[],0,3,true,1,0,new Map(),count,undefined,count);
  assert.deepEqual(live.countInProgress(),{bar:1,bars:2,beat:1,beats:6});
  now=2.83;assert.deepEqual(live.countInProgress(),{bar:1,bars:2,beat:6,beats:6});
  now=3.08;assert.deepEqual(live.countInProgress(),{bar:2,bars:2,beat:1,beats:6});
  // Frozen context models pause; progress reads must not advance the counter.
  assert.deepEqual(live.countInProgress(),{bar:2,bars:2,beat:1,beats:6});
  now=6.08;assert.equal(live.countInProgress(),null);
  now=9.08;assert.deepEqual(live.countInProgress(),{bar:1,bars:2,beat:1,beats:6});
  now=12.08;assert.deepEqual(live.countInProgress(),{bar:2,bars:2,beat:1,beats:6});
  live.setRate(2);assert.deepEqual(live.countInProgress(),{bar:2,bars:2,beat:1,beats:6});
  now=12.33;assert.deepEqual(live.countInProgress(),{bar:2,bars:2,beat:2,beats:6});
});

test("silent visual metronome shares the rate, pause and loop clock and denominator beats", () => {
  const score=createScore("solo",{seedDemo:false});score.tempo=60;
  for(const id of score.measureOrder) score.measures[id].time={numerator:6,denominator:8};
  let now=0;
  // No sound sources: the guide still advances from the transport clock.
  const context={get currentTime(){return now;}} as AudioContext;
  const live=createLivePlayback(context,{} as AudioNode,[],0,6,true,1,0,new Map());
  const position=()=>locatePlaybackPosition(score,live.position());
  assert.equal(position()?.beat,1);
  now=.83;assert.equal(position()?.beat,2);
  const pausedPosition=position();live.setRate(2);assert.deepEqual(position(),pausedPosition);
  now=1.955;assert.equal(position()?.measureNumber,2);assert.equal(position()?.beat,1);
  now=2.705;assert.equal(position()?.beat,4);
  now=3.455;assert.equal(position()?.measureNumber,1);assert.equal(position()?.beat,1);
});

// Practice reset history is separate from score undo and survives a reload.
import { PRACTICE_DEFAULTS, isDefaultPractice, persistPracticeSettings, readPracticeResetUndo, discardPracticeResetUndo, type PracticeSettings } from "../lib/practice-settings";

test("practice reset and undo persist exact preferences without touching the score, tempo or follow setting", () => {
  const before: PracticeSettings={rate:.75,metronome:true,volume:35,countIn:true,repeatCountIn:true,bars:2,beatGuide:false};
  const data=new Map<string,string>([["score","original score and tempo"],["garak.playback-follow","off"]]);
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  persistPracticeSettings(storage,PRACTICE_DEFAULTS,before);
  assert.equal(isDefaultPractice(PRACTICE_DEFAULTS),true);assert.equal(isDefaultPractice(before),false);
  const recovered=readPracticeResetUndo(storage);assert.deepEqual(recovered,before);
  persistPracticeSettings(storage,recovered!,null);
  assert.equal(readPracticeResetUndo(storage),null);
  assert.equal(data.get("garak.playback-speed"),"0.75");assert.equal(data.get("garak.practice.click-volume"),"35");
  assert.equal(data.get("garak.practice.count-in-bars"),"2");assert.equal(data.get("garak.practice.beat-guide"),"off");
  assert.equal(data.get("score"),"original score and tempo");assert.equal(data.get("garak.playback-follow"),"off");
});

test("practice undo rejects malformed snapshots and expires when preferences are manually changed", () => {
  const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  const before={...PRACTICE_DEFAULTS,rate:2};
  persistPracticeSettings(storage,PRACTICE_DEFAULTS,before);
  const valid=data.get("garak.practice.reset-undo")!;
  for(const raw of ["broken", "null", JSON.stringify({version:1,settings:{...before,volume:-1}}),JSON.stringify({version:1,settings:{...before,rate:99}}),JSON.stringify({version:1,settings:{...before,countIn:"yes"}})]) {
    data.set("garak.practice.reset-undo",raw);assert.equal(readPracticeResetUndo(storage),null);
  }
  data.set("garak.practice.reset-undo",valid);data.set("garak.practice.click-volume","30");assert.equal(readPracticeResetUndo(storage),null);
  data.set("garak.practice.click-volume","60");assert.deepEqual(readPracticeResetUndo(storage),before);
  discardPracticeResetUndo(storage);assert.equal(readPracticeResetUndo(storage),null);
});

test("failed practice preference writes cannot leave an obsolete undo available on reopen", () => {
  const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  persistPracticeSettings(storage,PRACTICE_DEFAULTS,{...PRACTICE_DEFAULTS,rate:2});
  const failing={...storage,setItem(){throw new Error("storage full");}};
  assert.throws(()=>persistPracticeSettings(failing,{...PRACTICE_DEFAULTS,rate:.5},null),/storage full/);
  assert.equal(readPracticeResetUndo(storage),null);
});
