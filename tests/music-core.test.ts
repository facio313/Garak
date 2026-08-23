import assert from "node:assert/strict";
import test from "node:test";
import { FAMILIES, FAMILY_COLORS, INSTRUMENTS, SCORE_TEMPLATES, getInstrument } from "../lib/music/catalog";
import { keySignaturesEqual, resolveMeasureAccidentals, timeSignaturesEqual } from "../lib/music/engraving";
import { collectPlaybackNotes, scoreToMidi, scoreToMusicXML } from "../lib/music/exporters";
import { KEY_SIGNATURES, concertToWrittenKey, createWrittenKeySignatureSnapshot, fifthsToVexFlowKey, keySignatureAlterForStep, keySignatureName, writtenKeyForPart } from "../lib/music/key-signatures";
import { getDefaultBeamGroups, getFullMeasureDuration } from "../lib/music/meter";
import { TICKS_PER_QUARTER, durationTicks, eventCount, getPrimaryVoice, measureCapacity, validateScore, voiceTicks, writtenToSounding } from "../lib/music/model";
import type { MusicEvent, Pitch, ScoreDocument } from "../lib/music/model";
import { addInstrument, appendEvent, appendMeasure, createScore, findEventTargetMeasureId, makeEvent, removeLastEvent, removeLastMeasure, setMeasureKey, setScoreKey, toggleTieLastTwo } from "../lib/music/score";

test("duration and meter arithmetic stays exact", () => {
  assert.equal(durationTicks({ base: 1, dots: 0 }), TICKS_PER_QUARTER * 4);
  assert.equal(durationTicks({ base: 4, dots: 1 }), TICKS_PER_QUARTER * 1.5);
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

test("MusicXML part-list assigns melodic channels without using percussion channel 10", () => {
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
  assert.ok(score.parts.slice(0, 10).every((part) => part.instrument.family !== "Percussion"));
  assert.equal(score.parts[10].instrument.family, "Percussion");
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

test("MusicXML emits key mode and time changes only at their measure boundaries", () => {
  const score = createScore("solo", { seedDemo: false });
  const [, secondId, thirdId, fourthId] = score.measureOrder;
  score.measures[secondId].key = { fifths: 0, mode: "minor" };
  score.measures[thirdId].key = { fifths: 0, mode: "minor" };
  score.measures[thirdId].time = { numerator: 6, denominator: 8 };
  score.measures[fourthId].key = { fifths: 0, mode: "minor" };
  score.measures[fourthId].time = { numerator: 6, denominator: 8 };

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
  score.parts[0].staves.forEach((staff) => {
    staff.measures[previousMeasureId].voices.push({ id: `${staff.id}-${previousMeasureId}-v2`, events: [] });
  });

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
