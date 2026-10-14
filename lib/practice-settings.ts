/** Browser practice preferences only; score data and score tempo never belong here. */
export interface PracticeSettings {
  rate: number;
  metronome: boolean;
  volume: number;
  countIn: boolean;
  repeatCountIn: boolean;
  bars: 1 | 2;
  beatGuide: boolean;
}
export const PRACTICE_DEFAULTS: PracticeSettings = { rate: 1, metronome: false, volume: 60, countIn: false, repeatCountIn: false, bars: 1, beatGuide: true };
const UNDO_KEY = "garak.practice.reset-undo";
export function practicePreferenceEntries(settings: PracticeSettings): [string, string][] {
  return [
    ["garak.playback-speed", String(settings.rate)],
    ["garak.practice.metronome", settings.metronome ? "on" : "off"],
    ["garak.practice.click-volume", String(settings.volume)],
    ["garak.practice.count-in", settings.countIn ? "on" : "off"],
    ["garak.practice.repeat-count-in", settings.repeatCountIn ? "on" : "off"],
    ["garak.practice.count-in-bars", String(settings.bars)],
    ["garak.practice.beat-guide", settings.beatGuide ? "on" : "off"],
  ];
}
export function isDefaultPractice(settings: PracticeSettings): boolean {
  return practicePreferenceEntries(settings).every((entry, index) => entry[1] === practicePreferenceEntries(PRACTICE_DEFAULTS)[index][1]);
}
export function discardPracticeResetUndo(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(UNDO_KEY);
}
export function persistPracticeSettings(storage: Pick<Storage, "removeItem" | "setItem">, settings: PracticeSettings, undo: PracticeSettings | null) {
  // Invalidate an older snapshot before writes; a partial failure must never
  // offer an unrelated undo after reopening the application.
  discardPracticeResetUndo(storage);
  for (const [key, value] of practicePreferenceEntries(settings)) storage.setItem(key, value);
  if (undo) storage.setItem(UNDO_KEY, JSON.stringify({ version: 1, settings: undo }));
}
export function readPracticeResetUndo(storage: Pick<Storage, "getItem">): PracticeSettings | null {
  try {
    if (!practicePreferenceEntries(PRACTICE_DEFAULTS).every(([key, value]) => storage.getItem(key) === value)) return null;
    const raw = storage.getItem(UNDO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const settings = parsed?.settings;
    if (parsed?.version !== 1 || !settings || ![.25, .5, .75, 1, 1.25, 1.5, 2].includes(settings.rate)
      || typeof settings.volume !== "number" || !Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 100
      || (settings.bars !== 1 && settings.bars !== 2)
      || [settings.metronome, settings.countIn, settings.repeatCountIn, settings.beatGuide].some(value => typeof value !== "boolean")) return null;
    return { rate: settings.rate, volume: settings.volume, bars: settings.bars, metronome: settings.metronome, countIn: settings.countIn, repeatCountIn: settings.repeatCountIn, beatGuide: settings.beatGuide };
  } catch { return null; }
}
