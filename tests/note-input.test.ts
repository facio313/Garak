import { pitchFromKeyboardKey, shiftChromaticPitch } from "../lib/music/note-input";
import { DOCK_POSITION_STORAGE_KEY, dockPointFromPosition, floatingDockPlacement, loadDockPosition, relativeDockPosition, saveDockPosition } from "../lib/floating-dock";
import { clampPanelWidth, loadPanelCollapsed, loadPanelWidth, MIN_SCORE_WIDTH, PANEL_LIMITS, PANEL_SIDES, panelWidthsAfterResize, savePanelCollapsed, savePanelWidth, workspacePanelLayout } from "../lib/panel-widths";
import assert from "node:assert/strict";
import test from "node:test";
import { durationTicks, getPrimaryVoice, TICKS_PER_QUARTER, validateScore } from "../lib/music/model";
import {
  durationKeyAction,
  finishesScoreNoteDrag,
  finishesScorePointerTap,
  hasSystemShortcutModifier,
  letterKeyAction,
  pitchButtonAction,
  pitchFromStaffPointer,
  sameStaffMeasureTarget,
  shiftDiatonicPitch,
  startScoreNoteDrag,
  startScorePointerTap,
  trackScorePointerTap,
  trackScoreNoteDrag,
} from "../lib/music/note-input";
import { appendEventToMeasure, createScore, makeEvent } from "../lib/music/score";

test("diatonic arrow input crosses octave boundaries and clamps to C0 through B8", () => {
  assert.deepEqual(shiftDiatonicPitch({ step: "C", octave: 4 }, 1), { step: "D", octave: 4 });
  assert.deepEqual(shiftDiatonicPitch({ step: "C", octave: 4 }, -1), { step: "B", octave: 3 });
  assert.deepEqual(shiftDiatonicPitch({ step: "B", octave: 4 }, 1), { step: "C", octave: 5 });
  assert.deepEqual(shiftDiatonicPitch({ step: "C", octave: 0 }, -100), { step: "C", octave: 0 });
  assert.deepEqual(shiftDiatonicPitch({ step: "B", octave: 8 }, 100), { step: "B", octave: 8 });
});

test("each input method has one explicit duration, letter, and pitch-button grammar", () => {
  assert.equal(durationKeyAction("arrow-duration"), "enter");
  assert.equal(durationKeyAction("duration-letter"), "select");
  assert.equal(durationKeyAction("score-pointer"), "select");
  assert.equal(durationKeyAction("buttons"), "select");

  assert.equal(letterKeyAction("arrow-duration"), "select");
  assert.equal(letterKeyAction("duration-letter"), "enter");
  assert.equal(letterKeyAction("score-pointer"), "ignore");
  assert.equal(letterKeyAction("buttons"), "ignore");

  assert.equal(pitchButtonAction("arrow-duration"), "select");
  assert.equal(pitchButtonAction("duration-letter"), "enter");
  assert.equal(pitchButtonAction("score-pointer"), "enter");
  assert.equal(pitchButtonAction("buttons"), "enter");
});

test("system modifiers cannot fall through to notation input", () => {
  assert.equal(hasSystemShortcutModifier({ metaKey: true, ctrlKey: false, altKey: false }), true);
  assert.equal(hasSystemShortcutModifier({ metaKey: false, ctrlKey: true, altKey: false }), true);
  assert.equal(hasSystemShortcutModifier({ metaKey: false, ctrlKey: false, altKey: true }), true);
  assert.equal(hasSystemShortcutModifier({ metaKey: false, ctrlKey: false, altKey: false }), false);
});

test("pointer chord targeting requires the same part, staff, and measure", () => {
  const selected = { partId: "part-a", staffId: "staff-a", measureId: "measure-a" };
  assert.equal(sameStaffMeasureTarget(selected, { ...selected }), true);
  assert.equal(sameStaffMeasureTarget(selected, { ...selected, partId: "part-b" }), false);
  assert.equal(sameStaffMeasureTarget(selected, { ...selected, staffId: "staff-b" }), false);
  assert.equal(sameStaffMeasureTarget(selected, { ...selected, measureId: "measure-b" }), false);
  assert.equal(sameStaffMeasureTarget(null, selected), false);
});

test("a primary mouse, touch, or pen tap tolerates small contact jitter", () => {
  const down = { pointerId: 7, clientX: 120, clientY: 240, timeStamp: 100, button: 0, isPrimary: true };
  const tap = startScorePointerTap(down);
  assert.ok(tap);
  const moved = trackScorePointerTap(tap, { ...down, clientX: 123, clientY: 244, timeStamp: 150 });
  assert.equal(finishesScorePointerTap(moved, { ...down, clientX: 124, clientY: 245, timeStamp: 200 }), true);
  assert.equal(startScorePointerTap({ ...down, button: 2 }), null, "right click or a pen barrel button cannot add a note");
  assert.equal(startScorePointerTap({ ...down, isPrimary: false }), null, "a secondary touch cannot start a note");
});

test("scrolls and pen strokes cannot become notes even after returning to the start", () => {
  const down = { pointerId: 1, clientX: 80, clientY: 90, timeStamp: 10, button: 0, isPrimary: true };
  const tap = startScorePointerTap(down);
  assert.ok(tap);
  const dragged = trackScorePointerTap(tap, { ...down, clientX: 105, timeStamp: 70 });
  assert.equal(dragged.cancelled, true);
  assert.equal(finishesScorePointerTap(trackScorePointerTap(dragged, { ...down, timeStamp: 100 }), { ...down, timeStamp: 150 }), false);
  assert.equal(finishesScorePointerTap(tap, { ...down, clientY: 102, timeStamp: 150 }), false, "pointerup also checks distance when no move event was delivered");
  assert.equal(finishesScorePointerTap(tap, { ...down, timeStamp: 800 }), false, "long press is not a tap");
});

test("cancelled, mismatched, and multi-pointer gestures cannot complete note entry", () => {
  const down = { pointerId: 3, clientX: 80, clientY: 90, timeStamp: 10, button: 0, isPrimary: true };
  const tap = startScorePointerTap(down);
  assert.ok(tap);
  const otherPointer = { ...down, pointerId: 4, timeStamp: 40 };
  assert.equal(finishesScorePointerTap(tap, otherPointer), false);
  const pinched = trackScorePointerTap(tap, otherPointer);
  assert.equal(finishesScorePointerTap(pinched, { ...down, timeStamp: 60 }), false);
  assert.equal(finishesScorePointerTap(null, { ...down, timeStamp: 60 }), false, "pointercancel and scroll clear the active gesture");
  assert.equal(finishesScorePointerTap(tap, { ...down, timeStamp: 0 }), false);
  assert.equal(startScorePointerTap({ ...down, clientX: Number.NaN }), null);
});

test("note dragging snaps relative to its grab point and keeps its accidental at every zoom", () => {
  const down = { pointerId: 3, clientX: 180, clientY: 143, timeStamp: 10, button: 0, isPrimary: true };
  const pitch = { step: "C", alter: -1, octave: 4 } as const;
  for (const scale of [.55, .8, 1, 1.5]) {
    const drag = startScoreNoteDrag(down, pitch, 5 * scale);
    assert.ok(drag);
    assert.equal(finishesScoreNoteDrag(drag, { ...down, clientY: 140 }), null, "small contact jitter selects without editing");
    assert.deepEqual(finishesScoreNoteDrag(drag, { ...down, clientY: down.clientY - 15 * scale }), { step: "F", alter: -1, octave: 4 });
    assert.deepEqual(finishesScoreNoteDrag(drag, { ...down, clientY: down.clientY + 15 * scale }), { step: "G", alter: -1, octave: 3 });
    assert.equal(finishesScoreNoteDrag(drag, { ...down, clientX: 400 }), null, "horizontal movement alone never changes pitch");
  }
});

test("the first deliberate drag direction locks time or pitch through later diagonal movement", () => {
  const down = { pointerId: 8, clientX: 200, clientY: 100, timeStamp: 0, button: 0, isPrimary: true };
  const pitch = { step: "E", alter: 1, octave: 4 } as const;
  const drag = startScoreNoteDrag(down, pitch, 5);
  assert.ok(drag);
  const jitter = trackScoreNoteDrag(drag, { ...down, clientX: 205, clientY: 104 });
  assert.equal(jitter.axis, null);
  const time = trackScoreNoteDrag(jitter, { ...down, clientX: 208, clientY: 105 });
  assert.equal(time.axis, "time");
  const nextSystem = trackScoreNoteDrag(time, { ...down, clientX: 150, clientY: 360 });
  assert.equal(nextSystem.axis, "time", "a time drag can reach another system without becoming a pitch edit");
  assert.deepEqual(nextSystem.pitch, pitch);
  assert.equal(finishesScoreNoteDrag(nextSystem, { ...down, clientX: 150, clientY: 360 }), null);

  const vertical = trackScoreNoteDrag(drag, { ...down, clientX: 204, clientY: 92 });
  assert.equal(vertical.axis, "pitch");
  const diagonal = trackScoreNoteDrag(vertical, { ...down, clientX: 400, clientY: 90 });
  assert.equal(diagonal.axis, "pitch");
  assert.deepEqual(finishesScoreNoteDrag(diagonal, { ...down, clientX: 400, clientY: 90 }), { step: "G", alter: 1, octave: 4 });
  assert.equal(trackScoreNoteDrag(time, { ...down, pointerId: 9 }).cancelled, true);
  assert.equal(trackScoreNoteDrag(time, { ...down, clientX: Number.NaN }).cancelled, true);
});

test("note drags preserve the full imported pitch range instead of input-button octave limits", () => {
  const down = { pointerId: 1, clientX: 0, clientY: 100, timeStamp: 0, button: 0, isPrimary: true };
  const low = startScoreNoteDrag(down, { step: "C", alter: 2, octave: -1 }, 5);
  const high = startScoreNoteDrag(down, { step: "B", alter: -2, octave: 9 }, 5);
  assert.ok(low && high);
  assert.deepEqual(finishesScoreNoteDrag(low, { ...down, clientY: 90 }), { step: "E", alter: 2, octave: -1 });
  assert.deepEqual(finishesScoreNoteDrag(high, { ...down, clientY: 110 }), { step: "G", alter: -2, octave: 9 });
  assert.equal(finishesScoreNoteDrag(low, { ...down, clientY: 1000 }), null, "dragging below the minimum leaves it unchanged");
  assert.equal(finishesScoreNoteDrag(high, { ...down, clientY: -1000 }), null, "dragging above the maximum leaves it unchanged");
});

test("cancelled note drags and returning to the original pitch never create a history edit", () => {
  const down = { pointerId: 1, clientX: 100, clientY: 100, timeStamp: 0, button: 0, isPrimary: true };
  const drag = startScoreNoteDrag(down, { step: "E", alter: 0, octave: 4 }, 5);
  assert.ok(drag);
  const moved = trackScoreNoteDrag(drag, { ...down, clientY: 80 });
  assert.equal(moved.activated, true);
  assert.equal(finishesScoreNoteDrag(moved, down), null);
  assert.equal(finishesScoreNoteDrag(moved, { ...down, pointerId: 2, clientY: 70 }), null);
  const invalid = trackScoreNoteDrag(moved, { ...down, clientY: Number.NaN });
  assert.equal(finishesScoreNoteDrag(invalid, { ...down, clientY: 70 }), null, "cancellation remains latched");
  assert.equal(finishesScoreNoteDrag(null, { ...down, clientY: 70 }), null, "Escape, pointercancel, scroll and extra touches clear the gesture");
  assert.equal(startScoreNoteDrag({ ...down, isPrimary: false }, drag.pitch, 5), null);
  assert.equal(startScoreNoteDrag({ ...down, button: 2 }, drag.pitch, 5), null);
  assert.equal(startScoreNoteDrag(down, drag.pitch, 0), null);
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

test("pointer entry splits long notes from the clicked measure and leaves earlier empty measures alone", () => {
  const source = createScore("solo", { seedDemo: false });
  const part = source.parts[0];
  const [firstId, clickedId, nextId] = source.measureOrder;
  getPrimaryVoice(part, clickedId).events.push(makeEvent({ id: "pointer-prefix", pitch: { step: "C", alter: 0, octave: 4 }, duration: { base: 2, dots: 1 }, rest: true }));
  const snapshot = structuredClone(source);
  const event = makeEvent({ id: "pointer-long", pitch: { step: "E", alter: 0, octave: 4 }, duration: { base: 2, dots: 0 }, rest: false });
  const result = appendEventToMeasure(source, part.id, clickedId, event);
  assert.equal(result.error, undefined);
  assert.equal(result.measureId, clickedId);
  assert.equal(result.segmentCount, 2);
  assert.equal(getPrimaryVoice(result.score.parts[0], firstId).events.length, 0);
  const segments = [getPrimaryVoice(result.score.parts[0], clickedId).events[1], getPrimaryVoice(result.score.parts[0], nextId).events[0]];
  assert.deepEqual(segments.map(segment => durationTicks(segment.duration)), [TICKS_PER_QUARTER, TICKS_PER_QUARTER]);
  assert.equal(result.score.ties.length, 1);
  assert.deepEqual(validateScore(result.score), []);
  assert.deepEqual(source, snapshot);
});

test("explicit-measure entry rejects full measures and stale targets atomically", () => {
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


test("floating palette stays reachable, opens toward available space, and adjusts to small screens", () => {
  const bounds = { width: 1000, height: 700, dockHeight: 180 };
  const left = floatingDockPlacement(bounds, { x: 20, y: 220 }, true, true);
  assert.equal(left.side, "right");
  assert.equal(left.helpBelow, true);
  assert.ok(left.left >= 12 && left.left + left.width <= 988);
  const right = floatingDockPlacement(bounds, { x: 910, y: 680 }, true, true);
  assert.equal(right.side, "left");
  assert.equal(right.helpBelow, false);
  assert.ok(right.left >= 12 && right.left + right.width <= 988);
  const small = floatingDockPlacement({ width: 320, height: 500, dockHeight: 180 }, { x: -100, y: -100 }, true, false);
  assert.equal(small.width, 296);
  assert.equal(small.left, 12);
  assert.ok(small.bottom >= 12 && small.bottom + 180 <= 488);
  const closed = floatingDockPlacement(bounds, { x: 440, y: 400 }, false, false);
  assert.equal(closed.width, 80);
  assert.equal(closed.left, 440);
});

test("palette positions round-trip separately from scores, including reset to the default", () => {
  const entries = new Map([["garak.score.v1", "untouched score"]]);
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  assert.deepEqual(loadDockPosition(storage), { position: null, error: null });
  const bounds = { width: 1200, height: 700, dockHeight: 180 };
  const point = { x: 320, y: 430 };
  const position = relativeDockPosition(bounds, point);
  assert.equal(saveDockPosition(storage, position), null);
  const restored = loadDockPosition(storage);
  assert.deepEqual(restored, { position, error: null });
  assert.deepEqual(dockPointFromPosition(bounds, restored.position!), point);
  assert.equal(entries.get("garak.score.v1"), "untouched score");
  assert.equal(saveDockPosition(storage, null), null);
  assert.deepEqual(loadDockPosition(storage), { position: null, error: null });
  assert.equal(entries.get(DOCK_POSITION_STORAGE_KEY), "null");
});

test("saved palette positions adapt to a narrower or rotated workspace without escaping it", () => {
  const large = { width: 1200, height: 900, dockHeight: 180 };
  const saved = relativeDockPosition(large, { x: 980, y: 880 });
  for (const bounds of [{ width: 320, height: 500, dockHeight: 180 }, { width: 1024, height: 600, dockHeight: 136 }]) {
    for (const expanded of [true, false]) {
      const restored = floatingDockPlacement(bounds, dockPointFromPosition(bounds, saved), expanded, false);
      assert.ok(restored.left >= 12);
      assert.ok(restored.left + restored.width <= bounds.width - 12);
      assert.ok(restored.bottom >= 12);
      assert.ok(restored.bottom + bounds.dockHeight <= bounds.height - 12);
    }
  }
});

test("invalid or unavailable palette storage reports failure without changing saved data", () => {
  for (const raw of ['bad-json', '{}', '[]', '{"x":2,"y":0.5}', '{"x":"0.3","y":0.5}', '{"x":0.3,"y":0.5,"extra":true}']) {
    const loaded = loadDockPosition({ getItem: () => raw });
    assert.equal(loaded.position, null);
    assert.ok(loaded.error);
  }
  assert.ok(loadDockPosition({ getItem: () => { throw new Error("blocked"); } }).error);
  assert.match(saveDockPosition({ setItem: () => { throw new Error("quota"); } }, { x: 0.4, y: 0.5 })!, /this visit only/);
  let wrote = false;
  assert.ok(saveDockPosition({ setItem: () => { wrote = true; } }, { x: NaN, y: 0.5 }));
  assert.equal(wrote, false);
});

test("both panel widths persist independently and preserve the existing instruments preference", () => {
  const entries = new Map([["garak.score.v1", "untouched score"], [DOCK_POSITION_STORAGE_KEY, '{"x":0.4,"y":0.5}'], ["garak.instrument-panel-width.v1", "360"]]);
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  assert.deepEqual(loadPanelWidth(storage, "instrument"), { width: 360, error: null });
  assert.deepEqual(loadPanelWidth(storage, "inspector"), { width: 280, error: null });
  assert.equal(savePanelWidth(storage, "inspector", 420), null);
  assert.deepEqual(loadPanelWidth(storage, "inspector"), { width: 420, error: null });
  assert.deepEqual(loadPanelWidth(storage, "instrument"), { width: 360, error: null });
  assert.equal(savePanelWidth(storage, "instrument", 320), null);
  assert.deepEqual(loadPanelWidth(storage, "inspector"), { width: 420, error: null });
  assert.equal(entries.get("garak.score.v1"), "untouched score");
  assert.equal(entries.get(DOCK_POSITION_STORAGE_KEY), '{"x":0.4,"y":0.5}');
  for (const side of PANEL_SIDES) {
    assert.equal(savePanelWidth(storage, side, 280), null);
    assert.deepEqual(loadPanelWidth(storage, side), { width: 280, error: null });
  }
});

test("both docked panels reserve score space, including when both saved widths are large", () => {
  for (const workspace of [1181, 1280, 1440, 1920]) {
    for (const instrument of [200, 280, 360, 480]) {
      for (const inspector of [240, 280, 400, 480]) {
        const layout = workspacePanelLayout({ instrument, inspector }, workspace, "docked");
        assert.ok(workspace - layout.instrument.width - layout.inspector.width >= MIN_SCORE_WIDTH);
        for (const side of PANEL_SIDES) {
          const other = side === "instrument" ? "inspector" : "instrument";
          assert.ok(layout[side].width >= PANEL_LIMITS[side].min);
          assert.ok(layout[side].width <= layout[side].maxWidth);
          assert.ok(workspace - layout[side].maxWidth - layout[other].width >= MIN_SCORE_WIDTH);
        }
      }
    }
  }
  const layout = workspacePanelLayout({ instrument: 360, inspector: 280 }, 1280, "docked");
  assert.equal(layout.inspector.maxWidth, 440);
  assert.equal(clampPanelWidth("inspector", 900, layout.inspector.maxWidth), 440);
  assert.equal(clampPanelWidth("instrument", -100), 200);
  assert.equal(clampPanelWidth("inspector", -100), 240);
  assert.equal(clampPanelWidth("instrument", 250.6), 251);
});

test("narrow layouts constrain display widths without replacing either saved preference", () => {
  const preferred = Object.freeze({ instrument: 480, inspector: 480 });
  const small = workspacePanelLayout(preferred, 320, "drawers");
  assert.equal(small.instrument.width, 284);
  assert.equal(small.inspector.width, 284);
  const tablet = workspacePanelLayout(preferred, 900, "inspector-drawer");
  assert.equal(tablet.instrument.width, 420);
  assert.equal(tablet.inspector.width, 480);
  const wide = workspacePanelLayout(preferred, 1440, "docked");
  assert.equal(wide.instrument.width, 480);
  assert.equal(wide.inspector.width, 480);
  assert.deepEqual(preferred, { instrument: 480, inspector: 480 });
});

test("resizing one constrained panel keeps the other still and restores the same pair after reopening", () => {
  for (const side of PANEL_SIDES) {
    const preferred = { instrument: 480, inspector: 480 };
    const layout = workspacePanelLayout(preferred, 1280, "docked");
    const other = side === "instrument" ? "inspector" : "instrument";
    const next = panelWidthsAfterResize(preferred, layout, side, layout[side].width - 40);
    const resized = workspacePanelLayout(next, 1280, "docked");
    assert.equal(resized[side].width, layout[side].width - 40);
    assert.equal(resized[other].width, layout[other].width);
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    for (const savedSide of PANEL_SIDES) assert.equal(savePanelWidth(storage, savedSide, next[savedSide]), null);
    const restored = { instrument: loadPanelWidth(storage, "instrument").width, inspector: loadPanelWidth(storage, "inspector").width };
    assert.deepEqual(workspacePanelLayout(restored, 1280, "docked"), resized);
    assert.deepEqual(preferred, { instrument: 480, inspector: 480 });
  }
  const preferred = { instrument: 480, inspector: 480 };
  const mobile = workspacePanelLayout(preferred, 320, "drawers");
  assert.deepEqual(panelWidthsAfterResize(preferred, mobile, "inspector", 260), { instrument: 480, inspector: 260 });
});

test("collapsed panels release their columns without losing saved widths, including after resizing the other panel", () => {
  const preferred = Object.freeze({ instrument: 430, inspector: 470 });
  for (const side of PANEL_SIDES) {
    const other = side === "instrument" ? "inspector" : "instrument";
    const collapsed = { instrument: side === "instrument", inspector: side === "inspector" };
    const hidden = workspacePanelLayout(preferred, 1280, "docked", collapsed);
    assert.equal(hidden[side].docked, false);
    assert.equal(hidden[other].docked, true);
    assert.equal(hidden[other].width, preferred[other]);
    assert.equal(hidden[other].maxWidth, 480);
    const resized = panelWidthsAfterResize(preferred, hidden, other, 300);
    assert.equal(resized[side], preferred[side], "resizing the visible panel must not overwrite the hidden panel's preference");
    const reopened = workspacePanelLayout(resized, 1280, "docked");
    assert.equal(reopened[side].width, preferred[side]);
    assert.equal(reopened[other].width, 300);
  }
  for (const mode of ["docked", "inspector-drawer", "drawers"] as const) {
    const closed = workspacePanelLayout(preferred, mode === "drawers" ? 320 : 1024, mode, { instrument: true, inspector: true });
    assert.equal(closed.instrument.docked, false);
    assert.equal(closed.inspector.docked, false);
  }
  const constrained = workspacePanelLayout(preferred, 1280, "docked");
  assert.ok(1280 - constrained.instrument.width - constrained.inspector.width >= MIN_SCORE_WIDTH);
  assert.deepEqual(workspacePanelLayout(preferred, 1600, "docked").instrument.width, 430);
  assert.deepEqual(preferred, { instrument: 430, inspector: 470 });
});

test("each panel's collapsed state survives reopening independently from its width and score data", () => {
  const entries = new Map([["garak.score.v1", "original-score"]]);
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  assert.deepEqual(loadPanelCollapsed(storage, "instrument"), { collapsed: false, error: null });
  savePanelWidth(storage, "instrument", 350);
  savePanelWidth(storage, "inspector", 410);
  assert.equal(savePanelCollapsed(storage, "instrument", true), null);
  assert.equal(savePanelCollapsed(storage, "inspector", true), null);
  assert.equal(loadPanelCollapsed(storage, "instrument").collapsed, true);
  assert.equal(loadPanelCollapsed(storage, "inspector").collapsed, true);
  assert.equal(savePanelCollapsed(storage, "instrument", false), null);
  assert.equal(loadPanelCollapsed(storage, "instrument").collapsed, false);
  assert.equal(loadPanelCollapsed(storage, "inspector").collapsed, true);
  assert.equal(loadPanelWidth(storage, "instrument").width, 350);
  assert.equal(loadPanelWidth(storage, "inspector").width, 410);
  assert.equal(entries.get("garak.score.v1"), "original-score");
});

test("invalid or unavailable visibility storage falls back without overwriting saved widths", () => {
  for (const side of PANEL_SIDES) {
    for (const raw of ["bad-json", "null", '"true"', "0", "{}", "[]"]) {
      const loaded = loadPanelCollapsed({ getItem: () => raw }, side);
      assert.equal(loaded.collapsed, false);
      assert.ok(loaded.error);
    }
    assert.ok(loadPanelCollapsed({ getItem: () => { throw new Error("blocked"); } }, side).error);
    assert.match(savePanelCollapsed({ setItem: () => { throw new Error("quota"); } }, side, true)!, /this visit only/);
  }
});

test("invalid or unavailable panel width storage reports failure independently", () => {
  for (const side of PANEL_SIDES) {
    for (const raw of ["bad-json", "null", "[]", "{}", '"300"', "199", "481", "280.5", "1e309"]) {
      const loaded = loadPanelWidth({ getItem: () => raw }, side);
      assert.equal(loaded.width, 280);
      assert.ok(loaded.error);
    }
    assert.ok(loadPanelWidth({ getItem: () => { throw new Error("blocked"); } }, side).error);
    assert.match(savePanelWidth({ setItem: () => { throw new Error("quota"); } }, side, 360)!, /this visit only/);
    for (const width of [NaN, Infinity, 0, 199, 481, 280.5]) {
      let wrote = false;
      assert.ok(savePanelWidth({ setItem: () => { wrote = true; } }, side, width));
      assert.equal(wrote, false);
    }
  }
  const partlyDamaged = { getItem: (key: string) => key === PANEL_LIMITS.instrument.key ? "360" : "broken" };
  assert.deepEqual(loadPanelWidth(partlyDamaged, "instrument"), { width: 360, error: null });
  assert.ok(loadPanelWidth(partlyDamaged, "inspector").error);
});


test("QWERTYU enters fixed-do pitches without the old rest and tie collisions", () => {
  for (const [key, step] of Object.entries({ q: "C", w: "D", e: "E", r: "F", t: "G", y: "A", u: "B" })) {
    assert.equal(pitchFromKeyboardKey(key), step);
    assert.equal(pitchFromKeyboardKey(key.toUpperCase()), step);
  }
  for (const key of ["a", "s", "d", "f", "~", ".", "1", "Enter", "ArrowUp"]) assert.equal(pitchFromKeyboardKey(key), null);
});

test("chromatic selected-tone keys cross naturals and octaves without changing octave spelling", () => {
  assert.deepEqual(shiftChromaticPitch({ step: "C", octave: 4, alter: 0 }, -1), { step: "B", octave: 3, alter: 0 });
  assert.deepEqual(shiftChromaticPitch({ step: "E", octave: 4, alter: 0 }, 1), { step: "F", octave: 4, alter: 0 });
  assert.deepEqual(shiftChromaticPitch({ step: "D", octave: 4, alter: -1 }, 1), { step: "D", octave: 4, alter: 0 });
  assert.deepEqual(shiftChromaticPitch({ step: "D", octave: 4, alter: -1 }, 12), { step: "D", octave: 5, alter: -1 });
  assert.equal(shiftChromaticPitch({ step: "C", octave: -1, alter: 0 }, -12), null);
  assert.equal(shiftChromaticPitch({ step: "B", octave: 9, alter: 0 }, 12), null);
});
