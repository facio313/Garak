import assert from "node:assert/strict";
import test from "node:test";
import type { ScoreDocument } from "../lib/music/model";
import { createScore } from "../lib/music/score";
import {
  SCORE_BACKUP_STORAGE_KEY,
  SCORE_STORAGE_KEY,
  loadStoredScore,
  saveStoredScore,
  type ScoreStorage,
} from "../lib/music/storage";

class MemoryStorage implements ScoreStorage {
  readonly values = new Map<string, string>();
  readonly readAttempts: string[] = [];
  readonly writeAttempts: string[] = [];
  failNextReadFor: string | null = null;
  failNextWriteFor: string | null = null;

  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value));
  }

  getItem(key: string): string | null {
    this.readAttempts.push(key);
    if (this.failNextReadFor === key) {
      this.failNextReadFor = null;
      throw new DOMException("Storage access denied", "SecurityError");
    }
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writeAttempts.push(key);
    if (this.failNextWriteFor === key) {
      this.failNextWriteFor = null;
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    }
    this.values.set(key, value);
  }
}

test("loads an existing raw Garak v1 snapshot from the legacy primary key", () => {
  const existing = scoreWithTitle("Existing Garak draft");
  const raw = JSON.stringify(existing);
  const storage = new MemoryStorage({ [SCORE_STORAGE_KEY]: raw });

  const result = loadStoredScore(storage);

  assert.equal(result.kind, "loaded");
  if (result.kind !== "loaded") return;
  assert.equal(result.source, "primary");
  assert.deepEqual(result.score, existing);
  assert.notEqual(result.score, existing, "loading returns parsed data rather than an aliased caller object");
  result.score.metadata.title = "Caller edit";
  assert.equal(storage.values.get(SCORE_STORAGE_KEY), raw, "loaded output must not mutate the persisted snapshot");
});

function scoreWithTitle(title: string): ScoreDocument {
  const score = createScore("chamber", false);
  score.metadata.title = title;
  return score;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

test("saves through the legacy primary key and preserves the previous valid primary as backup", () => {
  const previous = scoreWithTitle("Previous primary");
  const next = deepFreeze(scoreWithTitle("New primary"));
  const previousRaw = JSON.stringify(previous);
  const nextBefore = JSON.stringify(next);
  const storage = new MemoryStorage({ [SCORE_STORAGE_KEY]: previousRaw });

  const result = saveStoredScore(storage, next);

  assert.deepEqual(result, { kind: "saved", backedUpPreviousPrimary: true });
  assert.equal(storage.getItem(SCORE_BACKUP_STORAGE_KEY), previousRaw);
  assert.equal(storage.getItem(SCORE_STORAGE_KEY), nextBefore);
  assert.equal(JSON.stringify(next), nextBefore, "saving must not mutate the source score");
  assert.deepEqual(storage.writeAttempts, [SCORE_BACKUP_STORAGE_KEY, SCORE_STORAGE_KEY]);
});

test("an identical save is a no-op and does not churn the backup", () => {
  const score = scoreWithTitle("Already saved");
  const raw = JSON.stringify(score);
  const existingBackup = JSON.stringify(scoreWithTitle("Older backup"));
  const storage = new MemoryStorage({
    [SCORE_STORAGE_KEY]: raw,
    [SCORE_BACKUP_STORAGE_KEY]: existingBackup,
  });

  assert.deepEqual(saveStoredScore(storage, score), { kind: "unchanged" });
  assert.deepEqual(storage.writeAttempts, []);
  assert.equal(storage.getItem(SCORE_STORAGE_KEY), raw);
  assert.equal(storage.getItem(SCORE_BACKUP_STORAGE_KEY), existingBackup);
});

test("loads a validated backup when the primary JSON is damaged", () => {
  const backup = scoreWithTitle("Last known good");
  const backupRaw = JSON.stringify(backup);
  const storage = new MemoryStorage({
    [SCORE_STORAGE_KEY]: "{not-json",
    [SCORE_BACKUP_STORAGE_KEY]: backupRaw,
  });

  const result = loadStoredScore(storage);

  assert.equal(result.kind, "loaded");
  if (result.kind !== "loaded") return;
  assert.equal(result.source, "backup");
  assert.equal(result.score.metadata.title, "Last known good");
  if (result.source === "backup") assert.equal(result.primaryProblem.kind, "invalid-json");
  result.score.metadata.title = "Caller edit";
  assert.deepEqual(storage.writeAttempts, [], "recovering a backup must not replace the salvageable damaged primary");
  assert.equal(storage.values.get(SCORE_STORAGE_KEY), "{not-json");
  assert.equal(storage.getItem(SCORE_BACKUP_STORAGE_KEY), backupRaw, "loaded output must not mutate storage");
});

test("loads a validated backup when the primary JSON parses but fails score validation", () => {
  const invalidPrimary = { ...scoreWithTitle("Structurally invalid"), parts: [] };
  const backup = scoreWithTitle("Validated fallback");
  const storage = new MemoryStorage({
    [SCORE_STORAGE_KEY]: JSON.stringify(invalidPrimary),
    [SCORE_BACKUP_STORAGE_KEY]: JSON.stringify(backup),
  });

  const result = loadStoredScore(storage);

  assert.equal(result.kind, "loaded");
  if (result.kind !== "loaded") return;
  assert.equal(result.source, "backup");
  assert.equal(result.score.metadata.title, "Validated fallback");
  if (result.source === "backup") assert.equal(result.primaryProblem.kind, "invalid-score");
});

test("loads the backup when reading the primary throws", () => {
  const backup = scoreWithTitle("Readable backup");
  const storage = new MemoryStorage({ [SCORE_BACKUP_STORAGE_KEY]: JSON.stringify(backup) });
  storage.failNextReadFor = SCORE_STORAGE_KEY;

  const result = loadStoredScore(storage);

  assert.equal(result.kind, "loaded");
  if (result.kind !== "loaded") return;
  assert.equal(result.source, "backup");
  assert.equal(result.score.metadata.title, "Readable backup");
  if (result.source === "backup") assert.equal(result.primaryProblem.kind, "read-failed");
});

test("returns an explicit fresh result when neither snapshot is usable", () => {
  const invalidScore = { ...scoreWithTitle("Invalid primary"), parts: [] };
  const storage = new MemoryStorage({
    [SCORE_STORAGE_KEY]: JSON.stringify(invalidScore),
    [SCORE_BACKUP_STORAGE_KEY]: "[broken",
  });

  const result = loadStoredScore(storage);

  assert.equal(result.kind, "fresh");
  if (result.kind !== "fresh") return;
  assert.equal(result.reason, "unrecoverable");
  assert.equal(result.primaryProblem.kind, "invalid-score");
  assert.equal(result.backupProblem.kind, "invalid-json");
  assert.deepEqual(storage.writeAttempts, [], "loading an unrecoverable store must never schedule or perform replacement writes");
  assert.equal(storage.values.get(SCORE_STORAGE_KEY), JSON.stringify(invalidScore));
  assert.equal(storage.values.get(SCORE_BACKUP_STORAGE_KEY), "[broken");
});

test("distinguishes an empty store from damaged snapshots", () => {
  const result = loadStoredScore(new MemoryStorage());

  assert.deepEqual(result, {
    kind: "fresh",
    reason: "empty",
    primaryProblem: { kind: "missing" },
    backupProblem: { kind: "missing" },
  });
});

test("rejects an invalid score before any storage read or write can replace a draft", () => {
  const previousRaw = JSON.stringify(scoreWithTitle("Keep me"));
  const storage = new MemoryStorage({ [SCORE_STORAGE_KEY]: previousRaw });
  const invalid = { ...scoreWithTitle("Invalid"), measureOrder: [] };

  const result = saveStoredScore(storage, invalid);

  assert.equal(result.kind, "rejected");
  assert.deepEqual(storage.readAttempts, []);
  assert.deepEqual(storage.writeAttempts, []);
  assert.equal(storage.values.get(SCORE_STORAGE_KEY), previousRaw);
});

test("a primary read failure aborts saving before any write", () => {
  const previousRaw = JSON.stringify(scoreWithTitle("Unread but preserved"));
  const storage = new MemoryStorage({ [SCORE_STORAGE_KEY]: previousRaw });
  storage.failNextReadFor = SCORE_STORAGE_KEY;

  const result = saveStoredScore(storage, scoreWithTitle("Do not write"));

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.phase, "read-primary");
  assert.deepEqual(storage.writeAttempts, []);
  assert.equal(storage.getItem(SCORE_STORAGE_KEY), previousRaw);
});

test("a backup write failure leaves the existing primary untouched", () => {
  const previousRaw = JSON.stringify(scoreWithTitle("Keep primary"));
  const storage = new MemoryStorage({ [SCORE_STORAGE_KEY]: previousRaw });
  storage.failNextWriteFor = SCORE_BACKUP_STORAGE_KEY;

  const result = saveStoredScore(storage, scoreWithTitle("Would replace primary"));

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.phase, "write-backup");
  assert.equal(storage.getItem(SCORE_STORAGE_KEY), previousRaw);
  assert.deepEqual(storage.writeAttempts, [SCORE_BACKUP_STORAGE_KEY]);
});

test("a primary quota failure retains the old primary and its last-known-good backup", () => {
  const previousRaw = JSON.stringify(scoreWithTitle("Keep primary"));
  const storage = new MemoryStorage({ [SCORE_STORAGE_KEY]: previousRaw });
  storage.failNextWriteFor = SCORE_STORAGE_KEY;

  const result = saveStoredScore(storage, scoreWithTitle("Quota failure"));

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.phase, "write-primary");
  assert.equal(storage.getItem(SCORE_STORAGE_KEY), previousRaw);
  assert.equal(storage.getItem(SCORE_BACKUP_STORAGE_KEY), previousRaw);
  assert.deepEqual(storage.writeAttempts, [SCORE_BACKUP_STORAGE_KEY, SCORE_STORAGE_KEY]);
});
