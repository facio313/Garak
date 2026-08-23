import assert from "node:assert/strict";
import test from "node:test";
import { collectPlaybackNotes, scoreToMusicXML } from "../lib/music/exporters";
import { importMusicXML } from "../lib/music/importers";
import { DYNAMIC_VELOCITIES, getPrimaryVoice, measureCapacity, SCORE_VALIDATION_LIMITS, validateScore } from "../lib/music/model";
import { createScore, makeEvent, setKeyFromMeasure, setTimeFromMeasure } from "../lib/music/score";

const CLARINET_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Import fixture</work-title></work>
  <identification><creator type="composer">Garak QA</creator></identification>
  <part-list>
    <score-part id="P1">
      <part-name>B♭ Clarinet</part-name><part-abbreviation>B♭ Cl.</part-abbreviation>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>72</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>2</fifths><mode>major</mode></key>
        <time><beats>6</beats><beat-type>8</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <sound tempo="120"/>
      <note><pitch><step>C</step><alter>1</alter><octave>4</octave></pitch><duration>720</duration><voice>1</voice><type>quarter</type><dot/><accidental>sharp</accidental></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>720</duration><voice>1</voice><type>quarter</type><dot/></note>
      <note><rest/><duration>240</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>240</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>240</duration><tie type="start"/><voice>1</voice><type>eighth</type></note>
    </measure>
    <measure number="2">
      <attributes><key><fifths>3</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>480</duration><tie type="stop"/><voice>1</voice><type>quarter</type></note>
      <note><rest/><duration>960</duration><voice>1</voice><type>half</type></note>
      <backup><duration>1440</duration></backup>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>480</duration><voice>2</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const ORDER_AND_CURSOR_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P2"><part-name>Top part</part-name></score-part>
    <score-part id="P1"><part-name>Bottom part</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><rest measure="yes"/><duration>1920</duration><voice>1</voice></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>480</duration><voice>2</voice><type>quarter</type></note>
      <backup><duration>480</duration></backup>
      <forward><duration>480</duration><voice>1</voice></forward>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>eighth</type></note>
      <note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>240</duration><voice>1</voice><type>eighth</type></note>
      <attributes><divisions>960</divisions></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const UNSUPPORTED_TIMING_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Timing audit</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>160</duration><voice>1</voice><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <forward><duration>320</duration><voice>1</voice></forward>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
      <forward><duration>1440</duration><voice>1</voice></forward>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const EXTENDED_DURATIONS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Extended rhythm</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>960</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1680</duration><voice>1</voice><type>quarter</type><dot/><dot/></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>120</duration><voice>1</voice><type>32nd</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>60</duration><voice>1</voice><type>64th</type></note>
    </measure>
  </part>
</score-partwise>`;

const MULTI_STAFF_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1920</duration><tie type="start"/><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>1920</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1920</duration><tie type="start"/><voice>2</voice><type>whole</type><staff>2</staff></note>
      <note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>1920</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>480</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>480</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>480</duration><tie type="stop"/><voice>2</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const DYNAMICS_DIRECTION_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Dynamics audit</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="above"><direction-type><dynamics><p/></dynamics></direction-type><offset>240</offset><voice>1</voice><staff>1</staff></direction>
      <direction><direction-type><words>dolce</words></direction-type><staff>1</staff></direction>
      <direction><direction-type><wedge type="crescendo"/></direction-type><staff>1</staff></direction>
      <direction><direction-type><dynamics><sfz/></dynamics></direction-type><voice>1</voice><staff>1</staff></direction>
      <direction><direction-type><dynamics><fff/></dynamics></direction-type><voice>9</voice><staff>1</staff></direction>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound dynamics="70"/><staff>1</staff></direction>
      <direction><direction-type><pedal type="start"/></direction-type><staff>1</staff></direction>
      <direction placement="below"><direction-type><dynamics><pp/></dynamics></direction-type><voice>2</voice><staff>2</staff></direction>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>480</duration></backup>
      <note><rest/><duration>480</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
      <direction><direction-type><dynamics><mp/><ff/></dynamics></direction-type><voice>1</voice><staff>1</staff></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
    <measure number="3">
      <direction><direction-type><dynamics><mf/></dynamics></direction-type><voice>1</voice><staff>1</staff></direction>
    </measure>
  </part>
</score-partwise>`;

test("MusicXML import preserves written-pitch chords, transposition, meter/key changes, ties, and safe voice boundaries", () => {
  const { score, warnings } = importMusicXML(CLARINET_FIXTURE);
  const part = score.parts[0];
  const firstVoice = getPrimaryVoice(part, score.measureOrder[0]);
  const secondVoice = getPrimaryVoice(part, score.measureOrder[1]);

  assert.equal(score.metadata.title, "Import fixture");
  assert.equal(score.metadata.composer, "Garak QA");
  assert.equal(score.tempo, 120);
  assert.deepEqual(part.instrument.transposition, { diatonic: -1, chromatic: -2, octaveChange: 0 });
  assert.deepEqual(score.measures[score.measureOrder[0]].time, { numerator: 6, denominator: 8 });
  assert.deepEqual(score.measures[score.measureOrder[0]].key, { fifths: 0, mode: "major" });
  assert.deepEqual(score.measures[score.measureOrder[1]].time, { numerator: 3, denominator: 4 });
  assert.deepEqual(score.measures[score.measureOrder[1]].key, { fifths: 1, mode: "major" });
  assert.equal(firstVoice.events.length, 4);
  assert.equal(firstVoice.events[0].kind, "note");
  assert.equal(firstVoice.events[0].kind === "note" ? firstVoice.events[0].notes.length : 0, 2);
  assert.deepEqual(firstVoice.events[0].duration, { base: 4, dots: 1 });
  assert.equal(firstVoice.events[0].kind === "note" ? firstVoice.events[0].notes[0].accidentalDisplay : "", "force");
  assert.equal(secondVoice.events.length, 2);
  assert.equal(score.ties.length, 1);
  assert.match(warnings.join("\n"), /voice 2 was skipped/);
  assert.deepEqual(validateScore(score), []);

  const playback = collectPlaybackNotes(score);
  assert.equal(playback.filter((note) => note.startSeconds === 0).length, 2);
  const exported = scoreToMusicXML(score);
  assert.match(exported, /<chord\/>/);
  assert.match(exported, /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic>/);
});

test("Garak's own multi-staff MusicXML exports round-trip without structural warnings", () => {
  const original = createScore("solo", false);
  original.tempo = 173;
  const exported = scoreToMusicXML(original);
  assert.match(exported, /<direction placement="above">[\s\S]*?<sound tempo="173"\/><\/direction>/);
  const imported = importMusicXML(exported);
  assert.equal(imported.score.tempo, 173);
  assert.equal(imported.score.parts.length, 1);
  assert.equal(imported.score.parts[0].staves.length, 2);
  assert.equal(imported.score.measureOrder.length, 4);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML import takes the first valid direction sound tempo and reports later global tempo changes", () => {
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Tempo audit</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1">
        <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <sound tempo="not-a-tempo"/>
        <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>123.6</per-minute></metronome></direction-type><sound tempo="123.6"/></direction>
        <note><rest measure="yes"/><duration>1920</duration><voice>1</voice></note>
      </measure>
      <measure number="2">
        <direction><sound tempo="150"/></direction>
        <note><rest measure="yes"/><duration>1920</duration><voice>1</voice></note>
      </measure>
    </part>
  </score-partwise>`;

  const imported = importMusicXML(xml);
  assert.equal(imported.score.tempo, 124, "tempo normalization rounds the first in-range sound value once");
  assert.match(imported.warnings.join("\n"), /tempo "not-a-tempo".*30–300 BPM.*ignored/i);
  assert.match(imported.warnings.join("\n"), /tempo change to 150 BPM.*initial 124 BPM remains global/i);
  assert.doesNotMatch(imported.warnings.join("\n"), /direction type metronome/i);
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML import discloses implicit and non-final underfilled measures before expanding their time axis", () => {
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Pickup audit</part-name></score-part></part-list>
    <part id="P1">
      <measure number="0" implicit="yes">
        <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><tie type="start"/><voice>1</voice><type>quarter</type></note>
      </measure>
      <measure number="1">
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><tie type="stop"/><voice>1</voice><type>quarter</type></note>
      </measure>
      <measure number="2">
        <note><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
      </measure>
    </part>
  </score-partwise>`;

  const imported = importMusicXML(xml);
  const report = imported.warnings.join("\n");
  assert.match(report, /measure 1.*marks.*implicit.*cannot preserve pickup\/implicit.*explicit measure/i);
  assert.match(report, /measure 1.*underfilled at 960 of 3840 ticks.*following measure starts 2880 ticks later/i);
  assert.match(report, /measure 2.*underfilled at 960 of 3840 ticks.*following measure starts 2880 ticks later/i);
  assert.match(report, /tie stop is not adjacent.*measure and timing normalization.*skipped/i);
  assert.equal(imported.score.ties.length, 0, "pickup expansion must not leave a tie rejected by the score validator");
  assert.deepEqual(collectPlaybackNotes(imported.score).map((note) => note.startSeconds), [0, 2.5, 5]);
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML import reports key and meter declarations normalized from after musical content", () => {
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Late attributes</part-name></score-part></part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>480</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
      <attributes><key><fifths>1</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
    </measure></part>
  </score-partwise>`;

  const imported = importMusicXML(xml);
  const firstMeasure = imported.score.measures[imported.score.measureOrder[0]];
  assert.deepEqual(firstMeasure.time, { numerator: 3, denominator: 4 });
  assert.deepEqual(firstMeasure.key, { fifths: 1, mode: "major" });
  assert.match(imported.warnings.join("\n"), /time signature occurs after musical content.*normalized.*start of the measure/i);
  assert.match(imported.warnings.join("\n"), /key signature occurs after musical content.*normalized.*start of the measure/i);
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML round-trips measure-level key and meter changes at the same boundaries", () => {
  let original = createScore("solo", { seedDemo: false });
  const [, secondId, thirdId] = original.measureOrder;
  original = setKeyFromMeasure(original, secondId, { fifths: -4, mode: "minor" }).score;
  original = setTimeFromMeasure(original, thirdId, { numerator: 5, denominator: 8 }).score;

  const exported = scoreToMusicXML(original);
  const imported = importMusicXML(exported);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(
    imported.score.measureOrder.map((id) => imported.score.measures[id].key),
    original.measureOrder.map((id) => original.measures[id].key),
  );
  assert.deepEqual(
    imported.score.measureOrder.map((id) => imported.score.measures[id].time),
    original.measureOrder.map((id) => original.measures[id].time),
  );
  assert.equal((exported.match(/<key>/g) ?? []).length, 2, "the two-staff part emits one key boundary per measure, not per staff");
  assert.equal((exported.match(/<time>/g) ?? []).length, 2, "the two-staff part emits one meter boundary per measure, not per staff");
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML import follows part-list order and preserves primary-voice onsets through backup, forward, and division changes", () => {
  const { score, warnings } = importMusicXML(ORDER_AND_CURSOR_FIXTURE);
  assert.deepEqual(score.parts.map((part) => part.name), ["Top part", "Bottom part"]);

  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  assert.equal(voice.events.length, 3);
  assert.deepEqual(voice.events.map((event) => event.kind), ["rest", "note", "note"]);
  assert.deepEqual(voice.events.map((event) => event.duration), [
    { base: 4, dots: 0 },
    { base: 4, dots: 0 },
    { base: 8, dots: 0 },
  ]);
  assert.equal(voice.events[1].kind === "note" ? voice.events[1].notes.length : 0, 2);
  assert.match(warnings.join("\n"), /voice 2 was skipped/i);
  assert.match(warnings.join("\n"), /notated.*duration|duration.*notated/i);
  assert.match(warnings.join("\n"), /shorter.*chord|chord.*shorter/i);
  assert.deepEqual(validateScore(score), []);
});

test("MusicXML import skips unrepresentable tuplets and events beyond the measure without shifting later supported onsets", () => {
  const { score, warnings } = importMusicXML(UNSUPPORTED_TIMING_FIXTURE);
  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  assert.deepEqual(voice.events.map((event) => event.kind), ["rest", "note"]);
  assert.deepEqual(voice.events.map((event) => event.duration), [
    { base: 4, dots: 0 },
    { base: 4, dots: 0 },
  ]);
  assert.match(warnings.join("\n"), /unsupported.*duration|cannot represent/i);
  assert.match(warnings.join("\n"), /exceeds the measure/i);
  assert.deepEqual(validateScore(score), []);
});

test("MusicXML import preserves 32nd, 64th, and double-dotted durations", () => {
  const { score, warnings } = importMusicXML(EXTENDED_DURATIONS_FIXTURE);
  const voice = getPrimaryVoice(score.parts[0], score.measureOrder[0]);
  assert.deepEqual(voice.events.map((event) => event.duration), [
    { base: 4, dots: 2 },
    { base: 32, dots: 0 },
    { base: 64, dots: 0 },
  ]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(validateScore(score), []);
});

test("MusicXML import keeps independent primary voices, chords, and ties on every staff", () => {
  const { score, warnings } = importMusicXML(MULTI_STAFF_FIXTURE);
  const part = score.parts[0];
  const upperChord = getPrimaryVoice(part, score.measureOrder[0], 0).events[0];
  const lowerChord = getPrimaryVoice(part, score.measureOrder[0], 1).events[0];
  assert.deepEqual(part.staves.map((staff) => staff.clef), ["treble", "bass"]);
  assert.equal(upperChord.kind === "note" ? upperChord.notes.length : 0, 2);
  assert.equal(lowerChord.kind === "note" ? lowerChord.notes.length : 0, 2);
  assert.equal(getPrimaryVoice(part, score.measureOrder[1], 0).events.length, 1);
  assert.equal(getPrimaryVoice(part, score.measureOrder[1], 1).events.length, 1);
  assert.equal(score.ties.length, 2);
  const eventIds = part.staves.flatMap((staff, staffIndex) => score.measureOrder.flatMap((measureId) =>
    getPrimaryVoice(part, measureId, staffIndex).events.map((event) => event.id)));
  assert.equal(new Set(eventIds).size, eventIds.length);
  assert.deepEqual(warnings, []);
  assert.deepEqual(validateScore(score), []);
});

test("Garak MusicXML round-trips semantic dynamics on notes and rests across staves and barlines", () => {
  const original = createScore("solo", { seedDemo: false });
  const part = original.parts[0];
  const [firstMeasureId, secondMeasureId] = original.measureOrder;

  const upperP = makeEvent({ id: "roundtrip-upper-p", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  const upperFfRest = makeEvent({ id: "roundtrip-upper-ff-rest", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: true });
  const upperAfterBarline = makeEvent({ id: "roundtrip-upper-after-barline", pitch: { step: "E", alter: 0, octave: 4 }, duration: { base: 4, dots: 0 }, rest: false });
  upperP.dynamic = "p";
  upperFfRest.dynamic = "ff";
  getPrimaryVoice(part, firstMeasureId, 0).events.push(upperP, upperFfRest);
  getPrimaryVoice(part, secondMeasureId, 0).events.push(upperAfterBarline);

  const lowerMpRest = makeEvent({ id: "roundtrip-lower-mp-rest", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: true });
  const lowerAfterBarline = makeEvent({ id: "roundtrip-lower-after-barline", pitch: { step: "C", alter: 0, octave: 3 }, duration: { base: 4, dots: 0 }, rest: false });
  lowerMpRest.dynamic = "mp";
  getPrimaryVoice(part, firstMeasureId, 1).events.push(lowerMpRest);
  getPrimaryVoice(part, secondMeasureId, 1).events.push(lowerAfterBarline);

  const exported = scoreToMusicXML(original);
  assert.equal((exported.match(/<direction placement="below">/g) ?? []).length, 3);
  const imported = importMusicXML(exported);
  assert.deepEqual(imported.warnings, []);
  const importedPart = imported.score.parts[0];
  assert.deepEqual(
    getPrimaryVoice(importedPart, imported.score.measureOrder[0], 0).events.map((event) => event.dynamic ?? null),
    ["p", "ff"],
  );
  assert.deepEqual(
    getPrimaryVoice(importedPart, imported.score.measureOrder[1], 0).events.map((event) => event.dynamic ?? null),
    [null],
  );
  assert.deepEqual(
    getPrimaryVoice(importedPart, imported.score.measureOrder[0], 1).events.map((event) => event.dynamic ?? null),
    ["mp"],
  );
  assert.deepEqual(
    getPrimaryVoice(importedPart, imported.score.measureOrder[1], 1).events.map((event) => event.dynamic ?? null),
    [null],
  );

  const velocityByMidi = new Map(collectPlaybackNotes(imported.score).map((note) => [note.midi, note.velocity]));
  assert.equal(velocityByMidi.get(60), DYNAMIC_VELOCITIES.p);
  assert.equal(velocityByMidi.get(64), DYNAMIC_VELOCITIES.ff, "a rest dynamic persists to the next upper-staff note across the barline");
  assert.equal(velocityByMidi.get(48), DYNAMIC_VELOCITIES.mp, "the lower staff keeps an independent rest dynamic across the barline");
  assert.deepEqual(validateScore(imported.score), []);
});

test("Garak MusicXML round-trips its complete single-articulation domain", () => {
  const original = createScore("solo", { seedDemo: false });
  const voice = getPrimaryVoice(original.parts[0], original.measureOrder[0]);
  const articulations = ["staccato", "tenuto", "accent", "marcato"] as const;
  const steps = ["C", "D", "E", "F"] as const;
  articulations.forEach((articulation, index) => {
    const event = makeEvent({
      id: `roundtrip-articulation-${articulation}`,
      pitch: { step: steps[index], alter: 0, octave: 4 },
      duration: { base: 8, dots: 0 },
      rest: false,
    });
    if (event.kind !== "note") assert.fail("Expected a note event.");
    event.articulation = articulation;
    voice.events.push(event);
  });

  const exported = scoreToMusicXML(original);
  assert.match(exported, /<staccato\/>/);
  assert.match(exported, /<tenuto\/>/);
  assert.match(exported, /<accent\/>/);
  assert.match(exported, /<strong-accent type="up"\/>/);
  const imported = importMusicXML(exported);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(
    getPrimaryVoice(imported.score.parts[0], imported.score.measureOrder[0]).events.map((event) =>
      event.kind === "note" ? event.articulation ?? null : null),
    articulations,
  );
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML articulation import keeps supported marks and reports every lossy boundary", () => {
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Articulation boundaries</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1">
        <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato/></articulations></notations></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><tenuto placement="below"/></articulations></notations></note>
        <note><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><accent/><strong-accent type="down"/></articulations></notations></note>
        <note><pitch><step>F</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><breath-mark/><accent/></articulations></notations></note>
      </measure>
      <measure number="2">
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><accent/></articulations></notations></note>
        <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><strong-accent/></articulations></notations></note>
        <note><rest/><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato/></articulations></notations></note>
      </measure>
    </part>
  </score-partwise>`;

  const imported = importMusicXML(xml);
  const part = imported.score.parts[0];
  assert.deepEqual(
    getPrimaryVoice(part, imported.score.measureOrder[0]).events.map((event) =>
      event.kind === "note" ? event.articulation ?? null : null),
    ["staccato", "tenuto", "marcato", "accent"],
  );
  const secondMeasure = getPrimaryVoice(part, imported.score.measureOrder[1]).events;
  assert.equal(secondMeasure[0].kind, "note");
  if (secondMeasure[0].kind !== "note") assert.fail("Expected an imported chord.");
  assert.equal(secondMeasure[0].notes.length, 2);
  assert.equal(secondMeasure[0].articulation, "marcato", "the later chord-tone articulation wins visibly");
  assert.equal(Object.hasOwn(secondMeasure[1], "articulation"), false, "rest articulations never enter the score model");

  const report = imported.warnings.join("\n");
  assert.match(report, /below tenuto placement.*normalized above/i);
  assert.match(report, /down strong-accent direction.*marcato.*normalized upward/i);
  assert.match(report, /multiple supported articulations accent and marcato.*later marcato/i);
  assert.match(report, /unsupported articulation breath-mark was skipped/i);
  assert.match(report, /measure 2, note 2: articulation on an individual chord tone.*marcato was applied to the whole editable chord event/i);
  assert.match(report, /conflicting chord articulations accent and marcato.*later marcato/i);
  assert.match(report, /staccato on a rest cannot be represented and was skipped/i);
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML reports chord-tone articulation widening once per editable chord event", () => {
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Chord warning</part-name></score-part></part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato/></articulations></notations></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato/></articulations></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><accent/></articulations></notations></note>
      <note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><accent/></articulations></notations></note>
    </measure></part>
  </score-partwise>`;

  const imported = importMusicXML(xml);
  const events = getPrimaryVoice(imported.score.parts[0], imported.score.measureOrder[0]).events;
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.kind === "note" ? {
    notes: event.notes.map((note) => note.pitch.step),
    articulation: event.articulation ?? null,
  } : null), [
    { notes: ["C", "E", "G"], articulation: "staccato" },
    { notes: ["D", "F"], articulation: "accent" },
  ]);

  const wideningWarnings = imported.warnings.filter((warning) => warning.includes("articulation on an individual chord tone"));
  assert.equal(wideningWarnings.length, 2, "repeated articulation marks on tones of one chord must not amplify warnings");
  assert.match(wideningWarnings[0], /^Chord warning, measure 1, note 2: articulation on an individual chord tone cannot be preserved; staccato was applied to the whole editable chord event\.$/);
  assert.match(wideningWarnings[1], /^Chord warning, measure 1, note 5: articulation on an individual chord tone cannot be preserved; accent was applied to the whole editable chord event\.$/);
  assert.equal(imported.warnings.length, 2, "same-articulation chord tones need one explicit widening warning and no conflict warning");

  const exported = scoreToMusicXML(imported.score);
  assert.equal((exported.match(/<staccato\/>/g) ?? []).length, 1);
  assert.equal((exported.match(/<accent\/>/g) ?? []).length, 1);
  assert.deepEqual(importMusicXML(exported).warnings, [], "Garak's event-level export no longer needs chord-tone normalization");
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML import anchors a dynamic to a decomposed full-measure rest instead of leaking it across a barline", () => {
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Full-rest dynamics</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1">
        <attributes><divisions>2</divisions><time><beats>5</beats><beat-type>8</beat-type></time></attributes>
        <direction><direction-type><dynamics><p/></dynamics></direction-type><voice>1</voice></direction>
        <note><rest measure="yes"/><duration>5</duration><voice>1</voice></note>
      </measure>
      <measure number="2">
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      </measure>
    </part>
  </score-partwise>`;

  const imported = importMusicXML(xml);
  const part = imported.score.parts[0];
  assert.deepEqual(
    getPrimaryVoice(part, imported.score.measureOrder[0]).events.map((event) => ({ duration: event.duration, dynamic: event.dynamic ?? null })),
    [
      { duration: { base: 2, dots: 0 }, dynamic: "p" },
      { duration: { base: 8, dots: 0 }, dynamic: null },
    ],
  );
  assert.equal(getPrimaryVoice(part, imported.score.measureOrder[1]).events[0].dynamic, undefined);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML direction import carries pending staff dynamics safely and reports every unsupported boundary", () => {
  const { score, warnings } = importMusicXML(DYNAMICS_DIRECTION_FIXTURE);
  const part = score.parts[0];
  const firstMeasureId = score.measureOrder[0];
  const secondMeasureId = score.measureOrder[1];
  assert.deepEqual(getPrimaryVoice(part, firstMeasureId, 0).events, []);
  assert.deepEqual(getPrimaryVoice(part, firstMeasureId, 1).events, []);

  const upper = getPrimaryVoice(part, secondMeasureId, 0);
  const lower = getPrimaryVoice(part, secondMeasureId, 1);
  assert.deepEqual(upper.events.map((event) => ({ kind: event.kind, duration: event.duration, dynamic: event.dynamic ?? null })), [
    { kind: "note", duration: { base: 4, dots: 0 }, dynamic: "p" },
    { kind: "note", duration: { base: 4, dots: 0 }, dynamic: "ff" },
  ], "ignored direction offsets must not insert or shift rhythmic events");
  assert.deepEqual(lower.events.map((event) => ({ kind: event.kind, duration: event.duration, dynamic: event.dynamic ?? null })), [
    { kind: "rest", duration: { base: 4, dots: 0 }, dynamic: "pp" },
  ]);

  const report = warnings.join("\n");
  assert.match(report, /direction offsets.*ignored without moving the musical cursor/i);
  assert.match(report, /above dynamic placement.*normalized below/i);
  assert.match(report, /text directions.*skipped/i);
  assert.match(report, /wedge and hairpin.*skipped/i);
  assert.match(report, /unsupported dynamic sfz.*skipped/i);
  assert.match(report, /dynamic for voice 9 was skipped/i);
  assert.match(report, /sound-only dynamics.*skipped/i);
  assert.match(report, /direction type metronome.*skipped/i);
  assert.match(report, /direction type pedal.*skipped/i);
  assert.match(report, /conflicting dynamic marks mp and ff.*later ff/i);
  assert.match(report, /1 dynamic mark had no following supported event and was skipped/i);
  assert.deepEqual(validateScore(score), []);
});

test("MusicXML import derives the concert key from a later transposing part when the top part omits key data", () => {
  const xml = `<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>Percussion</part-name></score-part>
      <score-part id="P2"><part-name>B♭ Clarinet</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1"><attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest measure="yes"/><duration>1920</duration><voice>1</voice></note></measure></part>
    <part id="P2"><measure number="1"><attributes><divisions>480</divisions><key><fifths>2</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes><note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note></measure></part>
  </score-partwise>`;
  const { score, warnings } = importMusicXML(xml);
  assert.deepEqual(score.measures[score.measureOrder[0]].key, { fifths: 0, mode: "major" });
  assert.equal(collectPlaybackNotes(score).find((note) => note.partId === score.parts[1].id)?.midi, 60);
  assert.deepEqual(warnings, []);
});

test("MusicXML import rejects malformed and timewise documents clearly", () => {
  assert.throws(() => importMusicXML("<score-partwise>"), /not well-formed/i);
  assert.throws(() => importMusicXML("<score-timewise version=\"4.0\"></score-timewise>"), /score-partwise/i);
  assert.throws(
    () => importMusicXML('<!DOCTYPE score-partwise [<!ENTITY x "expanded">]><score-partwise><part-list><score-part id="P1"><part-name>&x;</part-name></score-part></part-list><part id="P1"><measure number="1"/></part></score-partwise>'),
    /doctype|document type|entity/i,
  );
  assert.throws(
    () => importMusicXML('<score-partwise><part-list><score-part id="P1"><part-name>One</part-name></score-part><score-part id="P1"><part-name>Duplicate</part-name></score-part></part-list><part id="P1"><measure number="1"/></part></score-partwise>'),
    /duplicate id/i,
  );

  const invalidDuration = importMusicXML('<score-partwise><part-list><score-part id="P1"><part-name>Invalid duration</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions></attributes><note><rest/><duration>0</duration><voice>1</voice><type>quarter</type></note></measure></part></score-partwise>');
  assert.equal(getPrimaryVoice(invalidDuration.score.parts[0], invalidDuration.score.measureOrder[0]).events.length, 0);
  assert.match(invalidDuration.warnings.join("\n"), /positive duration/i);
});

test("MusicXML import caps and bounds high-volume warnings while bounding imported names", () => {
  const longName = "Long imported part ".repeat(80);
  const invalidTempo = "9".repeat(1_000);
  const notes = Array.from({ length: 250 }, (_, index) =>
    `<note><rest/><duration>0</duration><voice>1</voice><type>quarter</type><footnote>${index}</footnote></note>`).join("");
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>${longName}</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>480</divisions></attributes><sound tempo="${invalidTempo}"/>${notes}</measure></part>
  </score-partwise>`;

  const imported = importMusicXML(xml);
  assert.equal(imported.score.parts[0].name.length, 200);
  assert.equal(imported.warnings.length, 201, "the UI receives at most 200 diagnostics plus one omission summary");
  assert.equal(imported.warnings.at(-1), "52 additional warnings omitted.");
  assert.ok(imported.warnings.every((warning) => warning.length <= 500));
  assert.equal(imported.warnings[1].length, 500, "even a hostile attribute value is truncated before entering the warning list");
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML import never amplifies external part IDs into descendant IDs and rejects oversized references", () => {
  const boundedSourceId = `P${"x".repeat(255)}`;
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="${boundedSourceId}"><part-name>Bounded IDs</part-name></score-part></part-list>
    <part id="${boundedSourceId}"><measure number="1">
      <attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
    </measure></part>
  </score-partwise>`;
  const imported = importMusicXML(xml);
  const part = imported.score.parts[0];
  const voice = getPrimaryVoice(part, imported.score.measureOrder[0]);
  const internalIds = [part.id, part.staves[0].id, voice.id, ...voice.events.flatMap((event) => [event.id, ...(event.kind === "note" ? event.notes.map((note) => note.id) : [])])];
  assert.equal(part.id, "part-1");
  assert.ok(internalIds.every((id) => id.length < 80 && !id.includes(boundedSourceId)));
  assert.deepEqual(validateScore(imported.score), []);

  const oversizedSourceId = `P${"x".repeat(256)}`;
  const oversized = `<score-partwise><part-list><score-part id="${oversizedSourceId}"><part-name>Too long</part-name></score-part></part-list><part id="${oversizedSourceId}"><measure number="1"/></part></score-partwise>`;
  assert.throws(() => importMusicXML(oversized), /score-part id exceeds.*256-character safety limit/i);
});

test("MusicXML import refuses beat types the current integer-tick and MIDI model cannot preserve", () => {
  const xml = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Irrational meter</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>480</divisions><time><beats>2</beats><beat-type>3</beat-type></time></attributes><note><rest/><duration>480</duration><voice>1</voice><type>quarter</type></note></measure></part>
  </score-partwise>`;
  const imported = importMusicXML(xml);
  assert.deepEqual(imported.score.measures[imported.score.measureOrder[0]].time, { numerator: 4, denominator: 4 });
  assert.match(imported.warnings.join("\n"), /power-of-two beat types/i);
  assert.deepEqual(validateScore(imported.score), []);
});

test("MusicXML import rejects globally explosive staff-measure and notation products before score materialization", () => {
  const staffGrid = (partCount: number, measuresPerPart: number, stavesPerPart: number) => {
    const partList = Array.from({ length: partCount }, (_, index) =>
      `<score-part id="P${index + 1}"><part-name>Part ${index + 1}</part-name></score-part>`).join("");
    const parts = Array.from({ length: partCount }, (_, partIndex) =>
      `<part id="P${partIndex + 1}">${Array.from({ length: measuresPerPart }, (_, measureIndex) =>
        `<measure number="${measureIndex + 1}">${measureIndex === 0 ? `<attributes><staves>${stavesPerPart}</staves></attributes>` : ""}</measure>`).join("")}</part>`).join("");
    return `<score-partwise version="4.0"><part-list>${partList}</part-list>${parts}</score-partwise>`;
  };

  const atLimit = importMusicXML(staffGrid(10, 40, 25));
  assert.equal(10 * 40 * 25, 10_000);
  assert.deepEqual(validateScore(atLimit.score), [], "the inclusive 10,000-cell boundary remains importable and native-valid");

  assert.throws(() => importMusicXML(staffGrid(257, 1, 1)), /256-part safety limit/i);
  assert.throws(() => importMusicXML(staffGrid(17, 1, 32)), /512-staff total safety limit/i);

  const partCount = 11;
  const measuresPerPart = 30;
  const staffBomb = staffGrid(partCount, measuresPerPart, 32);
  assert.equal(partCount * measuresPerPart * 32, 10_560, "the regression crosses the 10,000-cell UI safety boundary");
  assert.ok(staffBomb.length < 10 * 1024 * 1024, "the regression must stay within the browser file-size gate");
  assert.throws(() => importMusicXML(staffBomb), /staff-by-measure complexity limit/i);

  const notationBomb = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Notation bomb</part-name></score-part></part-list><part id="P1"><measure number="1">${"<forward/>".repeat(100_001)}</measure></part></score-partwise>`;
  assert.ok(notationBomb.length < 10 * 1024 * 1024, "the notation regression must stay within the browser file-size gate");
  assert.throws(() => importMusicXML(notationBomb), /notation complexity limit/i);
});

test("MusicXML import enforces the native timeline ceiling before event materialization while accepting the exact boundary", () => {
  const musicXmlWithMeters = (meters: Array<{ numerator: number; denominator: number }>) => {
    const measures = meters.map(({ numerator, denominator }, index) =>
      `<measure number="${index + 1}"><attributes><time><beats>${numerator}</beats><beat-type>${denominator}</beat-type></time></attributes></measure>`).join("");
    return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Timeline boundary</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
  };

  const overLimit = musicXmlWithMeters(Array.from({ length: 550 }, () => ({ numerator: 255, denominator: 1 })));
  assert.throws(
    () => importMusicXML(overLimit),
    /timeline exceeds Garak's 536,870,910-tick safety limit/i,
    "550 maximum-capacity measures must be rejected at the import boundary instead of producing a native-invalid score",
  );

  const exactLimitMeters = [
    ...Array.from({ length: 548 }, () => ({ numerator: 255, denominator: 1 })),
    { numerator: 70, denominator: 1 },
    { numerator: 17, denominator: 128 },
  ];
  const imported = importMusicXML(musicXmlWithMeters(exactLimitMeters));
  const importedTimelineTicks = imported.score.measureOrder.reduce(
    (sum, measureId) => sum + measureCapacity(imported.score.measures[measureId]),
    0,
  );
  assert.equal(importedTimelineTicks, SCORE_VALIDATION_LIMITS.timelineTicks);
  assert.deepEqual(validateScore(imported.score), [], "the inclusive native timeline boundary remains importable and valid");
});
