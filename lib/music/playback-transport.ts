import type { PlaybackNote } from "./exporters";

function velocityAt(note: PlaybackNote, offset: number): number {
  const points = note.velocityEnvelope;
  if (!points?.length) return note.velocity;
  if (offset <= points[0].offsetSeconds) return points[0].velocity;
  for (let i = 1; i < points.length; i++) {
    if (offset <= points[i].offsetSeconds) {
      const previous = points[i - 1], next = points[i];
      const fraction = (offset - previous.offsetSeconds) / (next.offsetSeconds - previous.offsetSeconds);
      return previous.velocity + (next.velocity - previous.velocity) * fraction;
    }
  }
  return points.at(-1)!.velocity;
}

/** Clip sounding ties at an audition boundary, keeping the velocity at that instant. */
export function clipPlaybackNote(note: PlaybackNote, from: number, to: number): PlaybackNote | null {
  const start = Math.max(from, note.startSeconds);
  const end = Math.min(to, note.startSeconds + note.durationSeconds);
  if (end <= start) return null;
  const offset = start - note.startSeconds;
  return {
    ...note, startSeconds: start - from, durationSeconds: end - start,
    notatedDurationSeconds: Math.min(to, note.startSeconds + note.notatedDurationSeconds) - start,
    velocity: velocityAt(note, offset),
    ...(note.velocityEnvelope?.length ? { velocityEnvelope: [
      { offsetSeconds: 0, velocity: velocityAt(note, offset) },
      ...note.velocityEnvelope.filter(point => point.offsetSeconds > offset && point.offsetSeconds < offset + end - start)
        .map(point => ({ ...point, offsetSeconds: point.offsetSeconds - offset })),
      { offsetSeconds: end - start, velocity: velocityAt(note, offset + end - start) },
    ] } : {}),
  };
}

/** Bounded look-ahead in time, without a total note-count cutoff. */
export function createPlaybackQueue(input: readonly PlaybackNote[], from: number, to: number, loop: boolean) {
  const duration = to - from;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Choose a non-empty playback interval.");
  const notes = input.flatMap(note => { const clipped = clipPlaybackNote(note, from, to); return clipped ? [clipped] : []; })
    .sort((a,b) => a.startSeconds - b.startSeconds);
  let index = 0, cycle = 0;
  return {
    noteCount: notes.length, duration,
    position(elapsed: number) { return from + (loop ? Math.max(0, elapsed) % duration : Math.min(duration, Math.max(0, elapsed))); },
    take(elapsed: number, lookAhead = .35): (PlaybackNote & { transportId: string })[] {
      const batch: (PlaybackNote & { transportId: string })[] = [];
      if (!notes.length) return batch;
      if (loop && Math.floor(elapsed / duration) > cycle) { cycle = Math.floor(elapsed / duration); index = 0; }
      while (loop || cycle === 0) {
        if (index === notes.length) { if (!loop) break; cycle++; index = 0; }
        const note = notes[index];
        const start = cycle * duration + note.startSeconds;
        if (start > elapsed + lookAhead) break;
        const transportId = `${cycle}:${index}`;
        index++;
        const absolute = { ...note, startSeconds: start };
        if (start + note.durationSeconds <= elapsed) continue;
        // Late timer callbacks resume the remaining sustain instead of replaying old attacks.
        const clipped = clipPlaybackNote(absolute, Math.max(0, elapsed), cycle * duration + duration);
        if (clipped) batch.push({ ...clipped, transportId, startSeconds: clipped.startSeconds + Math.max(0, elapsed) });
      }
      return batch;
    },
  };
}

/** Convert score-time seconds to audio-time seconds without changing pitch or levels. */
export function playbackNoteAtRate(note: PlaybackNote, rate: number): PlaybackNote {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Playback speed must be positive.");
  return { ...note, startSeconds: note.startSeconds / rate,
    durationSeconds: note.durationSeconds / rate, notatedDurationSeconds: note.notatedDurationSeconds / rate,
    ...(note.velocityEnvelope ? { velocityEnvelope: note.velocityEnvelope.map(point => ({ ...point, offsetSeconds: point.offsetSeconds / rate })) } : {}),
  };
}
