import assert from "node:assert/strict";
import test from "node:test";
import { getPrimaryVoice, validateScore } from "../lib/music/model";
import { pitchFromStaffPointer, shiftDiatonicPitch } from "../lib/music/note-input";
import { appendEventToMeasure, createScore, makeEvent } from "../lib/music/score";

test("diatonic arrow input crosses octave boundaries and clamps to C0 through B8", () => {
  assert.deepEqual(shiftDiatonicPitch({ step: "C", octave: 4 }, 1), { step: "D", octave: 4 });
  assert.deepEqual(shiftDiatonicPitch({ step: "C", octave: 4 }, -1), { step: "B", octave: 3 });
  assert.deepEqual(shiftDiatonicPitch({ step: "B", octave: 4 }, 1), { step: "C", octave: 5 });
  assert.deepEqual(shiftDiatonicPitch({ step: "C", octave: 0 }, -100), { step: "C", octave: 0 });
  assert.deepEqual(shiftDiatonicPitch({ step: "B", octave: 8 }, 100), { step: "B", octave: 8 });
});

test("pointer input snaps every supported clef line to its written pitch", () => {
  const topLineY = 100;
  const lineSpacing = 10;
  const bottomLineY = topLineY + lineSpacing * 4;
  const expected = {
    treble: ["F5", "D5", "B4", "G4", "E4"],
    bass: ["A3", "F3", "D3", "B2", "G2"],
    alto: ["G4", "E4", "C4", "A3", "F3"],
    tenor: ["E4", "C4", "A3", "F3", "D3"],
  } as const;

  for (const [clef, pitches] of Object.entries(expected)) {
    pitches.forEach((pitchName, lineIndex) => {
      const pitch = pitchFromStaffPointer(clef as keyof typeof expected, topLineY + lineIndex * lineSpacing, bottomLineY, lineSpacing);
      assert.equal(pitch && `${pitch.step}${pitch.octave}`, pitchName, `${clef} line ${lineIndex + 1}`);
    });
  }

  assert.deepEqual(pitchFromStaffPointer("treble", bottomLineY - lineSpacing / 2, bottomLineY, lineSpacing), { step: "F", octave: 4 });
  assert.deepEqual(pitchFromStaffPointer("bass", topLineY + lineSpacing / 2, bottomLineY, lineSpacing), { step: "G", octave: 3 });
  assert.equal(pitchFromStaffPointer("percussion", 120, bottomLineY, lineSpacing), null);
  assert.equal(pitchFromStaffPointer("treble", 120, bottomLineY, 0), null);
  assert.equal(pitchFromStaffPointer("treble", Number.NaN, bottomLineY, lineSpacing), null);
});

test("pointer entry appends only to the explicit clicked measure", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staff = part.staves[0];
  const [firstMeasureId, , thirdMeasureId] = source.measureOrder;
  const event = makeEvent({
    id: "pointer-third-measure",
    pitch: { step: "F", alter: 0, octave: 5 },
    duration: { base: 4, dots: 0 },
    rest: false,
  });

  const result = appendEventToMeasure(source, part.id, thirdMeasureId, event, staff.id);
  assert.equal(result.error, undefined);
  assert.notEqual(result.score, source);
  assert.equal(getPrimaryVoice(result.score.parts[0], firstMeasureId, 0).events.length, 0);
  assert.deepEqual(getPrimaryVoice(result.score.parts[0], thirdMeasureId, 0).events, [event]);
  assert.equal(getPrimaryVoice(source.parts[0], thirdMeasureId, 0).events.length, 0, "the source score remains immutable");
  assert.deepEqual(validateScore(result.score), []);
});

test("explicit-measure entry rejects overflow and stale targets atomically", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staff = part.staves[0];
  const measureId = source.measureOrder[1];
  const whole = makeEvent({
    id: "pointer-whole",
    pitch: { step: "C", alter: 0, octave: 4 },
    duration: { base: 1, dots: 0 },
    rest: false,
  });
  const filled = appendEventToMeasure(source, part.id, measureId, whole, staff.id);
  assert.equal(filled.error, undefined);

  const overflowEvent = makeEvent({
    id: "pointer-overflow",
    pitch: { step: "D", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  });
  const overflow = appendEventToMeasure(filled.score, part.id, measureId, overflowEvent, staff.id);
  assert.equal(overflow.score, filled.score);
  assert.match(overflow.error ?? "", /does not have room/);

  assert.equal(appendEventToMeasure(source, part.id, "missing-measure", whole, staff.id).score, source);
  assert.equal(appendEventToMeasure(source, "missing-part", measureId, whole, staff.id).score, source);
  assert.equal(appendEventToMeasure(source, part.id, measureId, whole, "missing-staff").score, source);
});

test("explicit-measure entry rejects duplicate event identifiers without mutating its source", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const staff = part.staves[0];
  const event = makeEvent({
    id: "pointer-duplicate",
    pitch: { step: "G", alter: 0, octave: 4 },
    duration: { base: 4, dots: 0 },
    rest: false,
  });
  const once = appendEventToMeasure(source, part.id, source.measureOrder[0], event, staff.id);
  const duplicate = appendEventToMeasure(once.score, part.id, source.measureOrder[1], event, staff.id);
  assert.equal(duplicate.score, once.score);
  assert.match(duplicate.error ?? "", /safety limit/i);
  assert.deepEqual(validateScore(once.score), []);
});
