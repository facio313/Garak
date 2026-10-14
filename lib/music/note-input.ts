import { writtenMidi } from "./model";
import type { Clef, Pitch, PitchStep } from "./model";

export const PITCH_SHORTCUTS: Record<PitchStep, string> = { C: "Q", D: "W", E: "E", F: "R", G: "T", A: "Y", B: "U" };

export function pitchFromKeyboardKey(key: string): PitchStep | null {
  return (Object.keys(PITCH_SHORTCUTS) as PitchStep[]).find((step) => PITCH_SHORTCUTS[step] === key.toUpperCase()) ?? null;
}

export const NOTE_ENTRY_METHODS = [
  "arrow-duration",
  "duration-letter",
  "score-pointer",
  "buttons",
] as const;

export type NoteEntryMethod = typeof NOTE_ENTRY_METHODS[number];

export type DurationKeyAction = "enter" | "select";
export type LetterKeyAction = "enter" | "select" | "ignore";
export type PitchButtonAction = "enter" | "select";

export interface ShortcutModifiers {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface StaffMeasureTarget {
  partId: string;
  staffId: string;
  measureId: string;
}

export interface DiatonicPitch {
  step: PitchStep;
  octave: number;
}

export interface ScorePointerSample {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export interface ScorePointerTap {
  start: ScorePointerSample;
  cancelled: boolean;
}

export interface ScoreNoteDrag {
  start: ScorePointerSample;
  originalPitch: Pitch;
  pitch: Pitch;
  screenStepHeight: number;
  axis: "pitch" | "time" | null;
  activated: boolean;
  cancelled: boolean;
}

const SCORE_TAP_MOVEMENT_LIMIT = 10;
const SCORE_TAP_TIME_LIMIT_MS = 650;

/** Uses viewport CSS pixels so zoom does not turn a scroll or pen stroke into a tap. */
export function startScorePointerTap(
  pointer: ScorePointerSample & { button: number; isPrimary: boolean },
): ScorePointerTap | null {
  if (!pointer.isPrimary || pointer.button !== 0 || !Number.isFinite(pointer.clientX) || !Number.isFinite(pointer.clientY)) return null;
  return {
    start: { pointerId: pointer.pointerId, clientX: pointer.clientX, clientY: pointer.clientY, timeStamp: pointer.timeStamp },
    cancelled: false,
  };
}

/** Cancellation stays latched even when a drag returns to its starting point. */
export function trackScorePointerTap(tap: ScorePointerTap, pointer: ScorePointerSample): ScorePointerTap {
  const distance = Math.hypot(pointer.clientX - tap.start.clientX, pointer.clientY - tap.start.clientY);
  return tap.cancelled || (pointer.pointerId === tap.start.pointerId && Number.isFinite(distance) && distance <= SCORE_TAP_MOVEMENT_LIMIT)
    ? tap
    : { ...tap, cancelled: true };
}

export function finishesScorePointerTap(tap: ScorePointerTap | null, pointer: ScorePointerSample): boolean {
  if (!tap || pointer.pointerId !== tap.start.pointerId || trackScorePointerTap(tap, pointer).cancelled) return false;
  const elapsed = pointer.timeStamp - tap.start.timeStamp;
  return elapsed >= 0 && elapsed <= SCORE_TAP_TIME_LIMIT_MS;
}

/** A note drag moves relative to the grab point, keeping accidentals and imported octaves. */
export function startScoreNoteDrag(
  pointer: ScorePointerSample & { button: number; isPrimary: boolean },
  pitch: Pitch,
  screenStepHeight: number,
): ScoreNoteDrag | null {
  const tap = startScorePointerTap(pointer);
  if (!tap || !Number.isFinite(screenStepHeight) || screenStepHeight <= 0) return null;
  return { start: tap.start, originalPitch: pitch, pitch, screenStepHeight, axis: null, activated: false, cancelled: false };
}

export function trackScoreNoteDrag(drag: ScoreNoteDrag, pointer: ScorePointerSample): ScoreNoteDrag {
  const deltaY = drag.start.clientY - pointer.clientY;
  const deltaX = pointer.clientX - drag.start.clientX;
  if (drag.cancelled || pointer.pointerId !== drag.start.pointerId || !Number.isFinite(deltaY) || !Number.isFinite(deltaX)) {
    return { ...drag, cancelled: true };
  }
  // Decide once, after contact jitter, so changing rows during a time move cannot alter pitch.
  const axis = drag.axis ?? (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 6
    ? Math.abs(deltaX) > Math.abs(deltaY) ? "time" : "pitch"
    : null);
  if (!axis) return drag;
  if (axis === "time") return { ...drag, axis, activated: true };
  const index = Math.max(-7, Math.min(69, diatonicPitchIndex(drag.originalPitch) + Math.round(deltaY / drag.screenStepHeight)));
  return {
    ...drag,
    axis,
    activated: true,
    pitch: { ...drag.originalPitch, step: DIATONIC_STEPS[positiveModulo(index, 7)], octave: Math.floor(index / 7) },
  };
}

/** Returns one final edit; taps and returning to the original pitch produce no edit. */
export function finishesScoreNoteDrag(drag: ScoreNoteDrag | null, pointer: ScorePointerSample): Pitch | null {
  if (!drag) return null;
  const final = trackScoreNoteDrag(drag, pointer);
  if (final.cancelled || final.axis !== "pitch" || (final.pitch.step === drag.originalPitch.step && final.pitch.octave === drag.originalPitch.octave)) return null;
  return final.pitch;
}

export const SOLFEGE: Record<PitchStep, string> = {
  C: "도",
  D: "레",
  E: "미",
  F: "파",
  G: "솔",
  A: "라",
  B: "시",
};

const DIATONIC_STEPS: readonly PitchStep[] = ["C", "D", "E", "F", "G", "A", "B"];
const MIN_DIATONIC_INDEX = 0;
const MAX_DIATONIC_INDEX = 8 * DIATONIC_STEPS.length + DIATONIC_STEPS.length - 1;

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function diatonicPitchIndex(pitch: DiatonicPitch): number {
  return pitch.octave * DIATONIC_STEPS.length + DIATONIC_STEPS.indexOf(pitch.step);
}

export function diatonicPitchFromIndex(index: number): DiatonicPitch {
  const bounded = Math.max(MIN_DIATONIC_INDEX, Math.min(MAX_DIATONIC_INDEX, Math.round(index)));
  return {
    step: DIATONIC_STEPS[positiveModulo(bounded, DIATONIC_STEPS.length)],
    octave: Math.floor(bounded / DIATONIC_STEPS.length),
  };
}

/** Moves by written staff steps and keeps the editor's supported C0–B8 range. */
export function shiftDiatonicPitch(pitch: DiatonicPitch, delta: number): DiatonicPitch {
  return diatonicPitchFromIndex(diatonicPitchIndex(pitch) + delta);
}

/** Keeps each selectable input grammar explicit and independently testable. */
export function durationKeyAction(method: NoteEntryMethod): DurationKeyAction {
  return method === "arrow-duration" ? "enter" : "select";
}

export function letterKeyAction(method: NoteEntryMethod): LetterKeyAction {
  if (method === "duration-letter") return "enter";
  if (method === "arrow-duration") return "select";
  return "ignore";
}

export function pitchButtonAction(method: NoteEntryMethod): PitchButtonAction {
  return method === "arrow-duration" ? "select" : "enter";
}

/** Browser and OS modifier chords must never mutate the score as plain input. */
export function hasSystemShortcutModifier(modifiers: ShortcutModifiers): boolean {
  return modifiers.metaKey || modifiers.ctrlKey || modifiers.altKey;
}

export function sameStaffMeasureTarget(
  left: StaffMeasureTarget | null | undefined,
  right: StaffMeasureTarget | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.partId === right.partId
    && left.staffId === right.staffId
    && left.measureId === right.measureId,
  );
}

const CLEF_BOTTOM_LINE_PITCH: Partial<Record<Clef, DiatonicPitch>> = {
  treble: { step: "E", octave: 4 },
  bass: { step: "G", octave: 2 },
  alto: { step: "F", octave: 3 },
  tenor: { step: "D", octave: 3 },
};

/**
 * Snaps a pointer to the nearest written line or space. `lineSpacing` is the
 * distance between two adjacent staff lines; half of it is one diatonic step.
 * Percussion is intentionally unsupported until an instrument drum map exists.
 */
export function pitchFromStaffPointer(
  clef: Clef,
  pointerY: number,
  bottomLineY: number,
  lineSpacing: number,
): DiatonicPitch | null {
  const bottomPitch = CLEF_BOTTOM_LINE_PITCH[clef];
  if (!bottomPitch || !Number.isFinite(pointerY) || !Number.isFinite(bottomLineY) || !Number.isFinite(lineSpacing) || lineSpacing <= 0) {
    return null;
  }
  const stepsAboveBottom = Math.round((bottomLineY - pointerY) / (lineSpacing / 2));
  return diatonicPitchFromIndex(diatonicPitchIndex(bottomPitch) + stepsAboveBottom);
}

export function noteEntryMethodShortLabel(method: NoteEntryMethod): string {
  if (method === "arrow-duration") return "Arrow → number";
  if (method === "duration-letter") return "Number → letter";
  if (method === "score-pointer") return "Score click";
  return "Buttons / touch";
}

/** Chromatic edit of one written tone; octaves preserve its spelling. */
export function shiftChromaticPitch(pitch: Pitch, semitones: -12 | -1 | 1 | 12): Pitch | null {
  const letters: PitchStep[] = ["C", "D", "E", "F", "G", "A", "B"];
  const displacements = Math.abs(semitones) === 12 ? [semitones / 12 * 7] : [0, semitones];
  let best: Pitch | null = null;
  for (const displacement of displacements) {
    const position = pitch.octave * 7 + letters.indexOf(pitch.step) + displacement;
    const octave = Math.floor(position / 7);
    const step = letters[((position % 7) + 7) % 7];
    const alter = writtenMidi(pitch) + semitones - writtenMidi({ step, octave, alter: 0 });
    if (octave < -1 || octave > 9 || Math.abs(alter) > 2) continue;
    if (!best || Math.abs(alter) < Math.abs(best.alter)) best = { step, octave, alter: alter as Pitch["alter"] };
  }
  return best;
}
