import type { Clef, PitchStep } from "./model";

export const NOTE_ENTRY_METHODS = [
  "arrow-duration",
  "duration-letter",
  "score-pointer",
  "buttons",
] as const;

export type NoteEntryMethod = typeof NOTE_ENTRY_METHODS[number];

export interface DiatonicPitch {
  step: PitchStep;
  octave: number;
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
