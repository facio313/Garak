import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_BYTE_BUDGET,
  HISTORY_MAX_ENTRIES,
  estimateScoreSnapshotBytes,
  trimHistorySnapshots,
} from "../lib/music/history";
import { createScore } from "../lib/music/score";

test("history keeps the current edge and never retains an unbounded large-score snapshot stack", () => {
  const snapshots = Array.from({ length: 40 }, (_, index) => {
    const score = createScore("solo", { seedDemo: false });
    score.metadata.title = `${index}:${"가".repeat(140_000)}`;
    return score;
  });

  const past = trimHistorySnapshots(snapshots, "end");
  const future = trimHistorySnapshots(snapshots, "start");
  assert.equal(past.at(-1), snapshots.at(-1));
  assert.equal(future[0], snapshots[0]);
  assert.ok(past.length < snapshots.length);
  assert.ok(future.length < snapshots.length);
  assert.ok(past.length <= HISTORY_MAX_ENTRIES);
  assert.ok(future.length <= HISTORY_MAX_ENTRIES);
  assert.ok(past.reduce((total, score) => total + estimateScoreSnapshotBytes(score), 0) <= HISTORY_BYTE_BUDGET);
  assert.ok(future.reduce((total, score) => total + estimateScoreSnapshotBytes(score), 0) <= HISTORY_BYTE_BUDGET);
  assert.deepEqual(snapshots.map((score) => Number(score.metadata.title.split(":")[0])), Array.from({ length: 40 }, (_, index) => index));
});

test("history retains one oversized snapshot and honors the hard entry ceiling for tiny scores", () => {
  const oversized = createScore("solo", { seedDemo: false });
  oversized.metadata.title = "A".repeat(HISTORY_BYTE_BUDGET + 1);
  assert.deepEqual(trimHistorySnapshots([oversized], "end"), [oversized]);

  const tiny = Array.from({ length: HISTORY_MAX_ENTRIES + 20 }, () => createScore("solo", { seedDemo: false }));
  const retained = trimHistorySnapshots(tiny, "end", Number.MAX_SAFE_INTEGER);
  assert.equal(retained.length, HISTORY_MAX_ENTRIES);
  assert.equal(retained[0], tiny[20]);
  assert.equal(retained.at(-1), tiny.at(-1));
});
