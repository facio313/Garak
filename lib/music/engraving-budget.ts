import type { PartData, ScoreDocument } from "./model";

/**
 * A conservative main-thread budget for the current single-SVG VexFlow
 * renderer. These limits do not reject, truncate, or mutate a valid score;
 * they only decide whether an interactive engraving is safe to construct.
 */
export const LIVE_ENGRAVING_LIMITS = Object.freeze({
  measures: 128,
  rows: 32,
  staffMeasureCells: 512,
  events: 2_048,
  notes: 4_096,
  ties: 2_048,
} as const);

export interface LiveEngravingStats {
  measures: number;
  rows: number;
  staffMeasureCells: number;
  events: number;
  notes: number;
  ties: number;
}

export type LiveEngravingPlan = {
  kind: "safe" | "part-fallback" | "blocked";
  parts: readonly PartData[];
  /** Complexity of the user-requested score/part scope. */
  stats: LiveEngravingStats;
  /** Complexity actually handed to the renderer after any safe fallback. */
  renderedStats: LiveEngravingStats;
  exceeded: readonly (keyof typeof LIVE_ENGRAVING_LIMITS)[];
};

function overLimit(stats: LiveEngravingStats): (keyof typeof LIVE_ENGRAVING_LIMITS)[] {
  return (Object.keys(LIVE_ENGRAVING_LIMITS) as (keyof typeof LIVE_ENGRAVING_LIMITS)[])
    .filter((key) => stats[key] > LIVE_ENGRAVING_LIMITS[key]);
}

export function measureLiveEngraving(score: ScoreDocument, parts: readonly PartData[]): LiveEngravingStats {
  const measures = score.measureOrder.length;
  const rows = parts.reduce((sum, part) => sum + part.staves.length, 0);
  const staffMeasureCells = rows * measures;
  const stats: LiveEngravingStats = { measures, rows, staffMeasureCells, events: 0, notes: 0, ties: 0 };

  if (
    measures > LIVE_ENGRAVING_LIMITS.measures
    || rows > LIVE_ENGRAVING_LIMITS.rows
    || staffMeasureCells > LIVE_ENGRAVING_LIMITS.staffMeasureCells
  ) return stats;

  const visibleNoteIds = new Set<string>();
  for (const part of parts) {
    for (const staff of part.staves) {
      for (const measureId of score.measureOrder) {
        const voices = staff.measures[measureId]?.voices ?? [];
        for (const voice of voices) {
          for (const event of voice.events) {
            stats.events += 1;
            if (event.kind === "note") {
              stats.notes += event.notes.length;
              event.notes.forEach((note) => visibleNoteIds.add(note.id));
            }
            if (stats.events > LIVE_ENGRAVING_LIMITS.events || stats.notes > LIVE_ENGRAVING_LIMITS.notes) return stats;
          }
        }
      }
    }
  }

  for (const tie of score.ties) {
    if (visibleNoteIds.has(tie.fromNoteId) && visibleNoteIds.has(tie.toNoteId)) stats.ties += 1;
    if (stats.ties > LIVE_ENGRAVING_LIMITS.ties) break;
  }
  return stats;
}

/** Plans a safe visible scope without ever modifying or truncating the score. */
export function planLiveEngraving(
  score: ScoreDocument,
  requestedViewMode: "score" | "part",
  selectedPartId: string,
): LiveEngravingPlan {
  const selectedPart = score.parts.find((part) => part.id === selectedPartId) ?? score.parts[0];
  const requestedParts = requestedViewMode === "part" && selectedPart ? [selectedPart] : score.parts;
  const requestedStats = measureLiveEngraving(score, requestedParts);
  const requestedExceeded = overLimit(requestedStats);
  if (!requestedExceeded.length) {
    return { kind: "safe", parts: requestedParts, stats: requestedStats, renderedStats: requestedStats, exceeded: [] };
  }

  if (requestedViewMode === "score" && selectedPart) {
    const partStats = measureLiveEngraving(score, [selectedPart]);
    const partExceeded = overLimit(partStats);
    if (!partExceeded.length) {
      return { kind: "part-fallback", parts: [selectedPart], stats: requestedStats, renderedStats: partStats, exceeded: requestedExceeded };
    }
  }

  return { kind: "blocked", parts: requestedParts, stats: requestedStats, renderedStats: requestedStats, exceeded: requestedExceeded };
}
