import type { ScoreDocument } from "./model";

/**
 * Native files are compact JSON. The raw-file allowance leaves room for
 * whitespace in third-party files, while the canonical limit guarantees that
 * every Garak-generated snapshot can be opened again without inviting a very
 * large synchronous JSON parse on the editor thread.
 */
export const MAX_NATIVE_SCORE_BYTES = 20 * 1024 * 1024;
export const MAX_NATIVE_FILE_BYTES = 24 * 1024 * 1024;
export const MAX_MUSICXML_FILE_BYTES = 10 * 1024 * 1024;

export function serializeNativeScore(score: ScoreDocument): string {
  const serialized = JSON.stringify(score);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > MAX_NATIVE_SCORE_BYTES) {
    throw new Error("This score exceeds Garak's 20 MB portable native-snapshot limit.");
  }
  return serialized;
}
