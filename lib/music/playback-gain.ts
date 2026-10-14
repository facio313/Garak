import type { PlaybackNote } from "./exporters";

interface GainAutomation {
  setValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}
const amplitude = (velocity: number) => .015 + velocity / 127 * .105;

/** Schedule the original attack once, then follow the hairpin while the note is held. */
export function schedulePlaybackGain(gain: GainAutomation, note: PlaybackNote, start: number): void {
  const attack = Math.min(.018, note.durationSeconds * .35);
  const end = start + note.durationSeconds;
  gain.setValueAtTime(.0001, start);
  if (!note.velocityEnvelope?.length) {
    gain.exponentialRampToValueAtTime(amplitude(note.velocity), start + attack);
    gain.exponentialRampToValueAtTime(.0001, end);
    return;
  }
  const points = note.velocityEnvelope;
  const at = (offset: number): number => {
    for (let i = 1; i < points.length; i += 1) {
      if (points[i].offsetSeconds >= offset) {
        const previous = points[i - 1];
        const fraction = (offset - previous.offsetSeconds) / (points[i].offsetSeconds - previous.offsetSeconds);
        return previous.velocity + (points[i].velocity - previous.velocity) * fraction;
      }
    }
    return points.at(-1)!.velocity;
  };
  const release = Math.min(.025, note.durationSeconds * .15);
  const sustainEnd = note.durationSeconds - release;
  gain.exponentialRampToValueAtTime(amplitude(at(attack)), start + attack);
  for (const point of points) if (point.offsetSeconds > attack && point.offsetSeconds < sustainEnd) {
    gain.linearRampToValueAtTime(amplitude(point.velocity), start + point.offsetSeconds);
  }
  gain.linearRampToValueAtTime(amplitude(at(sustainEnd)), start + sustainEnd);
  gain.exponentialRampToValueAtTime(.0001, end);
}

/** Preserve the instantaneous level and phase; only replace the remaining automation. */
export function retimePlaybackGain(gain: GainAutomation & { cancelAndHoldAtTime(time: number): unknown }, note: PlaybackNote, now: number): void {
  gain.cancelAndHoldAtTime(now);
  const release = Math.min(.025, note.durationSeconds * .15);
  const sustainEnd = Math.max(0, note.durationSeconds - release);
  for (const point of note.velocityEnvelope ?? []) {
    if (point.offsetSeconds > 0 && point.offsetSeconds < sustainEnd)
      gain.linearRampToValueAtTime(amplitude(point.velocity), now + point.offsetSeconds);
  }
  if (note.velocityEnvelope?.length && sustainEnd > 0) {
    const points = note.velocityEnvelope;
    let velocity = points.at(-1)!.velocity;
    for (let i = 1; i < points.length; i++) if (points[i].offsetSeconds >= sustainEnd) {
      const a = points[i - 1], b = points[i];
      velocity = a.velocity + (b.velocity - a.velocity) * (sustainEnd - a.offsetSeconds) / (b.offsetSeconds - a.offsetSeconds);
      break;
    }
    gain.linearRampToValueAtTime(amplitude(velocity), now + sustainEnd);
  }
  gain.exponentialRampToValueAtTime(.0001, now + note.durationSeconds);
}
