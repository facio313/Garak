import { DEFAULT_MIDI_VELOCITY, DYNAMIC_VELOCITIES, durationTicks, measureCapacity } from "./model";
import type { HairpinSpan, MusicEvent, ScoreDocument } from "./model";

export interface EventTime {
  event: MusicEvent;
  partId: string;
  staffId: string;
  voiceIndex: number;
  startTick: number;
  endTick: number;
}

export function eventTimeline(score: ScoreDocument): Map<string, EventTime> {
  const result = new Map<string, EventTime>();
  let start = 0;
  for (const measureId of score.measureOrder) {
    for (const part of score.parts) for (const staff of part.staves) {
      staff.measures[measureId].voices.forEach((voice, voiceIndex) => {
        let tick = start;
        for (const event of voice.events) {
          const endTick = tick + durationTicks(event.duration);
          result.set(event.id, { event, partId: part.id, staffId: staff.id, voiceIndex, startTick: tick, endTick });
          tick = endTick;
        }
      });
    }
    start += measureCapacity(score.measures[measureId]);
  }
  return result;
}

export interface TimedHairpin extends HairpinSpan {
  staffId: string;
  startTick: number;
  endTick: number;
}

export function timedHairpins(score: ScoreDocument, events = eventTimeline(score)): TimedHairpin[] {
  return (score.hairpins ?? []).flatMap((span) => {
    const start = events.get(span.startEventId);
    const end = events.get(span.endEventId);
    return start && end ? [{ ...span, staffId: start.staffId, startTick: start.startTick, endTick: end.endTick }] : [];
  });
}

/** Only editing commands use this; imports must validate and report broken anchors. */
export function removeOrphanHairpins(score: ScoreDocument): void {
  if (!score.hairpins?.length) return;
  const events = eventTimeline(score);
  score.hairpins = score.hairpins.filter((span) => events.get(span.startEventId)?.event.kind === "note"
    && events.get(span.endEventId)?.event.kind === "note");
}

export interface VelocityPoint { tick: number; velocity: number }
export interface DynamicLane {
  spans: TimedHairpin[];
  marks: VelocityPoint[];
}

function atOrBefore<T>(items: T[], tick: number, position: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (position(items[middle]) <= tick) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function dynamicLanes(score: ScoreDocument): Map<string, DynamicLane> {
  const events = eventTimeline(score);
  const lanes = new Map<string, DynamicLane>();
  for (const span of timedHairpins(score, events)) {
    const lane = lanes.get(span.staffId) ?? { spans: [], marks: [] };
    lane.spans.push(span);
    lanes.set(span.staffId, lane);
  }
  for (const item of events.values()) {
    const lane = lanes.get(item.staffId);
    if (lane && item.event.dynamic) lane.marks.push({ tick: item.startTick, velocity: DYNAMIC_VELOCITIES[item.event.dynamic] });
  }
  for (const lane of lanes.values()) lane.spans.sort((a, b) => a.startTick - b.startTick);
  return lanes;
}

/** Hairpin levels take precedence inside the span. The end level lasts until the next mark. */
export function laneVelocity(lane: DynamicLane, tick: number): number {
  const mark = lane.marks[atOrBefore(lane.marks, tick, (item) => item.tick)];
  const span = lane.spans[atOrBefore(lane.spans, tick, (item) => item.startTick)];
  if (span && tick < span.endTick) {
    const fraction = (tick - span.startTick) / (span.endTick - span.startTick);
    return DYNAMIC_VELOCITIES[span.from] + (DYNAMIC_VELOCITIES[span.to] - DYNAMIC_VELOCITIES[span.from]) * fraction;
  }
  if (span && span.endTick > (mark?.tick ?? -1)) return DYNAMIC_VELOCITIES[span.to];
  return mark?.velocity ?? DEFAULT_MIDI_VELOCITY;
}

export function hairpinEnvelope(lane: DynamicLane, start: number, end: number, bonus: number): VelocityPoint[] | undefined {
  const firstSpan = Math.max(0, atOrBefore(lane.spans, start, (item) => item.startTick));
  const lastSpan = atOrBefore(lane.spans, end, (item) => item.startTick);
  const spans = lane.spans.slice(firstSpan, lastSpan + 1).filter((span) => span.startTick < end && span.endTick > start);
  if (!spans.length) return undefined;
  const ticks = new Set([start, end]);
  for (const span of spans) for (const tick of [span.startTick, span.endTick]) {
    if (tick > start && tick < end) { ticks.add(tick - .001); ticks.add(tick); }
  }
  for (let index = atOrBefore(lane.marks, start, (item) => item.tick) + 1; index < lane.marks.length; index += 1) {
    const mark = lane.marks[index];
    if (mark.tick >= end) break;
    ticks.add(mark.tick - .001);
    ticks.add(mark.tick);
  }
  return [...ticks].sort((a, b) => a - b).map((tick) => ({ tick, velocity: Math.min(127, laneVelocity(lane, tick) + bonus) }));
}
