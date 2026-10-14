import { METRONOME_PART, COUNT_IN_PART } from "./metronome";
import type { PlaybackNote } from "./exporters";
import { clipPlaybackNote, createPlaybackQueue, playbackNoteAtRate } from "./playback-transport";
import { retimePlaybackGain, schedulePlaybackGain } from "./playback-gain";

/** A score-time clock and a live voice registry: rate changes never restart a sounding oscillator. */
export function createLivePlayback(context: Pick<AudioContext, "currentTime" | "createOscillator" | "createGain">, master: AudioNode,
  notes: readonly PlaybackNote[], from: number, to: number, loop: boolean, initialRate: number, offset: number,
  families: ReadonlyMap<string, string>, countIn?: { duration: number; notes: readonly PlaybackNote[]; beatsPerBar?: number }, clickOutputs?: { metronome: AudioNode; countIn: AudioNode }, repeatCountIn?: { duration: number; notes: readonly PlaybackNote[]; beatsPerBar?: number }) {
  type Count = NonNullable<typeof repeatCountIn>;
  const musicDuration = to - from;
  const musicNotes = notes.flatMap(note => { const clipped = clipPlaybackNote(note, from, to); return clipped ? [clipped] : []; });
  const makeEpoch = (start: number, count?: Count) => {
    const duration = musicDuration + (count?.duration ?? 0);
    const events = [...musicNotes, ...(count?.notes.map(note => ({ ...note, partId: COUNT_IN_PART, startSeconds: musicDuration + note.startSeconds })) ?? [])];
    return { start, count, duration, events, queue: createPlaybackQueue(events, 0, duration, loop) };
  };
  let epochs = [makeEpoch(0, loop ? repeatCountIn : undefined)];
  const epochAt = (time: number) => epochs.findLast(epoch => epoch.start <= Math.max(0, time)) ?? epochs[0];
  const phaseAt = (time: number) => {
    const epoch = epochAt(time);
    const relative = Math.max(0, time - epoch.start);
    const cycle = loop ? Math.floor(relative / epoch.duration) : 0;
    return { epoch, phase: loop ? relative % epoch.duration : Math.min(musicDuration, relative), cycleStart: epoch.start + cycle * epoch.duration };
  };
  let countQueue = countIn ? createPlaybackQueue(countIn.notes, 0, countIn.duration, false) : null;
  const lead = countIn?.duration ?? 0;
  let rate = initialRate, anchorScore = offset - lead, anchorAudio = context.currentTime + .08;
  type Voice = { note: PlaybackNote; oscillator: OscillatorNode; gain: GainNode; audioStart: number };
  const voices = new Map<string, Voice>();
  const elapsed = () => anchorScore + Math.max(0, context.currentTime - anchorAudio) * rate;
  const schedule = () => {
    const time = elapsed();
    const batch = epochs.flatMap((epoch, index) => {
      const until = epochs[index + 1]?.start ?? Infinity;
      const begin = Math.max(0, time, epoch.start);
      const horizon = Math.min(time + .35 * rate, until);
      if (begin >= until || horizon < begin) return [];
      return epoch.queue.take(begin - epoch.start, horizon - begin).flatMap(note => {
        const startSeconds = note.startSeconds + epoch.start;
        if (startSeconds >= until) return [];
        const [cycle, event] = note.transportId.split(":");
        const origin = epoch.start + Number(cycle) * epoch.duration;
        return [{ ...note, startSeconds, transportId: `${origin.toFixed(9)}:${event}` }];
      });
    });
    const countBatch = countQueue && time < 0 ? countQueue.take(time + lead, .35 * rate).map(note => ({ ...note, startSeconds: note.startSeconds - lead, transportId: `count:${note.transportId}` })) : [];
    for (const note of [...batch, ...countBatch]) {
      if (voices.has(note.transportId)) continue;
      const item = playbackNoteAtRate(note, rate);
      const oscillator = context.createOscillator(), gain = context.createGain();
      const family = families.get(note.partId);
      oscillator.type = family === "Brass" ? "sawtooth" : family === "Strings" ? "triangle" : "sine";
      oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
      const noteStart = anchorAudio + (note.startSeconds - anchorScore) / rate;
      schedulePlaybackGain(gain.gain, item, noteStart);
      const output = (note.partId === METRONOME_PART || note.partId === COUNT_IN_PART) && clickOutputs
        ? note.transportId.startsWith("count:") || note.partId === COUNT_IN_PART ? clickOutputs.countIn : clickOutputs.metronome
        : master;
      oscillator.connect(gain).connect(output);
      const voice = { note, oscillator, gain, audioStart: noteStart };
      voices.set(note.transportId, voice);
      oscillator.onended = () => {
        oscillator.disconnect(); gain.disconnect();
        if (voices.get(note.transportId) === voice) voices.delete(note.transportId);
      };
      oscillator.start(noteStart);
      oscillator.stop(noteStart + item.durationSeconds);
    }
  };
  return {
    elapsed, schedule,
    position: () => {
      const { phase } = phaseAt(elapsed());
      return from + (phase >= musicDuration && loop ? 0 : phase);
    },
    countInProgress: () => {
      const time = elapsed();
      const { phase, epoch } = phaseAt(time);
      const current = time < 0 ? countIn : phase >= musicDuration ? epoch.count : undefined;
      if (!current) return null;
      const progress = time < 0 ? time + current.duration : phase - musicDuration;
      const index = Math.min(current.notes.length - 1, Math.floor(progress / (current.duration / current.notes.length)));
      const beats = current.beatsPerBar ?? current.notes.length;
      return { bar: Math.floor(index / beats) + 1, bars: current.notes.length / beats, beat: index % beats + 1, beats };
    },
    setRepeatCountIn(next?: Count) {
      if (!loop) return;
      const time = elapsed();
      const { epoch, phase, cycleStart } = phaseAt(time);
      // A count already in progress is indivisible. Otherwise keep this music
      // pass, and only change the gap before the next pass.
      epochs = time >= 0 && phase >= musicDuration
        ? [makeEpoch(cycleStart, epoch.count), makeEpoch(cycleStart + epoch.duration, next)]
        : [makeEpoch(cycleStart, next)];
      for (const [id, voice] of voices) if (voice.audioStart > context.currentTime && !id.startsWith("count:")) {
        voice.oscillator.stop(context.currentTime); voice.oscillator.disconnect(); voice.gain.disconnect(); voices.delete(id);
      }
      schedule();
    },
    setRate(next: number) {
      if (!Number.isFinite(next) || next <= 0) throw new Error("Playback speed must be positive.");
      const time = elapsed(), now = context.currentTime;
      anchorScore = time; anchorAudio = now; rate = next;
      for (const [id, voice] of voices) {
        if (voice.audioStart > now) {
          voice.oscillator.stop(now); voice.oscillator.disconnect(); voice.gain.disconnect(); voices.delete(id);
          continue;
        }
        const remaining = clipPlaybackNote(voice.note, time, Number.POSITIVE_INFINITY);
        if (!remaining) continue;
        const scaled = playbackNoteAtRate(remaining, rate);
        retimePlaybackGain(voice.gain.gain, scaled, now);
        // Web Audio replaces the previous scheduled stop when the source has not ended.
        voice.oscillator.stop(now + scaled.durationSeconds);
      }
      epochs = epochs.map(epoch => makeEpoch(epoch.start, epoch.count));
      countQueue = countIn ? createPlaybackQueue(countIn.notes, 0, countIn.duration, false) : null;
      schedule();
    },
  };
}
