import assert from "node:assert/strict";
import test from "node:test";
import { INSTRUMENTS } from "../lib/music/catalog";
import { importMusicXML } from "../lib/music/importers";
import type { DurationValue, NoteEvent, Pitch, ScoreDocument } from "../lib/music/model";
import { SCORE_VALIDATION_LIMITS, getPrimaryVoice, measureCapacity, validateScore } from "../lib/music/model";
import { addInstrument, createScore } from "../lib/music/score";

const MINIMAL_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Validator import</work-title></work>
  <part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>
  <part id="P1"><measure number="0">
    <attributes><divisions>480</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
  </measure></part>
</score-partwise>`;

function freshScore(): ScoreDocument {
  return createScore("solo", { seedDemo: false });
}

function firstVoice(score: ScoreDocument) {
  return getPrimaryVoice(score.parts[0], score.measureOrder[0]);
}

function noteEvent(
  eventId: string,
  noteId: string,
  pitch: Pitch = { step: "C", alter: 0, octave: 4 },
  duration: DurationValue = { base: 4, dots: 0 },
): NoteEvent {
  return {
    id: eventId,
    kind: "note",
    duration,
    notes: [{ id: noteId, pitch: { ...pitch }, accidentalDisplay: "auto" }],
  };
}

function tieFixture(): ScoreDocument {
  const score = freshScore();
  firstVoice(score).events.push(
    noteEvent("tie-event-c1", "tie-note-c1"),
    noteEvent("tie-event-c2", "tie-note-c2"),
    noteEvent("tie-event-d", "tie-note-d", { step: "D", alter: 0, octave: 4 }),
  );
  return score;
}

function oneStaffScore(): ScoreDocument {
  const score = freshScore();
  score.parts = [score.parts[0]];
  score.parts[0].staves = [score.parts[0].staves[0]];
  return score;
}

function scoreWithMeters(times: Array<{ numerator: number; denominator: number }>): ScoreDocument {
  const score = oneStaffScore();
  const staff = score.parts[0].staves[0];
  score.measureOrder = [];
  score.measures = {};
  staff.measures = {};
  times.forEach((time, index) => {
    const measureId = `limit-measure-${index + 1}`;
    score.measureOrder.push(measureId);
    score.measures[measureId] = {
      id: measureId,
      number: index + 1,
      time: { ...time },
      key: { fifths: 0, mode: "major" },
    };
    staff.measures[measureId] = {
      voices: [{ id: `limit-voice-${index + 1}`, events: [] }],
    };
  });
  return score;
}

function scoreAtMaterialLimits(): ScoreDocument {
  const eventsPerMeasure = 64;
  const measureCount = Math.ceil(SCORE_VALIDATION_LIMITS.events / eventsPerMeasure);
  const score = scoreWithMeters(Array.from({ length: measureCount }, () => ({ numerator: 4, denominator: 4 })));
  for (let eventIndex = 0; eventIndex < SCORE_VALIDATION_LIMITS.events; eventIndex += 1) {
    const event = noteEvent(
      `material-event-${eventIndex}`,
      `material-note-c-${eventIndex}`,
      { step: "C", alter: 0, octave: 4 },
      { base: 64, dots: 0 },
    );
    event.notes.push({
      id: `material-note-e-${eventIndex}`,
      pitch: { step: "E", alter: 0, octave: 4 },
      accidentalDisplay: "auto",
    });
    const measureId = score.measureOrder[Math.floor(eventIndex / eventsPerMeasure)];
    getPrimaryVoice(score.parts[0], measureId).events.push(event);
  }
  for (let eventIndex = 0; eventIndex < SCORE_VALIDATION_LIMITS.events; eventIndex += 2) {
    score.ties.push(
      {
        id: `material-tie-c-${eventIndex}`,
        fromNoteId: `material-note-c-${eventIndex}`,
        toNoteId: `material-note-c-${eventIndex + 1}`,
      },
      {
        id: `material-tie-e-${eventIndex}`,
        fromNoteId: `material-note-e-${eventIndex}`,
        toNoteId: `material-note-e-${eventIndex + 1}`,
      },
    );
  }
  return score;
}

test("generated and imported schema-v1 scores validate without mutation", () => {
  const fullCatalog = INSTRUMENTS.reduce(
    (score, instrument) => addInstrument(score, instrument.catalogId),
    createScore("solo", { seedDemo: false }),
  );
  const scores = [
    createScore("solo", { seedDemo: false }),
    createScore("quartet", { seedDemo: true }),
    createScore("orchestra", { seedDemo: true }),
    fullCatalog,
    importMusicXML(MINIMAL_MUSICXML).score,
  ];
  for (const score of scores) {
    const snapshot = structuredClone(score);
    assert.deepEqual(validateScore(score), []);
    assert.deepEqual(score, snapshot, "validation must be read-only");
  }
});

test("malformed unknown values and hostile objects always return errors instead of throwing", () => {
  const throwingGetter = Object.defineProperty({}, "format", {
    enumerable: true,
    get() { throw new Error("unreadable"); },
  });
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  const values: unknown[] = [
    null,
    undefined,
    false,
    42,
    "score",
    Symbol("score"),
    [],
    {},
    Object.create(null),
    { format: "garak-score", schemaVersion: 1, measureOrder: [Symbol("measure")] },
    throwingGetter,
    revocable.proxy,
  ];

  for (const value of values) {
    let result: string[] | undefined;
    assert.doesNotThrow(() => { result = validateScore(value); });
    assert.ok(result && result.length > 0);
    assert.ok(result.every((message) => typeof message === "string" && message.length > 0));
  }
});

test("measure order, metadata, meter, key, and measure numbers are structurally checked", () => {
  const cases: Array<{ name: string; mutate: (score: ScoreDocument) => void; expected: RegExp }> = [
    {
      name: "duplicate order",
      mutate: (score) => { score.measureOrder.push(score.measureOrder[0]); },
      expected: /measure order contains duplicate ID/i,
    },
    {
      name: "missing ordered measure",
      mutate: (score) => { delete score.measures[score.measureOrder[0]]; },
      expected: /missing measure/i,
    },
    {
      name: "mismatched metadata ID",
      mutate: (score) => { score.measures[score.measureOrder[0]].id = "another-measure"; },
      expected: /store the same ID/i,
    },
    {
      name: "negative measure number",
      mutate: (score) => { score.measures[score.measureOrder[0]].number = -1; },
      expected: /invalid measure number/i,
    },
    {
      name: "fractional measure number",
      mutate: (score) => { score.measures[score.measureOrder[0]].number = 1.5; },
      expected: /invalid measure number/i,
    },
    {
      name: "zero numerator",
      mutate: (score) => { score.measures[score.measureOrder[0]].time.numerator = 0; },
      expected: /invalid time signature/i,
    },
    {
      name: "MIDI-unsafe numerator",
      mutate: (score) => { score.measures[score.measureOrder[0]].time.numerator = 256; },
      expected: /1 through 255/i,
    },
    {
      name: "zero denominator",
      mutate: (score) => { score.measures[score.measureOrder[0]].time.denominator = 0; },
      expected: /invalid time signature/i,
    },
    {
      name: "fractional denominator",
      mutate: (score) => { score.measures[score.measureOrder[0]].time.denominator = 4.5; },
      expected: /invalid time signature/i,
    },
    {
      name: "non-binary beat type",
      mutate: (score) => { score.measures[score.measureOrder[0]].time = { numerator: 2, denominator: 3 }; },
      expected: /power of two/i,
    },
    {
      name: "fractional tick capacity",
      mutate: (score) => { score.measures[score.measureOrder[0]].time = { numerator: 1, denominator: 8192 }; },
      expected: /exact integer tick count/i,
    },
    {
      name: "unsupported key",
      mutate: (score) => { score.measures[score.measureOrder[0]].key = { fifths: 8, mode: "major" }; },
      expected: /invalid key signature/i,
    },
    {
      name: "MIDI-unsafe slow tempo",
      mutate: (score) => { score.tempo = 1; },
      expected: /30 through 300 BPM/i,
    },
    {
      name: "unsupported fast tempo",
      mutate: (score) => { score.tempo = 301; },
      expected: /30 through 300 BPM/i,
    },
    {
      name: "fractional tempo",
      mutate: (score) => { score.tempo = 96.5; },
      expected: /tempo must be an integer/i,
    },
  ];

  for (const scenario of cases) {
    const score = freshScore();
    scenario.mutate(score);
    assert.match(validateScore(score).join("\n"), scenario.expected, scenario.name);
  }

  const pickup = freshScore();
  pickup.measures[pickup.measureOrder[0]].number = 0;
  assert.deepEqual(validateScore(pickup), [], "schema-v1 permits a pickup measure numbered zero");
});

test("every ordered staff measure has a non-empty voice structure", () => {
  const missing = freshScore();
  delete missing.parts[0].staves[0].measures[missing.measureOrder[1]];
  assert.match(validateScore(missing).join("\n"), /missing ordered measure 2/i);

  const noVoices = freshScore();
  noVoices.parts[0].staves[0].measures[noVoices.measureOrder[0]].voices = [];
  assert.match(validateScore(noVoices).join("\n"), /must contain at least one voice/i);

  const secondaryVoice = freshScore();
  secondaryVoice.parts[0].staves[0].measures[secondaryVoice.measureOrder[0]].voices.push({
    id: "silently-dropped-secondary-voice",
    events: [],
  });
  assert.match(validateScore(secondaryVoice).join("\n"), /exactly one editable voice/i);

  const malformedEvents = freshScore();
  (firstVoice(malformedEvents) as unknown as { events: unknown }).events = "not-an-array";
  assert.match(validateScore(malformedEvents).join("\n"), /events must be an array/i);
});

test("part, staff, voice, event, note, and tie IDs share one global namespace", () => {
  const duplicateParts = createScore("quartet", { seedDemo: false });
  duplicateParts.parts[1].id = duplicateParts.parts[0].id;
  assert.match(validateScore(duplicateParts).join("\n"), /duplicate ID/i);

  const duplicateStaves = freshScore();
  duplicateStaves.parts[0].staves[1].id = duplicateStaves.parts[0].staves[0].id;
  assert.match(validateScore(duplicateStaves).join("\n"), /duplicate ID/i);

  const duplicateVoices = freshScore();
  const voice = firstVoice(duplicateVoices);
  duplicateVoices.parts[0].staves[0].measures[duplicateVoices.measureOrder[0]].voices.push({ id: voice.id, events: [] });
  assert.match(validateScore(duplicateVoices).join("\n"), /duplicate ID/i);

  const duplicateEvents = freshScore();
  firstVoice(duplicateEvents).events.push(
    { id: "same-event", kind: "rest", duration: { base: 4, dots: 0 } },
    { id: "same-event", kind: "rest", duration: { base: 4, dots: 0 } },
  );
  assert.match(validateScore(duplicateEvents).join("\n"), /duplicate ID/i);

  const duplicateNotes = freshScore();
  const chord = noteEvent("chord-event", "same-note");
  chord.notes.push({ id: "same-note", pitch: { step: "E", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  firstVoice(duplicateNotes).events.push(chord);
  assert.match(validateScore(duplicateNotes).join("\n"), /duplicate ID/i);

  const crossKindCollision = tieFixture();
  crossKindCollision.ties.push({ id: crossKindCollision.parts[0].id, fromNoteId: "tie-note-c1", toNoteId: "tie-note-c2" });
  assert.match(validateScore(crossKindCollision).join("\n"), /duplicate ID/i);

  const duplicateTies = tieFixture();
  duplicateTies.ties.push(
    { id: "same-tie", fromNoteId: "tie-note-c1", toNoteId: "tie-note-c2" },
    { id: "same-tie", fromNoteId: "tie-note-c2", toNoteId: "tie-note-c1" },
  );
  assert.match(validateScore(duplicateTies).join("\n"), /duplicate ID/i);
});

test("duration validation accepts the complete supported domain and rejects malformed rhythm before arithmetic", () => {
  const supported = freshScore();
  firstVoice(supported).events.push(
    { id: "supported-32", kind: "rest", duration: { base: 32, dots: 2 } },
    { id: "supported-64", kind: "rest", duration: { base: 64, dots: 2 } },
  );
  assert.deepEqual(validateScore(supported), []);

  const cases: Array<[string, unknown, unknown]> = [
    ["zero base", 0, 0],
    ["non-binary base", 3, 0],
    ["fractional base", 4.5, 0],
    ["NaN base", Number.NaN, 0],
    ["too many dots", 4, 3],
    ["negative dots", 4, -1],
    ["string dots", 4, "1"],
  ];
  for (const [name, base, dots] of cases) {
    const score = freshScore();
    const malformed = {
      id: `bad-duration-${name}`,
      kind: "rest",
      duration: { base, dots },
    };
    (firstVoice(score).events as unknown[]).push(malformed);
    assert.doesNotThrow(() => validateScore(score), name);
    assert.match(validateScore(score).join("\n"), /invalid duration/i, name);
  }
});

test("note, pitch, accidental, event-kind, and rest schemas reject malformed values", () => {
  const emptyChord = freshScore();
  const empty = noteEvent("empty-note-event", "unused-note");
  empty.notes = [];
  firstVoice(emptyChord).events.push(empty);
  assert.match(validateScore(emptyChord).join("\n"), /at least one note/i);

  const duplicateWrittenPitch = freshScore();
  const doubled = noteEvent("doubled-pitch-event", "doubled-pitch-note-1");
  doubled.notes.push({
    id: "doubled-pitch-note-2",
    pitch: { step: "C", alter: 0, octave: 4 },
    accidentalDisplay: "force",
  });
  firstVoice(duplicateWrittenPitch).events.push(doubled);
  assert.match(validateScore(duplicateWrittenPitch).join("\n"), /duplicates written pitch.*within one chord event/i);

  const pitchCases: Array<[string, Partial<Pitch>]> = [
    ["step", { step: "H" as Pitch["step"] }],
    ["alter", { alter: 3 as Pitch["alter"] }],
    ["fractional octave", { octave: 4.5 }],
    ["octave range", { octave: 10 }],
  ];
  for (const [name, change] of pitchCases) {
    const score = freshScore();
    const event = noteEvent(`bad-pitch-event-${name}`, `bad-pitch-note-${name}`);
    Object.assign(event.notes[0].pitch, change);
    firstVoice(score).events.push(event);
    assert.match(validateScore(score).join("\n"), /invalid written pitch/i, name);
  }

  const accidental = freshScore();
  const accidentalEvent = noteEvent("bad-accidental-event", "bad-accidental-note");
  (accidentalEvent.notes[0] as unknown as { accidentalDisplay: unknown }).accidentalDisplay = "always";
  firstVoice(accidental).events.push(accidentalEvent);
  assert.match(validateScore(accidental).join("\n"), /invalid accidental display mode/i);

  const dynamic = freshScore();
  const dynamicEvent = noteEvent("bad-dynamic-event", "bad-dynamic-note");
  (dynamicEvent as unknown as { dynamic: unknown }).dynamic = "fortissimo";
  firstVoice(dynamic).events.push(dynamicEvent);
  assert.match(validateScore(dynamic).join("\n"), /invalid dynamic marking/i);

  const pitchedRest = freshScore();
  const restWithPitch = {
    id: "pitched-rest",
    kind: "rest",
    duration: { base: 4, dots: 0 },
    pitch: { step: "C", alter: 0, octave: 4 },
  };
  (firstVoice(pitchedRest).events as unknown[]).push(restWithPitch);
  assert.match(validateScore(pitchedRest).join("\n"), /rest and must not contain pitch data/i);

  const restWithNotes = freshScore();
  (firstVoice(restWithNotes).events as unknown[]).push({
    id: "rest-with-notes",
    kind: "rest",
    duration: { base: 4, dots: 0 },
    notes: [{ id: "discarded-rest-note", pitch: { step: "C", alter: 0, octave: 4 }, accidentalDisplay: "auto" }],
  });
  assert.match(validateScore(restWithNotes).join("\n"), /rest and must not contain note data/i);

  const noteWithEventPitch = freshScore();
  const eventWithPitch = noteEvent("event-level-pitch", "nested-pitch");
  (eventWithPitch as unknown as { pitch: Pitch }).pitch = { step: "D", alter: 0, octave: 4 };
  firstVoice(noteWithEventPitch).events.push(eventWithPitch);
  assert.match(validateScore(noteWithEventPitch).join("\n"), /note event and must not contain event-level pitch data/i);

  const eventWithLegacyRestFlag = freshScore();
  const legacy = noteEvent("legacy-rest-flag", "legacy-rest-note");
  (legacy as unknown as { rest: boolean }).rest = false;
  firstVoice(eventWithLegacyRestFlag).events.push(legacy);
  assert.match(validateScore(eventWithLegacyRestFlag).join("\n"), /must not contain the legacy rest flag/i);

  const unknownKind = freshScore();
  (firstVoice(unknownKind).events as unknown[]).push({ id: "unknown-event", kind: "dynamic", duration: { base: 4, dots: 0 } });
  assert.match(validateScore(unknownKind).join("\n"), /invalid event kind/i);
});

test("instrument snapshots validate MIDI, clef, strings, and bounded integer transposition", () => {
  const badProgram = freshScore();
  badProgram.parts[0].instrument.midiProgram = 128;
  assert.match(validateScore(badProgram).join("\n"), /invalid instrument snapshot/i);

  const badClef = freshScore();
  badClef.parts[0].instrument.clef = "tab" as never;
  assert.match(validateScore(badClef).join("\n"), /invalid instrument snapshot/i);

  const badString = freshScore();
  badString.parts[0].instrument.catalogId = "";
  assert.match(validateScore(badString).join("\n"), /invalid instrument snapshot/i);

  const unsafeColor = freshScore();
  unsafeColor.parts[0].instrument.color = "url(https://attacker.test/pixel)";
  assert.match(validateScore(unsafeColor).join("\n"), /safe #RRGGBB hexadecimal format/i);

  for (const value of [Number.NaN, 1.5, 97]) {
    const score = freshScore();
    score.parts[0].instrument.transposition.chromatic = value;
    assert.match(validateScore(score).join("\n"), /invalid transposition snapshot/i);
  }
});

test("native strings and generated composite IDs respect inclusive field-specific bounds", () => {
  const exactStrings = oneStaffScore();
  exactStrings.id = "s".repeat(SCORE_VALIDATION_LIMITS.idCharacters);
  exactStrings.metadata.title = "T".repeat(SCORE_VALIDATION_LIMITS.nameCharacters);
  exactStrings.metadata.subtitle = "S".repeat(SCORE_VALIDATION_LIMITS.nameCharacters);
  exactStrings.metadata.composer = "C".repeat(SCORE_VALIDATION_LIMITS.nameCharacters);
  exactStrings.metadata.copyright = "R".repeat(SCORE_VALIDATION_LIMITS.copyrightCharacters);
  exactStrings.updatedAt = "u".repeat(SCORE_VALIDATION_LIMITS.updatedAtCharacters);
  exactStrings.parts[0].name = "P".repeat(SCORE_VALIDATION_LIMITS.nameCharacters);
  exactStrings.parts[0].shortName = "p".repeat(SCORE_VALIDATION_LIMITS.shortNameCharacters);
  exactStrings.parts[0].instrument.catalogId = "i".repeat(SCORE_VALIDATION_LIMITS.idCharacters);
  exactStrings.parts[0].instrument.family = "F".repeat(SCORE_VALIDATION_LIMITS.nameCharacters);
  exactStrings.parts[0].instrument.name = "I".repeat(SCORE_VALIDATION_LIMITS.nameCharacters);
  exactStrings.parts[0].instrument.shortName = "n".repeat(SCORE_VALIDATION_LIMITS.shortNameCharacters);
  exactStrings.parts[0].instrument.color = "#A0b1C2";
  assert.deepEqual(validateScore(exactStrings), []);

  const overlongCases: Array<{ name: string; mutate: (score: ScoreDocument) => void; expected: RegExp }> = [
    {
      name: "score ID",
      mutate: (score) => { score.id = "s".repeat(SCORE_VALIDATION_LIMITS.idCharacters + 1); },
      expected: /score ID exceeds.*256-character safety limit/i,
    },
    {
      name: "title",
      mutate: (score) => { score.metadata.title = "T".repeat(SCORE_VALIDATION_LIMITS.nameCharacters + 1); },
      expected: /score title exceeds.*200-character safety limit/i,
    },
    {
      name: "part name",
      mutate: (score) => { score.parts[0].name = "P".repeat(SCORE_VALIDATION_LIMITS.nameCharacters + 1); },
      expected: /Part 1 name exceeds.*200-character safety limit/i,
    },
    {
      name: "part short name",
      mutate: (score) => { score.parts[0].shortName = "p".repeat(SCORE_VALIDATION_LIMITS.shortNameCharacters + 1); },
      expected: /short name exceeds.*80-character safety limit/i,
    },
    {
      name: "instrument catalog ID",
      mutate: (score) => { score.parts[0].instrument.catalogId = "i".repeat(SCORE_VALIDATION_LIMITS.idCharacters + 1); },
      expected: /instrument catalogId exceeds.*256-character safety limit/i,
    },
    {
      name: "copyright",
      mutate: (score) => { score.metadata.copyright = "R".repeat(SCORE_VALIDATION_LIMITS.copyrightCharacters + 1); },
      expected: /copyright exceeds.*500-character safety limit/i,
    },
  ];
  for (const scenario of overlongCases) {
    const score = oneStaffScore();
    scenario.mutate(score);
    assert.match(validateScore(score).join("\n"), scenario.expected, scenario.name);
  }

  const compositeIds = scoreWithMeters([{ numerator: 4, denominator: 4 }]);
  const voice = firstVoice(compositeIds);
  voice.id = "v".repeat(SCORE_VALIDATION_LIMITS.voiceIdCharacters);
  const from = noteEvent(
    "e".repeat(SCORE_VALIDATION_LIMITS.idCharacters),
    "n".repeat(SCORE_VALIDATION_LIMITS.noteIdCharacters),
  );
  const to = noteEvent(
    "f".repeat(SCORE_VALIDATION_LIMITS.idCharacters),
    "m".repeat(SCORE_VALIDATION_LIMITS.noteIdCharacters),
  );
  voice.events.push(from, to);
  compositeIds.ties.push({
    id: "t".repeat(SCORE_VALIDATION_LIMITS.tieIdCharacters),
    fromNoteId: from.notes[0].id,
    toNoteId: to.notes[0].id,
  });
  assert.deepEqual(validateScore(compositeIds), [], "maximum-size note endpoints and their generated-class tie ID remain valid");

  const overlongVoice = scoreWithMeters([{ numerator: 4, denominator: 4 }]);
  firstVoice(overlongVoice).id = "v".repeat(SCORE_VALIDATION_LIMITS.voiceIdCharacters + 1);
  assert.match(validateScore(overlongVoice).join("\n"), /1,024-character ID safety limit/i);

  const overlongNote = scoreWithMeters([{ numerator: 4, denominator: 4 }]);
  firstVoice(overlongNote).events.push(noteEvent("event-with-long-note", "n".repeat(SCORE_VALIDATION_LIMITS.noteIdCharacters + 1)));
  assert.match(validateScore(overlongNote).join("\n"), /512-character ID safety limit/i);

  const overlongTie = tieFixture();
  overlongTie.ties.push({
    id: "t".repeat(SCORE_VALIDATION_LIMITS.tieIdCharacters + 1),
    fromNoteId: "tie-note-c1",
    toNoteId: "tie-note-c2",
  });
  assert.match(validateScore(overlongTie).join("\n"), /2,048-character ID safety limit/i);
});

test("global structural ceilings are inclusive and reject the first over-limit shape before traversal", () => {
  const exactParts = oneStaffScore();
  (exactParts as unknown as { parts: unknown[] }).parts = Array.from({ length: SCORE_VALIDATION_LIMITS.parts }, () => null);
  assert.doesNotMatch(validateScore(exactParts).join("\n"), /part safety limit/i);

  const overParts = oneStaffScore();
  (overParts as unknown as { parts: unknown[] }).parts = Array.from({ length: SCORE_VALIDATION_LIMITS.parts + 1 }, () => null);
  assert.match(validateScore(overParts).join("\n"), /256-part safety limit/i);

  const exactStaves = oneStaffScore();
  (exactStaves.parts[0] as unknown as { staves: unknown[] }).staves = Array.from({ length: SCORE_VALIDATION_LIMITS.staves }, () => null);
  assert.doesNotMatch(validateScore(exactStaves).join("\n"), /staff safety limit/i);

  const overStaves = oneStaffScore();
  (overStaves.parts[0] as unknown as { staves: unknown[] }).staves = Array.from({ length: SCORE_VALIDATION_LIMITS.staves + 1 }, () => null);
  assert.match(validateScore(overStaves).join("\n"), /512-staff safety limit/i);

  const exactCells = oneStaffScore();
  (exactCells.parts[0] as unknown as { staves: unknown[] }).staves = Array.from({ length: 100 }, () => null);
  exactCells.measureOrder = Array.from({ length: 100 }, (_, index) => `cell-measure-${index}`);
  assert.doesNotMatch(validateScore(exactCells).join("\n"), /staff-by-measure safety limit/i);

  const overCells = oneStaffScore();
  (overCells.parts[0] as unknown as { staves: unknown[] }).staves = Array.from({ length: 100 }, () => null);
  overCells.measureOrder = Array.from({ length: 101 }, (_, index) => `cell-measure-${index}`);
  assert.match(validateScore(overCells).join("\n"), /10,000-cell staff-by-measure safety limit/i);

  const exactVoices = scoreWithMeters([{ numerator: 4, denominator: 4 }]);
  (exactVoices.parts[0].staves[0].measures[exactVoices.measureOrder[0]] as unknown as { voices: unknown[] }).voices =
    Array.from({ length: SCORE_VALIDATION_LIMITS.voices }, () => null);
  assert.doesNotMatch(validateScore(exactVoices).join("\n"), /voice safety limit/i);

  const overVoices = scoreWithMeters([{ numerator: 4, denominator: 4 }]);
  (overVoices.parts[0].staves[0].measures[overVoices.measureOrder[0]] as unknown as { voices: unknown[] }).voices =
    Array.from({ length: SCORE_VALIDATION_LIMITS.voices + 1 }, () => null);
  assert.match(validateScore(overVoices).join("\n"), /10,000-voice safety limit/i);

  const exactMeasures = oneStaffScore();
  (exactMeasures as unknown as { parts: unknown[] }).parts = [null];
  exactMeasures.measureOrder = Array.from({ length: SCORE_VALIDATION_LIMITS.orderedMeasures }, (_, index) => `ordered-measure-${index}`);
  assert.doesNotMatch(validateScore(exactMeasures).join("\n"), /ordered-measure safety limit/i);

  const overMeasures = oneStaffScore();
  overMeasures.measureOrder = Array.from({ length: SCORE_VALIDATION_LIMITS.orderedMeasures + 1 }, (_, index) => `ordered-measure-${index}`);
  assert.match(validateScore(overMeasures).join("\n"), /20,000-ordered-measure safety limit/i);
});

test("materialization ceilings accept exact maxima and reject one-over without invoking an exporter", () => {
  const exact = scoreAtMaterialLimits();
  assert.deepEqual(validateScore(exact), []);

  const finalVoice = getPrimaryVoice(exact.parts[0], exact.measureOrder.at(-1)!);
  finalVoice.events.push({ id: "one-event-over", kind: "rest", duration: { base: 64, dots: 0 } });
  assert.match(validateScore(exact).join("\n"), /50,000-event safety limit/i);
  finalVoice.events.pop();

  const first = firstVoice(exact).events[0];
  assert.equal(first.kind, "note");
  first.notes.push({ id: "one-note-over", pitch: { step: "G", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  assert.match(validateScore(exact).join("\n"), /100,000-note safety limit/i);
  first.notes.pop();

  exact.ties.push({ id: "one-tie-over", fromNoteId: "material-note-c-0", toNoteId: "material-note-c-1" });
  assert.match(validateScore(exact).join("\n"), /50,000-tie safety limit/i);
});

test("absolute score timeline accepts the MIDI-safe ceiling and rejects the first tick beyond it", () => {
  const exactMeters = [
    ...Array.from({ length: 548 }, () => ({ numerator: 255, denominator: 1 })),
    { numerator: 70, denominator: 1 },
    { numerator: 17, denominator: 128 },
  ];
  const exact = scoreWithMeters(exactMeters);
  const totalTicks = exact.measureOrder.reduce((total, measureId) => total + measureCapacity(exact.measures[measureId]), 0);
  assert.equal(totalTicks, SCORE_VALIDATION_LIMITS.timelineTicks);
  assert.deepEqual(validateScore(exact), []);

  const over = scoreWithMeters([...exactMeters, { numerator: 1, denominator: 256 }]);
  assert.match(validateScore(over).join("\n"), /536,870,910-tick safety limit/i);
});

test("validation diagnostics stop after 200 actionable errors with a deterministic summary", () => {
  const malformed = scoreWithMeters([{ numerator: 4, denominator: 4 }]);
  (firstVoice(malformed) as unknown as { events: unknown[] }).events = Array.from({ length: 300 }, () => ({}));
  const errors = validateScore(malformed);
  assert.equal(errors.length, SCORE_VALIDATION_LIMITS.validationErrors + 1);
  assert.match(errors[0], /event 1 ID must have a non-empty string ID/i);
  assert.equal(errors.at(-1), "Additional validation errors were omitted after the first 200.");
});

test("ties accept adjacent same-pitch note events in one voice, including chains, chords, and measure boundaries", () => {
  const valid = tieFixture();
  valid.ties.push({ id: "valid-tie", fromNoteId: "tie-note-c1", toNoteId: "tie-note-c2" });
  assert.deepEqual(validateScore(valid), []);

  const chain = freshScore();
  firstVoice(chain).events.push(
    noteEvent("chain-event-1", "chain-note-1"),
    noteEvent("chain-event-2", "chain-note-2"),
    noteEvent("chain-event-3", "chain-note-3"),
  );
  chain.ties.push(
    { id: "chain-tie-1", fromNoteId: "chain-note-1", toNoteId: "chain-note-2" },
    { id: "chain-tie-2", fromNoteId: "chain-note-2", toNoteId: "chain-note-3" },
  );
  assert.deepEqual(validateScore(chain), [], "a middle note may stop one tie and start the next");

  const chords = freshScore();
  const chordFrom = noteEvent("chord-event-1", "chord-c-1");
  chordFrom.notes.push({ id: "chord-e-1", pitch: { step: "E", alter: -1, octave: 4 }, accidentalDisplay: "auto" });
  const chordTo = noteEvent("chord-event-2", "chord-c-2");
  chordTo.notes.push({ id: "chord-e-2", pitch: { step: "E", alter: -1, octave: 4 }, accidentalDisplay: "auto" });
  firstVoice(chords).events.push(chordFrom, chordTo);
  chords.ties.push(
    { id: "chord-c-tie", fromNoteId: "chord-c-1", toNoteId: "chord-c-2" },
    { id: "chord-e-tie", fromNoteId: "chord-e-1", toNoteId: "chord-e-2" },
  );
  assert.deepEqual(validateScore(chords), [], "independent chord tones may tie between adjacent note events");

  const crossMeasure = freshScore();
  const [firstMeasureId, secondMeasureId] = crossMeasure.measureOrder;
  getPrimaryVoice(crossMeasure.parts[0], firstMeasureId).events.push(
    noteEvent("cross-measure-event-1", "cross-measure-note-1", undefined, { base: 1, dots: 0 }),
  );
  getPrimaryVoice(crossMeasure.parts[0], secondMeasureId).events.push(
    noteEvent("cross-measure-event-2", "cross-measure-note-2"),
  );
  crossMeasure.ties.push({
    id: "cross-measure-tie",
    fromNoteId: "cross-measure-note-1",
    toNoteId: "cross-measure-note-2",
  });
  assert.deepEqual(
    validateScore(crossMeasure),
    [],
    "a source ending at the barline may tie to a destination starting the next measure",
  );
});

test("ties reject invalid endpoints, voice timelines, graph incidence, and cycles", () => {

  const missing = tieFixture();
  missing.ties.push({ id: "missing-tie", fromNoteId: "missing", toNoteId: "tie-note-c2" });
  assert.match(validateScore(missing).join("\n"), /source note .* does not exist/i);

  const sameNote = tieFixture();
  sameNote.ties.push({ id: "self-tie", fromNoteId: "tie-note-c1", toNoteId: "tie-note-c1" });
  assert.match(validateScore(sameNote).join("\n"), /connect two different notes/i);

  const differentPitch = tieFixture();
  differentPitch.ties.push({ id: "different-pitch-tie", fromNoteId: "tie-note-c1", toNoteId: "tie-note-d" });
  assert.match(validateScore(differentPitch).join("\n"), /same written pitch/i);

  const duplicateEdge = tieFixture();
  duplicateEdge.ties.push(
    { id: "edge-1", fromNoteId: "tie-note-c1", toNoteId: "tie-note-c2" },
    { id: "edge-2", fromNoteId: "tie-note-c1", toNoteId: "tie-note-c2" },
  );
  assert.match(validateScore(duplicateEdge).join("\n"), /duplicates the tie edge/i);

  const crossPart = createScore("quartet", { seedDemo: false });
  const crossPartMeasureId = crossPart.measureOrder[0];
  getPrimaryVoice(crossPart.parts[0], crossPartMeasureId).events.push(noteEvent("part-event-1", "part-note-1"));
  getPrimaryVoice(crossPart.parts[1], crossPartMeasureId).events.push(noteEvent("part-event-2", "part-note-2"));
  crossPart.ties.push({ id: "cross-part-tie", fromNoteId: "part-note-1", toNoteId: "part-note-2" });
  assert.match(validateScore(crossPart).join("\n"), /same part, staff, and voice/i);

  const crossStaff = freshScore();
  const crossStaffMeasureId = crossStaff.measureOrder[0];
  getPrimaryVoice(crossStaff.parts[0], crossStaffMeasureId, 0).events.push(noteEvent("staff-event-1", "staff-note-1"));
  getPrimaryVoice(crossStaff.parts[0], crossStaffMeasureId, 1).events.push(noteEvent("staff-event-2", "staff-note-2"));
  crossStaff.ties.push({ id: "cross-staff-tie", fromNoteId: "staff-note-1", toNoteId: "staff-note-2" });
  assert.match(validateScore(crossStaff).join("\n"), /same part, staff, and voice/i);

  const crossVoice = freshScore();
  const crossVoiceMeasureId = crossVoice.measureOrder[0];
  const crossVoiceMeasure = crossVoice.parts[0].staves[0].measures[crossVoiceMeasureId];
  crossVoiceMeasure.voices[0].events.push(noteEvent("voice-event-1", "voice-note-1"));
  crossVoiceMeasure.voices.push({ id: "cross-voice-v2", events: [noteEvent("voice-event-2", "voice-note-2")] });
  crossVoice.ties.push({ id: "cross-voice-tie", fromNoteId: "voice-note-1", toNoteId: "voice-note-2" });
  assert.match(validateScore(crossVoice).join("\n"), /same part, staff, and voice/i);

  const backward = tieFixture();
  backward.ties.push({ id: "backward-tie", fromNoteId: "tie-note-c2", toNoteId: "tie-note-c1" });
  assert.match(validateScore(backward).join("\n"), /destination must follow its source/i);

  const restGap = freshScore();
  firstVoice(restGap).events.push(
    noteEvent("rest-gap-event-1", "rest-gap-note-1"),
    { id: "rest-gap-rest", kind: "rest", duration: { base: 4, dots: 0 } },
    noteEvent("rest-gap-event-2", "rest-gap-note-2"),
  );
  restGap.ties.push({ id: "rest-gap-tie", fromNoteId: "rest-gap-note-1", toNoteId: "rest-gap-note-2" });
  assert.match(validateScore(restGap).join("\n"), /immediately following event.*start tick/i);

  const incompleteMeasureGap = freshScore();
  const [gapFirstMeasureId, gapSecondMeasureId] = incompleteMeasureGap.measureOrder;
  getPrimaryVoice(incompleteMeasureGap.parts[0], gapFirstMeasureId).events.push(
    noteEvent("measure-gap-event-1", "measure-gap-note-1"),
  );
  getPrimaryVoice(incompleteMeasureGap.parts[0], gapSecondMeasureId).events.push(
    noteEvent("measure-gap-event-2", "measure-gap-note-2"),
  );
  incompleteMeasureGap.ties.push({
    id: "measure-gap-tie",
    fromNoteId: "measure-gap-note-1",
    toNoteId: "measure-gap-note-2",
  });
  assert.match(validateScore(incompleteMeasureGap).join("\n"), /start tick must exactly equal the source event's end tick/i);

  const noncontiguous = tieFixture();
  firstVoice(noncontiguous).events.push(noteEvent("tie-event-c3", "tie-note-c3"));
  noncontiguous.ties.push({ id: "noncontiguous-tie", fromNoteId: "tie-note-c1", toNoteId: "tie-note-c3" });
  assert.match(validateScore(noncontiguous).join("\n"), /immediately following event.*start tick/i);

  const duplicateOutgoing = freshScore();
  const outgoingFrom = noteEvent("outgoing-event-1", "outgoing-source");
  const outgoingTo = noteEvent("outgoing-event-2", "outgoing-destination-1");
  outgoingTo.notes.push({ id: "outgoing-destination-2", pitch: { step: "C", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  firstVoice(duplicateOutgoing).events.push(outgoingFrom, outgoingTo);
  duplicateOutgoing.ties.push(
    { id: "outgoing-tie-1", fromNoteId: "outgoing-source", toNoteId: "outgoing-destination-1" },
    { id: "outgoing-tie-2", fromNoteId: "outgoing-source", toNoteId: "outgoing-destination-2" },
  );
  assert.match(validateScore(duplicateOutgoing).join("\n"), /more than one outgoing tie/i);

  const duplicateIncoming = freshScore();
  const incomingFrom = noteEvent("incoming-event-1", "incoming-source-1");
  incomingFrom.notes.push({ id: "incoming-source-2", pitch: { step: "C", alter: 0, octave: 4 }, accidentalDisplay: "auto" });
  const incomingTo = noteEvent("incoming-event-2", "incoming-destination");
  firstVoice(duplicateIncoming).events.push(incomingFrom, incomingTo);
  duplicateIncoming.ties.push(
    { id: "incoming-tie-1", fromNoteId: "incoming-source-1", toNoteId: "incoming-destination" },
    { id: "incoming-tie-2", fromNoteId: "incoming-source-2", toNoteId: "incoming-destination" },
  );
  assert.match(validateScore(duplicateIncoming).join("\n"), /more than one incoming tie/i);

  const cycle = freshScore();
  firstVoice(cycle).events.push(
    noteEvent("cycle-event-1", "cycle-note-1"),
    noteEvent("cycle-event-2", "cycle-note-2"),
  );
  cycle.ties.push(
    { id: "cycle-tie-1", fromNoteId: "cycle-note-1", toNoteId: "cycle-note-2" },
    { id: "cycle-tie-2", fromNoteId: "cycle-note-2", toNoteId: "cycle-note-1" },
  );
  assert.match(validateScore(cycle).join("\n"), /tie graph must not contain cycles/i);
});

test("overflow and requireComplete retain draft-versus-complete semantics", () => {
  const draft = freshScore();
  assert.deepEqual(validateScore(draft), []);
  assert.match(validateScore(draft, true).join("\n"), /is incomplete/i);

  const overflow = freshScore();
  firstVoice(overflow).events.push(
    noteEvent("overflow-whole", "overflow-whole-note", undefined, { base: 1, dots: 0 }),
    noteEvent("overflow-quarter", "overflow-quarter-note", undefined, { base: 4, dots: 0 }),
  );
  assert.match(validateScore(overflow).join("\n"), /exceeds its time signature/i);

  const complete = freshScore();
  const firstMeasureId = complete.measureOrder[0];
  complete.measureOrder = [firstMeasureId];
  complete.parts = [complete.parts[0]];
  complete.parts[0].staves = [complete.parts[0].staves[0]];
  firstVoice(complete).events.push(noteEvent("complete-whole", "complete-whole-note", undefined, { base: 1, dots: 0 }));
  assert.deepEqual(validateScore(complete, true), []);
});
