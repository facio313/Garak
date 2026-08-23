import assert from "node:assert/strict";
import test from "node:test";
import { FAMILIES, FAMILY_COLORS, INSTRUMENTS, SCORE_TEMPLATES, getInstrument } from "../lib/music/catalog";
import { keySignaturesEqual, resolveMeasureAccidentals, timeSignaturesEqual } from "../lib/music/engraving";
import { ARTICULATION_VELOCITY_BONUSES, collectPlaybackNotes, encodeMidiVariableLength, scoreToMidi, scoreToMusicXML, selectPlaybackWindow, STACCATO_GATE_RATIO } from "../lib/music/exporters";
import { KEY_SIGNATURES, concertToWrittenKey, createWrittenKeySignatureSnapshot, fifthsToVexFlowKey, keySignatureAlterForStep, keySignatureName, writtenKeyForPart } from "../lib/music/key-signatures";
import { getDefaultBeamGroups, getFullMeasureDuration } from "../lib/music/meter";
import { ARTICULATIONS, DEFAULT_MIDI_VELOCITY, DURATION_LABELS, DYNAMIC_MARKINGS, DYNAMIC_VELOCITIES, TICKS_PER_QUARTER, durationTicks, eventCount, getPrimaryVoice, measureCapacity, nextAugmentationDotCount, validateScore, voiceTicks, writtenToSounding } from "../lib/music/model";
import type { MusicEvent, Pitch, ScoreDocument, ScoreNote } from "../lib/music/model";
import { addChordTone, addInstrument, appendEvent, appendMeasure, createScore, findEventTargetMeasureId, makeEvent, removeInstrument, removeLastChordTone, removeLastEvent, removeLastMeasure, setKeyFromMeasure, setLastEventDynamic, setLastNoteArticulation, setMeasureKey, setScoreKey, setTimeFromMeasure, toggleTieLastTwo } from "../lib/music/score";

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
  assert.match(rejected.error ?? "", /3840 ticks.*2880/);
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

test("event entry rejects a duration longer than the inherited meter without appending an overflowing measure", () => {
  const score = createScore("solo", { seedDemo: false });
  score.measureOrder.forEach((measureId) => { score.measures[measureId].time = { numerator: 6, denominator: 8 }; });
  const result = appendEvent(score, score.parts[0].id, makeEvent({ id: "too-long", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 1, dots: 0 }, rest: false }));
  assert.equal(result.score, score);
  assert.equal(result.measureId, null);
  assert.match(result.error ?? "", /longer than a 6\/8 measure/);
  assert.equal(result.score.measureOrder.length, 4);
  assert.equal(eventCount(result.score), 0);
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

test("bounded live playback is chronological and fair across simultaneous parts", () => {
  const input = ["part-a", "part-b"].flatMap((partId) => Array.from({ length: 350 }, (_, onset) => ({
    partId,
    midi: partId === "part-a" ? 60 : 67,
    velocity: DEFAULT_MIDI_VELOCITY,
    startSeconds: onset,
    durationSeconds: .5,
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
