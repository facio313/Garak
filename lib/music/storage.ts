import type { ScoreDocument } from "./model";
import { validateScore } from "./model";

/** Existing Garak drafts keep using this key for backward compatibility. */
export const SCORE_STORAGE_KEY = "garak.score.v1";
export const SCORE_BACKUP_STORAGE_KEY = `${SCORE_STORAGE_KEY}.backup`;

/** The subset of the Web Storage API needed by Garak's persistence boundary. */
export interface ScoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StoredSnapshotProblem =
  | { kind: "missing" }
  | { kind: "read-failed"; message: string }
  | { kind: "invalid-json"; message: string }
  | { kind: "invalid-score"; errors: string[] };

export type LoadStoredScoreResult =
  | { kind: "loaded"; source: "primary"; score: ScoreDocument }
  | { kind: "loaded"; source: "backup"; score: ScoreDocument; primaryProblem: StoredSnapshotProblem }
  | {
    kind: "fresh";
    reason: "empty" | "unrecoverable";
    primaryProblem: StoredSnapshotProblem;
    backupProblem: StoredSnapshotProblem;
  };

export type SaveStoredScoreResult =
  | { kind: "saved"; backedUpPreviousPrimary: boolean }
  | { kind: "unchanged" }
  | { kind: "rejected"; errors: string[] }
  | { kind: "failed"; phase: "serialize" | "read-primary" | "write-backup" | "write-primary"; message: string };

type SnapshotReadResult =
  | { kind: "valid"; raw: string; score: ScoreDocument }
  | StoredSnapshotProblem;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Storage operation failed.";
}

function readSnapshot(storage: ScoreStorage, key: string): SnapshotReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return { kind: "read-failed", message: errorMessage(error) };
  }

  if (raw === null) return { kind: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return { kind: "invalid-json", message: errorMessage(error) };
  }

  const errors = validateScore(parsed);
  if (errors.length) return { kind: "invalid-score", errors: [...errors] };
  return { kind: "valid", raw, score: parsed as ScoreDocument };
}

/**
 * Reads the primary draft first, then independently validates the last-known-good
 * backup when the primary is missing or damaged. No storage entry is rewritten
 * while loading; callers decide whether a fresh score should be created.
 */
export function loadStoredScore(storage: ScoreStorage): LoadStoredScoreResult {
  const primary = readSnapshot(storage, SCORE_STORAGE_KEY);
  if (primary.kind === "valid") return { kind: "loaded", source: "primary", score: primary.score };

  const backup = readSnapshot(storage, SCORE_BACKUP_STORAGE_KEY);
  if (backup.kind === "valid") {
    return { kind: "loaded", source: "backup", score: backup.score, primaryProblem: primary };
  }

  return {
    kind: "fresh",
    reason: primary.kind === "missing" && backup.kind === "missing" ? "empty" : "unrecoverable",
    primaryProblem: primary,
    backupProblem: backup,
  };
}

/**
 * Persists a validated score without mutating it. When the existing primary is
 * valid and different, it is copied to the backup key before the new primary is
 * written. Web Storage setItem is atomic: if either write throws (including a
 * quota error), the failing key retains its previous value.
 */
export function saveStoredScore(storage: ScoreStorage, score: unknown): SaveStoredScoreResult {
  const errors = validateScore(score);
  if (errors.length) return { kind: "rejected", errors: [...errors] };

  let serialized: string;
  try {
    serialized = JSON.stringify(score);
  } catch (error) {
    return { kind: "failed", phase: "serialize", message: errorMessage(error) };
  }

  const primary = readSnapshot(storage, SCORE_STORAGE_KEY);
  if (primary.kind === "read-failed") {
    return { kind: "failed", phase: "read-primary", message: primary.message };
  }
  if (primary.kind === "valid" && primary.raw === serialized) return { kind: "unchanged" };

  if (primary.kind === "valid") {
    try {
      storage.setItem(SCORE_BACKUP_STORAGE_KEY, primary.raw);
    } catch (error) {
      return { kind: "failed", phase: "write-backup", message: errorMessage(error) };
    }
  }

  try {
    storage.setItem(SCORE_STORAGE_KEY, serialized);
  } catch (error) {
    return { kind: "failed", phase: "write-primary", message: errorMessage(error) };
  }

  return { kind: "saved", backedUpPreviousPrimary: primary.kind === "valid" };
}
