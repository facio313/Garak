"use client";

import {
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  FileDown,
  FileJson,
  FileMusic,
  FolderOpen,
  Grip,
  RotateCcw,
  Keyboard,
  Minus,
  Music2,
  MoveHorizontal,
  Pause,
  Square,
  Timer,
  Repeat2,
  Drum,
  SlidersHorizontal,
  Eye,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Printer,
  Redo2,
  Save,
  Search,
  Scan,
  Trash2,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import { PRACTICE_DEFAULTS, isDefaultPractice, persistPracticeSettings, readPracticeResetUndo, discardPracticeResetUndo, type PracticeSettings } from "../lib/practice-settings";
import { useFloatingNoteDock } from "./useFloatingNoteDock";
import { useWorkspacePanelWidths } from "./useWorkspacePanelWidths";
import type { PanelSide } from "../lib/panel-widths";
import type { EventRangeDurationChange, EventRangeExpressionChange, HairpinChange } from "../lib/music/score";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { FAMILIES, INSTRUMENTS, SCORE_TEMPLATES } from "../lib/music/catalog";
import { collectPlaybackNotes, scoreToMidi, scoreToMusicXML } from "../lib/music/exporters";
import { planLiveEngraving } from "../lib/music/engraving-budget";
import { trimHistorySnapshots } from "../lib/music/history";
import { KEY_SIGNATURES, keySignatureAlterForStep, keySignatureName, writtenKeyForPart } from "../lib/music/key-signatures";
import type { KeySignature } from "../lib/music/key-signatures";
import type { Articulation, DurationBase, DurationValue, DynamicMarking, MusicEvent, Pitch, PitchStep, ScoreDocument, ScoreNote } from "../lib/music/model";
import { ARTICULATIONS, DURATION_LABELS, DYNAMIC_MARKINGS, TICKS_PER_QUARTER, durationTicks, getPrimaryVoice, measureCapacity, nextAugmentationDotCount, pitchName, resolveStaffIndex, validateScore, voiceTicks } from "../lib/music/model";
import { MAX_MUSICXML_FILE_BYTES, MAX_NATIVE_FILE_BYTES, serializeNativeScore } from "../lib/music/native-format";
import {
  SOLFEGE,
  hasSystemShortcutModifier,
  pitchFromKeyboardKey,
  PITCH_SHORTCUTS,
  noteEntryMethodShortLabel,
  pitchButtonAction,
  sameStaffMeasureTarget,
  shiftDiatonicPitch,
  shiftChromaticPitch,
} from "../lib/music/note-input";
import type { DiatonicPitch, NoteEntryMethod } from "../lib/music/note-input";
import { locatePlaybackPosition } from "../lib/music/playback-position";
import { createPlaybackQueue } from "../lib/music/playback-transport";
import { countInForPosition, metronomeNotes } from "../lib/music/metronome";
import { createLivePlayback } from "../lib/music/live-playback";
import { addChordTone, addChordToneToEvent, addInstrument, appendEvent, appendEventToMeasure, appendMeasure, changeEventRangeDuration, clearEventRange, clearEventToRest, copyEventRangeToPosition, createScore, editEventNotation, eventRhythm, findEventTargetMeasureId, getEventRange, getTiedNoteIds, makeEvent, moveEventRangeToPosition, moveEventToPosition, removeChordToneFromEvent, removeEvent, removeInstrument, removeLastChordTone, removeLastEvent, removeLastMeasure, setEventArticulation, setEventDynamic, setKeyFromMeasure, setLastEventDynamic, setLastNoteArticulation, setNoteTie, setTimeFromMeasure, toggleTieLastTwo, transposeEventRange, updatePart } from "../lib/music/score";
import { setEventRangeHairpin, setEventRangeExpression } from "../lib/music/score";
import { loadStoredScore, saveStoredScore } from "../lib/music/storage";
import { DurationIcon } from "./DurationIcon";
import { NoteEntryPreview } from "./NoteEntryPreview";
import { RangeHairpinControls } from "./RangeHairpinControls";
import { timedHairpins } from "../lib/music/hairpins";
import { ScoreRenderer } from "./ScoreRenderer";
import type { ScoreEventMoveIntent, ScoreEventSelection, ScoreNotePitchIntent, ScorePointerNoteIntent, ScoreRangeDestination } from "./ScoreRenderer";

type AccidentalMode = "auto" | "sharp" | "flat" | "natural";
type PendingImport = { score: ScoreDocument; warnings: string[] };
type StatusTone = "neutral" | "success" | "warning" | "error";
type RangeEditTool = "pitch" | "rhythm" | "expression" | "hairpin";
type HistoryEntry = { score: ScoreDocument; selection: ScoreEventSelection | null; range?: EventRangeTarget | null; rangeTool?: RangeEditTool; rangeExpanded?: boolean; action?: string };
type EventRangeTarget = { partId: string; staffId: string; startEventId: string; endEventId: string };
type EnterEventOptions = {
  duration?: DurationBase;
  octave?: number;
  partId?: string;
  staffId?: string;
  measureId?: string;
  startNewChord?: boolean;
  addToSelectedChord?: boolean;
  preserveInputPitch?: boolean;
};

const DURATION_CHOICES: Array<{ value: DurationBase; shortcut: string }> = [
  { value: 1, shortcut: "1" },
  { value: 2, shortcut: "2" },
  { value: 4, shortcut: "3" },
  { value: 8, shortcut: "4" },
  { value: 16, shortcut: "5" },
  { value: 32, shortcut: "6" },
  { value: 64, shortcut: "7" },
];
const METER_PRESETS = ["2/4", "3/4", "4/4", "5/8", "6/8", "7/8", "9/8", "12/8"] as const;
const NEW_SCORE_DEFAULTS = { title: "Untitled score", composer: "", templateId: "solo", instrumentId: "piano", meter: "4/4", tempo: "96" };

function focusScoreInput() {
  document.querySelector<HTMLButtonElement>(".score-hit-target")?.focus({ preventScroll: true });
}

function keyValue(key: KeySignature): string {
  return `${key.fifths}:${key.mode}`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function inputAlter(mode: AccidentalMode, writtenKey: KeySignature, step: PitchStep): -1 | 0 | 1 {
  if (mode === "auto") return keySignatureAlterForStep(writtenKey, step);
  if (mode === "sharp") return 1;
  if (mode === "flat") return -1;
  return 0;
}

function accidentalGlyph(alter: -1 | 0 | 1): string {
  return alter === 1 ? "♯" : alter === -1 ? "♭" : "♮";
}

function dotCycleAriaLabel(dots: DurationValue["dots"]): string {
  if (dots === 0) return "Augmentation dots: none. Activate for one dot";
  if (dots === 1) return "Augmentation dots: one dot. Activate for two dots";
  return "Augmentation dots: two dots. Activate to clear dots";
}

function dotSelectionStatus(dots: DurationValue["dots"]): string {
  if (dots === 0) return "Augmentation dots cleared";
  return dots === 1 ? "One augmentation dot selected" : "Two augmentation dots selected";
}

function durationName(base: DurationBase, dots: DurationValue["dots"]): string {
  const prefix = dots === 1 ? "Dotted " : dots === 2 ? "Double-dotted " : "";
  return `${prefix}${DURATION_LABELS[base]}`;
}

function inputPitchLabel(pitch: DiatonicPitch): string {
  return `${pitch.step}${pitch.octave} (${SOLFEGE[pitch.step]})`;
}

function noteEntryInstruction(
  method: NoteEntryMethod,
  pitch: DiatonicPitch,
  base: DurationBase,
  dots: DurationValue["dots"],
): string {
  if (method === "arrow-duration") {
    return `${noteEntryMethodShortLabel(method)} · ${inputPitchLabel(pitch)} selected · choose length with 1–7, then QWERTYU to enter`;
  }
  if (method === "duration-letter") {
    return `${noteEntryMethodShortLabel(method)} · ${durationName(base, dots)} selected · press Q W E R T Y U (도–시) to enter`;
  }
  if (method === "score-pointer") {
    return `${noteEntryMethodShortLabel(method)} · ${durationName(base, dots)} selected · tap a blank staff line or space to add at that measure's NEXT position`;
  }
  return `${noteEntryMethodShortLabel(method)} · ${durationName(base, dots)} selected · press 도(C) through 시(B), or Rest`;
}

function eventName(event: MusicEvent): string {
  if (event.kind === "rest") return `${durationName(event.duration.base, event.duration.dots).toLowerCase()} rest`;
  const pitches = event.notes.map((note) => pitchName(note.pitch)).join(" + ");
  return `${pitches} ${durationName(event.duration.base, event.duration.dots).toLowerCase()}${event.notes.length > 1 ? " chord" : " note"}`;
}

function eventAtSelection(score: ScoreDocument, selection: ScoreEventSelection | null): MusicEvent | undefined {
  if (!selection) return undefined;
  const part = score.parts.find((candidate) => candidate.id === selection.partId);
  const staff = part?.staves.find((candidate) => candidate.id === selection.staffId);
  return staff?.measures[selection.measureId]?.voices[0]?.events.find((event) => event.id === selection.eventId);
}

function revalidateEventSelection(score: ScoreDocument, selection: ScoreEventSelection | null): ScoreEventSelection | null {
  const event = eventAtSelection(score, selection);
  if (!selection || !event) return null;
  if (!selection.noteId || (event.kind === "note" && event.notes.some((note) => note.id === selection.noteId))) return selection;
  return { partId: selection.partId, staffId: selection.staffId, measureId: selection.measureId, eventId: selection.eventId };
}

function trimStudioHistory(entries: HistoryEntry[], keepEdge: "start" | "end"): HistoryEntry[] {
  const retainedScores = trimHistorySnapshots(entries.map((entry) => entry.score), keepEdge);
  if (!retainedScores.length) return [];
  return keepEdge === "start"
    ? entries.slice(0, retainedScores.length)
    : entries.slice(-retainedScores.length);
}

function scoreNotatedDurationSeconds(score: ScoreDocument): number {
  const totalTicks = score.measureOrder.reduce((sum, measureId) => {
    const measure = score.measures[measureId];
    return sum + (measure ? measure.time.numerator * TICKS_PER_QUARTER * 4 / measure.time.denominator : 0);
  }, 0);
  return totalTicks * 60 / score.tempo / TICKS_PER_QUARTER;
}

function downloadBlob(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(title: string): string {
  return title.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-|-$/g, "") || "garak-score";
}

function safeSelection(score: ScoreDocument, preferredPartId?: string, preferredStaffId?: string) {
  const part = score.parts.find((candidate) => candidate.id === preferredPartId) ?? score.parts[0];
  const staff = part?.staves.find((candidate) => candidate.id === preferredStaffId) ?? part?.staves[0];
  return { partId: part?.id ?? "", staffId: staff?.id ?? "" };
}

function findLastEventMeasureId(score: ScoreDocument, partId: string, staffIndex: number): string | null {
  const part = score.parts.find((candidate) => candidate.id === partId);
  if (!part) return null;
  for (let measureIndex = score.measureOrder.length - 1; measureIndex >= 0; measureIndex -= 1) {
    const measureId = score.measureOrder[measureIndex];
    if (getPrimaryVoice(part, measureId, staffIndex).events.length) return measureId;
  }
  return null;
}

function primaryEventOnsetTicks(part: ScoreDocument["parts"][number], measureId: string, staffIndex: number, eventId: string): number | null {
  const events = getPrimaryVoice(part, measureId, staffIndex).events;
  const eventIndex = events.findIndex((event) => event.id === eventId);
  if (eventIndex < 0) return null;
  return events.slice(0, eventIndex).reduce((sum, event) => sum + durationTicks(event.duration), 0);
}

function findLastNoteEvent(
  score: ScoreDocument,
  partId: string,
  staffIndex: number,
): { measureId: string; event: Extract<MusicEvent, { kind: "note" }> } | null {
  const part = score.parts.find((candidate) => candidate.id === partId);
  if (!part) return null;
  for (let measureIndex = score.measureOrder.length - 1; measureIndex >= 0; measureIndex -= 1) {
    const measureId = score.measureOrder[measureIndex];
    const events = getPrimaryVoice(part, measureId, staffIndex).events;
    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = events[eventIndex];
      if (event.kind === "note") return { measureId, event };
    }
  }
  return null;
}

function measureRangeLabel(score: ScoreDocument, measureIds: readonly string[]): string {
  const first = score.measures[measureIds[0]]?.number;
  const last = score.measures[measureIds.at(-1) ?? ""]?.number;
  if (first === undefined || last === undefined) return "the selected range";
  return first === last ? `measure ${first}` : `measures ${first}–${last}`;
}

function localSaveStatus(result: ReturnType<typeof saveStoredScore>): string {
  if (result.kind === "saved" || result.kind === "unchanged") return "Saved locally";
  if (result.kind === "rejected") return "Not saved — score validation failed";
  return "Local save failed — keep this tab open and try again";
}

function persistScoreLocally(score: ScoreDocument): string {
  try {
    return localSaveStatus(saveStoredScore(window.localStorage, score));
  } catch {
    return "Local save failed — keep this tab open and try again";
  }
}

function statusTone(message: string): StatusTone {
  const normalized = message.toLowerCase();
  if (/failed|not saved|not applied|not added|invalid|could not|cannot change|unavailable|no longer available|does not have room|larger than|safety limit|required|unexpected/.test(normalized)) return "error";
  if (/paused|warning|last-known-good|damaged|review/.test(normalized)) return "warning";
  if (/saved locally|ready|recovered your local score/.test(normalized)) return "success";
  return "neutral";
}

export function NotationStudio() {
  const [score, setScore] = useState<ScoreDocument>(() => createScore("chamber"));
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [selectedPartId, setSelectedPartId] = useState(() => createScore("chamber").parts[0].id);
  const [selectedStaffId, setSelectedStaffId] = useState(() => createScore("chamber").parts[0].staves[0].id);
  const [changeMeasureId, setChangeMeasureId] = useState(() => createScore("chamber").measureOrder[0]);
  const [viewMode, setViewMode] = useState<"score" | "part">("score");
  const [duration, setDuration] = useState<DurationBase>(4);
  const [dotCount, setDotCount] = useState<DurationValue["dots"]>(0);
  const [restInput, setRestInput] = useState(false);
  const [chordMode, setChordMode] = useState(false);
  const [newChordPending, setNewChordPending] = useState(false);
  const [selectedChordNote, setSelectedChordNote] = useState<{ eventId: string; noteId: string } | null>(null);
  const [accidentalMode, setAccidentalMode] = useState<AccidentalMode>("auto");
  const [noteEntryMethod, setNoteEntryMethod] = useState<NoteEntryMethod>("duration-letter");
  const [inputPitch, setInputPitch] = useState<DiatonicPitch>({ step: "C", octave: 4 });
  const octave = inputPitch.octave;
  const [keyboardEntryTarget, setKeyboardEntryTarget] = useState<{ scoreId: string; partId: string; staffId: string; measureId: string } | null>(null);
  const [zoom, setZoom] = useState(82);
  const [{ text: status, revision: statusRevision }, setStatus] = useReducer(
    (current: { text: string; revision: number }, text: string) => ({ text, revision: current.revision + 1 }),
    { text: "Opening your local score…", revision: 0 },
  );
  const [hydrated, setHydrated] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [lastLocalSave, setLastLocalSave] = useState<{ score: ScoreDocument; message: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newScoreDraft, setNewScoreDraft] = useState(NEW_SCORE_DEFAULTS);
  const [newScoreError, setNewScoreError] = useState("");
  const [newScoreDownloadStatus, setNewScoreDownloadStatus] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [inputToolsOpen, setInputToolsOpen] = useState(false);
  const [inputHelpOpen, setInputHelpOpen] = useState(false);
  const inputHelpButtonRef = useRef<HTMLButtonElement>(null);
  const inputDockRef = useRef<HTMLDivElement>(null);
  const floatingDock = useFloatingNoteDock(inputDockRef, inputToolsOpen, inputHelpOpen);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const panels = useWorkspacePanelWidths(workspaceRef);
  const instrumentPanel = panels.instrument;
  const inspectorPanel = panels.inspector;
  const setPanelCollapsed = panels.setPanelCollapsed;
  const [inputFollowRevision, requestInputFollow] = useReducer((revision: number) => revision + 1, 0);
  const [selectedEventTarget, setSelectedEventTargetState] = useState<ScoreEventSelection | null>(null);
  const [rangeTarget, setRangeTarget] = useState<EventRangeTarget | null>(null);
  const [rangeSelectionMode, setRangeSelectionMode] = useState(false);
  const [rangeToolsExpanded, setRangeToolsExpanded] = useState(false);
  const rangeToolsToggleRef = useRef<HTMLButtonElement>(null);
  const [rangeEditTool, setRangeEditTool] = useState<RangeEditTool>("expression");
  const [rangeDestinationMode, setRangeDestinationMode] = useState<"move" | "copy" | null>(null);
  const [rangeError, setRangeError] = useState<{ score: ScoreDocument; message: string } | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorSection, setInspectorSection] = useState<"event" | "score" | "part">("event");
  const [inspectorDrawerMode, setInspectorDrawerMode] = useState(false);
  const [instrumentsOpen, setInstrumentsOpen] = useState(false);
  const instrumentsVisible = instrumentPanel.drawer ? instrumentsOpen : !instrumentPanel.collapsed;
  const inspectorVisible = inspectorDrawerMode ? inspectorOpen : !inspectorPanel.collapsed;
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [activeFamily, setActiveFamily] = useState("All");
  const [clickVolume, setClickVolume] = useState(60);
  const [practiceResetUndo, setPracticeResetUndo] = useState<PracticeSettings | null>(null);
  const [practiceNotice, setPracticeNotice] = useState("");
  const practiceResetButtonRef = useRef<HTMLButtonElement | null>(null);
  const practiceUndoButtonRef = useRef<HTMLButtonElement | null>(null);
  const clickGainsRef = useRef<{ metronome: GainNode; countIn: GainNode } | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [beatGuideEnabled, setBeatGuideEnabled] = useState(true);
  const repeatCountSetterRef = useRef<((enabled: boolean, bars: 1 | 2) => void) | null>(null);
  const [repeatCountInEnabled, setRepeatCountInEnabled] = useState(false);
  const [countInEnabled, setCountInEnabled] = useState(false);
  const [countInBars, setCountInBars] = useState<1 | 2>(1);
  const [countInProgress, setCountInProgress] = useState<ReturnType<ReturnType<typeof createLivePlayback>["countInProgress"]>>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const playbackRateSetterRef = useRef<((rate: number) => void) | null>(null);
  const playbackClockRef = useRef<(() => number) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playbackFollowEnabled, setPlaybackFollowEnabled] = useState(true);
  const [playbackFollowRevision, setPlaybackFollowRevision] = useState(0);
  const pausedRef = useRef(false);
  const transportRef = useRef<{ from: number; to: number; loop: boolean } | null>(null);
  const [playbackSeconds, setPlaybackSeconds] = useState<number | null>(null);
  const [metadataDraft, setMetadataDraft] = useState(score.metadata);
  const [titleError, setTitleError] = useState("");
  const [meterError, setMeterError] = useState<{ score: ScoreDocument; measureId: string; message: string } | null>(null);
  const [eventEditNotice, setEventEditNotice] = useState<{ score: ScoreDocument; eventId: string; message: string } | null>(null);
  const [eventEditError, setEventEditError] = useState<{ score: ScoreDocument; eventId: string; message: string; scope?: "tie" | "drag" | "move" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openFileButtonRef = useRef<HTMLButtonElement>(null);
  const projectTitleRef = useRef<HTMLButtonElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const exportAnchorRef = useRef<HTMLDivElement>(null);
  const mobileInstrumentsButtonRef = useRef<HTMLButtonElement>(null);
  const filePickerReturnFocusRef = useRef<HTMLElement | null>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const dialogReturnToScoreRef = useRef(false);
  const notationToolsRef = useRef<HTMLElement>(null);
  const inputToolsButtonRef = useRef<HTMLButtonElement>(null);
  const activeDialogRef = useRef<HTMLElement>(null);
  const eventSequence = useRef(1000);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackFrameRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const scoreRef = useRef(score);
  const selectedEventTargetRef = useRef<ScoreEventSelection | null>(selectedEventTarget);
  const importRequestIdRef = useRef(0);
  const hydratedRef = useRef(hydrated);
  const autoSaveEnabledRef = useRef(autoSaveEnabled);
  const savePendingRef = useRef(false);
  const autoZoomRef = useRef(true);
  const lastFocusedControlRef = useRef<HTMLElement | null>(null);
  const setSelectedEventTarget = useCallback((selection: ScoreEventSelection | null) => {
    setRangeTarget(null);
    setRangeDestinationMode(null);
    setRangeError(null);
    selectedEventTargetRef.current = selection;
    setSelectedEventTargetState(selection);
    if (selection?.noteId) setSelectedChordNote({ eventId: selection.eventId, noteId: selection.noteId });
  }, []);
  const clearRangeSelection = useCallback(() => {
    setRangeTarget(null);
    setRangeSelectionMode(false);
    setRangeDestinationMode(null);
    setRangeError(null);
  }, []);
  const selectedRange = useMemo(() => rangeTarget
    ? getEventRange(score, rangeTarget.partId, rangeTarget.staffId, rangeTarget.startEventId, rangeTarget.endEventId)
    : null, [rangeTarget, score]);
  const rangeHairpins = useMemo(() => selectedRange ? timedHairpins(score).filter((span) => span.staffId === rangeTarget?.staffId && span.startTick < selectedRange.endTick && span.endTick > selectedRange.startTick) : [], [rangeTarget, score, selectedRange]);
  const rangeExpression = useMemo(() => {
    const staff = score.parts.find((part) => part.id === rangeTarget?.partId)?.staves.find((item) => item.id === rangeTarget?.staffId);
    const ids = new Set(selectedRange?.eventIds);
    const events = staff ? score.measureOrder.flatMap((id) => staff.measures[id].voices.flatMap((voice) => voice.events)).filter((event) => ids.has(event.id)) : [];
    const common = (values: string[]) => new Set(values).size > 1 ? "mixed" : values[0] ?? "none";
    return {
      dynamic: common(events.map((event) => event.dynamic ?? "none")),
      articulation: common(events.flatMap((event) => event.kind === "note" ? [event.articulation ?? "none"] : [])),
    };
  }, [rangeTarget, score, selectedRange]);

  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { hydratedRef.current = hydrated; }, [hydrated]);
  useEffect(() => { autoSaveEnabledRef.current = autoSaveEnabled; }, [autoSaveEnabled]);

  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== document.body) {
        lastFocusedControlRef.current = event.target;
      }
    };
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, []);

  useEffect(() => {
    let focusFrame = 0;
    const preserveVisibleFocus = () => {
      const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : lastFocusedControlRef.current;
      if (!focused) return;
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        const current = document.activeElement;
        if (!focused.isConnected || focused.getClientRects().length === 0) projectTitleRef.current?.focus();
        else if (current === document.body) focused.focus();
      });
    };
    window.addEventListener("resize", preserveVisibleFocus);
    return () => {
      window.removeEventListener("resize", preserveVisibleFocus);
      window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1180px)");
    const syncMode = () => {
      const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : lastFocusedControlRef.current;
      const focusedInspector = Boolean(active?.closest("#score-inspector"));
      setInspectorDrawerMode(query.matches);
      if (query.matches && focusedInspector) {
        setInspectorOpen(true);
      } else if (!query.matches) {
        setInspectorOpen(false);
      }
    };
    syncMode();
    query.addEventListener("change", syncMode);
    return () => query.removeEventListener("change", syncMode);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const syncCompactPanels = () => {
      const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : lastFocusedControlRef.current;
      if (query.matches) {
        if (active?.closest("#instrument-drawer")) setInstrumentsOpen(true);
        return;
      }
      setInstrumentsOpen(false);
    };
    syncCompactPanels();
    query.addEventListener("change", syncCompactPanels);
    return () => query.removeEventListener("change", syncCompactPanels);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 620px)");
    const syncZoom = () => {
      if (autoZoomRef.current && query.matches) setZoom((current) => Math.max(75, current));
    };
    syncZoom();
    query.addEventListener("change", syncZoom);
    return () => query.removeEventListener("change", syncZoom);
  }, []);

  const cancelPendingImport = useCallback(() => {
    setPendingImport(null);
    setStatus("MusicXML import cancelled — current score unchanged");
  }, []);
  const activeDialogKind = pendingImport
    ? "import"
    : helpOpen
      ? "help"
      : addOpen
        ? "instrument"
        : newOpen
          ? "new"
          : inspectorOpen
            ? "inspector"
            : instrumentsOpen
              ? "instruments"
              : null;
  const activeDialogOpen = activeDialogKind !== null;
  const closeWorkspacePanel = useCallback((side: PanelSide) => {
    if (side === "instrument") setInstrumentsOpen(false);
    else setInspectorOpen(false);
    setPanelCollapsed(side, true);
  }, [setPanelCollapsed]);
  const closeActiveDialog = useCallback(() => {
    if (pendingImport) cancelPendingImport();
    else if (helpOpen) setHelpOpen(false);
    else if (addOpen) setAddOpen(false);
    else if (newOpen) setNewOpen(false);
    else if (inspectorOpen) closeWorkspacePanel("inspector");
    else if (instrumentsOpen) closeWorkspacePanel("instrument");
  }, [addOpen, cancelPendingImport, closeWorkspacePanel, helpOpen, inspectorOpen, instrumentsOpen, newOpen, pendingImport]);
  const captureModalReturnFocus = useCallback((): HTMLElement | null => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (active?.closest(".export-menu")) return exportButtonRef.current;
    if (active?.closest("#score-inspector")) return projectTitleRef.current;
    return active;
  }, []);
  const toggleWorkspacePanel = (side: PanelSide) => {
    if (side === "instrument" ? instrumentsVisible : inspectorVisible) {
      closeWorkspacePanel(side);
      return;
    }
    setExportOpen(false);
    setPanelCollapsed(side, false);
    if (panels[side].drawer) {
      modalReturnFocusRef.current = captureModalReturnFocus();
      setInspectorOpen(side === "inspector");
      setInstrumentsOpen(side === "instrument");
    } else {
      window.requestAnimationFrame(() => document.getElementById(side === "instrument" ? "instrument-drawer" : "score-inspector")?.focus());
    }
  };
  const openNewDialog = useCallback(() => {
    modalReturnFocusRef.current = captureModalReturnFocus();
    setNewScoreDraft(NEW_SCORE_DEFAULTS);
    setNewScoreError("");
    setNewScoreDownloadStatus("");
    setExportOpen(false);
    setHelpOpen(false);
    setInspectorOpen(false);
    setInstrumentsOpen(false);
    setNewOpen(true);
  }, [captureModalReturnFocus]);
  const openHelpDialog = useCallback(() => {
    modalReturnFocusRef.current = captureModalReturnFocus();
    setExportOpen(false);
    setNewOpen(false);
    setInspectorOpen(false);
    setInstrumentsOpen(false);
    setHelpOpen(true);
  }, [captureModalReturnFocus]);
  const openInstrumentDialog = useCallback(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalReturnFocusRef.current = active?.closest("#instrument-drawer")
      && mobileInstrumentsButtonRef.current?.getClientRects().length
      ? mobileInstrumentsButtonRef.current
      : captureModalReturnFocus();
    setExportOpen(false);
    setInstrumentsOpen(false);
    setAddOpen(true);
  }, [captureModalReturnFocus]);
  const restoreFilePickerFocus = useCallback(() => {
    const returnFocus = filePickerReturnFocusRef.current;
    if (!returnFocus) return;
    filePickerReturnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      const focusTarget = returnFocus.isConnected && returnFocus.getClientRects().length
        ? returnFocus
        : exportButtonRef.current?.getClientRects().length
          ? exportButtonRef.current
          : projectTitleRef.current;
      focusTarget?.focus();
    });
  }, []);
  const openFilePicker = useCallback((returnFocus: HTMLElement | null) => {
    filePickerReturnFocusRef.current = returnFocus;
    setExportOpen(false);
    window.addEventListener("focus", () => {
      window.setTimeout(() => {
        if (filePickerReturnFocusRef.current === returnFocus) restoreFilePickerFocus();
      }, 300);
    }, { once: true });
    fileInputRef.current?.click();
  }, [restoreFilePickerFocus]);
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    input.addEventListener("cancel", restoreFilePickerFocus);
    return () => input.removeEventListener("cancel", restoreFilePickerFocus);
  }, [restoreFilePickerFocus]);
  const closeExportMenuAndRestoreFocus = useCallback(() => {
    setExportOpen(false);
    window.requestAnimationFrame(() => exportButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!exportOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !exportAnchorRef.current?.contains(event.target)) setExportOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [exportOpen]);

  useEffect(() => {
    if (!activeDialogOpen) return;
    const dialog = activeDialogRef.current;
    if (!dialog) return;
    const previousFocus = modalReturnFocusRef.current ?? (document.activeElement === fileInputRef.current
      ? openFileButtonRef.current
      : document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : projectTitleRef.current);
    const fallbackFocus = projectTitleRef.current;
    modalReturnFocusRef.current = null;
    const backdrop = dialog.parentElement;
    const isDrawer = dialog.classList.contains("drawer-open");
    const drawerParentSiblings = isDrawer && backdrop
      ? [...backdrop.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog)
      : [];
    const topLevelSiblings = backdrop?.parentElement
      ? [...backdrop.parentElement.children].filter((element): element is HTMLElement => (
        element instanceof HTMLElement
        && element !== backdrop
        && !element.classList.contains("drawer-scrim")
        && !element.classList.contains("sr-status")
      ))
      : [];
    const siblings = [...drawerParentSiblings, ...topLevelSiblings];
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    dialog.focus();

    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKey);
    return () => {
      document.removeEventListener("keydown", handleDialogKey);
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      window.requestAnimationFrame(() => {
        if (dialogReturnToScoreRef.current) {
          dialogReturnToScoreRef.current = false;
          focusScoreInput();
        } else if (previousFocus?.getClientRects().length) previousFocus.focus();
        else fallbackFocus?.focus();
      });
    };
  }, [activeDialogKind, activeDialogOpen, closeActiveDialog]);

  useEffect(() => {
    if (!inputHelpOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !inputDockRef.current?.contains(event.target)) {
        setInputHelpOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [inputHelpOpen]);

  const toggleInputTools = useCallback(() => {
    const next = !inputToolsOpen;
    if (next) {
      clearRangeSelection();
      if (rangeSelectionMode) setStatus(noteEntryInstruction(noteEntryMethod, inputPitch, duration, dotCount));
    }
    setExportOpen(false);
    setInputToolsOpen(next);
    setInputHelpOpen(false);
    window.requestAnimationFrame(() => {
      if (next) {
        const activeDuration = notationToolsRef.current?.querySelector<HTMLElement>('.note-values button[aria-pressed="true"]');
        const firstControl = notationToolsRef.current?.querySelector<HTMLElement>("button:not([disabled]), select:not([disabled])");
        (activeDuration ?? firstControl)?.focus();
      } else {
        inputToolsButtonRef.current?.focus();
      }
    });
  }, [clearRangeSelection, dotCount, duration, inputPitch, inputToolsOpen, noteEntryMethod, rangeSelectionMode]);

  const selectedPart = score.parts.find((part) => part.id === selectedPartId) ?? score.parts[0];
  const resolvedStaffIndex = selectedPart ? resolveStaffIndex(selectedPart, selectedStaffId) : -1;
  const selectedStaffIndex = resolvedStaffIndex >= 0 ? resolvedStaffIndex : 0;
  const selectedStaff = selectedPart?.staves[selectedStaffIndex];
  const activeStaffId = selectedStaff?.id ?? "";
  const selectedStaffNumber = selectedStaffIndex + 1;
  const activeChangeMeasureId = score.measures[changeMeasureId] ? changeMeasureId : score.measureOrder[0];
  const visibleMeterError = meterError?.score === score && meterError.measureId === activeChangeMeasureId ? meterError.message : "";
  const changeMeasure = score.measures[activeChangeMeasureId];
  const changeMeterValue = `${changeMeasure.time.numerator}/${changeMeasure.time.denominator}`;
  const changeMeterIsPreset = METER_PRESETS.some((meter) => meter === changeMeterValue);
  const selectedConcertKey = changeMeasure.key;
  const selectedWrittenKey = selectedPart ? writtenKeyForPart(selectedConcertKey, selectedPart) : selectedConcertKey;
  const lastEventMeasureId = selectedPart ? findLastEventMeasureId(score, selectedPart.id, selectedStaffIndex) : null;
  const lastEvent = selectedPart && lastEventMeasureId ? getPrimaryVoice(selectedPart, lastEventMeasureId, selectedStaffIndex).events.at(-1) : undefined;
  const selectedEvent = selectedEventTarget
    && selectedEventTarget.partId === selectedPart?.id
    && selectedEventTarget.staffId === activeStaffId
    ? eventAtSelection(score, selectedEventTarget)
    : undefined;
  const inspectorEvent = selectedEvent ?? lastEvent;
  const selectedTone = selectedEvent?.kind === "note"
    ? (selectedChordNote?.eventId === selectedEvent.id ? selectedEvent.notes.find((note) => note.id === selectedChordNote.noteId) : undefined) ?? selectedEvent.notes[0]
    : null;
  const selectedPitch = selectedTone?.pitch ?? null;
  const selectedRhythm = selectedEventTarget && selectedEvent ? eventRhythm(score, selectedEventTarget.partId, selectedEventTarget.staffId, selectedEventTarget.measureId, selectedEventTarget.eventId) : null;
  const editingDuration = selectedRhythm?.duration ?? selectedEvent?.duration;
  const selectedIsChord = selectedEvent?.kind === "note" && selectedEvent.notes.length > 1;
  const currentEventEditError = eventEditError?.score === score && eventEditError.eventId === selectedEvent?.id ? eventEditError : null;
  const visibleEventEditError = !currentEventEditError?.scope ? currentEventEditError?.message : "";
  const visibleEventEditNotice = eventEditNotice?.score === score && eventEditNotice.eventId === selectedEvent?.id ? eventEditNotice.message : "";
  const visibleTieEditError = currentEventEditError?.scope === "tie" ? currentEventEditError.message : "";
  const inspectorUsesSelection = Boolean(selectedEvent && selectedEventTarget);
  const deletionTargetEvent = selectedEvent ?? lastEvent;
  const selectedChordTarget = chordMode && !newChordPending && selectedEvent?.kind === "note" && selectedEventTarget
    ? { event: selectedEvent, measureId: selectedEventTarget.measureId }
    : null;
  const latestChordTarget = chordMode && !newChordPending && !selectedEventTarget && lastEvent?.kind === "note" && lastEventMeasureId
    ? { event: lastEvent, measureId: lastEventMeasureId }
    : null;
  const chordTarget = selectedChordTarget ?? latestChordTarget;
  const selectedPitchLabel = selectedPitch ? pitchName(selectedPitch) : "";
  const chordTargetLabel = chordTarget ? eventName(chordTarget.event) : "";
  const tiedNoteCount = selectedTone ? getTiedNoteIds(score, selectedTone.id).length : 0;
  const hasPreviousTie = Boolean(selectedTone && score.ties.some((tie) => tie.toNoteId === selectedTone.id));
  const hasNextTie = Boolean(selectedTone && score.ties.some((tie) => tie.fromNoteId === selectedTone.id));
  const tieActionLabel = selectedTone
    ? `${hasPreviousTie ? "Remove tie from previous note to" : "Tie to previous note from"} selected ${selectedPitchLabel}`
    : selectedEvent ? "Select a pitched note to add a tie" : "Tie the last two matching notes";
  const deleteRemovesChordTone = Boolean(chordTarget && chordTarget.event.notes.length > 1);
  const deleteActionLabel = deleteRemovesChordTone && chordTarget
    ? `Remove last chord tone from ${eventName(chordTarget.event)}`
    : selectedEvent?.kind === "note"
      ? `Clear selected ${eventName(selectedEvent)} to a rest and keep the rhythm`
      : selectedEvent
        ? `Delete selected ${eventName(selectedEvent)} and shift later events earlier`
        : deletionTargetEvent
          ? `Delete previous ${eventName(deletionTargetEvent)}`
      : "Nothing to delete";
  const inspectorDeleteText = inspectorUsesSelection
    ? selectedEvent?.kind === "note" ? selectedIsChord ? "Clear whole chord to rest" : "Clear note to rest" : "Delete selected rest"
    : "Delete previous input";
  const lastNoteTarget = selectedPart ? findLastNoteEvent(score, selectedPart.id, selectedStaffIndex) : null;
  const lastNoteEvent = lastNoteTarget?.event;
  const inspectorNoteEvent = selectedEvent
    ? selectedEvent.kind === "note" ? selectedEvent : undefined
    : lastNoteEvent;
  const previewDuration: DurationValue = { base: duration, dots: dotCount };
  const canAddChordTone = Boolean(chordTarget);
  const chordActionTarget = selectedChordTarget ? "selected note chord" : "latest note chord";
  const keyboardEntryMeasureId = keyboardEntryTarget?.scoreId === score.id
    && keyboardEntryTarget.partId === selectedPart?.id && keyboardEntryTarget.staffId === activeStaffId
    && score.measures[keyboardEntryTarget.measureId] ? keyboardEntryTarget.measureId : null;
  const previewMeasureId = selectedPart && activeStaffId
    ? canAddChordTone
      ? chordTarget?.measureId ?? null
      : findEventTargetMeasureId(score, selectedPart.id, previewDuration, activeStaffId, keyboardEntryMeasureId ?? undefined) ?? score.measureOrder.at(-1) ?? null
    : null;
  const previewWrittenKey = selectedPart && previewMeasureId
    ? writtenKeyForPart(score.measures[previewMeasureId].key, selectedPart)
    : selectedWrittenKey;
  const floatingPitch: Pitch = { ...inputPitch, alter: inputAlter(accidentalMode, previewWrittenKey, inputPitch.step) };
  const floatingPitchLabel = pitchName(floatingPitch);
  const previewEntryTick = selectedPart && previewMeasureId
    ? chordTarget
      ? primaryEventOnsetTicks(selectedPart, previewMeasureId, selectedStaffIndex, chordTarget.event.id)
        ?? voiceTicks(getPrimaryVoice(selectedPart, previewMeasureId, selectedStaffIndex))
      : voiceTicks(getPrimaryVoice(selectedPart, previewMeasureId, selectedStaffIndex))
    : 0;
  const playbackPosition = playbackSeconds === null ? null : locatePlaybackPosition(score, playbackSeconds);
  const transportBeat = countInProgress?.beat ?? playbackPosition?.beat;
  const transportBeats = countInProgress?.beats ?? (playbackPosition ? score.measures[playbackPosition.measureId].time.numerator : 0);
  const liveEngravingPlan = useMemo(
    () => planLiveEngraving(score, viewMode, selectedPartId),
    [score, selectedPartId, viewMode],
  );
  const wholeScoreEngravingPlan = useMemo(
    () => planLiveEngraving(score, "score", selectedPartId),
    [score, selectedPartId],
  );
  const liveEngravingUnavailable = liveEngravingPlan.kind !== "safe";
  const largeScoreEditingPaused = wholeScoreEngravingPlan.kind !== "safe";
  const guardLargeScoreEditing = useCallback(() => {
    if (!largeScoreEditingPaused) return false;
    setStatus("Editing paused for this large score to keep the app responsive — viewing, saving, and export remain available");
    return true;
  }, [largeScoreEditingPaused]);
  const inputTargetLabel = selectedPart && activeStaffId
    ? previewMeasureId
      ? `${selectedPart.shortName} · Staff ${selectedStaffNumber} · m. ${score.measures[previewMeasureId].number}`
      : `${selectedPart.shortName} · Staff ${selectedStaffNumber} · Enter a note first`
    : "Select a staff";

  const selectPart = useCallback((partId: string) => {
    const part = score.parts.find((candidate) => candidate.id === partId);
    if (!part) return;
    const staff = part.staves.find((candidate) => candidate.id === selectedStaffId) ?? part.staves[0];
    setSelectedPartId(part.id);
    setSelectedStaffId(staff?.id ?? "");
    setSelectedEventTarget(null);
    setStatus(`Selected ${part.name}, staff ${Math.max(1, part.staves.findIndex((candidate) => candidate.id === staff?.id) + 1)} · event selection cleared`);
  }, [score.parts, selectedStaffId, setSelectedEventTarget]);

  const selectStaff = useCallback((staffId: string) => {
    const part = score.parts.find((candidate) => candidate.staves.some((staff) => staff.id === staffId));
    if (!part) return;
    setSelectedPartId(part.id);
    setSelectedStaffId(staffId);
    setSelectedEventTarget(null);
    setStatus(`Selected ${part.name}, staff ${part.staves.findIndex((staff) => staff.id === staffId) + 1} · event selection cleared`);
  }, [score.parts, setSelectedEventTarget]);

  const selectRenderedEvent = useCallback((selection: ScoreEventSelection | null) => {
    setKeyboardEntryTarget(null);
    setRangeSelectionMode(false);
    setSelectedEventTarget(selection);
    const event = eventAtSelection(score, selection);
    if (event && selection) {
      setEventEditError(null);
      setSelectedPartId(selection.partId);
      setSelectedStaffId(selection.staffId);
      if (event.kind === "note" && selection.noteId && event.notes.some((note) => note.id === selection.noteId)) {
        setSelectedChordNote({ eventId: event.id, noteId: selection.noteId });
      }
      setNewChordPending(false);
      setInspectorSection("event");
      setChangeMeasureId(selection.measureId);
      const part = score.parts.find((candidate) => candidate.id === selection.partId);
      const staffNumber = Math.max(1, (part?.staves.findIndex((staff) => staff.id === selection.staffId) ?? 0) + 1);
      const measureNumber = score.measures[selection.measureId]?.number;
      const location = `${part?.shortName ?? "Part"} · staff ${staffNumber}${measureNumber ? ` · measure ${measureNumber}` : ""}`;
      const removesChordTone = chordMode
        && event.kind === "note"
        && event.notes.length > 1;
      setStatus(removesChordTone
        ? `Selected ${eventName(event)} · ${location} · Delete removes its last chord tone`
        : event.kind === "note"
          ? `Selected ${eventName(event)} · ${location} · Delete clears it to a rest; Shift+Delete removes its time`
          : `Selected ${eventName(event)} · ${location} · Delete removes this rest and shifts later events earlier`);
    } else if (selection === null) {
      setStatus("Event selection cleared · new notes append at the blue NEXT marker");
    }
  }, [chordMode, score, setSelectedEventTarget, setEventEditError]);

  const selectRangeEvent = useCallback((selection: ScoreEventSelection, extend: boolean) => {
    if (guardLargeScoreEditing()) return;
    const anchor = extend && rangeTarget
      ? rangeTarget
      : extend && !rangeSelectionMode && selectedEventTarget
        ? { ...selectedEventTarget, startEventId: selectedEventTarget.eventId, endEventId: selectedEventTarget.eventId }
        : { ...selection, startEventId: selection.eventId, endEventId: selection.eventId };
    if (anchor.partId !== selection.partId || anchor.staffId !== selection.staffId) {
      const message = "Choose the last note on the same staff. The current range is kept.";
      setRangeError({ score, message });
      setStatus(`Selection not applied — ${message}`);
      return;
    }
    const next = { partId: anchor.partId, staffId: anchor.staffId, startEventId: anchor.startEventId, endEventId: selection.eventId };
    const range = getEventRange(score, next.partId, next.staffId, next.startEventId, next.endEventId);
    if (!range) return;
    setSelectedEventTarget(selection);
    setRangeTarget(next);
    setRangeSelectionMode(true);
    setChordMode(false);
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setStatus(`Selected ${range.noteEventCount} notes / chords across ${range.eventIds.length} events${range.expandedForTies ? " · extended to keep complete ties" : ""} · choose Move, Copy, Delete, Pitch, Length, Expression, or Cresc. / dim.`);
  }, [guardLargeScoreEditing, rangeSelectionMode, rangeTarget, score, selectedEventTarget, setSelectedEventTarget]);

  const cancelPlayback = useCallback(() => {
    if (playbackTimerRef.current !== null) window.clearInterval(playbackTimerRef.current);
    playbackTimerRef.current = null;
    if (playbackFrameRef.current !== null) window.cancelAnimationFrame(playbackFrameRef.current);
    playbackFrameRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    setPlaying(false);
    setPaused(false);
    pausedRef.current = false;
    transportRef.current = null;
    playbackClockRef.current = null;
    playbackRateSetterRef.current = null;
    clickGainsRef.current = null;
    repeatCountSetterRef.current = null;
    setPlaybackSeconds(null);
    setCountInProgress(null);
    if (context) {
      try {
        void context.close().catch(() => undefined);
      } catch {
        // Cleanup state is already detached; a broken browser close cannot revive playback.
      }
    }
  }, []);

  const commit = useCallback((next: ScoreDocument, message: string) => {
    if (guardLargeScoreEditing()) return;
    if (next === score) {
      setStatus(message);
      return;
    }
    const validationErrors = validateScore(next);
    if (validationErrors.length) {
      setStatus(`Edit not applied — ${validationErrors[0]}`);
      return;
    }
    try {
      serializeNativeScore(next);
    } catch (error) {
      setStatus(`Edit not applied — ${error instanceof Error ? error.message : "the score exceeds the portable snapshot limit"}`);
      return;
    }
    clearRangeSelection();
    cancelPlayback();
    const proposedHistory = [...past, { score, selection: selectedEventTarget, range: rangeSelectionMode ? rangeTarget : null, rangeTool: rangeEditTool, rangeExpanded: rangeToolsExpanded, action: message.split(" · ")[0] }];
    const retainedHistory = trimStudioHistory(proposedHistory, "end");
    setPast(retainedHistory);
    setFuture([]);
    scoreRef.current = next;
    savePendingRef.current = true;
    setScore(next);
    const editStatus = retainedHistory.length < proposedHistory.length
      ? `${message} · oldest undo steps released to protect memory`
      : message;
    setStatus(autoSaveEnabled ? editStatus : `${editStatus} · autosave paused — use Save in this browser or New to replace preserved drafts`);
  }, [autoSaveEnabled, cancelPlayback, clearRangeSelection, guardLargeScoreEditing, past, score, selectedEventTarget, rangeSelectionMode, rangeTarget, rangeEditTool, rangeToolsExpanded]);

  const beginRangeAction = (action: "move" | "copy") => {
    if (!selectedRange || guardLargeScoreEditing()) return;
    setRangeDestinationMode(action);
    setRangeError(null);
    setStatus(`${action === "copy" ? "Copy" : "Move"} range · tap the destination beat on the same staff · Esc cancels`);
  };

  const applyRangeDestination = useCallback((destination: ScoreRangeDestination) => {
    if (!selectedRange || !rangeTarget || !rangeDestinationMode || guardLargeScoreEditing()) return;
    if (destination.partId !== rangeTarget.partId || destination.staffId !== rangeTarget.staffId) {
      const message = "Choose a destination on the same staff. No music was changed.";
      setRangeError({ score, message });
      setStatus(`Range edit not applied — ${message}`);
      return;
    }
    const operation = rangeDestinationMode === "copy" ? copyEventRangeToPosition : moveEventRangeToPosition;
    const result = operation(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, destination.measureId, destination.tick);
    if (result.error !== undefined) {
      setRangeError({ score, message: result.error });
      setStatus(`Range edit not applied — ${result.error}`);
      return;
    }
    const label = rangeDestinationMode === "copy" ? "Copied" : "Moved";
    if (result.changed) commit(result.score, `${label} ${selectedRange.noteEventCount} notes / chords to m. ${score.measures[destination.measureId].number} · chords and ties kept · Undo restores this edit`);
    else setStatus("The range is already at that position");
    setSelectedEventTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, ...result.selection });
    setRangeTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, startEventId: result.eventIds[0], endEventId: result.eventIds[result.eventIds.length - 1] });
    setRangeSelectionMode(true);
    setRangeDestinationMode(null);
  }, [commit, guardLargeScoreEditing, rangeDestinationMode, rangeTarget, score, selectedRange, setSelectedEventTarget]);

  const transposeRange = useCallback((semitones: number) => {
    if (!selectedRange || !rangeTarget || guardLargeScoreEditing()) return;
    const result = transposeEventRange(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, semitones);
    if (result.error !== undefined) {
      setRangeError({ score, message: result.error });
      setStatus(`Transpose not applied — ${result.error}`);
      return;
    }
    if (!result.changed) {
      setStatus("This range contains only rests — select a note to change pitch");
      return;
    }
    const interval = Math.abs(semitones) === 12 ? "one octave" : "one semitone";
    commit(result.score, `Transposed ${selectedRange.noteEventCount} notes / chords ${semitones > 0 ? "up" : "down"} ${interval} · intervals and ties kept · Undo restores this edit`);
    setSelectedEventTarget(selectedEventTarget);
    setRangeTarget(rangeTarget);
    setRangeSelectionMode(true);
  }, [commit, guardLargeScoreEditing, rangeTarget, score, selectedEventTarget, selectedRange, setSelectedEventTarget]);

  const changeRangeRhythm = useCallback((change: EventRangeDurationChange) => {
    if (!selectedRange || !rangeTarget || guardLargeScoreEditing()) return;
    const result = changeEventRangeDuration(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, change);
    if (result.error !== undefined) {
      setRangeError({ score, message: result.error });
      setStatus(`Rhythm not changed — ${result.error}`);
      return;
    }
    if (!result.changed) { setStatus("The selected notes and rests already use that dot setting"); return; }
    const label = change.scale === 2 ? "Doubled the selected lengths" : change.scale === 0.5 ? "Halved the selected lengths" : `Applied ${change.dots} ${change.dots === 1 ? "dot" : "dots"} to the selected written notes and rests`;
    commit(result.score, `${label} · following notes shifted · chords and ties kept · Undo restores this edit`);
    setSelectedEventTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, ...result.selection });
    setRangeTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, startEventId: result.eventIds[0], endEventId: result.eventIds[result.eventIds.length - 1] });
    setRangeSelectionMode(true);
  }, [commit, guardLargeScoreEditing, rangeTarget, score, selectedRange, setSelectedEventTarget]);

  const changeRangeExpression = useCallback((change: EventRangeExpressionChange) => {
    if (!selectedRange || !rangeTarget || guardLargeScoreEditing()) return;
    const result = setEventRangeExpression(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, change);
    if (result.error !== undefined) {
      setRangeError({ score, message: result.error });
      setStatus(`Expression not changed — ${result.error}`);
      return;
    }
    setRangeError(null);
    if (!result.changed) { setStatus("The selected events already use that expression setting"); return; }
    const label = change.dynamic !== undefined
      ? change.dynamic === null ? "Removed the selected dynamic marks" : `Applied ${change.dynamic} to the selected notes and rests`
      : change.articulation === null ? "Removed the selected articulations" : `Applied ${change.articulation} to the selected notes / chords`;
    commit(result.score, `${label} · chords and ties kept · Undo restores this edit`);
    setSelectedEventTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, ...result.selection });
    setRangeTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, startEventId: result.eventIds[0], endEventId: result.eventIds[result.eventIds.length - 1] });
    setRangeSelectionMode(true);
  }, [commit, guardLargeScoreEditing, rangeTarget, score, selectedRange, setSelectedEventTarget]);

  const changeRangeHairpin = useCallback((change: HairpinChange | null) => {
    if (!selectedRange || !rangeTarget || guardLargeScoreEditing()) return;
    const result = setEventRangeHairpin(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, change);
    if (result.error !== undefined) {
      setRangeError({ score, message: result.error });
      setStatus(`Hairpin not changed — ${result.error}`);
      return;
    }
    setRangeError(null);
    if (!result.changed) { setStatus("The selected range already uses this hairpin setting"); return; }
    commit(result.score, change ? `Applied ${change.kind}: ${change.from} → ${change.to} · press Play to hear the gradual change · Undo restores this edit`
      : "Removed the hairpin · notes, chords, and ties kept · Undo restores this edit");
    setSelectedEventTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, ...result.selection });
    setRangeTarget({ partId: rangeTarget.partId, staffId: rangeTarget.staffId, startEventId: result.eventIds[0], endEventId: result.eventIds.at(-1)! });
    setRangeSelectionMode(true);
    setRangeToolsExpanded(false);
    rangeToolsToggleRef.current?.focus();
  }, [commit, guardLargeScoreEditing, rangeTarget, score, selectedRange, setSelectedEventTarget]);

  const deleteRange = useCallback(() => {
    if (!selectedRange || !rangeTarget || guardLargeScoreEditing()) return;
    const result = clearEventRange(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds);
    if (result.error !== undefined) {
      setRangeError({ score, message: result.error });
      setStatus(`Range edit not applied — ${result.error}`);
      return;
    }
    if (result.changed) commit(result.score, `Deleted ${selectedRange.noteEventCount} notes / chords · rests keep the rhythm · Undo restores the range and its ties`);
    else setStatus("This range already contains only rests");
    setSelectedEventTarget(null);
    clearRangeSelection();
  }, [clearRangeSelection, commit, guardLargeScoreEditing, rangeTarget, score, selectedRange, setSelectedEventTarget]);

  const changeSelectedNotation = useCallback((update: { duration?: DurationValue; pitch?: Pitch }) => {
    if (!selectedEvent || !selectedEventTarget || guardLargeScoreEditing()) return;
    const result = editEventNotation(score, selectedEventTarget.partId, selectedEventTarget.staffId, selectedEventTarget.measureId, selectedEventTarget.eventId, update.pitch && selectedTone ? { ...update, noteId: selectedTone.id } : update);
    if (result.error) {
      setEventEditError({ score, eventId: selectedEvent.id, message: result.error });
      setStatus(`Edit not applied — ${result.error}`);
      return;
    }
    if (update.duration && selectedRhythm && selectedRhythm.eventId !== selectedEventTarget.eventId) setSelectedEventTarget({ ...selectedEventTarget, measureId: selectedRhythm.measureId, eventId: selectedRhythm.eventId });
    setEventEditError(null);
    const rhythmNotice = result.durationReflow && update.duration
      ? result.durationReflow.segmentCount > 1
        ? `${durationName(update.duration.base, update.duration.dots)} applied across ${result.durationReflow.segmentCount} tied segments. Length and dots edit the complete split note. Following notes moved; all ties kept.`
        : `${durationName(update.duration.base, update.duration.dots)} applied. Following notes moved across measures as needed; all ties kept.`
      : "";
    setEventEditNotice(rhythmNotice ? { score: result.score, eventId: selectedEvent.id, message: rhythmNotice } : null);
    if (result.changed) commit(result.score, rhythmNotice || (update.pitch && tiedNoteCount > 1
      ? `Updated all ${tiedNoteCount} tied notes · connections kept · Undo restores their pitches`
      : "Updated selected event · Undo restores the previous notation"));
  }, [selectedEvent, selectedEventTarget, selectedRhythm, setSelectedEventTarget, guardLargeScoreEditing, score, selectedTone, tiedNoteCount, commit, setEventEditError]);

  const changeDraggedNotePitch = useCallback((intent: ScoreNotePitchIntent) => {
    if (guardLargeScoreEditing()) return;
    const event = eventAtSelection(score, intent);
    const note = event?.kind === "note" ? event.notes.find((candidate) => candidate.id === intent.noteId) : undefined;
    if (!note) return;
    setSelectedPartId(intent.partId);
    setSelectedStaffId(intent.staffId);
    setSelectedEventTarget(intent);
    setSelectedChordNote({ eventId: intent.eventId, noteId: intent.noteId });
    setInspectorSection("event");
    setChangeMeasureId(intent.measureId);
    const result = editEventNotation(score, intent.partId, intent.staffId, intent.measureId, intent.eventId, {
      noteId: intent.noteId,
      pitch: intent.pitch,
    });
    if (result.error) {
      setEventEditError({ score, eventId: intent.eventId, message: result.error, scope: "drag" });
      setStatus(`Pitch unchanged — ${result.error}`);
      return;
    }
    setEventEditError(null);
    setEventEditNotice(null);
    if (!result.changed) return;
    const linkedCount = getTiedNoteIds(score, intent.noteId).length;
    commit(result.score, `Moved ${pitchName(note.pitch)} to ${pitchName(intent.pitch)}${linkedCount > 1 ? ` · all ${linkedCount} linked notes updated; ties kept` : ""}${event?.kind === "note" && event.notes.length > 1 ? " · other chord tones kept" : ""} · Undo restores the pitch`);
  }, [commit, guardLargeScoreEditing, score, setSelectedEventTarget, setEventEditError]);

  const changeSelectedPitchBy = useCallback((semitones: -12 | -1 | 1 | 12) => {
    if (!selectedTone || !selectedEventTarget) return;
    const pitch = shiftChromaticPitch(selectedTone.pitch, semitones);
    if (!pitch) { setStatus("Pitch unchanged · supported pitch range reached"); return; }
    changeDraggedNotePitch({ ...selectedEventTarget, noteId: selectedTone.id, pitch });
  }, [changeDraggedNotePitch, selectedEventTarget, selectedTone]);

  const moveDraggedEvent = useCallback((intent: ScoreEventMoveIntent) => {
    if (guardLargeScoreEditing()) return;
    const event = eventAtSelection(score, intent);
    if (!event) return;
    const result = moveEventToPosition(score, intent.partId, intent.staffId, intent.measureId, intent.eventId, intent.targetMeasureId, intent.targetTick);
    setSelectedPartId(intent.partId);
    setSelectedStaffId(intent.staffId);
    setInspectorSection("event");
    if (result.error !== undefined) {
      setSelectedEventTarget(intent);
      setEventEditError({ score, eventId: intent.eventId, message: result.error, scope: "move" });
      setStatus(`Move not applied — ${result.error}`);
      return;
    }
    setEventEditError(null);
    setEventEditNotice(null);
    const selection = { partId: intent.partId, staffId: intent.staffId, ...result.selection, noteId: intent.noteId };
    setSelectedEventTarget(selection);
    setChangeMeasureId(selection.measureId);
    if (!result.changed) return;
    const measure = result.score.measures[selection.measureId];
    const beat = Number((1 + intent.targetTick / (TICKS_PER_QUARTER * 4 / measure.time.denominator)).toFixed(2));
    const subject = result.movedEventCount > 1 ? `${result.movedEventCount} linked events` : event.kind === "note" && event.notes.length > 1 ? "chord" : "note";
    commit(result.score, `Moved ${subject} to m. ${measure.number}, beat ${beat} · ties and other notes kept · Undo restores the position`);
  }, [commit, guardLargeScoreEditing, score, setSelectedEventTarget, setEventEditError]);

  const openEventEditor = () => {
    setInspectorSection("event");
    setPanelCollapsed("inspector", false);
    setInputHelpOpen(false);
    setInstrumentsOpen(false);
    if (window.matchMedia("(max-width: 1180px)").matches) {
      modalReturnFocusRef.current = captureModalReturnFocus();
      setInspectorOpen(true);
    } else window.requestAnimationFrame(() => document.getElementById(selectedIsChord ? "selected-tone-choice" : "selected-event-duration")?.focus());
  };

  const continueNoteInput = useCallback(() => {
    setKeyboardEntryTarget(null);
    clearRangeSelection();
    setSelectedEventTarget(null);
    setSelectedChordNote(null);
    setChordMode(false);
    setNewChordPending(false);
    setEventEditError(null);
    setInputHelpOpen(false);
    if (inspectorOpen) {
      dialogReturnToScoreRef.current = true;
      setInspectorOpen(false);
    } else window.requestAnimationFrame(focusScoreInput);
    setStatus("Input mode · add at NEXT · 1–7 and ~ set the next note; QWERTYU enters notes");
  }, [clearRangeSelection, inspectorOpen, setSelectedEventTarget, setEventEditError]);

  const startTouchInput = () => {
    continueNoteInput();
    setNoteEntryMethod("buttons");
    setInputToolsOpen(true);
    window.requestAnimationFrame(() => notationToolsRef.current?.querySelector<HTMLButtonElement>('.note-values button[aria-pressed="true"]')?.focus());
    setStatus("Touch input · choose a length, then tap 도–시 or Rest to add at NEXT");
  };

  const prepareNextChord = () => {
    if (guardLargeScoreEditing()) return;
    setChordMode(true);
    setNewChordPending(true);
    setSelectedEventTarget(null);
    setStatus("Next chord ready · choose a pitch to start it at the NEXT marker, then add more pitches");
  };

  const removeSelectedTone = () => {
    if (!selectedIsChord || !selectedEventTarget || !selectedTone || guardLargeScoreEditing()) return;
    const result = removeChordToneFromEvent(score, selectedEventTarget.partId, selectedEventTarget.staffId, selectedEventTarget.measureId, selectedEventTarget.eventId, selectedTone.id);
    if (!result.removed) {
      setEventEditError({ score, eventId: selectedEventTarget.eventId, message: result.error });
      return;
    }
    setEventEditError(null);
    commit(result.score, `Removed only ${pitchName(result.removedNote.pitch)} · rhythm and other tones kept · Undo restores it`);
    window.requestAnimationFrame(() => document.getElementById("selected-note-pitch")?.focus());
  };

  useEffect(() => {
    if (inspectorOpen && document.activeElement === document.body) activeDialogRef.current?.focus();
  }, [inspectorOpen, score]);

  const undo = useCallback(() => {
    if (!past.length) return;
    clearRangeSelection();
    cancelPlayback();
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => trimStudioHistory([{ score, selection: selectedEventTarget, range: rangeSelectionMode ? rangeTarget : null, rangeTool: rangeEditTool, rangeExpanded: rangeToolsExpanded, action: previous.action }, ...items], "start"));
    scoreRef.current = previous.score;
    savePendingRef.current = true;
    setScore(previous.score);
    const restoredSelection = revalidateEventSelection(previous.score, previous.selection);
    setSelectedEventTarget(restoredSelection);
    const restoredRange = previous.range && getEventRange(previous.score, previous.range.partId, previous.range.staffId, previous.range.startEventId, previous.range.endEventId) ? previous.range : null;
    setRangeTarget(restoredRange);
    setRangeSelectionMode(Boolean(restoredRange));
    if (previous.rangeTool) setRangeEditTool(previous.rangeTool);
    setRangeToolsExpanded(previous.rangeExpanded ?? true);
    setMetadataDraft(previous.score.metadata);
    setTitleError("");
    const selection = safeSelection(
      previous.score,
      restoredSelection?.partId ?? selectedPartId,
      restoredSelection?.staffId ?? selectedStaffId,
    );
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setStatus(autoSaveEnabled
      ? `Undid ${previous.action ?? "the last edit"}${restoredRange ? " · range selection restored" : ""}`
      : "Undid the last edit · autosave paused — use Save in this browser or New to replace preserved drafts");
  }, [autoSaveEnabled, cancelPlayback, clearRangeSelection, past, score, selectedEventTarget, selectedPartId, selectedStaffId, setSelectedEventTarget, setMetadataDraft, setTitleError, rangeSelectionMode, rangeTarget, rangeEditTool, rangeToolsExpanded]);

  const redo = useCallback(() => {
    if (!future.length) return;
    clearRangeSelection();
    cancelPlayback();
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => trimStudioHistory([...items, { score, selection: selectedEventTarget, range: rangeSelectionMode ? rangeTarget : null, rangeTool: rangeEditTool, rangeExpanded: rangeToolsExpanded, action: next.action }], "end"));
    scoreRef.current = next.score;
    savePendingRef.current = true;
    setScore(next.score);
    const restoredSelection = revalidateEventSelection(next.score, next.selection);
    setSelectedEventTarget(restoredSelection);
    const restoredRange = next.range && getEventRange(next.score, next.range.partId, next.range.staffId, next.range.startEventId, next.range.endEventId) ? next.range : null;
    setRangeTarget(restoredRange);
    setRangeSelectionMode(Boolean(restoredRange));
    if (next.rangeTool) setRangeEditTool(next.rangeTool);
    setRangeToolsExpanded(next.rangeExpanded ?? true);
    setMetadataDraft(next.score.metadata);
    setTitleError("");
    const selection = safeSelection(
      next.score,
      restoredSelection?.partId ?? selectedPartId,
      restoredSelection?.staffId ?? selectedStaffId,
    );
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setStatus(autoSaveEnabled
      ? `Redid ${next.action ?? "the edit"}${restoredRange ? " · range selection restored" : ""}`
      : "Redid the edit · autosave paused — use Save in this browser or New to replace preserved drafts");
  }, [autoSaveEnabled, cancelPlayback, clearRangeSelection, future, score, selectedEventTarget, selectedPartId, selectedStaffId, setSelectedEventTarget, setMetadataDraft, setTitleError, rangeSelectionMode, rangeTarget, rangeEditTool, rangeToolsExpanded]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setMetronomeEnabled(window.localStorage.getItem("garak.practice.metronome") === "on");
        setBeatGuideEnabled(window.localStorage.getItem("garak.practice.beat-guide") !== "off");
        setRepeatCountInEnabled(window.localStorage.getItem("garak.practice.repeat-count-in") === "on");
        setCountInEnabled(window.localStorage.getItem("garak.practice.count-in") === "on");
        setCountInBars(window.localStorage.getItem("garak.practice.count-in-bars") === "2" ? 2 : 1);
        const savedClickVolume = window.localStorage.getItem("garak.practice.click-volume");
        if (savedClickVolume !== null && Number.isFinite(Number(savedClickVolume))) setClickVolume(Math.max(0, Math.min(100, Number(savedClickVolume))));
        const savedRate = Number(window.localStorage.getItem("garak.playback-speed"));
        if ([.25, .5, .75, 1, 1.25, 1.5, 2].includes(savedRate)) setPlaybackRate(savedRate);
        setPlaybackFollowEnabled(window.localStorage.getItem("garak.playback-follow") !== "off");
        const savedPracticeUndo = readPracticeResetUndo(window.localStorage);
        setPracticeResetUndo(savedPracticeUndo);
        if (savedPracticeUndo) setPracticeNotice("기본값으로 되돌렸습니다. 초기화 취소로 이전 설정을 복원할 수 있습니다.");
        const stored = loadStoredScore(window.localStorage);
        if (stored.kind === "loaded") {
          scoreRef.current = stored.score;
          setScore(stored.score);
          const selection = safeSelection(stored.score);
          setSelectedPartId(selection.partId);
          setSelectedStaffId(selection.staffId);
          setChangeMeasureId(stored.score.measureOrder[0]);
          setMetadataDraft(stored.score.metadata);
          if (stored.source === "primary") setLastLocalSave({ score: stored.score, message: "Saved locally" });
          setStatus(stored.source === "backup"
            ? "Recovered the last-known-good backup — the damaged latest draft was preserved; autosave is paused until Save in this browser or New"
            : "Recovered your local score");
          autoSaveEnabledRef.current = stored.source === "primary";
          setAutoSaveEnabled(stored.source === "primary");
        } else if (stored.reason === "empty") {
          setStatus("Ready — changes save on this device");
          autoSaveEnabledRef.current = true;
          setAutoSaveEnabled(true);
        } else {
          autoSaveEnabledRef.current = false;
          setAutoSaveEnabled(false);
          setStatus("Started a fresh score — damaged drafts were preserved; autosave is paused until Save in this browser or New");
        }
      } catch {
        autoSaveEnabledRef.current = false;
        setAutoSaveEnabled(false);
        setStatus("Started a fresh score — local storage is unavailable; autosave is paused");
      } finally {
        hydratedRef.current = true;
        setHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated || !autoSaveEnabled) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const nextStatus = persistScoreLocally(score);
      savePendingRef.current = nextStatus !== "Saved locally";
      setLastLocalSave({ score, message: nextStatus });
      if (nextStatus !== "Saved locally") setStatus(nextStatus);
    }, 450);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [autoSaveEnabled, hydrated, score]);

  const saveNow = useCallback(() => {
    const nextStatus = persistScoreLocally(score);
    savePendingRef.current = nextStatus !== "Saved locally";
    setLastLocalSave({ score, message: nextStatus });
    setStatus(nextStatus);
    if (nextStatus === "Saved locally") {
      autoSaveEnabledRef.current = true;
      setAutoSaveEnabled(true);
    }
  }, [score]);

  useEffect(() => {
    const flushPendingSave = (): boolean => {
      if (!hydratedRef.current || !savePendingRef.current) return true;
      if (!autoSaveEnabledRef.current) return false;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const nextStatus = persistScoreLocally(scoreRef.current);
      const saved = nextStatus === "Saved locally";
      savePendingRef.current = !saved;
      setLastLocalSave({ score: scoreRef.current, message: nextStatus });
      return saved;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      if (!flushPendingSave()) setStatus("Local save failed — keep this tab open and export a Garak JSON backup");
    };
    const handlePageHide = () => { flushPendingSave(); };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (flushPendingSave()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const localSaveState = !hydrated ? "opening" : !autoSaveEnabled ? "paused" : lastLocalSave?.score !== score ? "saving" : lastLocalSave.message === "Saved locally" ? "saved" : "error";
  const localSaveLabel = { opening: "Opening local score…", paused: "Autosave paused", saving: "Saving changes…", saved: "Saved in this browser", error: "Changes not saved" }[localSaveState];

  const currentPractice: PracticeSettings = { rate: playbackRate, metronome: metronomeEnabled, volume: clickVolume, countIn: countInEnabled, repeatCountIn: repeatCountInEnabled, bars: countInBars, beatGuide: beatGuideEnabled };
  const clearPracticeUndo = () => {
    setPracticeResetUndo(null);
    setPracticeNotice("");
    discardPracticeResetUndo(window.localStorage);
  };

  const rememberPracticePreference = (key: "beat-guide" | "metronome" | "count-in" | "repeat-count-in" | "count-in-bars" | "click-volume", value: string) => {
    try { clearPracticeUndo(); window.localStorage.setItem(`garak.practice.${key}`, value); }
    catch { setStatus("Practice setting changed for this session · browser could not save it"); }
  };

  const applyPracticeSettings = (settings: PracticeSettings, undo: PracticeSettings | null, notice: string) => {
    setPlaybackRate(settings.rate);
    setMetronomeEnabled(settings.metronome);
    setClickVolume(settings.volume);
    setCountInEnabled(settings.countIn);
    setRepeatCountInEnabled(settings.repeatCountIn);
    setCountInBars(settings.bars);
    setBeatGuideEnabled(settings.beatGuide);
    setPracticeResetUndo(undo);
    let message = notice;
    try {
      playbackRateSetterRef.current?.(settings.rate);
      repeatCountSetterRef.current?.(settings.repeatCountIn, settings.bars);
      const context = audioContextRef.current;
      if (context && clickGainsRef.current) {
        clickGainsRef.current.metronome.gain.setTargetAtTime(settings.metronome ? settings.volume / 100 * .32 : 0, context.currentTime, .005);
        clickGainsRef.current.countIn.gain.setTargetAtTime(settings.volume / 100 * .32, context.currentTime, .005);
      }
    } catch {
      cancelPlayback();
      message += " 브라우저가 소리를 갱신하지 못해 재생을 멈췄습니다.";
    }
    try { persistPracticeSettings(window.localStorage, settings, undo); }
    catch { message += " 브라우저에 저장하지 못한 설정이 있습니다. 다시 열면 유지되지 않을 수 있습니다."; }
    setStatus(message);
    setPracticeNotice(message);
  };

  const resetPracticeSettings = () => {
    if (isDefaultPractice(currentPractice)) return;
    applyPracticeSettings(PRACTICE_DEFAULTS, currentPractice, "기본값으로 되돌렸습니다. 초기화 취소로 이전 설정을 복원할 수 있습니다.");
    window.requestAnimationFrame(() => practiceUndoButtonRef.current?.focus());
  };
  const undoPracticeReset = () => {
    if (!practiceResetUndo) return;
    applyPracticeSettings(practiceResetUndo, null, "초기화를 취소하고 직전 연습 설정을 복원했습니다.");
    window.requestAnimationFrame(() => practiceResetButtonRef.current?.focus());
  };

  const stopPlayback = useCallback(() => {
    cancelPlayback();
    setStatus("Playback stopped");
  }, [cancelPlayback]);

  const finishPlayback = useCallback(() => {
    cancelPlayback();
    setStatus("Playback finished");
  }, [cancelPlayback]);

  const playScore = useCallback((loop = false, fromBeginning = false, seekSeconds?: number, rateOverride?: number, keepPaused = false) => {
    const rate = rateOverride ?? playbackRate;
    if (audioContextRef.current && seekSeconds === undefined && !fromBeginning) {
      const context = audioContextRef.current;
      const nextPaused = !pausedRef.current;
      pausedRef.current = nextPaused;
      setPaused(nextPaused);
      setStatus(nextPaused ? "Playback paused · Space to resume · tap score to seek" : transportRef.current?.loop ? "Looping selected range" : "Playback resumed");
      void (nextPaused ? context.suspend() : context.resume()).catch(() => {
        if (audioContextRef.current !== context) return;
        cancelPlayback();
        setStatus("Playback stopped — the browser could not pause or resume audio");
      });
      return;
    }
    const previous = seekSeconds !== undefined ? transportRef.current : null;
    if (previous?.loop && (seekSeconds! < previous.from || seekSeconds! >= previous.to)) {
      setStatus("Choose a position inside the loop · Stop to play outside the selected range");
      return;
    }
    if (audioContextRef.current) cancelPlayback();
    const playbackPartIds = viewMode === "part" && selectedPart ? [selectedPart.id] : undefined;
    const startMeasure = selectedEventTarget?.measureId ?? keyboardEntryMeasureId;
    const secondsPerTick = 60 / score.tempo / TICKS_PER_QUARTER;
    const measureIndex = startMeasure ? score.measureOrder.indexOf(startMeasure) : 0;
    const measureStart = score.measureOrder.slice(0, Math.max(0, measureIndex)).reduce((sum, id) => sum + measureCapacity(score.measures[id]), 0) * secondsPerTick;
    const from = previous && (previous.loop || rateOverride !== undefined) ? previous.from : seekSeconds !== undefined ? seekSeconds : fromBeginning ? 0 : selectedRange ? selectedRange.startTick * secondsPerTick : measureStart;
    const to = previous && (previous.loop || rateOverride !== undefined) ? previous.to : seekSeconds !== undefined ? scoreNotatedDurationSeconds(score) : !fromBeginning && selectedRange ? selectedRange.endTick * secondsPerTick : scoreNotatedDurationSeconds(score);
    loop = previous?.loop ?? loop;
    if (loop && !selectedRange) { setStatus("Select a range to loop"); return; }
    const musicNotes = collectPlaybackNotes(score, playbackPartIds);
    const playbackNotes = [...musicNotes, ...metronomeNotes(score)];
    const queue = createPlaybackQueue(playbackNotes, from, to, loop);
    const musicNoteCount = musicNotes.filter(note => note.startSeconds < to && note.startSeconds + note.durationSeconds > from).length;
    const hasAudibleMusic = musicNoteCount > 0;
    if (to <= from) {
      setStatus("Choose a non-empty interval for playback");
      return;
    }
    if (typeof AudioContext === "undefined") {
      setStatus("Playback is unavailable in this browser");
      return;
    }
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const master = context.createGain();
      master.gain.value = Math.min(.32, .9 / Math.sqrt(Math.max(1, playbackPartIds?.length ?? score.parts.length)));
      master.connect(context.destination);
      const clickGains = { metronome: context.createGain(), countIn: context.createGain() };
      clickGains.metronome.gain.value = metronomeEnabled ? clickVolume / 100 * .32 : 0;
      clickGains.countIn.gain.value = clickVolume / 100 * .32;
      clickGains.metronome.connect(context.destination);
      clickGains.countIn.connect(context.destination);
      clickGainsRef.current = clickGains;
      const offset = seekSeconds === undefined ? 0 : Math.max(0, seekSeconds - from);

      transportRef.current = { from, to, loop };
      const families = new Map(score.parts.map(part => [part.id, part.instrument.family]));
      const repeatedCount = loop && repeatCountInEnabled ? countInForPosition(score, from, countInBars) : undefined;
      const countIn = (countInEnabled || repeatedCount) && seekSeconds === undefined ? countInForPosition(score, from, countInBars) : undefined;
      const live = createLivePlayback(context, master, playbackNotes, from, to, loop, rate, offset, families, countIn, clickGains, repeatedCount);
      repeatCountSetterRef.current = (enabled, bars) => live.setRepeatCountIn(enabled ? countInForPosition(score, from, bars) : undefined);
      setCountInProgress(live.countInProgress());
      const scheduleAhead = () => {
        if (audioContextRef.current !== context || pausedRef.current) return;
        try {
          live.schedule();
          if (!loop && live.elapsed() >= queue.duration) finishPlayback();
        } catch {
          cancelPlayback();
          setStatus("Playback stopped — the browser could not schedule the next notes");
        }
      };
      audioContextRef.current = context;
      playbackClockRef.current = live.position;
      playbackRateSetterRef.current = live.setRate;
      void (keepPaused ? context.suspend() : context.resume()).catch(() => {
        if (audioContextRef.current !== context) return;
        cancelPlayback();
        setStatus("Playback could not start — check this browser's audio permissions");
      });
      setPlaying(true);
      setPaused(keepPaused);
      pausedRef.current = keepPaused;
      setPlaybackSeconds(from + offset);
      const playbackScope = viewMode === "part" && selectedPart ? ` · ${selectedPart.name} part` : "";
      setStatus(`${loop ? "Looping selected range" : seekSeconds !== undefined ? `Playing from measure ${locatePlaybackPosition(score, seekSeconds)?.measureNumber ?? 1}` : selectedRange && !fromBeginning ? "Playing selected range" : `Playing from measure ${fromBeginning ? 1 : Math.max(0, measureIndex) + 1}`} · ${countLabel(musicNoteCount, "note")} · ♩ = ${score.tempo} · ${rate}×${!hasAudibleMusic && (!metronomeEnabled || clickVolume === 0) ? " · Silent playback" : ""}${keepPaused ? " · paused" : ""}${playbackScope}`);
      playbackTimerRef.current = window.setInterval(scheduleAhead, 50);
      scheduleAhead();
      const updatePlayback = () => {
        if (audioContextRef.current !== context) return;
        const elapsed = live.elapsed();
        if (!pausedRef.current) {
          setPlaybackSeconds(live.position());
          const counting = live.countInProgress();
          setCountInProgress(counting);
        }
        if (!pausedRef.current && !loop && elapsed >= queue.duration) {
          playbackFrameRef.current = null;
          finishPlayback();
          return;
        }
        playbackFrameRef.current = window.requestAnimationFrame(updatePlayback);
      };
      playbackFrameRef.current = window.requestAnimationFrame(updatePlayback);
    } catch {
      audioContextRef.current = null;
      if (playbackTimerRef.current !== null) window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
      if (playbackFrameRef.current !== null) window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
      setPlaying(false);
      setPlaybackSeconds(null);
      setStatus("Playback could not start — this browser could not prepare the audio graph");
      if (context) {
        try {
          void context.close().catch(() => undefined);
        } catch {
          // State is already idle even when a browser's close implementation is broken.
        }
      }
    }
  }, [cancelPlayback, finishPlayback, keyboardEntryMeasureId, selectedEventTarget, selectedRange, score, selectedPart, viewMode, playbackRate, metronomeEnabled, countInEnabled, countInBars, repeatCountInEnabled, clickVolume]);

  const shiftInputPitch = useCallback((delta: -1 | 1) => {
    const next = shiftDiatonicPitch(inputPitch, delta);
    setInputPitch(next);
    setStatus(`${inputPitchLabel(next)} selected · choose length with 1–7, then QWERTYU to enter`);
  }, [inputPitch]);

  const changeInputOctave = useCallback((delta: -1 | 1) => {
    const next = { ...inputPitch, octave: Math.max(0, Math.min(8, inputPitch.octave + delta)) };
    setInputPitch(next);
    setStatus(`${inputPitchLabel(next)} selected`);
  }, [inputPitch]);

  const chooseNoteEntryMethod = useCallback((method: NoteEntryMethod) => {
    setNoteEntryMethod(method);
    setStatus(noteEntryInstruction(method, inputPitch, duration, dotCount));
  }, [dotCount, duration, inputPitch]);

  const enterEvent = useCallback((step: PitchStep, forceRest = restInput, options: EnterEventOptions = {}) => {
    if (guardLargeScoreEditing()) return;
    if (options.addToSelectedChord && (selectedEvent?.kind !== "note" || !selectedEventTarget)) {
      setStatus("Select a note or chord first · Shift+QWERTYU adds a tone to that selection");
      return;
    }
    const targetPartId = options.addToSelectedChord ? selectedEventTarget?.partId : options.partId;
    const targetStaffId = options.addToSelectedChord ? selectedEventTarget?.staffId : options.staffId;
    const part = targetPartId
      ? score.parts.find((candidate) => candidate.id === targetPartId)
      : score.parts.find((candidate) => candidate.id === selectedPartId) ?? score.parts[0];
    if (!part) {
      setStatus("The input target is no longer available.");
      return;
    }
    const staffIndex = resolveStaffIndex(part, targetStaffId ?? selectedStaffId);
    if (staffIndex < 0) {
      setStatus("The input staff is no longer available.");
      return;
    }
    const staffId = part.staves[staffIndex].id;
    const staffNumber = staffIndex + 1;
    const entryOctave = options.octave ?? octave;
    const entryDuration = options.duration ?? duration;
    const eventId = `event-${Date.now()}-${eventSequence.current++}`;
    const enteringRest = forceRest;
    const startsNewChord = options.startNewChord || newChordPending;
    const exactChordTarget = (options.addToSelectedChord || chordMode && !startsNewChord && !enteringRest)
      && selectedEvent?.kind === "note"
      && selectedEventTarget?.partId === part.id
      && selectedEventTarget.staffId === staffId
      ? selectedEventTarget
      : null;
    const latestChordMeasureId = chordMode && !startsNewChord && !enteringRest && !selectedEventTarget
      ? findLastEventMeasureId(score, part.id, staffIndex)
      : null;
    const latestChordEvent = latestChordMeasureId
      ? getPrimaryVoice(part, latestChordMeasureId, staffIndex).events.at(-1)
      : undefined;
    if (exactChordTarget || latestChordMeasureId && latestChordEvent?.kind === "note") {
      const targetMeasureId = exactChordTarget?.measureId ?? latestChordMeasureId!;
      const entryWrittenKey = writtenKeyForPart(score.measures[targetMeasureId].key, part);
      const alter = inputAlter(accidentalMode, entryWrittenKey, step);
      const note: ScoreNote = {
        id: `${eventId}-note-1`,
        pitch: { step, alter, octave: entryOctave },
        accidentalDisplay: accidentalMode === "auto" ? "auto" : "force",
      };
      const result = exactChordTarget
        ? addChordToneToEvent(score, part.id, staffId, exactChordTarget.measureId, exactChordTarget.eventId, note)
        : addChordTone(score, part.id, note, staffId);
      if (!result.added) {
        setStatus(result.error);
        return;
      }
      const updatedPart = result.score.parts.find((candidate) => candidate.id === part.id)!;
      const updatedStaffIndex = resolveStaffIndex(updatedPart, staffId);
      const updatedEvent = getPrimaryVoice(updatedPart, result.measureId, updatedStaffIndex).events.find((event) => event.id === result.eventId);
      const noteCount = updatedEvent?.kind === "note" ? updatedEvent.notes.length : 1;
      commit(result.score, `Added ${pitchName(note.pitch)} · Chord · ${countLabel(noteCount, "note")} · staff ${staffNumber}`);
      if (!options.preserveInputPitch) setInputPitch({ step, octave: entryOctave });
      setSelectedEventTarget({ partId: part.id, staffId, measureId: result.measureId, eventId: result.eventId });
      setSelectedChordNote({ eventId: result.eventId, noteId: note.id });
      requestInputFollow();
      return;
    }

    const durationValue: DurationValue = { base: entryDuration, dots: dotCount };
    const explicitMeasureId = options.measureId;
    const targetMeasureId = explicitMeasureId
      ?? findEventTargetMeasureId(score, part.id, durationValue, staffId, keyboardEntryMeasureId ?? undefined)
      ?? score.measureOrder.at(-1)!;
    if (!score.measures[targetMeasureId]) {
      setStatus("The input measure is no longer available.");
      return;
    }
    const entryWrittenKey = writtenKeyForPart(score.measures[targetMeasureId].key, part);
    const alter = inputAlter(accidentalMode, entryWrittenKey, step);
    const event = makeEvent({
      id: eventId,
      pitch: { step, alter, octave: entryOctave },
      duration: durationValue,
      rest: enteringRest,
      accidentalDisplay: accidentalMode === "auto" ? "auto" : "force",
    });
    const result = explicitMeasureId
      ? appendEventToMeasure(score, part.id, targetMeasureId, event, staffId)
      : appendEvent(score, part.id, event, staffId, keyboardEntryMeasureId ?? undefined);
    if (result.error) setStatus(result.error);
    else {
      setNewChordPending(false);
      const chordStatus = event.kind === "rest" && chordMode ? " · Chord mode ignored for rests" : "";
      const entryStatus = event.kind === "rest"
        ? "Entered rest"
        : chordMode
          ? `Started chord with ${pitchName(event.notes[0].pitch)}`
          : `Entered ${pitchName(event.notes[0].pitch)}`;
      const splitStatus = "segmentCount" in result && Number(result.segmentCount) > 1 ? ` · split across barlines${event.kind === "note" ? "; ties kept" : ""}` : "";
      const measureStatus = result.measureId ? ` · measure ${result.score.measures[result.measureId].number}` : "";
      commit(result.score, `${entryStatus} · ${durationName(entryDuration, dotCount)} · staff ${staffNumber}${measureStatus}${splitStatus}${chordStatus}`);
      if (result.measureId) {
        if (!enteringRest) setInputPitch({ step, octave: entryOctave });
        setSelectedEventTarget({ partId: part.id, staffId, measureId: result.measureId, eventId: event.id });
        requestInputFollow();
      }
    }
  }, [keyboardEntryMeasureId, accidentalMode, restInput, chordMode, commit, dotCount, duration, guardLargeScoreEditing, newChordPending, octave, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId, setSelectedEventTarget]);

  const enterPointerNote = useCallback((intent: ScorePointerNoteIntent) => {
    if (noteEntryMethod !== "score-pointer") return;
    if (intent.kind === "unsupported") {
      setSelectedPartId(intent.partId);
      setSelectedStaffId(intent.staffId);
      setSelectedEventTarget(null);
      setStatus("Score click input is not available on percussion staves yet — use the visible pitch buttons or switch input method");
      return;
    }
    const requestedSelectedChord = intent.addToChord && chordMode;
    const addToSelectedChord = requestedSelectedChord
      && selectedEvent?.kind === "note"
      && sameStaffMeasureTarget(selectedEventTarget, intent);
    if (requestedSelectedChord && !addToSelectedChord) {
      setStatus("Shift-click needs a selected note in the same staff and measure. No note was entered.");
      return;
    }
    setSelectedPartId(intent.partId);
    setSelectedStaffId(intent.staffId);
    if (!addToSelectedChord) setSelectedEventTarget(null);
    setInputPitch({ step: intent.step, octave: intent.octave });
    enterEvent(intent.step, false, {
      partId: intent.partId,
      staffId: intent.staffId,
      measureId: intent.measureId,
      octave: intent.octave,
      startNewChord: !addToSelectedChord,
    });
  }, [chordMode, enterEvent, noteEntryMethod, selectedEvent, selectedEventTarget, setSelectedEventTarget]);

  const activatePitchButton = useCallback((step: PitchStep) => {
    if (pitchButtonAction(noteEntryMethod) === "select") {
      const next = { step, octave: inputPitch.octave };
      setInputPitch(next);
      setStatus(`${inputPitchLabel(next)} selected · choose length with 1–7, then QWERTYU to enter`);
      return;
    }
    enterEvent(step);
  }, [enterEvent, inputPitch.octave, noteEntryMethod]);

  const changeSelectedTie = useCallback((direction: "incoming" | "outgoing", enabled: boolean) => {
    if (!selectedEventTarget || !selectedTone || guardLargeScoreEditing()) return;
    const result = setNoteTie(score, selectedEventTarget.partId, selectedEventTarget.staffId,
      selectedEventTarget.measureId, selectedEventTarget.eventId, selectedTone.id, direction, enabled);
    if (result.error) {
      setEventEditError({ score, eventId: selectedEventTarget.eventId, message: result.error, scope: "tie" });
      setStatus(`Tie not applied — ${result.error}`);
      return;
    }
    setEventEditError(null);
    if (result.changed) commit(result.score, enabled
      ? `Tied ${selectedPitchLabel} to the ${direction === "incoming" ? "previous" : "next"} note · pitch edits now update the linked notes together`
      : `Removed the ${direction === "incoming" ? "previous" : "next"} tie only · notes and rhythm kept · Undo restores the connection`);
  }, [commit, guardLargeScoreEditing, score, selectedEventTarget, selectedPitchLabel, selectedTone, setEventEditError]);

  const toggleTie = useCallback(() => {
    if (guardLargeScoreEditing()) return;
    if (selectedEvent) {
      if (selectedTone) changeSelectedTie("incoming", !hasPreviousTie);
      else setStatus("A rest cannot be tied. Select a pitched note first.");
      return;
    }
    const part = score.parts.find((candidate) => candidate.id === selectedPartId) ?? score.parts[0];
    if (!part) return;
    const staffIndex = resolveStaffIndex(part, selectedStaffId);
    if (staffIndex < 0) return;
    const result = toggleTieLastTwo(score, part.id, part.staves[staffIndex].id);
    if (result.error) setStatus(`Tie not applied — ${result.error}`);
    else commit(result.score, result.tied ? "Tied the last two notes" : "Removed the tie");
  }, [changeSelectedTie, commit, guardLargeScoreEditing, hasPreviousTie, score, selectedEvent, selectedPartId, selectedStaffId, selectedTone]);

  const removeChordTone = useCallback(() => {
    if (guardLargeScoreEditing()) return;
    const part = score.parts.find((candidate) => candidate.id === selectedPartId) ?? score.parts[0];
    if (!part) {
      setStatus("Select an instrument first.");
      return;
    }
    const staffIndex = resolveStaffIndex(part, selectedStaffId);
    if (staffIndex < 0) {
      setStatus("Select a valid staff first.");
      return;
    }
    const staffId = part.staves[staffIndex].id;
    const result = selectedEvent?.kind === "note" && selectedEventTarget
      ? removeChordToneFromEvent(
        score,
        selectedEventTarget.partId,
        selectedEventTarget.staffId,
        selectedEventTarget.measureId,
        selectedEventTarget.eventId,
      )
      : removeLastChordTone(score, part.id, staffId);
    if (!result.removed) {
      setStatus(result.error);
      return;
    }
    commit(result.score, `Removed ${pitchName(result.removedNote.pitch)} · Chord · ${countLabel(result.remainingNoteCount, "note")} · Undo is available`);
  }, [commit, guardLargeScoreEditing, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId]);

  const removeLatestInput = useCallback((collapseTime = false, clearAllNotes = false) => {
    if (guardLargeScoreEditing()) return;
    if (deleteRemovesChordTone && !collapseTime && !clearAllNotes) {
      removeChordTone();
      return;
    }
    if (selectedEvent && selectedEventTarget) {
      if (selectedEvent.kind === "note" && !collapseTime) {
        const result = clearEventToRest(
          score,
          selectedEventTarget.partId,
          selectedEventTarget.staffId,
          selectedEventTarget.measureId,
          selectedEventTarget.eventId,
        );
        if (!result.changed) {
          setStatus(result.error);
          return;
        }
        const measureNumber = score.measures[result.measureId]?.number;
        commit(
          result.score,
          `Cleared selected ${eventName(selectedEvent)}${measureNumber ? ` in measure ${measureNumber}` : ""} to a rest · rhythm preserved · Undo is available`,
        );
        return;
      }
      const result = removeEvent(
        score,
        selectedEventTarget.partId,
        selectedEventTarget.staffId,
        selectedEventTarget.measureId,
        selectedEventTarget.eventId,
      );
      if (!result.removed) {
        setStatus(result.error);
        return;
      }
      const measureNumber = score.measures[result.measureId]?.number;
      setSelectedEventTarget(null);
      commit(
        result.score,
        `Deleted selected ${eventName(result.removedEvent)}${measureNumber ? ` from measure ${measureNumber}` : ""} · later events shifted earlier · Undo is available`,
      );
      return;
    }
    if (!selectedPart || !activeStaffId || !lastEvent) {
      setStatus("Nothing to delete on the selected staff");
      return;
    }
    commit(
      removeLastEvent(score, selectedPart.id, activeStaffId),
      `Deleted ${eventName(lastEvent)} from staff ${selectedStaffNumber} · Undo is available`,
    );
    setSelectedEventTarget(null);
  }, [activeStaffId, commit, deleteRemovesChordTone, guardLargeScoreEditing, lastEvent, removeChordTone, score, selectedEvent, selectedEventTarget, selectedPart, selectedStaffNumber, setSelectedEventTarget]);

  const applyDynamic = useCallback((dynamic: DynamicMarking | null) => {
    if (guardLargeScoreEditing()) return;
    const part = score.parts.find((candidate) => candidate.id === selectedPartId) ?? score.parts[0];
    if (!part) {
      setStatus("Select an instrument first.");
      return;
    }
    const staffIndex = resolveStaffIndex(part, selectedStaffId);
    if (staffIndex < 0) {
      setStatus("Select a valid staff first.");
      return;
    }
    const targetsSelection = Boolean(selectedEvent && selectedEventTarget);
    const result = targetsSelection && selectedEventTarget
      ? setEventDynamic(
        score,
        selectedEventTarget.partId,
        selectedEventTarget.staffId,
        selectedEventTarget.measureId,
        selectedEventTarget.eventId,
        dynamic,
      )
      : setLastEventDynamic(score, part.id, dynamic, part.staves[staffIndex].id);
    if (result.error) {
      setStatus(result.error);
      return;
    }
    if (!result.changed) {
      setStatus(dynamic
        ? `The ${targetsSelection ? "selected" : "last"} event is already ${dynamic}`
        : `The ${targetsSelection ? "selected" : "last"} event has no dynamic`);
      return;
    }
    commit(
      result.score,
      dynamic
        ? `Set ${dynamic} on the ${targetsSelection ? "selected" : "last"} event · staff ${staffIndex + 1}`
        : `Cleared the ${targetsSelection ? "selected" : "last"} event dynamic · staff ${staffIndex + 1}`,
    );
  }, [commit, guardLargeScoreEditing, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId]);

  const applyArticulation = useCallback((articulation: Articulation | null) => {
    if (guardLargeScoreEditing()) return;
    const part = score.parts.find((candidate) => candidate.id === selectedPartId) ?? score.parts[0];
    if (!part) {
      setStatus("Select an instrument first.");
      return;
    }
    const staffIndex = resolveStaffIndex(part, selectedStaffId);
    if (staffIndex < 0) {
      setStatus("Select a valid staff first.");
      return;
    }
    const targetsSelection = Boolean(selectedEvent && selectedEventTarget);
    if (targetsSelection && selectedEvent?.kind !== "note") {
      setStatus("Articulations apply to notes; select a note instead of a rest.");
      return;
    }
    const result = targetsSelection && selectedEventTarget
      ? setEventArticulation(
        score,
        selectedEventTarget.partId,
        selectedEventTarget.staffId,
        selectedEventTarget.measureId,
        selectedEventTarget.eventId,
        articulation,
      )
      : setLastNoteArticulation(score, part.id, articulation, part.staves[staffIndex].id);
    if (result.error) {
      setStatus(result.error);
      return;
    }
    if (!result.changed) {
      setStatus(articulation
        ? `The ${targetsSelection ? "selected" : "last"} note is already ${articulation}`
        : `The ${targetsSelection ? "selected" : "last"} note has no articulation`);
      return;
    }
    commit(
      result.score,
      articulation
        ? `Set ${articulation} on the ${targetsSelection ? "selected" : "last"} note · staff ${staffIndex + 1}`
        : `Cleared the ${targetsSelection ? "selected" : "last"} note articulation · staff ${staffIndex + 1}`,
    );
  }, [commit, guardLargeScoreEditing, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === "Escape" && !activeDialogOpen && (rangeSelectionMode || rangeDestinationMode)) {
        event.preventDefault();
        if (rangeDestinationMode) { setRangeDestinationMode(null); setRangeError(null); setStatus("Destination cancelled · range selection kept"); }
        else { clearRangeSelection(); setStatus("Range selection cleared"); }
        return;
      }
      if (event.key === "Escape") {
        if (inputHelpOpen && !activeDialogOpen) {
          event.preventDefault();
          setInputHelpOpen(false);
          window.requestAnimationFrame(() => inputHelpButtonRef.current?.focus());
          return;
        }
        if (selectedEventTarget && !activeDialogOpen && !exportOpen) {
          event.preventDefault();
          continueNoteInput();
          return;
        }
        const returnToInputTools = inputToolsOpen;
        const returnToExportMenu = exportOpen && Boolean(target?.closest(".export-menu"));
        setAddOpen(false); setNewOpen(false); setHelpOpen(false); setExportOpen(false); setInspectorOpen(false); setInstrumentsOpen(false); setInputToolsOpen(false);
        if (returnToInputTools) window.requestAnimationFrame(() => inputToolsButtonRef.current?.focus());
        else if (returnToExportMenu) window.requestAnimationFrame(() => exportButtonRef.current?.focus());
        return;
      }
      const inspectorEditingControl = Boolean(target?.closest("#score-inspector"));
      const editingShortcut = (event.metaKey || event.ctrlKey) && ["z", "s"].includes(event.key.toLowerCase());
      if (activeDialogOpen && !(inspectorOpen && inspectorEditingControl && editingShortcut)) return;
      const textEntry = target?.matches("input, textarea, [contenteditable='true']");
      const notationToolbarControl = Boolean(target?.closest(".note-toolbar button, .note-entry-toggle"));
      const scoreControl = Boolean(target?.closest(".score-hit-target, .notehead-hit-target, .range-selection-bar"));
      const unrelatedInteractive = Boolean(target?.closest('a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="separator"]'))
        && !scoreControl
        && !notationToolbarControl;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !textEntry) {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !textEntry) { event.preventDefault(); saveNow(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p" && !textEntry) {
        event.preventDefault();
        if (liveEngravingUnavailable) setStatus("Print unavailable while interactive engraving is paused — switch to a smaller part view first");
        else window.print();
        return;
      }
      if (hasSystemShortcutModifier(event)) return;
      if (notationToolbarControl && (event.key === " " || event.key === "Enter")) return;
      const typing = textEntry || target?.matches("select") || unrelatedInteractive;
      if (event.isComposing || typing) return;
      if (selectedRange && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        if (!event.repeat && !rangeDestinationMode) deleteRange();
        return;
      }
      if (event.key === " " && !rangeDestinationMode) { event.preventDefault(); if (!event.repeat) playScore(false, event.shiftKey); return; }
      if (rangeSelectionMode || rangeDestinationMode) return;
      if (event.key === "Tab" && scoreControl && selectedPart && activeStaffId) {
        const current = keyboardEntryMeasureId ?? selectedEventTarget?.measureId ?? previewMeasureId;
        const index = current ? score.measureOrder.indexOf(current) : 0;
        let next = score.measureOrder[index + (event.shiftKey ? -1 : 1)];
        if (!next && event.shiftKey) return; // Shift+Tab at the first measure leaves the score.
        event.preventDefault();
        if (event.repeat) return;
        let targetScore = score;
        if (!next) {
          if (guardLargeScoreEditing()) return;
          targetScore = appendMeasure(score);
          if (targetScore === score) { setStatus("Measure not added — the score reached its safety limit"); return; }
          next = targetScore.measureOrder.at(-1)!;
          commit(targetScore, `Added measure ${targetScore.measures[next].number} · Undo removes the new measure`);
        }
        setSelectedEventTarget(null);
        setKeyboardEntryTarget({ scoreId: score.id, partId: selectedPart.id, staffId: activeStaffId, measureId: next });
        setNewChordPending(true);
        requestInputFollow();
        setStatus(`Measure ${targetScore.measures[next].number} · new notes append at NEXT · Shift+Tab returns to the previous measure`);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        if (event.repeat) return;
        removeLatestInput(event.shiftKey);
        return;
      }
      if ([".", "~", "`"].includes(event.key)) {
        event.preventDefault();
        if (event.repeat) return;
        if (selectedEvent) {
          changeSelectedNotation({ duration: { ...editingDuration!, dots: nextAugmentationDotCount(editingDuration!.dots) } });
        } else {
          const next = nextAugmentationDotCount(dotCount);
          setDotCount(next);
          setStatus(dotSelectionStatus(next));
        }
        return;
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (!event.repeat) {
          setRestInput(!restInput);
          setStatus(restInput ? "Note input · Q W E R T Y U = 도 레 미 파 솔 라 시" : "Rest input · press QWERTYU to add a rest; A returns to notes");
        }
        return;
      }
      const accidentalKey = { s: "flat", d: "natural", f: "sharp" }[event.key.toLowerCase()] as AccidentalMode | undefined;
      if (accidentalKey) {
        event.preventDefault();
        if (!event.repeat) { setAccidentalMode(accidentalKey); setStatus(`${accidentalKey} selected · applies to the next note`); }
        return;
      }
      if (event.key === "\\") { event.preventDefault(); if (!event.repeat) toggleTie(); return; }
      if (["z", "x"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (!event.repeat) {
          const delta = event.key.toLowerCase() === "z" ? -1 : 1;
          if (event.shiftKey) {
            const nextOctave = inputPitch.octave + delta;
            if (nextOctave < 0 || nextOctave > 8) setStatus("Chord unchanged · input octave must stay between 0 and 8");
            else enterEvent(inputPitch.step, false, { addToSelectedChord: true, octave: nextOctave, preserveInputPitch: true });
          } else changeInputOctave(delta);
        }
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const delta = event.key === "ArrowUp" ? 1 : -1;
        if (selectedTone) changeSelectedPitchBy((event.shiftKey ? delta * 12 : delta) as -12 | -1 | 1 | 12);
        else if (noteEntryMethod === "arrow-duration") shiftInputPitch(delta);
        else changeInputOctave(delta);
        return;
      }
      const durationIndex = Number(event.key) - 1;
      if (durationIndex >= 0 && durationIndex < DURATION_CHOICES.length) {
        event.preventDefault();
        const nextDuration = DURATION_CHOICES[durationIndex].value;
        if (event.repeat) return;
        if (selectedEvent) {
          changeSelectedNotation({ duration: { ...editingDuration!, base: nextDuration } });
        } else {
          setDuration(nextDuration);
          setStatus(noteEntryInstruction(noteEntryMethod, inputPitch, nextDuration, dotCount));
        }
        return;
      }
      const step = pitchFromKeyboardKey(event.key);
      if (step) {
        event.preventDefault();
        if (!event.repeat) {
          if (event.shiftKey) enterEvent(step, false, { addToSelectedChord: true });
          else enterEvent(step);
        }
        return;
      }
      if (event.key === "?") { event.preventDefault(); openHelpDialog(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [continueNoteInput, editingDuration, changeSelectedNotation, selectedEvent, commit, guardLargeScoreEditing, activeStaffId, keyboardEntryMeasureId, previewMeasureId, score, selectedPart, selectedEventTarget, setSelectedEventTarget, selectedTone, changeSelectedPitchBy, activeDialogOpen, restInput, changeInputOctave, clearRangeSelection, deleteRange, dotCount, duration, enterEvent, exportOpen, rangeDestinationMode, rangeSelectionMode, selectedRange, inputPitch, inspectorOpen, liveEngravingUnavailable, inputHelpOpen, inputToolsOpen, noteEntryMethod, openHelpDialog, playScore, redo, removeLatestInput, saveNow, shiftInputPitch, toggleTie, undo]);

  useEffect(() => () => {
    if (playbackTimerRef.current !== null) window.clearInterval(playbackTimerRef.current);
    playbackTimerRef.current = null;
    if (playbackFrameRef.current !== null) window.cancelAnimationFrame(playbackFrameRef.current);
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) {
      try {
        void context.close().catch(() => undefined);
      } catch {
        // Component teardown must remain total even if audio cleanup fails.
      }
    }
  }, []);

  const filteredInstruments = useMemo(() => {
    const query = instrumentQuery.trim().toLowerCase();
    return INSTRUMENTS.filter((instrument) =>
      (activeFamily === "All" || instrument.family === activeFamily) &&
      (!query || `${instrument.name} ${instrument.shortName} ${instrument.keywords.join(" ")}`.toLowerCase().includes(query)),
    );
  }, [activeFamily, instrumentQuery]);

  const createFromTemplate = (templateId: string) => {
    clearRangeSelection();
    if (!newScoreDraft.title.trim()) {
      setNewScoreError("Give your score a title before creating it.");
      document.getElementById("new-score-name")?.focus();
      return;
    }
    const tempo = Number(newScoreDraft.tempo);
    if (!Number.isInteger(tempo) || tempo < 30 || tempo > 300) {
      setNewScoreError("Choose a tempo from 30 to 300 BPM.");
      document.getElementById("new-score-tempo")?.focus();
      return;
    }
    let next = createScore(templateId, { seedDemo: false, soloInstrumentId: newScoreDraft.instrumentId });
    const [numerator, denominator] = newScoreDraft.meter.split("/").map(Number);
    const metered = setTimeFromMeasure(next, next.measureOrder[0], { numerator, denominator });
    if (metered.error) { setNewScoreError(metered.error); return; }
    next = metered.score;
    next.tempo = tempo;
    next.metadata = { ...next.metadata, title: newScoreDraft.title.trim(), composer: newScoreDraft.composer.trim() };
    const selection = safeSelection(next);
    const preserveUndo = !largeScoreEditingPaused;
    cancelPlayback();
    scoreRef.current = next;
    savePendingRef.current = true;
    autoSaveEnabledRef.current = true;
    setScore(next);
    setSelectedEventTarget(null);
    setPast(preserveUndo ? trimStudioHistory([...past, { score, selection: selectedEventTarget }], "end") : []);
    setFuture([]);
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setChangeMeasureId(next.measureOrder[0]);
    setMetadataDraft(next.metadata);
    setTitleError("");
    setAutoSaveEnabled(true);
    setViewMode("score");
    setInspectorSection("event");
    setChordMode(false);
    setNewChordPending(false);
    setSelectedChordNote(null);
    setDuration(4);
    setDotCount(0);
    setAccidentalMode("auto");
    setRestInput(false);
    setInputPitch({ step: "C", octave: 4 });
    setKeyboardEntryTarget(null);
    setInputHelpOpen(false);
    dialogReturnToScoreRef.current = true;
    setNewOpen(false);
    setStatus(preserveUndo
      ? `Created ${next.metadata.subtitle} · Undo restores the previous score`
      : `Created ${next.metadata.subtitle} · previous large score was released from Undo to keep the app responsive`);
  };

  const openImportedScore = (parsed: ScoreDocument, message: string) => {
    clearRangeSelection();
    setNewChordPending(false);
    setSelectedChordNote(null);
    importRequestIdRef.current += 1;
    filePickerReturnFocusRef.current = null;
    modalReturnFocusRef.current = null;
    const previousScore = scoreRef.current;
    const previousSelection = revalidateEventSelection(previousScore, selectedEventTargetRef.current);
    const previousSelectionFallback = safeSelection(previousScore, previousSelection?.partId, previousSelection?.staffId);
    const preserveUndo = planLiveEngraving(previousScore, "score", previousSelectionFallback.partId).kind === "safe";
    const selection = safeSelection(parsed);
    cancelPlayback();
    scoreRef.current = parsed;
    savePendingRef.current = true;
    autoSaveEnabledRef.current = true;
    setScore(parsed);
    setSelectedEventTarget(null);
    selectedEventTargetRef.current = null;
    setPast((items) => preserveUndo
      ? trimStudioHistory([...items, { score: previousScore, selection: previousSelection }], "end")
      : []);
    setFuture([]);
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setChangeMeasureId(parsed.measureOrder[0]);
    setMetadataDraft(parsed.metadata);
    setTitleError("");
    setAutoSaveEnabled(true);
    setPendingImport(null);
    setKeyboardEntryTarget(null);
    setChordMode(false);
    setInputHelpOpen(false);
    setStatus(preserveUndo
      ? `${message} · Undo restores the previous score`
      : `${message} · previous large score was released from Undo to keep the app responsive`);
    if (pendingImport) dialogReturnToScoreRef.current = true;
    else window.requestAnimationFrame(focusScoreInput);
  };

  const importScore = async (file: File | undefined) => {
    const requestId = ++importRequestIdRef.current;
    const returnFocus = filePickerReturnFocusRef.current;
    if (!file) {
      restoreFilePickerFocus();
      return;
    }
    filePickerReturnFocusRef.current = null;
    try {
      const lowerName = file.name.toLowerCase();
      const isXml = lowerName.endsWith(".musicxml") || lowerName.endsWith(".xml") || file.type.includes("xml");
      const maximumBytes = isXml ? MAX_MUSICXML_FILE_BYTES : MAX_NATIVE_FILE_BYTES;
      if (file.size > maximumBytes) {
        throw new Error(`This ${isXml ? "MusicXML" : "Garak JSON"} file is larger than the ${maximumBytes / 1024 / 1024} MB safety limit.`);
      }
      const contents = await file.text();
      if (requestId !== importRequestIdRef.current) return;
      let imported: ReturnType<typeof import("../lib/music/importers").importMusicXML> | null = null;
      if (isXml) {
        const { importMusicXML } = await import("../lib/music/importers");
        if (requestId !== importRequestIdRef.current) return;
        imported = importMusicXML(contents);
      }
      const parsed = imported?.score ?? JSON.parse(contents) as ScoreDocument;
      const errors = validateScore(parsed);
      if (errors.length) throw new Error(errors[0]);
      serializeNativeScore(parsed);
      if (requestId !== importRequestIdRef.current) return;
      if (imported?.warnings.length) {
        modalReturnFocusRef.current = returnFocus;
        setPendingImport({ score: parsed, warnings: imported.warnings });
        setStatus(`Review ${imported.warnings.length} MusicXML warning${imported.warnings.length === 1 ? "" : "s"} — current score unchanged`);
        return;
      }
      openImportedScore(parsed, imported ? `Opened ${parsed.metadata.title} from MusicXML` : `Opened ${parsed.metadata.title}`);
    } catch (error) {
      if (requestId !== importRequestIdRef.current) return;
      filePickerReturnFocusRef.current = null;
      modalReturnFocusRef.current = null;
      setPendingImport(null);
      setStatus(error instanceof Error ? `The score file could not be opened. ${error.message}` : "The score file could not be opened.");
      window.setTimeout(() => {
        const focusTarget = returnFocus?.isConnected && returnFocus.getClientRects().length
          ? returnFocus
          : projectTitleRef.current;
        focusTarget?.focus();
      }, 0);
    }
  };

  const ensureExportable = (format: string): boolean => {
    const errors = validateScore(score);
    if (!errors.length) return true;
    closeExportMenuAndRestoreFocus();
    setStatus(`${format} export unavailable — ${errors[0]}`);
    return false;
  };

  const exportNative = (keepDialogOpen = false) => {
    if (!ensureExportable("Garak JSON")) return;
    try {
      downloadBlob(serializeNativeScore(score), "application/json", `${safeFilename(score.metadata.title)}.garak.json`);
      setStatus("Download started · open the .garak.json file to keep editing");
      if (keepDialogOpen) setNewScoreDownloadStatus("Download started. Keep the .garak.json file to reopen this score.");
    } catch (error) {
      setStatus(`Garak JSON export failed — ${error instanceof Error ? error.message : "the download could not be created"}`);
      if (keepDialogOpen) setNewScoreDownloadStatus("Download could not be created. Close this dialog to see the error details.");
    }
    if (!keepDialogOpen) closeExportMenuAndRestoreFocus();
  };

  const exportMusicXML = () => {
    if (!ensureExportable("MusicXML")) return;
    try {
      downloadBlob(scoreToMusicXML(score), "application/vnd.recordare.musicxml+xml", `${safeFilename(score.metadata.title)}.musicxml`);
      setStatus("Exported MusicXML 4.0");
    } catch (error) { setStatus(`MusicXML export failed — ${error instanceof Error ? error.message : "the download could not be created"}`); }
    closeExportMenuAndRestoreFocus();
  };

  const exportMidi = () => {
    if (!ensureExportable("MIDI")) return;
    try {
      const midi = scoreToMidi(score);
      const midiBuffer = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer;
      downloadBlob(midiBuffer, "audio/midi", `${safeFilename(score.metadata.title)}.mid`);
      setStatus("Exported a Standard MIDI File");
    } catch (error) { setStatus(`MIDI export failed — ${error instanceof Error ? error.message : "the download could not be created"}`); }
    closeExportMenuAndRestoreFocus();
  };

  const applyMetadata = () => {
    if (guardLargeScoreEditing()) {
      setMetadataDraft(score.metadata);
      return;
    }
    if (!metadataDraft.title.trim()) {
      setTitleError("Enter a score title before saving these details.");
      setStatus("Score title invalid — a score title is required");
      return;
    }
    const recoveredFromTitleError = Boolean(titleError);
    setTitleError("");
    if (JSON.stringify(metadataDraft) === JSON.stringify(score.metadata)) {
      if (recoveredFromTitleError) setStatus("Score title restored · no details changed");
      return;
    }
    const next = structuredClone(score);
    next.metadata = metadataDraft;
    next.updatedAt = new Date().toISOString();
    commit(next, "Updated score details");
  };

  const setTempo = (tempo: number) => {
    if (guardLargeScoreEditing()) return score.tempo;
    const safeTempo = Number.isFinite(tempo) ? Math.max(30, Math.min(300, Math.round(tempo))) : score.tempo;
    if (safeTempo === score.tempo) return safeTempo;
    const next = structuredClone(score);
    next.tempo = safeTempo;
    next.updatedAt = new Date().toISOString();
    commit(next, `Tempo set to ${safeTempo}`);
    return scoreRef.current.tempo;
  };

  const changeMeterFromMeasure = (value: string) => {
    if (guardLargeScoreEditing()) return;
    const [numerator, denominator] = value.split("/").map(Number);
    const result = setTimeFromMeasure(score, activeChangeMeasureId, { numerator, denominator });
    if (result.error) {
      setMeterError({ score, measureId: activeChangeMeasureId, message: result.error });
      setStatus(result.error);
      return;
    }
    setMeterError(null);
    if (!result.changed) {
      setStatus(`${measureRangeLabel(score, [activeChangeMeasureId])} already uses ${value}`);
      return;
    }
    commit(result.score, `Time signature ${value} applied to ${measureRangeLabel(score, result.affectedMeasureIds)} · later changes kept`);
  };

  const changeKeyFromMeasure = (value: string) => {
    if (guardLargeScoreEditing()) return;
    const option = KEY_SIGNATURES.find((candidate) => keyValue(candidate) === value);
    if (!option) {
      setStatus("Choose a supported major or minor key signature.");
      return;
    }
    const key: KeySignature = { fifths: option.fifths, mode: option.mode };
    const result = setKeyFromMeasure(score, activeChangeMeasureId, key);
    if (result.error) {
      setStatus(result.error);
      return;
    }
    if (!result.changed) {
      setStatus(`${measureRangeLabel(score, [activeChangeMeasureId])} already uses ${keySignatureName(key)}`);
      return;
    }
    commit(result.score, `${keySignatureName(key)} concert key applied to ${measureRangeLabel(score, result.affectedMeasureIds)} · later changes kept`);
  };

  const addEmptyMeasure = () => {
    if (guardLargeScoreEditing()) return;
    const next = appendMeasure(score);
    if (next === score) {
      setStatus("Measure not added — the score reached its safety limit");
      return;
    }
    const measure = next.measures[next.measureOrder.at(-1)!];
    commit(next, `Added measure ${measure.number}`);
    if (rangeSelectionMode && rangeTarget) {
      setRangeTarget(rangeTarget);
      setRangeSelectionMode(true);
      setRangeDestinationMode(rangeDestinationMode);
    }
  };

  const removeEmptyMeasure = () => {
    if (guardLargeScoreEditing()) return;
    const result = removeLastMeasure(score);
    if (!result.removed) {
      setStatus(result.error);
      return;
    }
    if (result.measureId === activeChangeMeasureId) setChangeMeasureId(result.score.measureOrder.at(-1) ?? "");
    commit(result.score, `Removed empty measure ${result.measureNumber}`);
  };

  return (
    <main className="studio-shell">
      <header className="app-header">
        <div className="brand" aria-label="Garak Studio"><span className="brand-mark">G</span><span>Garak</span><span className="beta-tag">ALPHA</span></div>
        <a className="bonifacio-return-link" href="https://bonifacio.work/" aria-label="← Bonifacio">
          <span>←</span><span className="bonifacio-return-label">Bonifacio</span>
        </a>
        <button
          ref={projectTitleRef}
          className="project-title"
          onClick={() => {
            setExportOpen(false);
            setInspectorSection("score");
            setPanelCollapsed("inspector", false);
            if (window.matchMedia("(max-width: 1180px)").matches) {
              setInstrumentsOpen(false);
              setInspectorOpen(true);
            } else window.requestAnimationFrame(() => document.getElementById("score-title")?.focus());
          }}
          aria-label="Edit score details"
          aria-controls="score-inspector"
          aria-expanded={inspectorVisible}
        >
          <span className="eyebrow">{viewMode === "score" ? "FULL SCORE" : "LINKED PART"}</span>
          <strong>{score.metadata.title}<ChevronDown size={12} aria-hidden="true" /></strong>
        </button>
        <div key={statusRevision} className={`save-state status-${statusTone(status)}`}><span className="status-dot" aria-hidden="true" />{status}</div>
        <div className="transport">
          <button className="icon-button" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 size={16} /></button>
          <button className="icon-button" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={16} /></button>
          <button className={`play-button ${playing ? "playing" : ""}`} onClick={() => playScore()} title={playing ? paused ? "Resume · Space" : "Pause · Space" : selectedRange ? "Play selected range · Space" : `Play from measure ${score.measures[selectedEventTarget?.measureId ?? keyboardEntryMeasureId ?? score.measureOrder[0]]?.number ?? 1} · Space; Shift+Space from beginning`} aria-label={playing ? paused ? "Resume playback" : "Pause playback" : "Play score"}>{playing && !paused ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
          {playing ? <button className="icon-button transport-stop" onClick={stopPlayback} title="Stop and reset playback" aria-label="Stop playback"><Square size={15} fill="currentColor" /></button> : null}
          <button type="button" className="icon-button practice-settings-toggle" aria-label="연습 설정" title="연습 설정 · Practice settings" popoverTarget="practice-settings"><SlidersHorizontal size={18} /></button>
          <section id="practice-settings" className="practice-settings" popover="auto" aria-label="연습 설정">
            <div className="practice-settings-heading"><strong>연습 설정</strong><button type="button" className="icon-button" aria-label="Close practice settings" popoverTarget="practice-settings" popoverTargetAction="hide"><X size={18} /></button></div>
          <button type="button" className="icon-button playback-follow-toggle" disabled={!hydrated} aria-label="Auto-follow playback" aria-pressed={playbackFollowEnabled} title={playbackFollowEnabled ? "Auto-follow on · turn off" : "Auto-follow off · turn on"} onClick={() => {
            const enabled = !playbackFollowEnabled;
            setPlaybackFollowEnabled(enabled);
            if (enabled) setPlaybackFollowRevision(value => value + 1);
            try { window.localStorage.setItem("garak.playback-follow", enabled ? "on" : "off"); }
            catch { setStatus("Auto-follow changed for this session · browser could not save the setting"); }
          }}><Scan size={17} aria-hidden="true" /><span>Auto-follow playback</span></button>
          <button type="button" className="icon-button playback-follow-toggle beat-guide-toggle" aria-label="Show beat guide" aria-pressed={beatGuideEnabled} disabled={!hydrated} title="Show beat guide · independent of metronome sound; count-in stays visible" onClick={() => {
            const enabled = !beatGuideEnabled;
            setBeatGuideEnabled(enabled);
            rememberPracticePreference("beat-guide", enabled ? "on" : "off");
          }}><Eye size={17} /><span>Show beat guide</span></button>
          <button type="button" className="icon-button playback-follow-toggle" aria-label="Metronome" aria-pressed={metronomeEnabled} disabled={!hydrated} title="Metronome · toggle anytime" onClick={() => {
            const enabled = !metronomeEnabled;
            setMetronomeEnabled(enabled);
            const context = audioContextRef.current;
            if (context && clickGainsRef.current) clickGainsRef.current.metronome.gain.setTargetAtTime(enabled ? clickVolume / 100 * .32 : 0, context.currentTime, .005);
            rememberPracticePreference("metronome", enabled ? "on" : "off");
          }}><Drum size={17} /><span>Metronome sound</span></button>
          <label className="practice-setting-row"><span>Click volume <output className="practice-volume-value">{clickVolume}%{clickVolume === 0 ? " · 무음" : ""}</output></span><input className="click-volume" type="range" min="0" max="100" step="5" value={clickVolume} disabled={!hydrated} aria-label="Click volume" aria-valuetext={`${clickVolume}%`} title={`Metronome and count-in volume · ${clickVolume}%`} onChange={event => {
            const volume = Number(event.target.value);
            setClickVolume(volume);
            const context = audioContextRef.current;
            if (context && clickGainsRef.current) {
              clickGainsRef.current.metronome.gain.setTargetAtTime(metronomeEnabled ? volume / 100 * .32 : 0, context.currentTime, .005);
              clickGainsRef.current.countIn.gain.setTargetAtTime(volume / 100 * .32, context.currentTime, .005);
            }
            rememberPracticePreference("click-volume", String(volume));
          }} /></label>
          <button type="button" className="icon-button playback-follow-toggle" aria-label="Count-in before playback" aria-pressed={countInEnabled} disabled={!hydrated} title="Count-in before playback · changes apply to the next playback start" onClick={() => {
            const enabled = !countInEnabled;
            setCountInEnabled(enabled);
            rememberPracticePreference("count-in", enabled ? "on" : "off");
          }}><Timer size={17} /><span>Count-in before playback</span></button>
          <label className="practice-setting-row"><span>Count-in length</span><select className="playback-speed" disabled={!hydrated} aria-label="Count-in length" title="Count-in length · applies to the next count; an active count finishes unchanged" value={countInBars} onChange={event => {
            const bars = event.target.value === "2" ? 2 : 1;
            setCountInBars(bars);
            try {
              repeatCountSetterRef.current?.(repeatCountInEnabled, bars);
              setStatus(`Count-in: ${bars} ${bars === 1 ? "bar" : "bars"} · applies to the next count; an active count finishes unchanged`);
            } catch { cancelPlayback(); setStatus("Playback stopped — the browser could not update the count-in"); }
            rememberPracticePreference("count-in-bars", String(bars));
          }}><option value="1">1 bar</option><option value="2">2 bars</option></select></label>
          <button type="button" className="icon-button playback-follow-toggle" aria-label="Count-in every loop" aria-pressed={repeatCountInEnabled} disabled={!hydrated} title="Count-in every loop · applies before the next repeat; a count already started finishes first" onClick={() => {
            const enabled = !repeatCountInEnabled;
            setRepeatCountInEnabled(enabled);
            try { repeatCountSetterRef.current?.(enabled, countInBars); }
            catch { cancelPlayback(); setStatus("Playback stopped — the browser could not update the loop"); }
            if (transportRef.current?.loop) setStatus(enabled ? "Count-in enabled for upcoming repeats · current performance continues" : "Continuous repeats selected · any count already started finishes first");
            rememberPracticePreference("repeat-count-in", enabled ? "on" : "off");
          }}><Repeat2 size={17} /><span>Count-in every loop</span></button>
          <label className="practice-setting-row"><span>Playback speed</span><select className="playback-speed" disabled={!hydrated} aria-label="Playback speed" title="Practice speed · score tempo stays unchanged" value={playbackRate} onChange={event => {
            const rate = Number(event.target.value);
            setPlaybackRate(rate);
            try { playbackRateSetterRef.current?.(rate); setStatus(`Playback speed ${rate}× · score tempo unchanged${pausedRef.current ? " · paused" : transportRef.current?.loop ? " · looping selected range" : ""}`); }
            catch { cancelPlayback(); setStatus("Playback stopped — the browser could not change speed"); }
            try { clearPracticeUndo(); window.localStorage.setItem("garak.playback-speed", String(rate)); }
            catch { setStatus("Playback speed changed · browser could not save the setting"); }
          }}>
            {[.25, .5, .75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
          </select></label>
            <div className="practice-reset">
              {practiceNotice ? <p className="practice-notice" role="status">{practiceNotice}</p> : null}
              {practiceResetUndo ? <><button ref={practiceUndoButtonRef} type="button" className="icon-button practice-reset-undo" onClick={undoPracticeReset}><Undo2 size={16} /><span>초기화 취소</span></button><p>다시 열어도 취소할 수 있습니다. 다른 연습 설정을 직접 바꾸면 취소 기록은 지워집니다.</p></> : null}
              <button ref={practiceResetButtonRef} type="button" className="icon-button" disabled={!hydrated || isDefaultPractice(currentPractice)} onClick={resetPracticeSettings} aria-describedby="practice-reset-details"><RotateCcw size={16} /><span>기본값으로 되돌리기</span></button>
              <p id="practice-reset-details">1× · sound off · volume 60% · count-in off, 1 bar · beat guide on. 악보·템포·자동 따라가기는 유지됩니다. 진행 중인 카운트인은 끝까지 센 뒤 반영합니다.</p>
            </div>
            <p>Sound and beat display are independent. Count-in stays visible. Settings save automatically.</p>
          </section>
          {playing && playbackPosition && (countInProgress || beatGuideEnabled) ? <span className={`playback-position beat-guide${countInProgress ? " count-in-position" : ""}`} data-downbeat={transportBeat === 1 ? "true" : undefined} aria-label={countInProgress ? `${paused ? "Paused · " : ""}Count-in · bar ${countInProgress.bar} of ${countInProgress.bars} · beat ${countInProgress.beat} of ${countInProgress.beats}${countInProgress.beat === 1 ? " · first beat" : ""}` : `${paused ? "Paused · " : ""}Beat guide · measure ${playbackPosition.measureNumber} · beat ${transportBeat} of ${transportBeats}${transportBeat === 1 ? " · first beat" : ""}`} title={countInProgress ? "Count-in · bar / total bars · beat / beats per bar" : "Visual metronome · independent of click sound"}>{countInProgress ? <><span>{paused ? "Paused" : "Count-in"} · {countInProgress.bar}/{countInProgress.bars} bar</span><strong>{countInProgress.beat === 1 ? "◆" : "·"} {countInProgress.beat}/{countInProgress.beats} beat</strong></> : <><span>{paused ? "Paused" : "Playing"} · m. {playbackPosition.measureNumber}</span><strong>{transportBeat === 1 ? "◆" : "·"} {transportBeat}/{transportBeats} beat</strong></>}</span> : null}
        </div>
        <div className="header-actions">
          <div className="header-panel-controls" role="group" aria-label="Workspace panels">
            <button ref={mobileInstrumentsButtonRef} type="button" className="icon-button panel-toggle" disabled={!instrumentPanel.ready}
              aria-controls="instrument-drawer" aria-expanded={instrumentsVisible}
              aria-label={instrumentsVisible ? "Collapse instruments" : "Open instruments"}
              title={instrumentsVisible ? "Collapse instruments" : "Open instruments"} onClick={() => toggleWorkspacePanel("instrument")}>
              {instrumentsVisible ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
            </button>
            <button type="button" className="icon-button panel-toggle" disabled={!inspectorPanel.ready}
              aria-controls="score-inspector" aria-expanded={inspectorVisible}
              aria-label={inspectorVisible ? "Collapse inspector" : "Open inspector"}
              title={inspectorVisible ? "Collapse inspector" : "Open inspector"} onClick={() => toggleWorkspacePanel("inspector")}>
              {inspectorVisible ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}
            </button>
            <button type="button" className="icon-button panel-toggle focus-mode-toggle" disabled={!instrumentPanel.ready || !inspectorPanel.ready}
              aria-label={panels.focusMode ? "Exit focus mode" : "Enter focus mode"} aria-pressed={panels.focusMode}
              aria-controls="instrument-drawer score-inspector"
              title={panels.focusMode ? "Exit focus mode · Restore previous panels" : "Focus mode · Hide both panels"}
              onClick={() => { setInspectorOpen(false); setInstrumentsOpen(false); setExportOpen(false); panels.toggleFocusMode(); }}>
              {panels.focusMode ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
            </button>
            {panels.visibilityError ? <p className="panel-visibility-error" role="status">{panels.visibilityError}</p> : null}
          </div>
          <button className="quiet-button header-new-button" onClick={openNewDialog} aria-label="New score"><Plus size={14} /><span className="action-label">New</span></button>
          <button ref={openFileButtonRef} className="icon-button header-open-button" title="Open score" onClick={() => openFilePicker(openFileButtonRef.current)} aria-label="Open Garak or MusicXML score"><FolderOpen size={16} /></button>
          <button className="icon-button header-save-button" title={`Save in this browser · ${localSaveLabel}`} onClick={saveNow} aria-label="Save in this browser"><Save size={16} /></button>
          <button className="icon-button header-help-button" title="Help and keyboard shortcuts" onClick={openHelpDialog} aria-label="Keyboard shortcuts"><Keyboard size={16} /></button>
          <div ref={exportAnchorRef} className="export-anchor" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExportOpen(false); }}>
            <button ref={exportButtonRef} className="primary-button file-menu-button" onClick={() => { setExportOpen((value) => !value); }} aria-label="File and export menu" title={localSaveLabel} data-save-state={localSaveState} aria-expanded={exportOpen}><Download className="export-icon" size={14} /><FolderOpen className="file-menu-icon" size={16} /><span className="action-label">Save a copy</span><span className="file-menu-label">File</span><ChevronDown className="export-chevron" size={13} /></button>
            {exportOpen ? (
              <div className="export-menu" role="group" aria-label="File and export options">
                <div className="local-save-status" data-save-state={localSaveState} role="status"><span className="save-state-dot" aria-hidden="true" /><span><strong>{localSaveLabel}</strong><small>{localSaveState === "error" ? `${lastLocalSave?.message}. Download a copy to keep your work.` : localSaveState === "paused" ? "Use Save in this browser to resume, or download a copy." : "This device only · download a copy for another device."}</small></span></div>
                <button className="mobile-file-action" onClick={openNewDialog}><Plus size={16} /><span><strong>New score</strong><small>Start from a template</small></span></button>
                <button className="mobile-file-action" onClick={() => openFilePicker(exportButtonRef.current)}><FolderOpen size={16} /><span><strong>Open score</strong><small>Garak JSON or MusicXML</small></span></button>
                <button className="mobile-file-action" onClick={() => { closeExportMenuAndRestoreFocus(); saveNow(); }}><Save size={16} /><span><strong>Save in this browser</strong><small>Update this browser’s draft</small></span></button>
                <button className="mobile-file-action mobile-focus-action" onClick={() => { closeExportMenuAndRestoreFocus(); setInspectorOpen(false); setInstrumentsOpen(false); panels.toggleFocusMode(); }}><Maximize2 size={16} /><span><strong>{panels.focusMode ? "Exit focus mode" : "Enter focus mode"}</strong><small>Hide panels or restore their previous state</small></span></button>
                <button className="mobile-file-action" onClick={openHelpDialog}><Keyboard size={16} /><span><strong>Help & shortcuts</strong><small>Input reference</small></span></button>
                <button className="mobile-file-action" disabled={!past.length} onClick={() => { closeExportMenuAndRestoreFocus(); undo(); }}><Undo2 size={16} /><span><strong>Undo last edit</strong><small>{past.at(-1)?.action ?? "Restore the previous notes and ties"}</small></span></button>
                <button className="mobile-file-action" disabled={!future.length} onClick={() => { closeExportMenuAndRestoreFocus(); redo(); }}><Redo2 size={16} /><span><strong>Redo edit</strong><small>{future[0]?.action ?? "Apply the undone change again"}</small></span></button>
                <p className="export-menu-help">{autoSaveEnabled ? "One draft autosaves in this browser. Download a file to keep another copy." : "Autosave is paused. Download a file to keep this score, or save in this browser to replace its preserved draft."}</p>
                <button onClick={() => exportNative()}><FileJson size={16} /><span><strong>Download editable score</strong><small>.garak.json · full score, all editing data</small></span></button>
                <span className="export-menu-heading">Other formats · full score</span>
                <button onClick={exportMusicXML}><FileMusic size={16} /><span><strong>MusicXML</strong><small>Full score · open in notation apps</small></span></button>
                <button onClick={exportMidi}><FileDown size={16} /><span><strong>MIDI</strong><small>Full score · notes, attack dynamics and rhythm</small></span></button>
                <p className="export-menu-help">MIDI keeps note-on dynamics. Volume changes during a held note may differ; use MusicXML to keep crescendo markings.</p>
                <button disabled={liveEngravingUnavailable} onClick={() => { closeExportMenuAndRestoreFocus(); window.print(); }}><Printer size={16} /><span><strong>Print / PDF</strong><small>{liveEngravingUnavailable ? "Unavailable while engraving is paused" : viewMode === "part" ? "Current part layout" : "Full score layout"}</small></span></button>
                <a className="compact-return-action" href="https://bonifacio.work/" aria-label="Back to Bonifacio"><span aria-hidden="true">←</span><span><strong>Bonifacio</strong><small>Back to your apps</small></span></a>
                <Link className="licenses-menu-link" href="/licenses" target="_blank" rel="noopener noreferrer" onClick={closeExportMenuAndRestoreFocus} aria-label="About and third-party licenses (opens in a new tab)"><CircleHelp size={16} /><span><strong>About & licenses</strong><small>Credits and license texts</small></span></Link>
              </div>
            ) : null}
          </div>
        </div>
        <input ref={fileInputRef} hidden type="file" accept=".json,.garak,.musicxml,.xml,application/vnd.recordare.musicxml+xml,application/xml,text/xml" onChange={(event) => { void importScore(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </header>

      <div ref={workspaceRef} className={`workspace${panels.dragging ? " resizing-panels" : ""}`} style={panels.style}>
        <aside
          id="instrument-drawer"
          ref={instrumentsOpen ? activeDialogRef : undefined}
          tabIndex={-1}
          className={`instrument-panel ${instrumentsOpen ? "drawer-open" : ""}`}
          hidden={instrumentPanel.collapsed && !instrumentsOpen}
          role={instrumentsOpen ? "dialog" : undefined}
          aria-modal={instrumentsOpen ? "true" : undefined}
          aria-labelledby="instrument-panel-title"
        >
          <div className="panel-heading"><div><span className="eyebrow">{countLabel(score.parts.length, "PART", "PARTS")}</span><h2 id="instrument-panel-title">Instruments</h2></div><span className="panel-heading-actions"><button className="round-button" disabled={largeScoreEditingPaused} onClick={openInstrumentDialog} aria-label="Add instrument"><Plus size={15} /></button><button className="icon-button drawer-close" onClick={() => closeWorkspacePanel("instrument")} aria-label="Close instruments"><X size={17} /></button></span></div>
          <div className="instrument-list">
            {score.parts.map((part, index) => (
              <button className={`instrument-row ${part.id === selectedPartId ? "selected" : ""}`} key={part.id} onClick={() => { selectPart(part.id); if (instrumentsOpen) closeWorkspacePanel("instrument"); }} aria-pressed={part.id === selectedPartId}>
                <span className="family-line" style={{ background: part.instrument.color }} />
                <span className="instrument-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="instrument-name"><strong>{part.name}</strong><small>{part.instrument.family}{part.staves.length > 1 ? ` · ${part.staves.length} staves` : ""}{part.instrument.transposition.chromatic || part.instrument.transposition.octaveChange ? " · transposing" : ""}</small></span>
                <span className="mini-mixers"><span className={part.muted ? "on" : ""} title="Muted">M</span><span className={part.solo ? "on" : ""} title="Solo">S</span></span>
              </button>
            ))}
          </div>
          <div className="instrument-panel-footer">
            <button className="add-staff-button" disabled={largeScoreEditingPaused} onClick={openInstrumentDialog}><Plus size={13} /> Add instrument</button>
            {instrumentPanel.storageError ? <p className="panel-width-error" role="status">{instrumentPanel.storageError}</p> : null}
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA window splitters use focusable separators for keyboard resizing. */}
          <div role="separator" tabIndex={0}
            className={`panel-resizer instrument-panel-resizer${instrumentPanel.dragging ? " resizing" : ""}`}
            aria-label="Resize instruments panel"
            aria-orientation="vertical"
            aria-controls="instrument-drawer"
            aria-valuemin={instrumentPanel.minWidth}
            aria-valuemax={instrumentPanel.maxWidth}
            aria-valuenow={instrumentPanel.width}
            aria-valuetext={`${instrumentPanel.width} pixels`}
            aria-describedby="panel-resize-help"
            title="Drag to resize · Double-click to reset"
            hidden={!instrumentPanel.ready}
            {...instrumentPanel.separatorHandlers}
          >
            <span className="panel-resize-grip" aria-hidden="true" />
            <span className="panel-resize-value" aria-hidden="true">{instrumentPanel.width} px</span>
          </div>
          <span id="panel-resize-help" className="visually-hidden">Drag to resize. Left and right arrows adjust by 10 pixels; hold Shift for 40. Home sets the minimum, End the maximum. Double-click to reset to 280 pixels. Width saves automatically in this browser.</span>
        </aside>

        <section className="canvas-workspace" aria-label="Score canvas">
          <div className="canvas-area">
          <div className="canvas-controls">
          <div className="score-view-switch" role="group" aria-label="Score view"><button className={`view-tab ${viewMode === "score" ? "active" : ""}`} onClick={() => setViewMode("score")} aria-pressed={viewMode === "score"}><Music2 size={14} /> Score</button><button className={`view-tab ${viewMode === "part" ? "active" : ""}`} onClick={() => setViewMode("part")} aria-pressed={viewMode === "part"}><FileMusic size={14} /> Part</button></div>
            <span className="score-context">{countLabel(score.measureOrder.length, "measure")}</span>
        <div className="zoom-control"><button onClick={() => { autoZoomRef.current = false; setZoom(Math.max(75, zoom - 10)); }} aria-label="Zoom out"><Minus size={13} /></button><span>{zoom}%</span><button onClick={() => { autoZoomRef.current = false; setZoom(Math.min(150, zoom + 10)); }} aria-label="Zoom in"><Plus size={13} /></button></div>
            <span className="tool-section" role="group" aria-label="Measure controls">
              <button className="mode-pill" disabled={largeScoreEditingPaused} onClick={addEmptyMeasure} aria-label="Add empty measure"><Plus size={11} aria-hidden="true" /> Measure</button>
              <button className="mode-pill" disabled={largeScoreEditingPaused} onClick={removeEmptyMeasure} aria-label="Remove last empty measure"><Trash2 size={11} aria-hidden="true" /> Remove empty</button>
            </span>
            <button type="button" className="range-select-toggle" aria-pressed={rangeSelectionMode} disabled={largeScoreEditingPaused} onClick={() => {
              if (rangeSelectionMode) { clearRangeSelection(); return; }
              setInputHelpOpen(false); setChordMode(false); setSelectedEventTarget(null);
              setRangeSelectionMode(true); setRangeToolsExpanded(false);
              setStatus("Select a range · tap its first note, then its last note on the same staff");
            }}><Scan size={16} aria-hidden="true" /> Select range</button>
            {largeScoreEditingPaused ? <span className="large-score-editing-notice" role="status">Large score · editing paused for responsiveness · save and export remain available</span> : null}
            {selectedEvent && selectedEventTarget && !chordMode && !rangeSelectionMode ? <div className="selected-event-summary"><span>EDIT · m. {score.measures[selectedEventTarget.measureId].number} · {eventName(selectedEvent)}</span><button type="button" onClick={openEventEditor}>Edit selection</button><button type="button" onClick={continueNoteInput} title="Clear selection and enter new notes · Esc">Continue input</button></div> : null}
            {chordMode ? <div className="chord-entry-guide">
              <p>{chordTarget ? <>Add tones to <strong>{chordTargetLabel}</strong>. Its length stays the same.</> : <>Start a new chord at <strong>NEXT</strong>. Choose its first pitch, then add more.</>}</p>
              {selectedEvent && selectedEventTarget ? <button type="button" className="quiet-button" aria-label="Edit selection" onClick={openEventEditor}>{selectedEvent.kind === "rest" ? "Edit rest" : "Edit tones"}</button> : null}
              <button type="button" className="quiet-button" disabled={largeScoreEditingPaused || newChordPending} onClick={prepareNextChord}><Plus size={13} /> Next chord</button>
              <button type="button" className="quiet-button" aria-label="Finish chord" onClick={() => { setChordMode(false); setNewChordPending(false); setStatus("Chord finished · the next pitch starts a separate note"); }}>Finish</button>
            </div> : null}
            <p className="score-gesture-hint">{playing ? "Tap a note or staff position to play from there · Space pauses / resumes · Stop to edit notes." : "Drag ↔ to move in time · drag ↕ to change pitch · swipe blank space to scroll."}</p>
            {currentEventEditError?.scope === "drag" || currentEventEditError?.scope === "move" ? <p className="score-drag-error" role="alert">{currentEventEditError.scope === "move" ? "Move not applied" : "Pitch unchanged"} — {currentEventEditError.message}</p> : null}

          </div>
            {rangeSelectionMode ? <div className="range-selection-bar" role="group" aria-label="Range selection">
              <div className="range-selection-summary">
                <strong>{rangeDestinationMode
                  ? `${rangeDestinationMode === "copy" ? "Copy" : "Move"} range · choose destination`
                  : selectedRange ? `${selectedRange.noteEventCount} notes / chords selected` : "Select the first note"}</strong>
                <small>{rangeDestinationMode ? "Tap the destination beat on the same staff. Other notes stay in place."
                  : selectedRange ? `m. ${score.measures[selectedRange.start.measureId].number}–${score.measures[selectedRange.end.measureId].number} · tap another note to adjust the end${selectedRange.expandedForTies ? " · expanded to keep complete ties" : ""}`
                    : "Then tap the last note. Chords and connected ties are included."}</small>
              </div>
              {!rangeDestinationMode ? <button ref={rangeToolsToggleRef} type="button" className="range-tools-toggle" aria-expanded={rangeToolsExpanded} aria-controls="range-controls" onClick={() => setRangeToolsExpanded((value) => !value)}>{rangeToolsExpanded ? "Hide tools" : "Edit range"}<ChevronDown size={15} aria-hidden="true" /></button> : null}
              <div id="range-controls" className="range-controls" hidden={!rangeToolsExpanded && !rangeDestinationMode}>
              <div className="range-selection-actions">
                {rangeDestinationMode ? <button type="button" onClick={() => { setRangeDestinationMode(null); setRangeError(null); setStatus("Destination cancelled · range selection kept"); }}>Cancel destination</button> : <>
                  <button type="button" disabled={!selectedRange || playing} onClick={() => playScore(true)} aria-label="Loop selected range">↻ Loop range</button>
                  <button type="button" aria-label="Move selected range" disabled={!selectedRange} onClick={() => beginRangeAction("move")}><MoveHorizontal size={16} /> Move</button>
                  <button type="button" aria-label="Copy selected range" disabled={!selectedRange} onClick={() => beginRangeAction("copy")}><Copy size={16} /> Copy</button>
                  <button type="button" className="delete-range" aria-label="Delete selected range and keep the rhythm" disabled={!selectedRange?.noteEventCount} onClick={deleteRange}><Trash2 size={16} /> Delete</button>
                  <button type="button" onClick={() => { setSelectedEventTarget(null); setRangeError(null); }}>Start again</button>
                  <button type="button" onClick={clearRangeSelection}>Done</button>
                </>}
              </div>
              {!rangeDestinationMode ? <div className="range-edit-tools" role="group" aria-label="Range edit tools">
                {([['pitch', 'Pitch'], ['rhythm', 'Length'], ['expression', 'Expression'], ['hairpin', 'Cresc. / dim.']] as const).map(([tool, label]) => <button key={tool} type="button" aria-pressed={rangeEditTool === tool} aria-controls={`range-${tool}-tools`} onClick={() => setRangeEditTool(tool)}>{label}</button>)}
              </div> : null}
              {!rangeDestinationMode && rangeEditTool === "pitch" ? <div id="range-pitch-tools" className="range-transpose-actions" role="group" aria-label="Transpose selected range">
                <span>Pitch</span>
                {([-12, -1, 1, 12] as const).map((semitones) => <button key={semitones} type="button" disabled={!selectedRange?.noteEventCount} onClick={() => transposeRange(semitones)} aria-label={`Transpose selected range ${semitones > 0 ? "up" : "down"} one ${Math.abs(semitones) === 12 ? "octave" : "semitone"}`}>
                  <strong>{semitones > 0 ? "+" : "−"}1</strong><small>{Math.abs(semitones) === 12 ? "octave" : "semitone"}</small>
                </button>)}
              </div> : null}
              {!rangeDestinationMode && rangeEditTool === "rhythm" ? <div id="range-rhythm-tools" className="range-rhythm-actions" role="group" aria-label="Change selected range rhythm">
                <span>Length</span>
                <button type="button" disabled={!selectedRange} onClick={() => changeRangeRhythm({ scale: 0.5 })} aria-label="Halve selected note and rest lengths">÷2</button>
                <button type="button" disabled={!selectedRange} onClick={() => changeRangeRhythm({ scale: 2 })} aria-label="Double selected note and rest lengths">×2</button>
                <label>Dots<select aria-label="Dots on selected written notes and rests" value="" disabled={!selectedRange} onChange={(event) => changeRangeRhythm({ dots: Number(event.target.value) as 0 | 1 | 2 })}>
                  <option value="" disabled>Apply…</option><option value="0">No dots</option><option value="1">1 dot</option><option value="2">2 dots</option>
                </select></label>
                <small>Notes and rests change together; following notes shift. Dots apply to each written segment.</small>
              </div> : null}
              {!rangeDestinationMode && rangeEditTool === "expression" ? <div id="range-expression-tools" className="range-expression-actions" role="group" aria-label="Change selected range expression">
                <label>Dynamic<select aria-label="Dynamic on selected range" value={rangeExpression.dynamic} disabled={!selectedRange} onChange={(event) => changeRangeExpression({ dynamic: event.target.value === "none" ? null : event.target.value as DynamicMarking })}>
                  <option value="mixed" disabled>Mixed</option><option value="none">No mark</option>
                  {DYNAMIC_MARKINGS.map((dynamic) => <option key={dynamic} value={dynamic}>{dynamic}</option>)}
                </select></label>
                <label>Articulation<select aria-label="Articulation on selected range" value={rangeExpression.articulation} disabled={!selectedRange?.noteEventCount} onChange={(event) => changeRangeExpression({ articulation: event.target.value === "none" ? null : event.target.value as Articulation })}>
                  <option value="mixed" disabled>Mixed</option><option value="none">No mark</option>
                  {ARTICULATIONS.map((articulation) => <option key={articulation} value={articulation}>{articulation}</option>)}
                </select></label>
                <small>For gradual volume changes, use Cresc. / dim. Dynamics apply to notes and rests; articulations skip rests. Ties stay connected. No mark removes existing marks; dynamics continue until the next mark.</small>
              </div> : null}
              {!rangeDestinationMode && rangeEditTool === "hairpin" ? <RangeHairpinControls
                key={`${selectedRange?.eventIds.join(":")}:${rangeHairpins.map((span) => `${span.id}:${span.kind}:${span.from}:${span.to}`).join(":")}`}
                spans={rangeHairpins} partialOverlap={rangeHairpins.some((span) => !!selectedRange && (span.startTick < selectedRange.startTick || span.endTick > selectedRange.endTick))}
                disabled={!selectedRange?.noteEventCount} onChange={changeRangeHairpin} /> : null}
              </div>
              {rangeError?.score === score ? <p className="range-selection-error" role="alert">{rangeError.message}</p> : null}
            </div> : null}
          {!lastEvent && !selectedEvent && !rangeSelectionMode && !playing && !largeScoreEditingPaused ? <div className="score-entry-start">
            <div><strong>Add notes to {selectedPart?.name}{selectedPart && selectedPart.staves.length > 1 ? ` · Staff ${selectedStaffNumber}` : ""}</strong><span>Keyboard: 1–7 for length, then Q W E R T Y U for 도–시. Or use the note buttons.</span></div>
            <button type="button" className="quiet-button" onClick={() => { continueNoteInput(); setNoteEntryMethod("duration-letter"); }}><Keyboard size={15} /> Use keyboard</button>
            <button type="button" className="quiet-button" onClick={startTouchInput}><Music2 size={15} /> Touch input</button>
          </div> : null}
          <article className="score-page">
            <div className="score-heading"><p>{score.metadata.subtitle.toUpperCase()}</p><h1>{score.metadata.title}</h1><span>{score.metadata.composer}</span></div>
            <ScoreRenderer
              score={score}
              selectedPartId={selectedPartId}
              selectedStaffId={selectedStaff?.id}
              viewMode={viewMode}
              zoom={zoom}
              playbackSeconds={playing ? playbackSeconds : null}
              playbackPaused={paused}
              playbackFollowEnabled={playbackFollowEnabled}
              playbackFollowRevision={playbackFollowRevision}
              onPlaybackSeek={playing ? (measureId, tick) => {
                const index = score.measureOrder.indexOf(measureId);
                const absoluteTick = score.measureOrder.slice(0, index).reduce((sum, id) => sum + measureCapacity(score.measures[id]), 0) + tick;
                playScore(false, false, absoluteTick * 60 / score.tempo / TICKS_PER_QUARTER);
              } : undefined}
              entryMeasureId={previewMeasureId}
              entryTick={previewEntryTick}
              selectedEventId={selectedEvent?.id}
              selectedNoteId={selectedTone?.id}
              rangeSelectionMode={rangeSelectionMode}
              selectedEventIds={selectedRange?.eventIds}
              onRangeEventSelect={selectRangeEvent}
              rangeDestinationMode={rangeDestinationMode}
              onRangeDestination={applyRangeDestination}
              inputFollowRevision={inputFollowRevision}
              onSelectEvent={selectRenderedEvent}
              onSelectPart={selectPart}
              onSelectStaff={selectStaff}
              noteEntryMethod={noteEntryMethod}
              chordMode={chordMode}
              pointerDurationTicks={durationTicks({ base: duration, dots: dotCount })}
              pointerDurationLabel={durationName(duration, dotCount)}
              onShiftInputPitch={shiftInputPitch}
              onPointerNoteIntent={enterPointerNote}
              onNotePitchChange={changeDraggedNotePitch}
              onEventMove={moveDraggedEvent}
            />
            <span className="page-number" aria-hidden="true">1</span>
          </article>
          </div>
          {floatingDock.storageError ? <p className="note-dock-storage-error" role="status">{floatingDock.storageError}</p> : null}
          <div ref={inputDockRef} className="floating-note-entry" style={floatingDock.style} data-side={floatingDock.side} data-help-below={floatingDock.helpBelow} data-dragging={floatingDock.dragging}>
          <span id="note-dock-move-help" className="visually-hidden">Drag the round note button or the move handle to reposition the palette. Its position is saved in this browser. Arrow keys on the handle move it; Home restores the bottom-right position.</span>
      <section ref={notationToolsRef} id="notation-tools" className="note-toolbar" hidden={!inputToolsOpen} aria-label="Notation tools">
        <p className="field-help" role="status">{selectedEvent ? `EDIT · ${durationName(editingDuration!.base, editingDuration!.dots)} · length and dots change the selected event. Continue input or Esc to add notes.` : "INPUT · length and dots set the next note"}</p><span className="visually-hidden">{inputTargetLabel}. Scroll each row sideways for more tools.</span>
        <div className="note-entry-primary">
        <div className="note-entry-row note-entry-length-row">
        <span className="toolbar-label">Length</span>
        <div className="tool-group note-values" role="group" aria-label="Note duration">
          {DURATION_CHOICES.map((choice) => (
            <button
              className={`tool-button note-button ${(editingDuration?.base ?? duration) === choice.value ? "active" : ""}`}
              key={choice.value}
              onClick={() => {
                if (selectedEvent && editingDuration) changeSelectedNotation({ duration: { ...editingDuration, base: choice.value } });
                else { setDuration(choice.value); setStatus(noteEntryInstruction(noteEntryMethod, inputPitch, choice.value, dotCount)); }
              }}
              aria-label={`${selectedEvent ? "Edit selected length: " : ""}${DURATION_LABELS[choice.value]} note, shortcut ${choice.shortcut}`}
              aria-pressed={(editingDuration ?? { base: duration }).base === choice.value}
            >
              <DurationIcon value={choice.value} /><span className="duration-value">{choice.value === 1 ? "1" : `1/${choice.value}`}</span><kbd>{choice.shortcut}</kbd>
            </button>
          ))}
        </div>
        <div className="note-entry-utilities">
          <button type="button" className="icon-button note-entry-drag-handle" aria-label="Move note palette" aria-describedby="note-dock-move-help" title="Drag to move · arrow keys to nudge · Home to reset" {...floatingDock.dragHandlers} onKeyDown={floatingDock.onHandleKeyDown}><Grip size={18} /></button>
          <button type="button" className="icon-button" disabled={!floatingDock.moved} onClick={floatingDock.reset} aria-label="Reset note palette to bottom right" title="Reset position"><RotateCcw size={16} /></button>
          <button className="icon-button note-entry-close" onClick={toggleInputTools} aria-label="Close note entry menu"><X size={18} /></button>
        </div>
        </div>
        <div className="note-entry-row note-entry-note-row">
        <span className="toolbar-label">Note</span>
        <div className="pitch-keys" role="group" aria-label={noteEntryMethod === "arrow-duration" ? "Select pitch or enter rest" : "Enter pitch or rest"}>
          {(["C", "D", "E", "F", "G", "A", "B"] as PitchStep[]).map((step) => {
            const previewAlter = inputAlter(accidentalMode, previewWrittenKey, step);
            const suffix = previewAlter === 0 && accidentalMode === "auto" ? "" : accidentalGlyph(previewAlter);
            const action = noteEntryMethod === "arrow-duration"
              ? "Select"
              : canAddChordTone ? `Add to the ${chordActionTarget}` : chordMode ? "Start a chord with" : "Enter";
            const nextInstruction = noteEntryMethod === "arrow-duration" ? "; choose length with 1 through 7, then QWERTYU to enter" : "";
            return <button className={inputPitch.step === step ? "pitch-current" : ""} key={step} disabled={largeScoreEditingPaused} onClick={() => activatePitchButton(step)} aria-label={`${action} ${step}${suffix}${octave}, ${SOLFEGE[step]}, ${accidentalMode} accidental mode${nextInstruction}`}><span className="pitch-name"><strong>{SOLFEGE[step]}</strong><small>{step}{suffix}{octave}</small></span><kbd>{PITCH_SHORTCUTS[step]}</kbd></button>;
          })}
          <button className={`rest-key${restInput ? " pitch-current" : ""}`} disabled={largeScoreEditingPaused} onClick={() => { setRestInput(!restInput); setStatus(restInput ? "Note input · QWERTYU adds notes" : "Rest input · QWERTYU adds rests; A returns to notes"); }} aria-label="Toggle rest input" aria-pressed={restInput}><span>{restInput ? "Rest on" : "Rest"}</span><kbd>A</kbd></button>
        </div>
        <div className="octave-control"><button onClick={() => changeInputOctave(-1)} aria-label="Lower octave" title="Lower input octave · Z" aria-keyshortcuts="Z">−</button><span><small>Octave</small>{octave}</span><button onClick={() => changeInputOctave(1)} aria-label="Raise octave" title="Raise input octave · X" aria-keyshortcuts="X">＋</button></div>
        </div>
        </div>
        <div className="note-entry-row note-entry-options-row">
        <div className="entry-secondary">
        <div className="tool-section mode-section" role="group" aria-label="Note or chord behavior">
          <span className="toolbar-label">Entry</span>
          <button className={`mode-pill ${!chordMode ? "active" : ""}`} onClick={() => {
            setChordMode(false);
            setNewChordPending(false);
            setStatus("Note mode on — the next pitch input starts a new note");
          }} aria-pressed={!chordMode}>Note</button>
          <button
            className={`mode-pill ${chordMode ? "active" : ""}`}
            onClick={() => {
              const next = !chordMode;
              setChordMode(next);
              setNewChordPending(false);
              setStatus(!next
                ? "Chord mode off — the next pitch starts a new note"
                : noteEntryMethod === "score-pointer"
                  ? selectedEvent?.kind === "note"
                    ? "Chord mode on — Shift-click in that note's staff and measure to add a tone; ordinary score click starts a new chord"
                    : "Chord mode on — ordinary score click starts a new chord; select a note before Shift-clicking to add a tone"
                  : selectedEvent?.kind === "note" ? "Chord mode on — the next pitch adds to the selected note" : lastEvent?.kind === "note" ? "Chord mode on — the next pitch adds to the latest note" : "Chord mode on — the next pitch starts a new chord");
            }}
            aria-label={noteEntryMethod === "score-pointer"
              ? "Chord mode. Ordinary score click starts a new chord. Shift-click adds to a selected note in the same staff and measure. Pitch buttons add directly."
              : `Chord mode. ${newChordPending ? "Start a chord with the next pitch" : selectedEvent?.kind === "note" ? "Add the next pitch to the selected note event" : lastEvent?.kind === "note" ? "Add the next pitch to the latest note event" : "Start a chord with the next pitch"}`}
            aria-pressed={chordMode}
          >Chord</button>
        </div>
        <div className="tool-group accidental-input-group" role="group" aria-label="Accidental input mode">
          <span className="toolbar-label">Accidental</span>
          <button className={`mode-pill ${accidentalMode === "auto" ? "active" : ""}`} onClick={() => setAccidentalMode("auto")} aria-label="Automatic accidental from the selected part key signature" aria-pressed={accidentalMode === "auto"}>Auto</button>
          <button className={`tool-button accidental ${accidentalMode === "sharp" ? "active" : ""}`} onClick={() => setAccidentalMode("sharp")} aria-label="Force sharp accidental" aria-pressed={accidentalMode === "sharp"}>♯<kbd>F</kbd></button>
          <button className={`tool-button accidental ${accidentalMode === "flat" ? "active" : ""}`} onClick={() => setAccidentalMode("flat")} aria-label="Force flat accidental" aria-pressed={accidentalMode === "flat"}>♭<kbd>S</kbd></button>
          <button className={`tool-button accidental ${accidentalMode === "natural" ? "active" : ""}`} onClick={() => setAccidentalMode("natural")} aria-label="Force natural accidental" aria-pressed={accidentalMode === "natural"}>♮<kbd>D</kbd></button>
        </div>
        <div className="tool-group rhythm-modifier-group">
          <button
            className={`tool-button dot-tool ${(editingDuration?.dots ?? dotCount) ? "active" : ""}`}
            onClick={() => {
              if (selectedEvent && editingDuration) changeSelectedNotation({ duration: { ...editingDuration, dots: nextAugmentationDotCount(editingDuration.dots) } });
              else { const next = nextAugmentationDotCount(dotCount); setDotCount(next); setStatus(dotSelectionStatus(next)); }
            }}
            aria-label={dotCycleAriaLabel(editingDuration?.dots ?? dotCount)}
            aria-pressed={(editingDuration?.dots ?? dotCount) > 0}
          >{(editingDuration?.dots ?? dotCount) === 2 ? "··" : "·"}<kbd>~</kbd></button>
          <button className={`tool-button tie-tool${hasPreviousTie ? " subtle-active" : ""}`} disabled={largeScoreEditingPaused || selectedEvent?.kind === "rest"} onClick={toggleTie} aria-label={tieActionLabel} title={tieActionLabel}><span aria-hidden="true">⌒</span><span className="tie-tool-label">{hasPreviousTie ? "Untie previous" : selectedTone ? "Tie previous" : "Tie last two"}</span><kbd>\</kbd></button>
        </div>
        <div className="tool-group quick-edit-group" role="group" aria-label="Edit input">
          <button className="edit-tool-button" onClick={undo} disabled={!past.length} aria-label="Undo last edit"><Undo2 size={16} /><span>Undo</span></button>
          <button className="edit-tool-button" onClick={redo} disabled={!future.length} aria-label="Redo edit"><Redo2 size={16} /><span>Redo</span></button>
          <button className="edit-tool-button delete-input-button" onClick={() => removeLatestInput()} disabled={largeScoreEditingPaused || !deletionTargetEvent} aria-label={deleteActionLabel}><Trash2 size={16} /><span>Delete</span></button>
        </div>

        </div>
        <div className="input-method-section">
          <label htmlFor="note-entry-method"><span className="toolbar-label">Input</span>
            <select
              id="note-entry-method"
              value={noteEntryMethod}
              aria-label="Note input method"
              aria-describedby="note-entry-method-help"
              onChange={(event) => chooseNoteEntryMethod(event.target.value as NoteEntryMethod)}
            >
              <option value="arrow-duration">Pitch → duration</option>
              <option value="duration-letter">Duration → pitch</option>
              <option value="score-pointer">Tap / click the score</option>
              <option value="buttons">Pitch buttons / touch</option>
            </select>
          </label>
          <small id="note-entry-method-help" className="visually-hidden">{noteEntryInstruction(noteEntryMethod, inputPitch, duration, dotCount)}</small>
        </div>
        <button className="score-tap-action" aria-label="Tap the staff · touch / Pencil" aria-pressed={noteEntryMethod === "score-pointer"} onClick={() => { chooseNoteEntryMethod("score-pointer"); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".score-hit-target")?.focus()); }}>Tap staff</button>
        </div>
      </section>


            {inputHelpOpen ? <section className="note-entry-help" role="dialog" aria-modal="false" aria-label="Note input help">
              <div className="note-entry-panel-heading"><strong>Keyboard & touch</strong><button className="icon-button" onClick={() => { setInputHelpOpen(false); inputHelpButtonRef.current?.focus(); }} aria-label="Close note input help"><X size={18} /></button></div>
              <p className="input-current-method">{noteEntryInstruction(noteEntryMethod, inputPitch, duration, dotCount)}</p>
              <dl><div><dt><kbd>1</kbd>–<kbd>7</kbd></dt><dd>Selected note/chord: change length, whole → 64th. No selection: input length only.</dd></div><div><dt><kbd>Q W E R T Y U</kbd></dt><dd>도 레 미 파 솔 라 시 · adds the chosen length without opening this menu</dd></div><div><dt><kbd>Shift + QWERTYU</kbd></dt><dd>Add a tone to the selected note or chord, even with Rest on; keeps its length</dd></div><div><dt><kbd>Shift + Z / X</kbd></dt><dd>Add the input pitch one octave below / above to the selected chord</dd></div><div><dt><kbd>Tab / Shift+Tab</kbd></dt><dd>On the score: next / previous measure’s NEXT position. Tab at the end adds a measure.</dd></div><div><dt><kbd>Z / X</kbd></dt><dd>Lower / raise input octave · works with the menu closed</dd></div><div><dt><kbd>~</kbd> / <kbd>.</kbd></dt><dd>Selected note/chord: cycle 0 → 1 → 2 dots across the complete automatic split. No selection: input dots only.</dd></div><div><dt><kbd>A</kbd></dt><dd>Toggle rest input; QWERTYU then adds rests. Press A again for notes.</dd></div><div><dt><kbd>S D F</kbd></dt><dd>Flat · natural · sharp, for the next note</dd></div><div><dt><kbd>↑ ↓</kbd> / <kbd>\</kbd></dt><dd>Edit selected tone by semitone; Shift = octave / toggle tie. Continue input or Esc clears selection for new input.</dd></div><div><dt><kbd>⌘/Ctrl Z</kbd></dt><dd>Undo · add Shift to redo</dd></div></dl>
              <p><strong>Touch / Pencil:</strong> choose Tap / click the score, then tap a blank staff line or space to add at that measure’s NEXT marker. Start sideways to move the whole note or chord to another beat or measure; tied events move together. Start up/down to change only the grabbed pitch and its tied notes. The first direction locks until you release. Moves snap to 16th notes or existing onsets, preserve other notes, and leave rests behind. To edit several notes, choose Select range and tap the first and last note. Move or Copy then asks for a destination beat; Delete leaves rests. The Pitch buttons transpose the whole range by a semitone or octave without changing its rhythm or key signature. You can repeat them without selecting again. Length ×2 or ÷2 also scales rests and silent gaps inside the range; following notes shift. Dots apply to each written note or rest, including tied segments. Expression applies dynamics to the selected events and articulations to notes and chords; No mark removes those marks. Connected ties are included automatically. Drag the round note button or the move handle to reposition the palette. Its position is saved in this browser and restored when you return; Reset saves the default bottom-right position. Release to apply; Esc cancels. Swipe blank space to scroll. Use Select range to edit several notes together.</p>
              <button className="quiet-button" onClick={() => { setInputHelpOpen(false); openHelpDialog(); }}>All shortcuts</button>
            </section> : null}
            <div className="note-entry-launchers">
              <button ref={inputHelpButtonRef} type="button" className="note-entry-help-toggle" aria-label="Note input help" aria-expanded={inputHelpOpen} onClick={() => setInputHelpOpen((open) => !open)}><CircleHelp size={22} /></button>
              <button ref={inputToolsButtonRef} type="button" className="note-entry-toggle" aria-label={`${inputToolsOpen ? "Close" : "Open"} note entry menu · ${restInput ? "Rest" : floatingPitchLabel} · ${durationName(duration, dotCount)}`} aria-controls="notation-tools" aria-expanded={inputToolsOpen} aria-describedby="note-dock-move-help" title={inputToolsOpen ? "Tap to close · drag to move" : "Tap to open · drag to move"} {...floatingDock.dragHandlers} onClick={toggleInputTools}>
                <NoteEntryPreview rest={restInput} pitch={floatingPitch} duration={{ base: duration, dots: dotCount }} clef={selectedStaff?.clef ?? "treble"} />
              </button>
            </div>
          </div>
        </section>

        <aside
          id="score-inspector"
          ref={inspectorOpen ? activeDialogRef : undefined}
          tabIndex={-1}
          className={`properties-panel ${inspectorOpen ? "drawer-open" : ""}`}
          hidden={inspectorPanel.collapsed && !inspectorOpen}
          role={inspectorOpen ? "dialog" : undefined}
          aria-modal={inspectorOpen ? "true" : undefined}
          aria-labelledby="inspector-title"
        >
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA window splitters use focusable separators for keyboard resizing. */}
          <div role="separator" tabIndex={0}
            className={`panel-resizer inspector-panel-resizer${inspectorPanel.dragging ? " resizing" : ""}`}
            aria-label="Resize inspector panel"
            aria-orientation="vertical"
            aria-controls="score-inspector"
            aria-valuemin={inspectorPanel.minWidth}
            aria-valuemax={inspectorPanel.maxWidth}
            aria-valuenow={inspectorPanel.width}
            aria-valuetext={`${inspectorPanel.width} pixels`}
            aria-describedby="inspector-resize-help"
            title="Drag to resize · Double-click to reset"
            hidden={!inspectorPanel.ready}
            {...inspectorPanel.separatorHandlers}
          >
            <span className="panel-resize-grip" aria-hidden="true" />
            <span className="panel-resize-value" aria-hidden="true">{inspectorPanel.width} px</span>
          </div>
          <span id="inspector-resize-help" className="visually-hidden">Drag left to widen or right to narrow. Arrow keys move the boundary by 10 pixels; hold Shift for 40. Home sets the minimum, End the maximum. Double-click to reset to 280 pixels. Width saves automatically in this browser; space is reserved for the score.</span>
          <div className="inspector-scroll">
          <div className="panel-heading compact"><div><span className="eyebrow">INSPECTOR</span><h2 id="inspector-title">{inspectorSection === "score" ? "Score settings" : inspectorSection === "part" ? "Part settings" : inspectorEvent ? inspectorUsesSelection ? "Selected event" : "Last event" : "Event settings"}</h2></div><button className="icon-button drawer-close" onClick={() => closeWorkspacePanel("inspector")} aria-label="Close score details"><X size={17} /></button></div>
          {inspectorPanel.storageError ? <p className="panel-width-error" role="status">{inspectorPanel.storageError}</p> : null}
          <div className="inspector-categories" role="group" aria-label="Inspector category">
            <button type="button" aria-pressed={inspectorSection === "event"} aria-controls="inspector-event" onClick={() => setInspectorSection("event")}>Event</button>
            <button type="button" aria-pressed={inspectorSection === "score"} aria-controls="inspector-score" onClick={() => setInspectorSection("score")}>Score</button>
            <button type="button" aria-pressed={inspectorSection === "part"} aria-controls="inspector-part" onClick={() => setInspectorSection("part")}>Part</button>
          </div>
          <div id="inspector-event" className="inspector-pane" hidden={inspectorSection !== "event"}>
          {rangeSelectionMode ? <div className="inspector-section">
            <strong>{selectedRange ? `${selectedRange.noteEventCount} notes / chords selected` : "Select a range on the score"}</strong>
            <p className="field-help">Use the range tools above the score to move, copy, delete, or edit Pitch, Length, and Expression. For gradual volume changes, use Cresc. / dim. Dynamics apply to notes and rests; articulations skip rests. No mark removes existing marks. Chords and ties stay connected.</p>
            <button type="button" className="quiet-button" onClick={clearRangeSelection}>Finish range selection</button>
          </div> : <>
          {selectedPart && inspectorEvent ? (
            <div className="selection-summary">
              <span className="selection-icon">{inspectorEvent?.kind === "rest" ? "𝄽" : inspectorEvent?.kind === "note" && inspectorEvent.notes.length > 1 ? "♬" : "♪"}</span>
              <span>
                <strong>{inspectorEvent?.kind === "note" ? inspectorEvent.notes.length > 1 ? `Chord · ${inspectorEvent.notes.length} notes` : pitchName(inspectorEvent.notes[0].pitch) : inspectorEvent?.kind === "rest" ? "Rest" : selectedPart.name}</strong>
                <small>{selectedPart.name}{selectedPart.staves.length > 1 ? ` · Staff ${selectedStaffIndex + 1}` : ""} · {durationName(inspectorEvent?.duration.base ?? duration, inspectorEvent?.duration.dots ?? dotCount)}</small>
                {inspectorEvent ? (
                  <button
                    type="button"
                    className="danger-link"
                    onClick={() => removeLatestInput(false, true)}
                    disabled={largeScoreEditingPaused}
                    aria-label={selectedEvent?.kind === "note" ? `Clear selected ${eventName(selectedEvent)} to a rest and keep the rhythm` : selectedEvent ? deleteActionLabel : `Delete previous ${eventName(inspectorEvent)}`}
                  ><Trash2 size={13} aria-hidden="true" /> {inspectorDeleteText}</button>
                ) : null}
              </span>
            </div>
          ) : null}
          {selectedEvent ? <div className="inspector-section event-notation-editor">
            <div className="event-editor-heading"><span className="section-title">Edit selected {selectedEvent.kind === "rest" ? "rest" : selectedIsChord ? "chord" : "note"}</span><button type="button" className="quiet-button" onClick={continueNoteInput}>Continue input</button></div>
            {selectedEvent.kind === "note" && selectedIsChord ? <div className="chord-tone-editor">
              <span className="section-title">Choose a tone to edit</span>
              <div className="chord-tone-choices" role="group" aria-label="Chord tones">
                {selectedEvent.notes.map((note, index) => <button type="button" key={note.id} id={selectedTone?.id === note.id ? "selected-tone-choice" : undefined} aria-label={`Edit tone ${index + 1}: ${pitchName(note.pitch)}`} aria-pressed={selectedTone?.id === note.id} onClick={() => { setSelectedChordNote({ eventId: selectedEvent.id, noteId: note.id }); if (selectedEventTarget) setSelectedEventTarget({ ...selectedEventTarget, noteId: note.id }); setEventEditError(null); }}><small>{index + 1}</small>{pitchName(note.pitch)}</button>)}
              </div>
              <p className="field-help">Editing <strong>{selectedPitchLabel || "this tone"}</strong>. Other chord tones stay unchanged.</p>
            </div> : null}
            {selectedPitch ? <>
              <p id="tied-pitch-scope" className={tiedNoteCount > 1 ? "field-help tied-pitch-scope" : "field-help"}>{tiedNoteCount > 1
                ? `${tiedNoteCount} linked notes · Pitch, accidental, and octave changes update every note in this tie chain.`
                : "Pitch changes apply only to this note."}</p>
              <label>Pitch<select id="selected-note-pitch" aria-label="Selected note pitch" aria-describedby="tied-pitch-scope" value={selectedPitch.step} disabled={largeScoreEditingPaused} onChange={(event) => changeSelectedNotation({ pitch: { ...selectedPitch, step: event.target.value as PitchStep } })}>
                {(["C", "D", "E", "F", "G", "A", "B"] as PitchStep[]).map((step) => <option key={step} value={step}>{step} · {SOLFEGE[step]}</option>)}
              </select></label>
              <label>Accidental<select aria-label="Selected note accidental" aria-describedby="tied-pitch-scope" value={selectedPitch.alter} disabled={largeScoreEditingPaused} onChange={(event) => changeSelectedNotation({ pitch: { ...selectedPitch, alter: Number(event.target.value) as Pitch["alter"] } })}>
                <option value={-2}>Double flat ♭♭</option><option value={-1}>Flat ♭</option><option value={0}>Natural ♮</option><option value={1}>Sharp ♯</option><option value={2}>Double sharp 𝄪</option>
              </select></label>
              <label>Octave<select aria-label="Selected note octave" aria-describedby="tied-pitch-scope" value={selectedPitch.octave} disabled={largeScoreEditingPaused} onChange={(event) => changeSelectedNotation({ pitch: { ...selectedPitch, octave: Number(event.target.value) } })}>
                {Array.from({ length: 11 }, (_, index) => index - 1).map((value) => <option key={value} value={value}>{value}</option>)}
              </select></label>
              <div className="selected-note-ties" role="group" aria-label={`Ties for ${selectedPitchLabel}`}>
                <div className="section-title"><span>Ties · {selectedPitchLabel}</span></div>
                <p className="field-help">Join adjacent notes of the same pitch into one held sound.</p>
                <div className="tie-actions">
                  <button type="button" disabled={largeScoreEditingPaused} onClick={() => changeSelectedTie("incoming", !hasPreviousTie)}>{hasPreviousTie ? "Remove previous tie" : "Tie to previous note"}</button>
                  <button type="button" disabled={largeScoreEditingPaused} onClick={() => changeSelectedTie("outgoing", !hasNextTie)}>{hasNextTie ? "Remove next tie" : "Tie to next note"}</button>
                </div>
                {visibleTieEditError ? <p className="field-error event-edit-error" role="alert">{visibleTieEditError}</p> : null}
                <p className="field-help">Removing a tie keeps both notes and their rhythm.</p>
              </div>
              {selectedIsChord ? <button type="button" className="danger-link remove-selected-tone" disabled={largeScoreEditingPaused} onClick={removeSelectedTone}><Trash2 size={13} /> Remove {selectedPitchLabel} from chord</button> : null}
            </> : null}
            {selectedIsChord ? <div className="section-title chord-rhythm-heading"><span>Whole chord rhythm</span></div> : null}
            <label htmlFor="selected-event-duration">Length<select id="selected-event-duration" aria-label="Selected event length" value={editingDuration!.base} disabled={largeScoreEditingPaused} onChange={(event) => changeSelectedNotation({ duration: { ...editingDuration!, base: Number(event.target.value) as DurationBase } })}>
              {DURATION_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{DURATION_LABELS[choice.value]}</option>)}
            </select></label>
            <label>Dots<select aria-label="Selected event dots" value={editingDuration!.dots} disabled={largeScoreEditingPaused} onChange={(event) => changeSelectedNotation({ duration: { ...editingDuration!, dots: Number(event.target.value) as DurationValue["dots"] } })}>
              <option value={0}>None</option><option value={1}>One dot</option><option value={2}>Two dots</option>
            </select></label>
            {visibleEventEditError ? <p className="field-error event-edit-error" role="alert">{visibleEventEditError}</p> : null}
            {visibleEventEditNotice ? <p className="field-help rhythm-edit-notice" role="status">{visibleEventEditNotice}</p> : null}
            <p className="field-help">{selectedEvent.kind === "note" && selectedEvent.notes.some((note) => score.ties.some((tie) => tie.fromNoteId === note.id || tie.toNoteId === note.id))
              ? "Length and dots change this event, not every linked note. Later notes move across measures to keep the ties connected. Notes crossing a barline are split into tied segments."
              : "Length and dots apply to this event only. Changing its length shifts later notes in the same measure."}</p>
          </div> : inspectorEvent && selectedPart && lastEventMeasureId ? <div className="inspector-section">
            <button type="button" className="quiet-button" onClick={() => selectRenderedEvent({ partId: selectedPart.id, staffId: activeStaffId, measureId: lastEventMeasureId, eventId: inspectorEvent.id })}>Edit this {inspectorEvent.kind === "rest" ? "rest" : inspectorEvent.notes.length > 1 ? "chord" : "note"}</button>
            <p className="field-help">Select a note on the score to change its pitch or length. The toolbar adds new notes.</p>
          </div> : <div className="inspector-section first-note-help">
            <strong>Add your first note</strong>
            <p>{noteEntryInstruction(noteEntryMethod, inputPitch, duration, dotCount)}</p>
            <p>To change a note afterward, select it on the score and choose Edit selection.</p>
            <button type="button" className="quiet-button" onClick={openHelpDialog}><CircleHelp size={14} /> Input guide</button>
          </div>}
          {inspectorEvent ? <div className="inspector-section">
            <div className="section-title"><span>Expression</span></div>
            <label>Dynamic<select
              aria-label={`Dynamic on ${inspectorUsesSelection ? "selected" : "last"} event`}
              value={inspectorEvent?.dynamic ?? "none"}
              disabled={largeScoreEditingPaused || !inspectorEvent}
              onChange={(event) => applyDynamic(event.target.value === "none" ? null : event.target.value as DynamicMarking)}
            >
              <option value="none">None</option>
              {DYNAMIC_MARKINGS.map((dynamic) => <option key={dynamic} value={dynamic}>{dynamic}</option>)}
            </select></label>
            <p className="field-help">{inspectorUsesSelection ? "Applies from the selected event" : "Applies from the latest event"} on this staff until the next dynamic.</p>
            <label>Articulation<select
              aria-label={`Articulation on ${inspectorUsesSelection ? "selected" : "last"} note event`}
              value={inspectorNoteEvent?.articulation ?? "none"}
              disabled={largeScoreEditingPaused || !inspectorNoteEvent}
              onChange={(event) => applyArticulation(event.target.value === "none" ? null : event.target.value as Articulation)}
            >
              <option value="none">None</option>
              {ARTICULATIONS.map((articulation) => <option key={articulation} value={articulation}>{articulation}</option>)}
            </select></label>
            <p className="field-help">{inspectorUsesSelection
              ? selectedEvent?.kind === "rest" ? "Select a note to apply an articulation." : "Applies only to the selected note."
              : "Applies to the latest note on this staff; trailing rests are skipped."}</p>
          </div> : null}
          </>}
          </div>
          <div id="inspector-score" className="inspector-pane" hidden={inspectorSection !== "score"}>
          <div className="inspector-section">
            <div className="section-title"><span>Score</span></div>
            <label>Title<input
              id="score-title"
              maxLength={200}
              disabled={largeScoreEditingPaused}
              value={metadataDraft.title}
              aria-invalid={Boolean(titleError)}
              aria-describedby={titleError ? "score-title-error" : undefined}
              onChange={(event) => {
                const title = event.target.value;
                setMetadataDraft({ ...metadataDraft, title });
                if (title.trim()) {
                  if (titleError) setStatus("Score title restored");
                  setTitleError("");
                }
              }}
              onBlur={applyMetadata}
            /></label>
            {titleError ? <p id="score-title-error" className="field-error">{titleError}</p> : null}
            <label>Composer<input maxLength={200} disabled={largeScoreEditingPaused} value={metadataDraft.composer} onChange={(event) => setMetadataDraft({ ...metadataDraft, composer: event.target.value })} onBlur={applyMetadata} /></label>
            <label>Tempo<span className="input-suffix"><input type="number" min="30" max="300" step="1" disabled={largeScoreEditingPaused} defaultValue={score.tempo} key={score.tempo} onBlur={(event) => {
              event.currentTarget.value = String(setTempo(event.currentTarget.valueAsNumber));
            }} /><small>BPM</small></span></label>
            <label>Change from<select aria-label="Change key and meter from measure" aria-describedby="measure-change-scope" value={activeChangeMeasureId} onChange={(event) => {
              setChangeMeasureId(event.target.value);
              setMeterError(null);
              setStatus(`Key and meter controls now target measure ${score.measures[event.target.value].number}`);
            }}>
              {score.measureOrder.map((measureId) => <option data-measure-change-option key={measureId} value={measureId}>Measure {score.measures[measureId].number}</option>)}
            </select></label>
            <p id="measure-change-scope" className="field-help">Applies from the selected measure until the next existing change.</p>
            <label>Meter from here<select aria-label="Time signature from selected measure" aria-invalid={Boolean(visibleMeterError)} aria-describedby={visibleMeterError ? "score-meter-error" : undefined} disabled={largeScoreEditingPaused} value={changeMeterValue} onChange={(event) => changeMeterFromMeasure(event.target.value)}>
              {!changeMeterIsPreset ? <option value={changeMeterValue}>{changeMeterValue} · imported/custom</option> : null}
              {METER_PRESETS.map((meter) => <option key={meter} value={meter}>{meter}</option>)}
            </select></label>
            {visibleMeterError ? <p id="score-meter-error" className="field-error meter-change-error">{visibleMeterError}</p> : null}
            <label>Concert key from here<select aria-label="Concert key signature" disabled={largeScoreEditingPaused} value={keyValue(selectedConcertKey)} onChange={(event) => changeKeyFromMeasure(event.target.value)}>
              {(["major", "minor"] as const).map((mode) => <optgroup key={mode} label={mode === "major" ? "Major keys" : "Minor keys"}>
                {KEY_SIGNATURES.filter((key) => key.mode === mode).map((key) => <option data-key-signature-option key={keyValue(key)} value={keyValue(key)}>{key.label}</option>)}
              </optgroup>)}
            </select></label>
          </div>
          </div>
          <div id="inspector-part" className="inspector-pane" hidden={inspectorSection !== "part"}>
          {selectedPart ? (
            <div className="inspector-section">
              <div className="section-title"><span>Part</span><span className="family-badge" style={{ color: selectedPart.instrument.color }}>{selectedPart.instrument.family}</span></div>
              <label>Instrument<output>{selectedPart.name}</output></label>
              {selectedPart.staves.length > 1 ? (
                <div className="mixer-buttons" role="group" aria-label={`${selectedPart.name} staff selection`}>
                  {selectedPart.staves.map((staff, staffIndex) => (
                    <button
                      key={staff.id}
                      className={staff.id === selectedStaff?.id ? "active" : ""}
                      onClick={() => selectStaff(staff.id)}
                      aria-label={`Select staff ${staffIndex + 1}, ${staff.clef} clef`}
                      aria-pressed={staff.id === selectedStaff?.id}
                    >Staff {staffIndex + 1} · {staff.clef}</button>
                  ))}
                </div>
              ) : null}
              <label>Clef<output aria-label={`Selected staff clef: ${selectedStaff?.clef ?? selectedPart.instrument.clef}`}>{selectedStaff?.clef ?? selectedPart.instrument.clef}</output></label>
              <label>Written key<output aria-label={`${selectedPart.name} written key`}>{keySignatureName(selectedWrittenKey)}</output></label>
              <label>Written C sounds<output>{selectedPart.instrument.transposition.chromatic + selectedPart.instrument.transposition.octaveChange * 12 > 0 ? "+" : ""}{selectedPart.instrument.transposition.chromatic + selectedPart.instrument.transposition.octaveChange * 12} st</output></label>
              <div className="mixer-buttons"><button className={selectedPart.muted ? "active" : ""} disabled={largeScoreEditingPaused} onClick={() => commit(updatePart(score, selectedPart.id, { muted: !selectedPart.muted }), selectedPart.muted ? "Unmuted part" : "Muted part")} aria-pressed={selectedPart.muted}><Volume2 size={13} /> Mute</button><button className={selectedPart.solo ? "active" : ""} disabled={largeScoreEditingPaused} onClick={() => commit(updatePart(score, selectedPart.id, { solo: !selectedPart.solo }), selectedPart.solo ? "Unsoloed part" : "Soloed part")} aria-pressed={selectedPart.solo}>S Solo</button></div>
              <button className="danger-link" onClick={() => { if (guardLargeScoreEditing()) return; const next = removeInstrument(score, selectedPart.id); const selection = safeSelection(next); setSelectedEventTarget(null); setSelectedPartId(selection.partId); setSelectedStaffId(selection.staffId); commit(next, `Removed ${selectedPart.name}`); }} disabled={largeScoreEditingPaused || score.parts.length <= 1}><Trash2 size={13} /> Remove part</button>
            </div>
          ) : null}
          </div>
          </div>
        </aside>
      </div>

      {inspectorOpen || instrumentsOpen ? <div className="drawer-scrim" role="presentation" onClick={() => closeWorkspacePanel(inspectorOpen ? "inspector" : "instrument")} /> : null}

      {newOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewOpen(false); }}>
          <section ref={activeDialogRef} tabIndex={-1} className="modal template-modal" role="dialog" aria-modal="true" aria-labelledby="new-score-title"><header><div><span className="eyebrow">START A SCORE</span><h2 id="new-score-title">Create a new score</h2><p>Name your score and choose its instruments. You can add more later.</p></div><button className="icon-button" onClick={() => setNewOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <form onSubmit={(event) => { event.preventDefault(); createFromTemplate(newScoreDraft.templateId); }}>
              <div className="new-score-details">
                <label htmlFor="new-score-name">Title<input id="new-score-name" maxLength={200} value={newScoreDraft.title} aria-invalid={Boolean(newScoreError)} aria-describedby={newScoreError ? "new-score-error" : undefined} onChange={(event) => { setNewScoreDraft({ ...newScoreDraft, title: event.target.value }); setNewScoreError(""); }} /></label>
                <label htmlFor="new-score-composer">Composer <span>(optional)</span><input id="new-score-composer" maxLength={200} value={newScoreDraft.composer} onChange={(event) => setNewScoreDraft({ ...newScoreDraft, composer: event.target.value })} /></label>
                {newScoreError ? <p id="new-score-error" className="field-error" role="alert">{newScoreError}</p> : null}
              </div>
              <div className="template-grid" role="group" aria-label="Choose an ensemble">{SCORE_TEMPLATES.map((template) => <button type="button" key={template.id} aria-pressed={newScoreDraft.templateId === template.id} onClick={() => setNewScoreDraft({ ...newScoreDraft, templateId: template.id })}><strong>{template.name}</strong><small>{template.id === "solo" ? INSTRUMENTS.find((instrument) => instrument.catalogId === newScoreDraft.instrumentId)?.name : template.description}</small><em>{template.instruments.length} {template.instruments.length === 1 ? "part" : "parts"}</em></button>)}</div>
              <div className="new-score-setup">
                {newScoreDraft.templateId === "solo" ? <label className="solo-instrument">Instrument<select aria-label="Solo instrument" value={newScoreDraft.instrumentId} onChange={(event) => setNewScoreDraft({ ...newScoreDraft, instrumentId: event.target.value })}>{FAMILIES.map((family) => <optgroup label={family} key={family}>{INSTRUMENTS.filter((instrument) => instrument.family === family).map((instrument) => <option key={instrument.catalogId} value={instrument.catalogId}>{instrument.name}</option>)}</optgroup>)}</select></label> : null}
                <label>Time signature<select aria-label="New score time signature" value={newScoreDraft.meter} onChange={(event) => setNewScoreDraft({ ...newScoreDraft, meter: event.target.value })}>{METER_PRESETS.map((meter) => <option key={meter} value={meter}>{meter}</option>)}</select></label>
                <label htmlFor="new-score-tempo">Tempo · BPM<input id="new-score-tempo" aria-label="New score tempo" type="number" inputMode="numeric" min={30} max={300} step={1} required value={newScoreDraft.tempo} onChange={(event) => setNewScoreDraft({ ...newScoreDraft, tempo: event.target.value })} /></label>
              </div>
              <div className="new-score-notice"><p>{largeScoreEditingPaused ? "This large score cannot be kept in Undo without freezing the editor. Export it before choosing a template." : "This browser keeps one draft. Creating a new score replaces it. Undo history is temporary and limited; download your current score to keep it."}</p><button type="button" className="quiet-button" onClick={() => exportNative(true)}><Download size={14} /> Download current score</button>{newScoreDownloadStatus ? <p className="new-score-download-status" role="status">{newScoreDownloadStatus}</p> : null}</div>
              <div className="new-score-actions"><p>Replaces this browser’s current draft.</p><button type="button" className="quiet-button" onClick={() => setNewOpen(false)}>Cancel</button><button type="submit" className="primary-button"><Plus size={14} /> Create score</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {addOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <section ref={activeDialogRef} tabIndex={-1} className="modal instrument-modal" role="dialog" aria-modal="true" aria-labelledby="add-instrument-title"><header><div><span className="eyebrow">ORCHESTRA LIBRARY</span><h2 id="add-instrument-title">Add an instrument</h2><p>{INSTRUMENTS.length} standard orchestral, keyboard, and vocal definitions.</p></div><button className="icon-button" onClick={() => setAddOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="instrument-search"><Search size={16} /><input value={instrumentQuery} onChange={(event) => setInstrumentQuery(event.target.value)} placeholder="Search flute, B♭ clarinet, violin…" aria-label="Search instruments" /></div>
            <div className="family-tabs" role="group" aria-label="Instrument family filter">{["All", "Woodwinds", "Brass", "Percussion", "Keyboards", "Voices", "Strings"].map((family) => <button key={family} className={activeFamily === family ? "active" : ""} onClick={() => setActiveFamily(family)} aria-pressed={activeFamily === family}>{family}</button>)}</div>
            <p className="catalog-results" role="status" aria-live="polite" aria-atomic="true">{countLabel(filteredInstruments.length, "matching instrument")}</p>
            <div className="catalog-list">{filteredInstruments.length ? filteredInstruments.map((instrument) => <button key={instrument.catalogId} disabled={largeScoreEditingPaused} onClick={() => {
              if (guardLargeScoreEditing()) return;
              const next = addInstrument(score, instrument.catalogId);
              if (next === score) {
                setAddOpen(false);
                setStatus(`Could not add ${instrument.name} — the score reached its safety limit`);
                return;
              }
              const selection = safeSelection(next, next.parts.at(-1)?.id);
              commit(next, `Added ${instrument.name}`);
              setSelectedEventTarget(null);
              setSelectedPartId(selection.partId);
              setSelectedStaffId(selection.staffId);
              setAddOpen(false);
            }}><span className="catalog-color" style={{ background: instrument.color }} /><span><strong>{instrument.name}</strong><small>{instrument.family} · {instrument.staffClefs?.join(" + ") ?? instrument.clef} {instrument.staffClefs ? "staves" : "clef"}{instrument.transposition.chromatic || instrument.transposition.octaveChange ? ` · ${instrument.transposition.chromatic + instrument.transposition.octaveChange * 12} semitones` : ""}</small></span><Plus size={15} /></button>) : (
              <div className="catalog-empty"><strong>No instruments found</strong><span>Try another name or clear the family filter.</span><button type="button" onClick={() => { setInstrumentQuery(""); setActiveFamily("All"); }}>Clear search and filters</button></div>
            )}</div>
          </section>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <section ref={activeDialogRef} tabIndex={-1} className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><header><div><span className="eyebrow">KEYBOARD FIRST</span><h2 id="shortcut-title">Compose without leaving the score</h2><p>Shortcuts are ignored while you type in a text field.</p></div><button className="icon-button" onClick={() => setHelpOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="shortcut-grid"><div><span>Four input methods</span><p><strong>1 · Arrow → number</strong><br /><kbd>↑</kbd><kbd>↓</kbd> chooses one staff step at a time; <kbd>1–7</kbd> chooses length; <kbd>QWERTYU</kbd> enters a note. With an event selected, arrows edit pitch and numbers edit its length. The visible 도–시 buttons also select pitch in this mode. <kbd>Alt ↑ ↓</kbd> changes staff while the score is focused.</p><p><strong>2 · Number → letter</strong><br /><kbd>1–7</kbd> chooses duration; <kbd>Q W E R T Y U</kbd> enters 도 레 미 파 솔 라 시. These pitch keys work with the menu closed and in every input method.</p><p><strong>3 · Score click / tap</strong><br />Choose duration, then click a blank staff line or space. Garak appends the pitch at that clicked measure&apos;s NEXT position; clicking an existing event selects it. Long notes split across barlines with ties; full measures stay unchanged. In Chord mode, Shift-click adds a tone only when a note is selected in the same staff and measure.</p><p><strong>4 · Buttons / touch</strong><br />Use 도(C), 레(D), 미(E), 파(F), 솔(G), 라(A), 시(B), or Rest.</p></div><div><span>Notes & rhythm</span><p><strong>Fixed-do map</strong> 도=C · 레=D · 미=E · 파=F · 솔=G · 라=A · 시=B</p><p><kbd>Shift + QWERTYU</kbd> Add a tone to the selected note or chord using the input octave and accidental, even with Rest on. Keeps its length and existing ties, including every automatic split across barlines. Select a note first; rests cannot receive chord tones. Continue input (or Esc) clears selection and returns to input settings at NEXT.</p><p><kbd>↑ / ↓</kbd> Edit only the selected chord tone by one semitone; hold Shift for an octave. Tied notes change together. Without a selection, arrows choose the input pitch.</p><p><kbd>Shift + Z / X</kbd> Add the current input pitch one octave below / above to the selected note or chord.</p><p><kbd>Tab / Shift+Tab</kbd> While the score is focused, move to the next / previous measure’s NEXT input position. Tab at the last measure creates and moves to a new measure. Shift+Tab at the first measure leaves the score normally.</p><p><kbd>Z / X</kbd> Lower / raise the input octave (0–8), with the menu open or closed.</p><p><kbd>1–7</kbd> Change the selected note, whole chord, or rest to whole → sixty-fourth. With no selection, only the input length changes. Length and dot edits keep ties, split across barlines as needed, and shift following notes.</p><p><kbd>~</kbd> or <kbd>.</kbd> Selected note/chord: cycle 0 → 1 → 2 dots across the complete automatic split. No selection: input dots only.</p><p><kbd>A</kbd> Toggle rest input; QWERTYU adds rests until A is pressed again</p><p><kbd>S D F</kbd> Flat · natural · sharp for the next note</p><p><kbd>\</kbd> Tie the selected tone to the previous matching note, or remove that connection. With no selection, use the last two notes.</p><p><strong>Ties</strong> In Edit selection, connect to the previous or next note. Pitch edits update all notes linked by ties, including across measures. Remove a connection to edit those notes separately; the notes and rhythm stay in place.</p><p><strong>Chord</strong> Add pitches to the selected note, or the latest note when nothing is selected. Next chord starts a separate chord with your next pitch; Finish chord returns to single-note input.</p></div><div><span>Select & edit</span><p><strong>Drag a notehead</strong> Start sideways to move the whole note or chord in time; tied events move together. Start up/down to change that tone and its tied notes. The first direction locks. Time moves snap to 16th notes or existing onsets and leave rests behind. Occupied destinations keep the original score. Release to apply; Esc cancels. Swipe blank space to scroll.</p><p><kbd>←</kbd><kbd>→</kbd> Select events while the score is focused</p><p><kbd>⌫</kbd> Clear a selected note to a rest; delete a selected rest or the previous input</p><p><kbd>⇧ ⌫</kbd> Remove selected rhythmic time and shift later events earlier</p><p><strong>Edit selection</strong> Choose a tone by name to change its pitch or remove only that tone. Length and dots affect the whole chord. Clear whole chord to rest keeps its rhythm.</p><p><strong>Chord mode Delete</strong> The toolbar and Delete key remove the last-added tone first. Shift+Delete removes the whole event and its time.</p><p><kbd>⌘ Z</kbd> Undo · <kbd>⌘ ⇧ Z</kbd> Redo</p></div><div><span>Project & playback</span><p><kbd>⌘ S</kbd> Save locally</p><p><kbd>⌘ P</kbd> Print / PDF</p><p><kbd>Space</kbd> Play from the selected measure, or play the selected range once. During playback, Space pauses / resumes at the same position; the square Stop button resets playback. <kbd>Shift+Space</kbd> starts from the beginning. Select a range and choose Loop range to repeat it. Ties are held within each pass; notes end at the loop boundary. Click or tap a note or staff position to seek and play, including while paused. During a loop, seeking stays inside the selected range; stop first to leave it. Metronome clicks once per denominator beat (6/8 has six eighth-note clicks), accenting each measure’s first beat. Choose 1 bar or 2 bars for count-in; each bar uses the starting measure’s meter and accents its first beat. The counter shows the current bar and beat within that bar; a diamond and highlighted background mark each first beat. Enable Count-in before playback before starting. Enable Count-in every loop to count the chosen number of bars before the first pass and between every repeat; turn it off for continuous repeats. You can change this during playback: the current music pass continues, and a count already started finishes its original length. Changing the length also applies only to the next count-in. The next repeat uses your choice. The setting is saved. Pause/resume and speed changes also work during count-in; seeking starts immediately. Practice settings (연습 설정) groups metronome sound, click volume, count-in, beat display, speed and auto-follow. The Show beat guide eye button toggles the visual beat guide independently of sound and remembers your choice in this browser. Count-in remains visible when the guide is off. The guide works with Metronome off or Click volume at 0%. A diamond and highlighted background mark each first beat. Mute the instruments as well for fully silent practice. Toggle the metronome sound anytime. Click volume controls both metronome and count-in, separately from the music; 0% is silent. Count-in switch changes apply to the next playback start. These settings are saved in this browser. Playback speed in the header changes practice speed (0.25×–2×) without changing score tempo or pitch. It stays set through pause, seek and loops and is saved in this browser. Changing speed keeps sounding notes continuous. The header Auto-follow button turns screen following on or off and remembers your choice in this browser. Manual scrolling holds following until you press Follow playback; waiting, resuming or seeking does not force the view back. Paused playback never scrolls automatically.</p><p><kbd>?</kbd> This guide</p></div></div>
            <footer><CircleHelp size={15} /><span>This alpha supports one voice per staff. Tuplets, multi-voice editing, and linked-part layout follow in the roadmap. <Link href="/licenses" target="_blank" rel="noopener noreferrer">Third-party licenses<span className="visually-hidden"> (opens in a new tab)</span></Link></span></footer>
          </section>
        </div>
      ) : null}

      {pendingImport ? (
        <div className="modal-backdrop" role="presentation">
          <section ref={activeDialogRef} tabIndex={-1} className="modal import-warning-modal" role="dialog" aria-modal="true" aria-labelledby="import-warning-title">
            <header>
              <div><span className="eyebrow">MUSICXML IMPORT</span><h2 id="import-warning-title">Review {pendingImport.warnings.length} warning{pendingImport.warnings.length === 1 ? "" : "s"}</h2><p>Your current score is unchanged. Garak will leave unsupported material out only if you open this editable copy.</p></div>
              <button className="icon-button" onClick={cancelPendingImport} aria-label="Cancel MusicXML import"><X size={18} /></button>
            </header>
            <div className="import-warning-body">
              <div className="import-warning-summary"><AlertTriangle size={17} /><span>Review the import details before continuing publication work.</span></div>
              <ol className="import-warning-list">{pendingImport.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ol>
            </div>
            <footer className="import-warning-actions"><button className="quiet-button" onClick={cancelPendingImport}>Cancel import</button><button className="primary-button" onClick={() => openImportedScore(pendingImport.score, `Opened ${pendingImport.score.metadata.title} from MusicXML · reviewed ${pendingImport.warnings.length} warning${pendingImport.warnings.length === 1 ? "" : "s"}`)}>Open editable copy</button></footer>
          </section>
        </div>
      ) : null}
      <div className="sr-status" role={statusTone(status) === "error" ? "alert" : "status"} aria-live={statusTone(status) === "error" ? "assertive" : "polite"} aria-atomic="true"><span key={statusRevision}>{status}</span></div>
    </main>
  );
}
