import type { InstrumentSnapshot, PartData, Transposition } from "./model";

export type KeyMode = "major" | "minor";

/** A traditional key signature expressed as a position on the circle of fifths. */
export interface KeySignature {
  /** Flats are negative, sharps are positive. Garak's editable range is seven of either. */
  fifths: number;
  mode: KeyMode;
}

export interface KeySignatureOption extends KeySignature {
  tonic: string;
  label: string;
}

export interface WrittenKeySignatureSnapshot {
  instrumentCatalogId: string;
  concertKey: KeySignature;
  writtenKey: KeySignature;
  transposition: Transposition;
}

const MAJOR_TONICS = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"] as const;
const MINOR_TONICS = ["A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "D♯", "A♯"] as const;
const VEXFLOW_KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"] as const;
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"] as const;
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"] as const;

/** All traditional major and minor signatures supported by the editor. */
export const KEY_SIGNATURES: readonly KeySignatureOption[] = (["major", "minor"] as const).flatMap((mode) =>
  Array.from({ length: 15 }, (_, index) => {
    const fifths = index - 7;
    const tonic = mode === "major" ? MAJOR_TONICS[index] : MINOR_TONICS[index];
    return { fifths, mode, tonic, label: `${tonic} ${mode}` };
  }),
);

export function isKeySignature(value: unknown): value is KeySignature {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KeySignature>;
  return Number.isInteger(candidate.fifths) && candidate.fifths! >= -7 && candidate.fifths! <= 7 &&
    (candidate.mode === "major" || candidate.mode === "minor");
}

export function assertKeySignature(value: unknown): asserts value is KeySignature {
  if (!isKeySignature(value)) {
    throw new RangeError("A key signature needs an integer fifths value from -7 to 7 and a major or minor mode.");
  }
}

export function keySignatureName(key: KeySignature): string {
  assertKeySignature(key);
  const tonic = key.mode === "major" ? MAJOR_TONICS[key.fifths + 7] : MINOR_TONICS[key.fifths + 7];
  return `${tonic} ${key.mode}`;
}

/** VexFlow key specifications describe the printed accidental set, independent of mode. */
export function fifthsToVexFlowKey(fifths: number): string {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) {
    throw new RangeError("VexFlow key signature fifths must be an integer from -7 to 7.");
  }
  return VEXFLOW_KEYS[fifths + 7];
}

/** The written alteration implied by a traditional key signature for one pitch step. */
export function keySignatureAlterForStep(key: KeySignature, step: typeof SHARP_ORDER[number]): -1 | 0 | 1 {
  assertKeySignature(key);
  if (key.fifths > 0 && SHARP_ORDER.slice(0, key.fifths).includes(step)) return 1;
  if (key.fifths < 0 && FLAT_ORDER.slice(0, -key.fifths).includes(step)) return -1;
  return 0;
}

/**
 * Returns an enharmonic traditional key in Garak's -7..7 range.
 * Circle-of-fifths positions twelve apart name the same pitch class.
 */
export function normalizeKeyFifths(fifths: number): number {
  if (!Number.isInteger(fifths)) throw new RangeError("Key signature fifths must be an integer.");
  let normalized = fifths;
  while (normalized > 7) normalized -= 12;
  while (normalized < -7) normalized += 12;
  return normalized;
}

/** Circle-of-fifths displacement from written key to sounding key. */
export function transpositionFifths(transposition: Transposition): number {
  return 7 * transposition.chromatic - 12 * transposition.diatonic;
}

/**
 * Converts a concert key to the traditional key signature printed in a part.
 * Octave displacement intentionally has no effect on a key signature.
 */
export function concertToWrittenKey(concertKey: KeySignature, transposition: Transposition): KeySignature {
  assertKeySignature(concertKey);
  return {
    fifths: normalizeKeyFifths(concertKey.fifths - transpositionFifths(transposition)),
    mode: concertKey.mode,
  };
}

export function writtenKeyForPart(concertKey: KeySignature, part: Pick<PartData, "instrument">): KeySignature {
  return concertToWrittenKey(concertKey, part.instrument.transposition);
}

/** Captures enough immutable metadata to reproduce a part's printed key later. */
export function createWrittenKeySignatureSnapshot(
  concertKey: KeySignature,
  instrument: Pick<InstrumentSnapshot, "catalogId" | "transposition">,
): WrittenKeySignatureSnapshot {
  return {
    instrumentCatalogId: instrument.catalogId,
    concertKey: { ...concertKey },
    writtenKey: concertToWrittenKey(concertKey, instrument.transposition),
    transposition: { ...instrument.transposition },
  };
}
