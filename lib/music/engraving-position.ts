export interface MeasureTickLayout {
  startX: number;
  endX: number;
  tickAnchors: Array<{ tick: number; x: number }>;
}

export function xForMeasureTick(layout: MeasureTickLayout, tick: number, capacity: number): number {
  const safeCapacity = Math.max(0, capacity);
  const safeTick = Math.max(0, Math.min(safeCapacity, tick));
  const anchors = [
    ...(layout.tickAnchors.length ? layout.tickAnchors : [{ tick: 0, x: layout.startX }]),
    { tick: safeCapacity, x: layout.endX },
  ].sort((left, right) => left.tick - right.tick);
  if (safeTick <= anchors[0].tick) return anchors[0].x;
  for (let index = 1; index < anchors.length; index += 1) {
    const next = anchors[index];
    if (safeTick > next.tick) continue;
    const previous = anchors[index - 1];
    if (next.tick === previous.tick) return next.x;
    const progress = (safeTick - previous.tick) / (next.tick - previous.tick);
    return previous.x + (next.x - previous.x) * progress;
  }
  return layout.endX;
}

/** Inverts the engraved spacing, which is deliberately not proportional to elapsed beats. */
export function tickForMeasureX(layout: MeasureTickLayout, x: number, capacity: number): number {
  const safeCapacity = Math.max(0, capacity);
  const anchors = [
    ...(layout.tickAnchors.length ? layout.tickAnchors : [{ tick: 0, x: layout.startX }]),
    { tick: safeCapacity, x: layout.endX },
  ].sort((left, right) => left.tick - right.tick);
  if (x <= anchors[0].x) return anchors[0].tick;
  for (let index = 1; index < anchors.length; index += 1) {
    const next = anchors[index];
    if (x > next.x) continue;
    const previous = anchors[index - 1];
    if (next.x === previous.x) return next.tick;
    const progress = (x - previous.x) / (next.x - previous.x);
    return previous.tick + (next.tick - previous.tick) * progress;
  }
  return safeCapacity;
}

/** Keeps a drop inside its chosen measure; exact onsets retain imported rhythms. */
export function snappedTickForMeasureX(
  layout: MeasureTickLayout,
  x: number,
  capacity: number,
  gridTicks: number,
  exactOnsets: readonly number[] = [],
): number {
  if (!Number.isFinite(x) || !Number.isFinite(capacity) || !Number.isFinite(gridTicks) || capacity <= 0 || gridTicks <= 0) return 0;
  const lastGridTick = Math.max(0, capacity - gridTicks);
  const unsnapped = Math.max(0, Math.min(capacity, tickForMeasureX(layout, x, capacity)));
  const gridTick = Math.max(0, Math.min(Math.floor(lastGridTick / gridTicks) * gridTicks, Math.round(unsnapped / gridTicks) * gridTicks));
  return exactOnsets.reduce((nearest, tick) => (
    Number.isFinite(tick) && tick >= 0 && tick < capacity && Math.abs(tick - unsnapped) < Math.abs(nearest - unsnapped)
      ? tick
      : nearest
  ), gridTick);
}
