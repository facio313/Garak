"use client";

import {
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Download,
  FileDown,
  FileJson,
  FileMusic,
  FolderOpen,
  Keyboard,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  Printer,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { INSTRUMENTS, SCORE_TEMPLATES } from "../lib/music/catalog";
import { collectPlaybackNotes, scoreToMidi, scoreToMusicXML, selectPlaybackWindow } from "../lib/music/exporters";
import { trimHistorySnapshots } from "../lib/music/history";
import { KEY_SIGNATURES, keySignatureAlterForStep, keySignatureName, writtenKeyForPart } from "../lib/music/key-signatures";
import type { KeySignature } from "../lib/music/key-signatures";
import type { Articulation, DurationBase, DurationValue, DynamicMarking, MusicEvent, PitchStep, ScoreDocument, ScoreNote } from "../lib/music/model";
import { ARTICULATIONS, DURATION_LABELS, DYNAMIC_MARKINGS, TICKS_PER_QUARTER, durationTicks, eventCount, getPrimaryVoice, nextAugmentationDotCount, pitchName, resolveStaffIndex, validateScore, voiceTicks } from "../lib/music/model";
import { locatePlaybackPosition } from "../lib/music/playback-position";
import { addChordTone, addChordToneToEvent, addInstrument, appendEvent, appendMeasure, clearEventToRest, createScore, findEventTargetMeasureId, makeEvent, removeChordToneFromEvent, removeEvent, removeInstrument, removeLastChordTone, removeLastEvent, removeLastMeasure, setEventArticulation, setEventDynamic, setKeyFromMeasure, setLastEventDynamic, setLastNoteArticulation, setTimeFromMeasure, toggleTieLastTwo, updatePart } from "../lib/music/score";
import { loadStoredScore, saveStoredScore } from "../lib/music/storage";
import { DurationIcon } from "./DurationIcon";
import { ScoreRenderer } from "./ScoreRenderer";
import type { ScoreEventSelection } from "./ScoreRenderer";

type AccidentalMode = "auto" | "sharp" | "flat" | "natural";
type PendingImport = { score: ScoreDocument; warnings: string[] };
type StatusTone = "neutral" | "success" | "warning" | "error";
type HistoryEntry = { score: ScoreDocument; selection: ScoreEventSelection | null };

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
  return selection && eventAtSelection(score, selection) ? selection : null;
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

function scoreHasNotes(score: ScoreDocument): boolean {
  return score.parts.some((part) => part.staves.some((staff) => score.measureOrder.some((measureId) =>
    staff.measures[measureId]?.voices.some((voice) => voice.events.some((event) => event.kind === "note")),
  )));
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
  if (/failed|not saved|invalid|could not|unavailable|larger than/.test(normalized)) return "error";
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
  const [chordMode, setChordMode] = useState(false);
  const [accidentalMode, setAccidentalMode] = useState<AccidentalMode>("auto");
  const [octave, setOctave] = useState(4);
  const [zoom, setZoom] = useState(82);
  const [{ text: status, revision: statusRevision }, setStatus] = useReducer(
    (current: { text: string; revision: number }, text: string) => ({ text, revision: current.revision + 1 }),
    { text: "Opening your local score…", revision: 0 },
  );
  const [hydrated, setHydrated] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [inputFollowRevision, requestInputFollow] = useReducer((revision: number) => revision + 1, 0);
  const [selectedEventTarget, setSelectedEventTarget] = useState<ScoreEventSelection | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorDrawerMode, setInspectorDrawerMode] = useState(false);
  const [instrumentsOpen, setInstrumentsOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [activeFamily, setActiveFamily] = useState("All");
  const [playing, setPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState<number | null>(null);
  const [metadataDraft, setMetadataDraft] = useState(score.metadata);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openFileButtonRef = useRef<HTMLButtonElement>(null);
  const projectTitleRef = useRef<HTMLButtonElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const filePickerReturnFocusRef = useRef<HTMLElement | null>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const notationToolsRef = useRef<HTMLElement>(null);
  const mobileToolsButtonRef = useRef<HTMLButtonElement>(null);
  const activeDialogRef = useRef<HTMLElement>(null);
  const eventSequence = useRef(1000);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const autoZoomRef = useRef(true);
  const lastFocusedControlRef = useRef<HTMLElement | null>(null);

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
        if (active?.closest("#notation-tools")) setMobileToolsOpen(true);
        return;
      }
      setInstrumentsOpen(false);
      setMobileToolsOpen(false);
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
  const closeActiveDialog = useCallback(() => {
    if (pendingImport) cancelPendingImport();
    else if (helpOpen) setHelpOpen(false);
    else if (addOpen) setAddOpen(false);
    else if (newOpen) setNewOpen(false);
    else if (inspectorOpen) setInspectorOpen(false);
    else if (instrumentsOpen) setInstrumentsOpen(false);
  }, [addOpen, cancelPendingImport, helpOpen, inspectorOpen, instrumentsOpen, newOpen, pendingImport]);
  const captureModalReturnFocus = useCallback((): HTMLElement | null => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (active?.closest(".export-menu")) return exportButtonRef.current;
    if (active?.closest("#score-inspector")) return projectTitleRef.current;
    return active;
  }, []);
  const openNewDialog = useCallback(() => {
    modalReturnFocusRef.current = captureModalReturnFocus();
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
  const openFilePicker = useCallback((returnFocus: HTMLElement | null) => {
    filePickerReturnFocusRef.current = returnFocus;
    setExportOpen(false);
    window.addEventListener("focus", () => {
      window.setTimeout(() => { filePickerReturnFocusRef.current = null; }, 500);
    }, { once: true });
    fileInputRef.current?.click();
  }, []);

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
      )].filter((element) => !element.hidden);
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
        if (previousFocus?.getClientRects().length) previousFocus.focus();
        else fallbackFocus?.focus();
      });
    };
  }, [activeDialogKind, activeDialogOpen, closeActiveDialog]);

  const toggleMobileTools = useCallback(() => {
    const next = !mobileToolsOpen;
    setMobileToolsOpen(next);
    window.requestAnimationFrame(() => {
      if (next) {
        const activeDuration = notationToolsRef.current?.querySelector<HTMLElement>('.note-values button[aria-pressed="true"]');
        const firstControl = notationToolsRef.current?.querySelector<HTMLElement>("button:not([disabled]), select:not([disabled])");
        (activeDuration ?? firstControl)?.focus();
      } else {
        mobileToolsButtonRef.current?.focus();
      }
    });
  }, [mobileToolsOpen]);

  const selectedPart = score.parts.find((part) => part.id === selectedPartId) ?? score.parts[0];
  const resolvedStaffIndex = selectedPart ? resolveStaffIndex(selectedPart, selectedStaffId) : -1;
  const selectedStaffIndex = resolvedStaffIndex >= 0 ? resolvedStaffIndex : 0;
  const selectedStaff = selectedPart?.staves[selectedStaffIndex];
  const activeStaffId = selectedStaff?.id ?? "";
  const selectedStaffNumber = selectedStaffIndex + 1;
  const activeChangeMeasureId = score.measures[changeMeasureId] ? changeMeasureId : score.measureOrder[0];
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
  const inspectorUsesSelection = Boolean(selectedEvent && selectedEventTarget);
  const deletionTargetEvent = selectedEvent ?? lastEvent;
  const selectedChordTarget = chordMode && selectedEvent?.kind === "note" && selectedEventTarget
    ? { event: selectedEvent, measureId: selectedEventTarget.measureId }
    : null;
  const latestChordTarget = chordMode && !selectedEventTarget && lastEvent?.kind === "note" && lastEventMeasureId
    ? { event: lastEvent, measureId: lastEventMeasureId }
    : null;
  const chordTarget = selectedChordTarget ?? latestChordTarget;
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
  const lastNoteTarget = selectedPart ? findLastNoteEvent(score, selectedPart.id, selectedStaffIndex) : null;
  const lastNoteEvent = lastNoteTarget?.event;
  const inspectorNoteEvent = selectedEvent
    ? selectedEvent.kind === "note" ? selectedEvent : undefined
    : lastNoteEvent;
  const previewDuration: DurationValue = { base: duration, dots: dotCount };
  const canAddChordTone = Boolean(chordTarget);
  const previewMeasureId = selectedPart && activeStaffId
    ? canAddChordTone
      ? chordTarget?.measureId ?? null
      : findEventTargetMeasureId(score, selectedPart.id, previewDuration, activeStaffId) ?? score.measureOrder.at(-1) ?? null
    : null;
  const previewWrittenKey = selectedPart && previewMeasureId
    ? writtenKeyForPart(score.measures[previewMeasureId].key, selectedPart)
    : selectedWrittenKey;
  const previewEntryTick = selectedPart && previewMeasureId
    ? chordTarget
      ? primaryEventOnsetTicks(selectedPart, previewMeasureId, selectedStaffIndex, chordTarget.event.id)
        ?? voiceTicks(getPrimaryVoice(selectedPart, previewMeasureId, selectedStaffIndex))
      : voiceTicks(getPrimaryVoice(selectedPart, previewMeasureId, selectedStaffIndex))
    : 0;
  const totalEvents = selectedPart && selectedStaff ? eventCount(score, selectedPart.id, selectedStaff.id) : 0;
  const playbackPosition = playbackSeconds === null ? null : locatePlaybackPosition(score, playbackSeconds);
  const inputTargetLabel = selectedPart && activeStaffId
    ? previewMeasureId
      ? `${selectedPart.shortName} · Staff ${selectedStaffNumber} · m. ${score.measures[previewMeasureId].number}`
      : `${selectedPart.shortName} · Staff ${selectedStaffNumber} · Enter a note first`
    : "Select a staff";

  const selectPart = useCallback((partId: string) => {
    const part = score.parts.find((candidate) => candidate.id === partId);
    if (!part) return;
    setSelectedPartId(part.id);
    setSelectedStaffId((current) => part.staves.some((staff) => staff.id === current) ? current : part.staves[0]?.id ?? "");
    setSelectedEventTarget(null);
  }, [score.parts]);

  const selectStaff = useCallback((staffId: string) => {
    const part = score.parts.find((candidate) => candidate.staves.some((staff) => staff.id === staffId));
    if (!part) return;
    setSelectedPartId(part.id);
    setSelectedStaffId(staffId);
    setSelectedEventTarget(null);
  }, [score.parts]);

  const selectRenderedEvent = useCallback((selection: ScoreEventSelection | null) => {
    setSelectedEventTarget(selection);
    const event = eventAtSelection(score, selection);
    if (event && selection) {
      setChangeMeasureId(selection.measureId);
      const removesChordTone = chordMode
        && event.kind === "note"
        && event.notes.length > 1;
      setStatus(removesChordTone
        ? `Selected ${eventName(event)} · Delete removes its last chord tone`
        : event.kind === "note"
          ? `Selected ${eventName(event)} · Delete clears it to a rest; Shift+Delete removes its time`
          : `Selected ${eventName(event)} · Delete removes this rest and shifts later events earlier`);
    } else if (selection === null) {
      setStatus("Input caret selected · new notes append at the blue NEXT marker");
    }
  }, [chordMode, score]);

  const cancelPlayback = useCallback(() => {
    if (playbackTimerRef.current) window.clearInterval(playbackTimerRef.current);
    playbackTimerRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setPlaying(false);
    setPlaybackSeconds(null);
  }, []);

  const commit = useCallback((next: ScoreDocument, message: string) => {
    if (next === score) {
      setStatus(message);
      return;
    }
    cancelPlayback();
    const proposedHistory = [...past, { score, selection: selectedEventTarget }];
    const retainedHistory = trimStudioHistory(proposedHistory, "end");
    setPast(retainedHistory);
    setFuture([]);
    setScore(next);
    const editStatus = retainedHistory.length < proposedHistory.length
      ? `${message} · oldest undo steps released to protect memory`
      : message;
    setStatus(autoSaveEnabled ? editStatus : `${editStatus} · autosave paused — use Save now or New to replace preserved drafts`);
  }, [autoSaveEnabled, cancelPlayback, past, score, selectedEventTarget]);

  const undo = useCallback(() => {
    if (!past.length) return;
    cancelPlayback();
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => trimStudioHistory([{ score, selection: selectedEventTarget }, ...items], "start"));
    setScore(previous.score);
    const restoredSelection = revalidateEventSelection(previous.score, previous.selection);
    setSelectedEventTarget(restoredSelection);
    setMetadataDraft(previous.score.metadata);
    const selection = safeSelection(
      previous.score,
      restoredSelection?.partId ?? selectedPartId,
      restoredSelection?.staffId ?? selectedStaffId,
    );
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setStatus("Undid the last edit");
  }, [cancelPlayback, past, score, selectedEventTarget, selectedPartId, selectedStaffId]);

  const redo = useCallback(() => {
    if (!future.length) return;
    cancelPlayback();
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => trimStudioHistory([...items, { score, selection: selectedEventTarget }], "end"));
    setScore(next.score);
    const restoredSelection = revalidateEventSelection(next.score, next.selection);
    setSelectedEventTarget(restoredSelection);
    setMetadataDraft(next.score.metadata);
    const selection = safeSelection(
      next.score,
      restoredSelection?.partId ?? selectedPartId,
      restoredSelection?.staffId ?? selectedStaffId,
    );
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setStatus("Redid the edit");
  }, [cancelPlayback, future, score, selectedEventTarget, selectedPartId, selectedStaffId]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = loadStoredScore(window.localStorage);
        if (stored.kind === "loaded") {
          setScore(stored.score);
          const selection = safeSelection(stored.score);
          setSelectedPartId(selection.partId);
          setSelectedStaffId(selection.staffId);
          setChangeMeasureId(stored.score.measureOrder[0]);
          setMetadataDraft(stored.score.metadata);
          setStatus(stored.source === "backup"
            ? "Recovered the last-known-good backup — the damaged latest draft was preserved; autosave is paused until Save now or New"
            : "Recovered your local score");
          setAutoSaveEnabled(stored.source === "primary");
        } else if (stored.reason === "empty") {
          setStatus("Ready — changes save on this device");
          setAutoSaveEnabled(true);
        } else {
          setAutoSaveEnabled(false);
          setStatus("Started a fresh score — damaged drafts were preserved; autosave is paused until Save now or New");
        }
      } catch {
        setAutoSaveEnabled(false);
        setStatus("Started a fresh score — local storage is unavailable; autosave is paused");
      } finally {
        setHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated || !autoSaveEnabled) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const nextStatus = persistScoreLocally(score);
      if (nextStatus !== "Saved locally") setStatus(nextStatus);
    }, 450);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [autoSaveEnabled, hydrated, score]);

  const saveNow = useCallback(() => {
    const nextStatus = persistScoreLocally(score);
    setStatus(nextStatus);
    if (nextStatus === "Saved locally") setAutoSaveEnabled(true);
  }, [score]);

  const stopPlayback = useCallback(() => {
    cancelPlayback();
    setStatus("Playback stopped");
  }, [cancelPlayback]);

  const playScore = useCallback(() => {
    if (playing) {
      stopPlayback();
      return;
    }
    const playbackWindow = selectPlaybackWindow(collectPlaybackNotes(score), 600);
    const notes = playbackWindow.notes;
    if (!notes.length) {
      setStatus(scoreHasNotes(score)
        ? "No audible notes — check the instrument Mute and Solo controls"
        : "Add a note before playback");
      return;
    }
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = Math.min(.32, .9 / Math.sqrt(Math.max(1, score.parts.length)));
    master.connect(context.destination);
    const start = context.currentTime + .08;
    const audioTotal = Math.max(...notes.map((note) => note.startSeconds + note.durationSeconds));
    const windowNotatedTotal = Math.max(...notes.map((note) => note.startSeconds + note.notatedDurationSeconds));
    const total = playbackWindow.truncated
      ? Math.max(audioTotal, windowNotatedTotal)
      : Math.max(audioTotal, scoreNotatedDurationSeconds(score));
    notes.forEach((item) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const part = score.parts.find((candidate) => candidate.id === item.partId);
      oscillator.type = part?.instrument.family === "Brass" ? "sawtooth" : part?.instrument.family === "Strings" ? "triangle" : "sine";
      oscillator.frequency.value = 440 * 2 ** ((item.midi - 69) / 12);
      const noteStart = start + item.startSeconds;
      const noteEnd = noteStart + item.durationSeconds;
      const attackSeconds = Math.min(.018, item.durationSeconds * .35);
      const peakGain = .015 + item.velocity / 127 * .105;
      gain.gain.setValueAtTime(.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(peakGain, noteStart + attackSeconds);
      gain.gain.exponentialRampToValueAtTime(.0001, noteEnd);
      oscillator.connect(gain).connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + .02);
    });
    audioContextRef.current = context;
    void context.resume();
    setPlaying(true);
    setPlaybackSeconds(0);
    setStatus(playbackWindow.truncated
      ? `Playing the first ${notes.length} of ${countLabel(playbackWindow.total, "note")} at ♩ = ${score.tempo}`
      : `Playing ${countLabel(notes.length, "note")} at ♩ = ${score.tempo}`);
    playbackTimerRef.current = window.setInterval(() => {
      const elapsed = Math.max(0, context.currentTime - start);
      setPlaybackSeconds(Math.min(total, elapsed));
      if (elapsed >= total) stopPlayback();
    }, 40);
  }, [playing, score, stopPlayback]);

  const enterEvent = useCallback((step: PitchStep, forceRest = false) => {
    const part = score.parts.find((candidate) => candidate.id === selectedPartId) ?? score.parts[0];
    if (!part) return;
    const staffIndex = resolveStaffIndex(part, selectedStaffId);
    if (staffIndex < 0) return;
    const staffId = part.staves[staffIndex].id;
    const staffNumber = staffIndex + 1;
    const eventId = `event-${Date.now()}-${eventSequence.current++}`;
    const enteringRest = forceRest;
    const exactChordTarget = chordMode && !enteringRest
      && selectedEvent?.kind === "note"
      && selectedEventTarget?.partId === part.id
      && selectedEventTarget.staffId === staffId
      ? selectedEventTarget
      : null;
    const latestChordMeasureId = chordMode && !enteringRest && !selectedEventTarget
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
        pitch: { step, alter, octave },
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
      setSelectedEventTarget({ partId: part.id, staffId, measureId: result.measureId, eventId: result.eventId });
      requestInputFollow();
      return;
    }

    const durationValue: DurationValue = { base: duration, dots: dotCount };
    const targetMeasureId = findEventTargetMeasureId(score, part.id, durationValue, staffId) ?? score.measureOrder.at(-1)!;
    const entryWrittenKey = writtenKeyForPart(score.measures[targetMeasureId].key, part);
    const alter = inputAlter(accidentalMode, entryWrittenKey, step);
    const event = makeEvent({
      id: eventId,
      pitch: { step, alter, octave },
      duration: durationValue,
      rest: enteringRest,
      accidentalDisplay: accidentalMode === "auto" ? "auto" : "force",
    });
    const result = appendEvent(score, part.id, event, staffId);
    if (result.error) setStatus(result.error);
    else {
      const chordStatus = event.kind === "rest" && chordMode ? " · Chord mode ignored for rests" : "";
      const entryStatus = event.kind === "rest"
        ? "Entered rest"
        : chordMode
          ? `Started chord with ${pitchName(event.notes[0].pitch)}`
          : `Entered ${pitchName(event.notes[0].pitch)}`;
      commit(result.score, `${entryStatus} · ${durationName(duration, dotCount)} · staff ${staffNumber}${chordStatus}`);
      if (result.measureId) {
        setSelectedEventTarget({ partId: part.id, staffId, measureId: result.measureId, eventId: event.id });
        requestInputFollow();
      }
    }
  }, [accidentalMode, chordMode, commit, dotCount, duration, octave, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId]);

  const toggleTie = useCallback(() => {
    const part = score.parts.find((candidate) => candidate.id === selectedPartId) ?? score.parts[0];
    if (!part) return;
    const staffIndex = resolveStaffIndex(part, selectedStaffId);
    if (staffIndex < 0) return;
    const result = toggleTieLastTwo(score, part.id, part.staves[staffIndex].id);
    if (result.error) setStatus(result.error);
    else commit(result.score, result.tied ? "Tied the last two notes" : "Removed the tie");
  }, [commit, score, selectedPartId, selectedStaffId]);

  const removeChordTone = useCallback(() => {
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
  }, [commit, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId]);

  const removeLatestInput = useCallback((collapseTime = false) => {
    if (deleteRemovesChordTone && !collapseTime) {
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
  }, [activeStaffId, commit, deleteRemovesChordTone, lastEvent, removeChordTone, score, selectedEvent, selectedEventTarget, selectedPart, selectedStaffNumber]);

  const applyDynamic = useCallback((dynamic: DynamicMarking | null) => {
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
  }, [commit, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId]);

  const applyArticulation = useCallback((articulation: Articulation | null) => {
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
  }, [commit, score, selectedEvent, selectedEventTarget, selectedPartId, selectedStaffId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        const returnToMobileTools = mobileToolsOpen;
        const returnToExportMenu = exportOpen && Boolean(target?.closest(".export-menu"));
        setAddOpen(false); setNewOpen(false); setHelpOpen(false); setExportOpen(false); setInspectorOpen(false); setInstrumentsOpen(false); setMobileToolsOpen(false);
        if (returnToMobileTools) window.requestAnimationFrame(() => mobileToolsButtonRef.current?.focus());
        else if (returnToExportMenu) window.requestAnimationFrame(() => exportButtonRef.current?.focus());
        return;
      }
      if (activeDialogOpen) return;
      const textEntry = target?.matches("input, textarea, select, [contenteditable='true']");
      const notationToolbarButton = target?.matches("button") && Boolean(target.closest(".note-toolbar, .mobile-input-dock"));
      const unrelatedButton = target?.matches("button") && !target.classList.contains("score-hit-target") && !notationToolbarButton;
      if (notationToolbarButton && (event.key === " " || event.key === "Enter")) return;
      const typing = textEntry || unrelatedButton;
      if (event.isComposing || typing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveNow(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") { event.preventDefault(); window.print(); return; }
      if (event.key === " ") { event.preventDefault(); playScore(); return; }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        if (event.repeat) return;
        removeLatestInput(event.shiftKey);
        return;
      }
      if (event.key === ".") {
        event.preventDefault();
        const next = nextAugmentationDotCount(dotCount);
        setDotCount(next);
        setStatus(dotSelectionStatus(next));
        return;
      }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); if (!event.repeat) enterEvent("C", true); return; }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); if (!event.repeat) toggleTie(); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setOctave((value) => Math.min(8, value + 1)); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setOctave((value) => Math.max(0, value - 1)); return; }
      const durationIndex = Number(event.key) - 1;
      if (durationIndex >= 0 && durationIndex < DURATION_CHOICES.length) {
        event.preventDefault();
        const nextDuration = DURATION_CHOICES[durationIndex].value;
        setDuration(nextDuration);
        setStatus(`${DURATION_LABELS[nextDuration]} duration selected`);
        return;
      }
      const step = event.key.toUpperCase();
      if (["A", "B", "C", "D", "E", "F", "G"].includes(step)) {
        event.preventDefault();
        if (!event.repeat) enterEvent(step as PitchStep);
      }
      if (event.key === "?") { event.preventDefault(); openHelpDialog(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeDialogOpen, dotCount, enterEvent, exportOpen, mobileToolsOpen, openHelpDialog, playScore, redo, removeLatestInput, saveNow, toggleTie, undo]);

  useEffect(() => () => {
    if (playbackTimerRef.current) window.clearInterval(playbackTimerRef.current);
    void audioContextRef.current?.close();
  }, []);

  const filteredInstruments = useMemo(() => {
    const query = instrumentQuery.trim().toLowerCase();
    return INSTRUMENTS.filter((instrument) =>
      (activeFamily === "All" || instrument.family === activeFamily) &&
      (!query || `${instrument.name} ${instrument.shortName} ${instrument.keywords.join(" ")}`.toLowerCase().includes(query)),
    );
  }, [activeFamily, instrumentQuery]);

  const createFromTemplate = (templateId: string) => {
    const next = createScore(templateId, false);
    const selection = safeSelection(next);
    cancelPlayback();
    setScore(next);
    setSelectedEventTarget(null);
    setPast([]);
    setFuture([]);
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setChangeMeasureId(next.measureOrder[0]);
    setMetadataDraft(next.metadata);
    setAutoSaveEnabled(true);
    setViewMode("score");
    setNewOpen(false);
    setStatus(`Created ${next.metadata.subtitle}`);
  };

  const openImportedScore = (parsed: ScoreDocument, message: string) => {
    filePickerReturnFocusRef.current = null;
    modalReturnFocusRef.current = null;
    const selection = safeSelection(parsed);
    cancelPlayback();
    setScore(parsed);
    setSelectedEventTarget(null);
    setPast([]);
    setFuture([]);
    setSelectedPartId(selection.partId);
    setSelectedStaffId(selection.staffId);
    setChangeMeasureId(parsed.measureOrder[0]);
    setMetadataDraft(parsed.metadata);
    setAutoSaveEnabled(true);
    setPendingImport(null);
    setStatus(message);
  };

  const importScore = async (file: File | undefined) => {
    const returnFocus = filePickerReturnFocusRef.current;
    filePickerReturnFocusRef.current = null;
    if (!file) {
      return;
    }
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("This score is larger than the 10 MB safety limit.");
      const contents = await file.text();
      const lowerName = file.name.toLowerCase();
      const isXml = lowerName.endsWith(".musicxml") || lowerName.endsWith(".xml") || file.type.includes("xml");
      const imported = isXml ? (await import("../lib/music/importers")).importMusicXML(contents) : null;
      const parsed = imported?.score ?? JSON.parse(contents) as ScoreDocument;
      const errors = validateScore(parsed);
      if (errors.length) throw new Error(errors[0]);
      if (imported?.warnings.length) {
        modalReturnFocusRef.current = returnFocus;
        setPendingImport({ score: parsed, warnings: imported.warnings });
        setStatus(`Review ${imported.warnings.length} MusicXML warning${imported.warnings.length === 1 ? "" : "s"} — current score unchanged`);
        return;
      }
      openImportedScore(parsed, imported ? `Opened ${parsed.metadata.title} from MusicXML` : `Opened ${parsed.metadata.title}`);
    } catch (error) {
      filePickerReturnFocusRef.current = null;
      modalReturnFocusRef.current = null;
      setPendingImport(null);
      setStatus(error instanceof Error ? error.message : "The score file could not be opened.");
    }
  };

  const exportNative = () => {
    downloadBlob(JSON.stringify(score, null, 2), "application/json", `${safeFilename(score.metadata.title)}.garak.json`);
    setExportOpen(false);
    setStatus("Exported a native Garak score");
  };

  const exportMusicXML = () => {
    try {
      downloadBlob(scoreToMusicXML(score), "application/vnd.recordare.musicxml+xml", `${safeFilename(score.metadata.title)}.musicxml`);
      setStatus("Exported MusicXML 4.0");
    } catch (error) { setStatus(error instanceof Error ? error.message : "MusicXML export failed."); }
    setExportOpen(false);
  };

  const exportMidi = () => {
    try {
      const midi = scoreToMidi(score);
      const midiBuffer = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer;
      downloadBlob(midiBuffer, "audio/midi", `${safeFilename(score.metadata.title)}.mid`);
      setStatus("Exported a Standard MIDI File");
    } catch (error) { setStatus(error instanceof Error ? error.message : "MIDI export failed."); }
    setExportOpen(false);
  };

  const applyMetadata = () => {
    if (!metadataDraft.title.trim()) { setStatus("A score title is required"); return; }
    if (JSON.stringify(metadataDraft) === JSON.stringify(score.metadata)) return;
    const next = structuredClone(score);
    next.metadata = metadataDraft;
    next.updatedAt = new Date().toISOString();
    commit(next, "Updated score details");
  };

  const setTempo = (tempo: number) => {
    const safeTempo = Math.max(30, Math.min(300, Math.round(tempo || 96)));
    if (safeTempo === score.tempo) return;
    const next = structuredClone(score);
    next.tempo = safeTempo;
    next.updatedAt = new Date().toISOString();
    commit(next, `Tempo set to ${safeTempo}`);
  };

  const changeMeterFromMeasure = (value: string) => {
    const [numerator, denominator] = value.split("/").map(Number);
    const result = setTimeFromMeasure(score, activeChangeMeasureId, { numerator, denominator });
    if (result.error) {
      setStatus(result.error);
      return;
    }
    if (!result.changed) {
      setStatus(`${measureRangeLabel(score, [activeChangeMeasureId])} already uses ${value}`);
      return;
    }
    commit(result.score, `Time signature ${value} applied to ${measureRangeLabel(score, result.affectedMeasureIds)} · later changes kept`);
  };

  const changeKeyFromMeasure = (value: string) => {
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
    const next = appendMeasure(score);
    const measure = next.measures[next.measureOrder.at(-1)!];
    commit(next, `Added measure ${measure.number}`);
  };

  const removeEmptyMeasure = () => {
    const result = removeLastMeasure(score);
    if (!result.removed) {
      setStatus(result.error);
      return;
    }
    if (result.measureId === activeChangeMeasureId) setChangeMeasureId(result.score.measureOrder.at(-1) ?? "");
    commit(result.score, `Removed empty measure ${result.measureNumber}`);
  };

  return (
    <main className={`studio-shell ${mobileToolsOpen ? "mobile-tools-visible" : ""}`}>
      <header className="app-header">
        <div className="brand" aria-label="Garak Studio"><span className="brand-mark">G</span><span>Garak</span><span className="beta-tag">ALPHA</span></div>
        <a className="bonifacio-return-link" href="https://bonifacio.work/" aria-label="← Bonifacio">
          <span>←</span><span className="bonifacio-return-label">Bonifacio</span>
        </a>
        <button
          ref={projectTitleRef}
          className="project-title"
          onClick={() => {
            if (window.matchMedia("(max-width: 1180px)").matches) {
              setInstrumentsOpen(false);
              setInspectorOpen(true);
            } else document.getElementById("score-title")?.focus();
          }}
          aria-label="Edit score details"
          aria-controls={inspectorDrawerMode ? "score-inspector" : undefined}
          aria-expanded={inspectorDrawerMode ? inspectorOpen : undefined}
        >
          <span className="eyebrow">{viewMode === "score" ? "FULL SCORE" : "LINKED PART"}</span>
          <strong>{score.metadata.title}</strong>
        </button>
        <div key={statusRevision} className={`save-state status-${statusTone(status)}`}><span className="status-dot" aria-hidden="true" />{status}</div>
        <div className="transport">
          <button className="icon-button" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 size={16} /></button>
          <button className="icon-button" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={16} /></button>
          <button className={`play-button ${playing ? "playing" : ""}`} onClick={playScore} aria-label={playing ? "Stop playback" : "Play score"}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
          {playing && playbackPosition ? <span className="playback-position">m. {playbackPosition.measureNumber} · beat {playbackPosition.beat}</span> : null}
        </div>
        <div className="header-actions">
          <button className="icon-button mobile-instruments-button" onClick={() => { setInspectorOpen(false); setInstrumentsOpen(true); }} aria-label="Open instruments" aria-controls="instrument-drawer" aria-expanded={instrumentsOpen}><Music2 size={16} /></button>
          <button className="quiet-button header-new-button" onClick={openNewDialog} aria-label="New score"><Plus size={14} /><span className="action-label">New</span></button>
          <button ref={openFileButtonRef} className="icon-button header-open-button" onClick={() => openFilePicker(openFileButtonRef.current)} aria-label="Open Garak or MusicXML score"><FolderOpen size={16} /></button>
          <button className="icon-button header-save-button" onClick={saveNow} aria-label="Save now"><Save size={16} /></button>
          <button className="icon-button header-help-button" onClick={openHelpDialog} aria-label="Keyboard shortcuts"><Keyboard size={16} /></button>
          <div className="export-anchor">
            <button ref={exportButtonRef} className="primary-button" onClick={() => { setMobileToolsOpen(false); setExportOpen((value) => !value); }} aria-label="File and export menu" aria-expanded={exportOpen}><Download size={14} /><span className="action-label">Export</span><ChevronDown className="export-chevron" size={13} /></button>
            {exportOpen ? (
              <div className="export-menu" role="group" aria-label="File and export options">
                <button className="mobile-file-action" onClick={openNewDialog}><Plus size={16} /><span><strong>New score</strong><small>Start from a template</small></span></button>
                <button className="mobile-file-action" onClick={() => openFilePicker(exportButtonRef.current)}><FolderOpen size={16} /><span><strong>Open score</strong><small>Garak JSON or MusicXML</small></span></button>
                <button className="mobile-file-action" onClick={() => { setExportOpen(false); saveNow(); }}><Save size={16} /><span><strong>Save now</strong><small>Keep a local snapshot</small></span></button>
                <button className="mobile-file-action" onClick={openHelpDialog}><Keyboard size={16} /><span><strong>Help & shortcuts</strong><small>Input reference</small></span></button>
                <button onClick={exportMusicXML}><FileMusic size={16} /><span><strong>MusicXML</strong><small>Open in notation apps</small></span></button>
                <button onClick={exportMidi}><FileDown size={16} /><span><strong>MIDI</strong><small>Performance data</small></span></button>
                <button onClick={exportNative}><FileJson size={16} /><span><strong>Garak JSON</strong><small>Editable native snapshot</small></span></button>
                <button onClick={() => { setExportOpen(false); window.print(); }}><Printer size={16} /><span><strong>Print / PDF</strong><small>Clean score pages</small></span></button>
              </div>
            ) : null}
          </div>
        </div>
        <input ref={fileInputRef} className="visually-hidden" type="file" tabIndex={-1} aria-hidden="true" accept=".json,.garak,.musicxml,.xml,application/vnd.recordare.musicxml+xml,application/xml,text/xml" onChange={(event) => { void importScore(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </header>

      <section ref={notationToolsRef} id="notation-tools" className={`note-toolbar ${mobileToolsOpen ? "mobile-tools-open" : ""}`} aria-label="Notation tools">
        <div className="tool-section mode-section" role="group" aria-label="Input mode">
          <span className="toolbar-label">INPUT</span>
          <button className={`mode-pill ${!chordMode ? "active" : ""}`} onClick={() => {
            setChordMode(false);
            setStatus("Note mode on — A–G enters new notes");
          }} aria-pressed={!chordMode}>Note</button>
          <button
            className={`mode-pill ${chordMode ? "active" : ""}`}
            onClick={() => {
              const next = !chordMode;
              setChordMode(next);
              setStatus(next ? "Chord mode on — A–G adds to the last note" : "Chord mode off — A–G enters new notes");
            }}
            aria-label="Chord mode. Add A through G to the last note event"
            aria-pressed={chordMode}
          >Chord</button>
        </div>
        <div className="pitch-keys" role="group" aria-label="Enter pitch or rest">
          {(["C", "D", "E", "F", "G", "A", "B"] as PitchStep[]).map((step) => {
            const previewAlter = inputAlter(accidentalMode, previewWrittenKey, step);
            const suffix = previewAlter === 0 && accidentalMode === "auto" ? "" : accidentalGlyph(previewAlter);
            const action = canAddChordTone ? "Add to the last note chord" : chordMode ? "Start a chord with" : "Enter";
            return <button key={step} onClick={() => enterEvent(step)} aria-label={`${action} ${step}${suffix}${octave}, ${accidentalMode} accidental mode`}><span>{step}{suffix}{octave}</span><kbd>{step}</kbd></button>;
          })}
          <button className="rest-key" onClick={() => enterEvent("C", true)} aria-label={chordMode ? "Enter a rest; chord mode is ignored for rests" : "Enter a rest"}><span>Rest</span><kbd>R</kbd></button>
        </div>
        <div className="tool-group quick-edit-group" role="group" aria-label="Edit input">
          <button className="edit-tool-button" onClick={undo} disabled={!past.length} aria-label="Undo last edit"><Undo2 size={16} /><span>Undo</span></button>
          <button className="edit-tool-button" onClick={redo} disabled={!future.length} aria-label="Redo edit"><Redo2 size={16} /><span>Redo</span></button>
          <button className="edit-tool-button delete-input-button" onClick={() => removeLatestInput()} disabled={!deletionTargetEvent} aria-label={deleteActionLabel}><Trash2 size={16} /><span>Delete</span></button>
        </div>
        <div className="tool-group note-values">
          {DURATION_CHOICES.map((choice) => (
            <button
              className={`tool-button note-button ${duration === choice.value ? "active" : ""}`}
              key={choice.value}
              onClick={() => {
                setDuration(choice.value);
                setStatus(`${DURATION_LABELS[choice.value]} duration selected`);
              }}
              aria-label={`${DURATION_LABELS[choice.value]} note, shortcut ${choice.shortcut}`}
              aria-pressed={duration === choice.value}
            >
              <DurationIcon value={choice.value} /><kbd>{choice.shortcut}</kbd>
            </button>
          ))}
        </div>
        <div className="tool-group accidental-input-group" role="group" aria-label="Accidental input mode">
          <button className={`mode-pill ${accidentalMode === "auto" ? "active" : ""}`} onClick={() => setAccidentalMode("auto")} aria-label="Automatic accidental from the selected part key signature" aria-pressed={accidentalMode === "auto"}>Auto</button>
          <button className={`tool-button accidental ${accidentalMode === "sharp" ? "active" : ""}`} onClick={() => setAccidentalMode("sharp")} aria-label="Force sharp accidental" aria-pressed={accidentalMode === "sharp"}>♯</button>
          <button className={`tool-button accidental ${accidentalMode === "flat" ? "active" : ""}`} onClick={() => setAccidentalMode("flat")} aria-label="Force flat accidental" aria-pressed={accidentalMode === "flat"}>♭</button>
          <button className={`tool-button accidental ${accidentalMode === "natural" ? "active" : ""}`} onClick={() => setAccidentalMode("natural")} aria-label="Force natural accidental" aria-pressed={accidentalMode === "natural"}>♮</button>
        </div>
        <div className="tool-group rhythm-modifier-group">
          <button
            className={`tool-button dot-tool ${dotCount ? "active" : ""}`}
            onClick={() => {
              const next = nextAugmentationDotCount(dotCount);
              setDotCount(next);
              setStatus(dotSelectionStatus(next));
            }}
            aria-label={dotCycleAriaLabel(dotCount)}
            aria-pressed={dotCount > 0}
          >{dotCount === 2 ? "··" : "·"}<kbd>.</kbd></button>
          <button className="tool-button tie-tool" onClick={toggleTie} aria-label="Tie the last two matching notes">⌒<kbd>T</kbd></button>
        </div>
        <div className="octave-control"><button onClick={() => setOctave(Math.max(0, octave - 1))} aria-label="Lower octave">−</button><span><small>OCTAVE</small>{octave}</span><button onClick={() => setOctave(Math.min(8, octave + 1))} aria-label="Raise octave">＋</button></div>
        <div className="toolbar-spacer" />
        <div className="zoom-control"><button onClick={() => { autoZoomRef.current = false; setZoom(Math.max(75, zoom - 10)); }} aria-label="Zoom out"><Minus size={13} /></button><span>{zoom}%</span><button onClick={() => { autoZoomRef.current = false; setZoom(Math.min(150, zoom + 10)); }} aria-label="Zoom in"><Plus size={13} /></button></div>
      </section>

      <section className="mobile-input-dock" aria-label="Quick notation input">
        <div className="mobile-input-meta">
          <button ref={mobileToolsButtonRef} className="mobile-tools-button" onClick={toggleMobileTools} aria-label={mobileToolsOpen ? "Close notation settings" : "Open notation settings"} aria-controls="notation-tools" aria-expanded={mobileToolsOpen}>
            <span><strong>{inputTargetLabel}</strong><small>{durationName(duration, dotCount)} · Oct {octave} · {chordMode ? "Chord" : "Note"}</small></span>
            <ChevronDown className={mobileToolsOpen ? "open" : ""} size={15} aria-hidden="true" />
          </button>
          <button className="mobile-rest-meta" onClick={() => enterEvent("C", true)} aria-label="Enter a rest">Rest</button>
          <button onClick={undo} disabled={!past.length} aria-label="Undo last edit"><Undo2 size={18} /></button>
          <button onClick={redo} disabled={!future.length} aria-label="Redo edit"><Redo2 size={18} /></button>
          <button className="mobile-delete-button" onClick={() => removeLatestInput()} disabled={!deletionTargetEvent} aria-label={deleteActionLabel}><Trash2 size={18} /></button>
        </div>
        <div className="mobile-pitch-keys" role="group" aria-label="Enter pitch or rest">
          {(["C", "D", "E", "F", "G", "A", "B"] as PitchStep[]).map((step) => {
            const previewAlter = inputAlter(accidentalMode, previewWrittenKey, step);
            const suffix = previewAlter === 0 && accidentalMode === "auto" ? "" : accidentalGlyph(previewAlter);
            const action = canAddChordTone ? "Add to the last note chord" : chordMode ? "Start a chord with" : "Enter";
            return <button key={step} onClick={() => enterEvent(step)} aria-label={`${action} ${step}${suffix}${octave}`}><span>{step}{suffix}</span><small>{octave}</small></button>;
          })}
          <button className="mobile-rest-key" onClick={() => enterEvent("C", true)} aria-label="Enter a rest">Rest</button>
        </div>
      </section>

      <div className="workspace">
        <aside
          id="instrument-drawer"
          ref={instrumentsOpen ? activeDialogRef : undefined}
          tabIndex={instrumentsOpen ? -1 : undefined}
          className={`instrument-panel ${instrumentsOpen ? "drawer-open" : ""}`}
          role={instrumentsOpen ? "dialog" : undefined}
          aria-modal={instrumentsOpen ? "true" : undefined}
          aria-labelledby="instrument-panel-title"
        >
          <div className="panel-heading"><div><span className="eyebrow">{countLabel(score.parts.length, "PART", "PARTS")}</span><h2 id="instrument-panel-title">Instruments</h2></div><span className="panel-heading-actions"><button className="round-button" onClick={() => { setInstrumentsOpen(false); setAddOpen(true); }} aria-label="Add instrument"><Plus size={15} /></button><button className="icon-button drawer-close" onClick={() => setInstrumentsOpen(false)} aria-label="Close instruments"><X size={17} /></button></span></div>
          <div className="instrument-list">
            {score.parts.map((part, index) => (
              <button className={`instrument-row ${part.id === selectedPartId ? "selected" : ""}`} key={part.id} onClick={() => { selectPart(part.id); if (instrumentsOpen) setInstrumentsOpen(false); }} aria-pressed={part.id === selectedPartId}>
                <span className="family-line" style={{ background: part.instrument.color }} />
                <span className="instrument-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="instrument-name"><strong>{part.name}</strong><small>{part.instrument.family}{part.staves.length > 1 ? ` · ${part.staves.length} staves` : ""}{part.instrument.transposition.chromatic || part.instrument.transposition.octaveChange ? " · transposing" : ""}</small></span>
                <span className="mini-mixers"><span className={part.muted ? "on" : ""} title="Muted">M</span><span className={part.solo ? "on" : ""} title="Solo">S</span></span>
              </button>
            ))}
          </div>
          <button className="add-staff-button" onClick={() => { setInstrumentsOpen(false); setAddOpen(true); }}><Plus size={13} /> Add instrument</button>
          <div className="panel-footer"><button className={`view-tab ${viewMode === "score" ? "active" : ""}`} onClick={() => setViewMode("score")} aria-pressed={viewMode === "score"}><Music2 size={14} /> Score</button><button className={`view-tab ${viewMode === "part" ? "active" : ""}`} onClick={() => setViewMode("part")} aria-pressed={viewMode === "part"}><FileMusic size={14} /> Part</button></div>
        </aside>

        <section className="canvas-area" aria-label="Score canvas">
          <div className="canvas-controls">
            <span>{viewMode === "score" ? `${score.parts.length}-part score` : selectedPart?.name}</span><span className="separator">•</span><span>{countLabel(score.measureOrder.length, "measure")}</span><span className="separator">•</span><span>{countLabel(totalEvents, selectedPart && selectedPart.staves.length > 1 ? "staff event" : "event")}</span>
            <span className="tool-section" role="group" aria-label="Measure controls">
              <button className="mode-pill" onClick={addEmptyMeasure} aria-label="Add empty measure"><Plus size={11} aria-hidden="true" /> Measure</button>
              <button className="mode-pill" onClick={removeEmptyMeasure} aria-label="Remove last empty measure"><Trash2 size={11} aria-hidden="true" /> Remove empty measure</button>
            </span>
            {selectedEvent && selectedEventTarget ? <span className="selected-event-summary">Selected · m. {score.measures[selectedEventTarget.measureId].number} · {eventName(selectedEvent)} · {deleteRemovesChordTone ? "Delete removes its last tone" : selectedEvent.kind === "note" ? "Delete clears to rest · rhythm kept" : "Delete removes time"}</span> : null}
            <span className="canvas-hint"><kbd>A–G</kbd> pitch <kbd>R</kbd> rest <kbd>⌫</kbd> delete <kbd>Space</kbd> play</span>
          </div>
          <article className="score-page">
            <div className="score-heading"><p>{score.metadata.subtitle.toUpperCase()}</p><h1>{score.metadata.title}</h1><span>{score.metadata.composer}</span></div>
            <ScoreRenderer
              score={score}
              selectedPartId={selectedPartId}
              selectedStaffId={selectedStaff?.id}
              viewMode={viewMode}
              zoom={zoom}
              playbackSeconds={playing ? playbackSeconds : null}
              entryMeasureId={previewMeasureId}
              entryTick={previewEntryTick}
              selectedEventId={selectedEvent?.id}
              inputFollowRevision={inputFollowRevision}
              onSelectEvent={selectRenderedEvent}
              onSelectPart={selectPart}
              onSelectStaff={selectStaff}
            />
            <span className="page-number">1</span>
          </article>
        </section>

        <aside
          id="score-inspector"
          ref={inspectorOpen ? activeDialogRef : undefined}
          tabIndex={inspectorOpen ? -1 : undefined}
          className={`properties-panel ${inspectorOpen ? "drawer-open" : ""}`}
          role={inspectorOpen ? "dialog" : undefined}
          aria-modal={inspectorOpen ? "true" : undefined}
          aria-labelledby="inspector-title"
        >
          <div className="panel-heading compact"><div><span className="eyebrow">INSPECTOR</span><h2 id="inspector-title">{inspectorEvent ? inspectorUsesSelection ? "Selected event" : "Last event" : "Score setup"}</h2></div><button className="icon-button drawer-close" onClick={() => setInspectorOpen(false)} aria-label="Close score details"><X size={17} /></button></div>
          {selectedPart ? (
            <div className="selection-summary">
              <span className="selection-icon">{inspectorEvent?.kind === "rest" ? "𝄽" : inspectorEvent?.kind === "note" && inspectorEvent.notes.length > 1 ? "♬" : "♪"}</span>
              <span>
                <strong>{inspectorEvent?.kind === "note" ? inspectorEvent.notes.length > 1 ? `Chord · ${inspectorEvent.notes.length} notes` : pitchName(inspectorEvent.notes[0].pitch) : inspectorEvent?.kind === "rest" ? "Rest" : selectedPart.name}</strong>
                <small>{selectedPart.name}{selectedPart.staves.length > 1 ? ` · Staff ${selectedStaffIndex + 1}` : ""} · {durationName(inspectorEvent?.duration.base ?? duration, inspectorEvent?.duration.dots ?? dotCount)}</small>
                {inspectorEvent?.kind === "note" && inspectorEvent.id === lastEvent?.id ? (
                  <button
                    type="button"
                    className="danger-link"
                    onClick={removeChordTone}
                    aria-label="Remove last chord tone"
                    disabled={inspectorEvent.notes.length <= 1}
                  ><Trash2 size={13} aria-hidden="true" /> Remove last chord tone</button>
                ) : null}
              </span>
            </div>
          ) : null}
          <div className="inspector-section">
            <div className="section-title"><span>Event</span></div>
            <label>Dynamic<select
              aria-label={`Dynamic on ${inspectorUsesSelection ? "selected" : "last"} event`}
              value={inspectorEvent?.dynamic ?? "none"}
              disabled={!inspectorEvent}
              onChange={(event) => applyDynamic(event.target.value === "none" ? null : event.target.value as DynamicMarking)}
            >
              <option value="none">None</option>
              {DYNAMIC_MARKINGS.map((dynamic) => <option key={dynamic} value={dynamic}>{dynamic}</option>)}
            </select></label>
            <p className="field-help">{inspectorUsesSelection ? "Applies from the selected event" : "Applies from the latest event"} on this staff until the next dynamic.</p>
            <label>Articulation<select
              aria-label={`Articulation on ${inspectorUsesSelection ? "selected" : "last"} note event`}
              value={inspectorNoteEvent?.articulation ?? "none"}
              disabled={!inspectorNoteEvent}
              onChange={(event) => applyArticulation(event.target.value === "none" ? null : event.target.value as Articulation)}
            >
              <option value="none">None</option>
              {ARTICULATIONS.map((articulation) => <option key={articulation} value={articulation}>{articulation}</option>)}
            </select></label>
            <p className="field-help">{inspectorUsesSelection
              ? selectedEvent?.kind === "rest" ? "Select a note to apply an articulation." : "Applies only to the selected note."
              : "Applies to the latest note on this staff; trailing rests are skipped."}</p>
          </div>
          <div className="inspector-section">
            <div className="section-title"><span>Score</span></div>
            <label>Title<input id="score-title" maxLength={200} value={metadataDraft.title} onChange={(event) => setMetadataDraft({ ...metadataDraft, title: event.target.value })} onBlur={applyMetadata} /></label>
            <label>Composer<input maxLength={200} value={metadataDraft.composer} onChange={(event) => setMetadataDraft({ ...metadataDraft, composer: event.target.value })} onBlur={applyMetadata} /></label>
            <label>Tempo<span className="input-suffix"><input type="number" min="30" max="300" step="1" defaultValue={score.tempo} key={score.tempo} onBlur={(event) => setTempo(Number(event.target.value))} /><small>BPM</small></span></label>
            <label>Change from<select aria-label="Change key and meter from measure" aria-describedby="measure-change-scope" value={activeChangeMeasureId} onChange={(event) => {
              setChangeMeasureId(event.target.value);
              setStatus(`Key and meter controls now target measure ${score.measures[event.target.value].number}`);
            }}>
              {score.measureOrder.map((measureId) => <option data-measure-change-option key={measureId} value={measureId}>Measure {score.measures[measureId].number}</option>)}
            </select></label>
            <p id="measure-change-scope" style={{ fontSize: 8, lineHeight: 1.45, color: "#777168", margin: "4px 0 7px" }}>Applies from the selected measure until the next existing change.</p>
            <label>Meter from here<select aria-label="Time signature from selected measure" value={changeMeterValue} onChange={(event) => changeMeterFromMeasure(event.target.value)}>
              {!changeMeterIsPreset ? <option value={changeMeterValue}>{changeMeterValue} · imported/custom</option> : null}
              {METER_PRESETS.map((meter) => <option key={meter} value={meter}>{meter}</option>)}
            </select></label>
            <label>Concert key from here<select aria-label="Concert key signature" value={keyValue(selectedConcertKey)} onChange={(event) => changeKeyFromMeasure(event.target.value)}>
              {(["major", "minor"] as const).map((mode) => <optgroup key={mode} label={mode === "major" ? "Major keys" : "Minor keys"}>
                {KEY_SIGNATURES.filter((key) => key.mode === mode).map((key) => <option data-key-signature-option key={keyValue(key)} value={keyValue(key)}>{key.label}</option>)}
              </optgroup>)}
            </select></label>
          </div>
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
              <div className="mixer-buttons"><button className={selectedPart.muted ? "active" : ""} onClick={() => commit(updatePart(score, selectedPart.id, { muted: !selectedPart.muted }), selectedPart.muted ? "Unmuted part" : "Muted part")} aria-pressed={selectedPart.muted}><Volume2 size={13} /> Mute</button><button className={selectedPart.solo ? "active" : ""} onClick={() => commit(updatePart(score, selectedPart.id, { solo: !selectedPart.solo }), selectedPart.solo ? "Unsoloed part" : "Soloed part")} aria-pressed={selectedPart.solo}>S Solo</button></div>
              <button className="danger-link" onClick={() => { const next = removeInstrument(score, selectedPart.id); const selection = safeSelection(next); setSelectedEventTarget(null); setSelectedPartId(selection.partId); setSelectedStaffId(selection.staffId); commit(next, `Removed ${selectedPart.name}`); }} disabled={score.parts.length <= 1}><Trash2 size={13} /> Remove part</button>
            </div>
          ) : null}
          <div className="shortcut-card"><span>QUICK INPUT</span><p><kbd>1–7</kbd> duration <kbd>.</kbd> 0–2 dots</p><p><kbd>A–G</kbd> pitch <kbd>R</kbd> rest</p><p><kbd>← →</kbd> select event <kbd>⌫</kbd> delete</p><p><kbd>↑ ↓</kbd> octave <kbd>Space</kbd> play</p><button onClick={openHelpDialog}>View all shortcuts <ChevronDown size={12} /></button></div>
        </aside>
      </div>

      {inspectorOpen || instrumentsOpen ? <div className="drawer-scrim" role="presentation" onMouseDown={() => { setInspectorOpen(false); setInstrumentsOpen(false); }} /> : null}

      {newOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewOpen(false); }}>
          <section ref={activeDialogRef} tabIndex={-1} className="modal template-modal" role="dialog" aria-modal="true" aria-labelledby="new-score-title"><header><div><span className="eyebrow">START A SCORE</span><h2 id="new-score-title">Choose an ensemble</h2><p>You can add and remove instruments after creating the score.</p></div><button className="icon-button" onClick={() => setNewOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="template-grid">{SCORE_TEMPLATES.map((template, index) => <button key={template.id} onClick={() => createFromTemplate(template.id)}><span className="template-number">0{index + 1}</span><Music2 size={22} /><strong>{template.name}</strong><small>{template.description}</small><em>{template.instruments.length} {template.instruments.length === 1 ? "part" : "parts"}</em></button>)}</div>
          </section>
        </div>
      ) : null}

      {addOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <section ref={activeDialogRef} tabIndex={-1} className="modal instrument-modal" role="dialog" aria-modal="true" aria-labelledby="add-instrument-title"><header><div><span className="eyebrow">ORCHESTRA LIBRARY</span><h2 id="add-instrument-title">Add an instrument</h2><p>{INSTRUMENTS.length} standard orchestral, keyboard, and vocal definitions.</p></div><button className="icon-button" onClick={() => setAddOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="instrument-search"><Search size={16} /><input value={instrumentQuery} onChange={(event) => setInstrumentQuery(event.target.value)} placeholder="Search flute, B♭ clarinet, violin…" aria-label="Search instruments" /></div>
            <div className="family-tabs" role="group" aria-label="Instrument family filter">{["All", "Woodwinds", "Brass", "Percussion", "Keyboards", "Voices", "Strings"].map((family) => <button key={family} className={activeFamily === family ? "active" : ""} onClick={() => setActiveFamily(family)} aria-pressed={activeFamily === family}>{family}</button>)}</div>
            <div className="catalog-list">{filteredInstruments.map((instrument) => <button key={instrument.catalogId} onClick={() => { const next = addInstrument(score, instrument.catalogId); const selection = safeSelection(next, next.parts.at(-1)?.id); commit(next, `Added ${instrument.name}`); setSelectedEventTarget(null); setSelectedPartId(selection.partId); setSelectedStaffId(selection.staffId); setAddOpen(false); }}><span className="catalog-color" style={{ background: instrument.color }} /><span><strong>{instrument.name}</strong><small>{instrument.family} · {instrument.staffClefs?.join(" + ") ?? instrument.clef} {instrument.staffClefs ? "staves" : "clef"}{instrument.transposition.chromatic || instrument.transposition.octaveChange ? ` · ${instrument.transposition.chromatic + instrument.transposition.octaveChange * 12} semitones` : ""}</small></span><Plus size={15} /></button>)}</div>
          </section>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <section ref={activeDialogRef} tabIndex={-1} className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><header><div><span className="eyebrow">KEYBOARD FIRST</span><h2 id="shortcut-title">Compose without leaving the score</h2><p>Shortcuts are ignored while you type in a text field.</p></div><button className="icon-button" onClick={() => setHelpOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="shortcut-grid"><div><span>Notes</span><p><kbd>A–G</kbd> Enter written pitch</p><p><strong>Chord</strong> Add pitches to the last note</p><p><kbd>R</kbd> Enter a rest</p><p><kbd>T</kbd> Tie matching notes</p><p><kbd>←</kbd><kbd>→</kbd> Select events while the score is focused</p><p><kbd>↑</kbd><kbd>↓</kbd> Change octave; on the score, select a staff</p><p><kbd>⌫</kbd> Clear a selected note to a rest; delete a selected rest or the previous input</p><p><kbd>⇧ ⌫</kbd> Remove selected rhythmic time and shift later events earlier</p><p><strong>Chord</strong> Delete removes the latest chord tone first</p></div><div><span>Rhythm</span><p><kbd>1–7</kbd> Whole → sixty-fourth</p><p><kbd>.</kbd> Cycle 0 → 1 → 2 dots</p></div><div><span>Project</span><p><kbd>⌘ Z</kbd> Undo</p><p><kbd>⌘ ⇧ Z</kbd> Redo</p><p><kbd>⌘ S</kbd> Save locally</p><p><kbd>⌘ P</kbd> Print / PDF</p></div><div><span>Playback</span><p><kbd>Space</kbd> Play / stop</p><p><kbd>?</kbd> This guide</p></div></div>
            <footer><CircleHelp size={15} /><span>This alpha supports one voice per staff. Tuplets, multi-voice editing, and linked-part layout follow in the roadmap.</span></footer>
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
      <div className="sr-status" aria-live="polite" aria-atomic="true"><span key={statusRevision}>{status}</span></div>
    </main>
  );
}
