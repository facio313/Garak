import type { ScoreDocument } from "./model";

export const HISTORY_MAX_ENTRIES = 100;
export const HISTORY_BYTE_BUDGET = 8 * 1024 * 1024;

const estimatedBytes = new WeakMap<ScoreDocument, number>();

/** A stable serialized-size proxy for bounding immutable score snapshots in RAM. */
export function estimateScoreSnapshotBytes(score: ScoreDocument): number {
  const cached = estimatedBytes.get(score);
  if (cached !== undefined) return cached;
  const bytes = new TextEncoder().encode(JSON.stringify(score)).byteLength;
  estimatedBytes.set(score, bytes);
  return bytes;
}

/**
 * Keeps the history edge nearest the current score while enforcing both an
 * entry ceiling and a serialized-byte budget. One snapshot is always retained
 * so even a very large document still has a single safe undo/redo step.
 */
export function trimHistorySnapshots(
  snapshots: readonly ScoreDocument[],
  keep: "start" | "end",
  byteBudget = HISTORY_BYTE_BUDGET,
  maxEntries = HISTORY_MAX_ENTRIES,
): ScoreDocument[] {
  if (!snapshots.length || maxEntries < 1 || byteBudget < 1) return [];
  const retained: ScoreDocument[] = [];
  let totalBytes = 0;
  for (let offset = 0; offset < snapshots.length && retained.length < maxEntries; offset += 1) {
    const index = keep === "start" ? offset : snapshots.length - 1 - offset;
    const snapshot = snapshots[index];
    const bytes = estimateScoreSnapshotBytes(snapshot);
    if (retained.length && totalBytes + bytes > byteBudget) break;
    retained.push(snapshot);
    totalBytes += bytes;
  }
  return keep === "end" ? retained.reverse() : retained;
}
