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
