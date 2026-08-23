import { keySignatureAlterForStep } from "./key-signatures";
import type { KeySignature } from "./key-signatures";
import type { MusicEvent, Pitch } from "./model";

export type EngravingAccidental = "bb" | "b" | "n" | "#" | "##";

export function accidentalForAlter(alter: Pitch["alter"]): EngravingAccidental {
  if (alter === -2) return "bb";
  if (alter === -1) return "b";
  if (alter === 1) return "#";
  if (alter === 2) return "##";
  return "n";
}

/**
 * Resolve only the accidentals that must be printed in one written-key measure.
 * Pitch semantics stay on the score events; this function owns display context only.
 */
export function resolveMeasureAccidentals(
  events: readonly MusicEvent[],
  writtenKey: KeySignature,
  tiedDestinationIds: ReadonlySet<string> = new Set(),
): Map<string, EngravingAccidental> {
  const active = new Map<string, Pitch["alter"]>();
  const printed = new Map<string, EngravingAccidental>();

  for (const event of events) {
    if (event.kind !== "note") continue;
    for (const note of event.notes) {
      const stateKey = `${note.pitch.step}:${note.pitch.octave}`;
      const previous = active.get(stateKey) ?? keySignatureAlterForStep(writtenKey, note.pitch.step);
      const changed = note.pitch.alter !== previous;
      const forced = note.accidentalDisplay === "force";
      const hidden = note.accidentalDisplay === "hide";
      const tiedContinuation = tiedDestinationIds.has(note.id);
      if (!hidden && (forced || (!tiedContinuation && changed))) {
        printed.set(note.id, accidentalForAlter(note.pitch.alter));
      }

      // An automatic tied destination inherits its pitch from the note before the
      // barline. It must not establish accidental state for later re-attacks in
      // this measure. A forced accidental is an explicit new printed statement.
      if (!tiedContinuation || forced) active.set(stateKey, note.pitch.alter);
    }
  }

  return printed;
}

export function timeSignaturesEqual(
  first: { numerator: number; denominator: number },
  second: { numerator: number; denominator: number },
): boolean {
  return first.numerator === second.numerator && first.denominator === second.denominator;
}

export function keySignaturesEqual(first: KeySignature, second: KeySignature): boolean {
  // Major/minor mode is preserved by the score model and exporters, but it does
  // not change the set of glyphs printed by a traditional key signature.
  return first.fifths === second.fifths;
}
