"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Beam as VexBeam, Stave as VexStave, StaveNote, Voice as VexVoice } from "vexflow";
import { keySignaturesEqual, resolveMeasureAccidentals, timeSignaturesEqual } from "../lib/music/engraving";
import { LIVE_ENGRAVING_LIMITS, planLiveEngraving } from "../lib/music/engraving-budget";
import { waitForEngravingFonts } from "../lib/music/engraving-fonts";
import { type MeasureTickLayout, snappedTickForMeasureX, xForMeasureTick } from "../lib/music/engraving-position";
import { fifthsToVexFlowKey, writtenKeyForPart } from "../lib/music/key-signatures";
import { getDefaultBeamGroups, getFullMeasureDuration } from "../lib/music/meter";
import type { Clef, MusicEvent, PartData, Pitch, PitchStep, ScoreDocument, StaffData, VoiceData } from "../lib/music/model";
import { DURATION_LABELS, TICKS_PER_QUARTER, durationTicks, measureCapacity, pitchName } from "../lib/music/model";
import { diatonicPitchIndex, finishesScoreNoteDrag, finishesScorePointerTap, hasSystemShortcutModifier, pitchFromStaffPointer, startScoreNoteDrag, startScorePointerTap, trackScoreNoteDrag, trackScorePointerTap } from "../lib/music/note-input";
import type { NoteEntryMethod, ScoreNoteDrag, ScorePointerTap } from "../lib/music/note-input";
import { timedHairpins } from "../lib/music/hairpins";
import { locatePlaybackPosition } from "../lib/music/playback-position";

export interface ScoreEventSelection {
  partId: string;
  staffId: string;
  measureId: string;
  eventId: string;
  noteId?: string;
}

export interface ScoreNotePitchIntent extends ScoreEventSelection {
  noteId: string;
  pitch: Pitch;
}

export interface ScoreEventMoveIntent extends ScoreEventSelection {
  targetMeasureId: string;
  targetTick: number;
}

export interface ScoreRangeDestination {
  partId: string;
  staffId: string;
  measureId: string;
  tick: number;
}

export type ScorePointerNoteIntent =
  | {
      kind: "pitch";
      partId: string;
      staffId: string;
      measureId: string;
      step: PitchStep;
      octave: number;
      addToChord: boolean;
    }
  | {
      kind: "unsupported";
      partId: string;
      staffId: string;
      measureId: string;
      clef: Clef;
    };

interface ScoreRendererProps {
  score: ScoreDocument;
  selectedPartId: string;
  viewMode: "score" | "part";
  zoom: number;
  onSelectPart: (partId: string) => void;
  selectedStaffId?: string;
  onSelectStaff?: (staffId: string) => void;
  playbackSeconds?: number | null;
  playbackPaused?: boolean;
  playbackFollowEnabled?: boolean;
  playbackFollowRevision?: number;
  onPlaybackSeek?: (measureId: string, tick: number) => void;
  entryMeasureId?: string | null;
  entryTick?: number;
  selectedEventId?: string | null;
  selectedNoteId?: string | null;
  selectedEventIds?: readonly string[];
  rangeSelectionMode?: boolean;
  rangeDestinationMode?: "move" | "copy" | null;
  onRangeEventSelect?: (selection: ScoreEventSelection, extend: boolean) => void;
  onRangeDestination?: (intent: ScoreRangeDestination) => void;
  inputFollowRevision?: number;
  onSelectEvent?: (selection: ScoreEventSelection | null) => void;
  noteEntryMethod?: NoteEntryMethod;
  chordMode?: boolean;
  pointerDurationTicks?: number;
  pointerDurationLabel?: string;
  onShiftInputPitch?: (delta: -1 | 1) => void;
  onPointerNoteIntent?: (intent: ScorePointerNoteIntent) => void;
  onNotePitchChange?: (intent: ScoreNotePitchIntent) => void;
  onEventMove?: (intent: ScoreEventMoveIntent) => void;
}

interface SystemLayout {
  measureIds: string[];
  widths: number[];
}

interface RenderRow {
  rowIndex: number;
  partIndex: number;
  staffIndex: number;
  part: PartData;
  staff: StaffData;
}

interface PartRowGroup {
  partIndex: number;
  part: PartData;
  firstRowIndex: number;
  lastRowIndex: number;
}

interface MeasureScreenLayout extends MeasureTickLayout {
  measureId: string;
  systemIndex: number;
  top: number;
  height: number;
}

interface EventScreenLayout extends ScoreEventSelection {
  tick: number;
  systemIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NoteheadScreenLayout extends EventScreenLayout {
  noteId: string;
  pitch: Pitch;
  tick: number;
  centerY: number;
  lineSpacing: number;
  draggable: boolean;
  tied: boolean;
}

interface NoteDragGesture {
  drag: ScoreNoteDrag;
  layout: NoteheadScreenLayout;
  source: EngravingSource;
  target: HTMLButtonElement;
  sourceTick: number;
  grabOffsetX: number;
  grabOffsetY: number;
  sourceStaffCenterY: number;
}

type NoteDragPreview = { source: EngravingSource; layout: NoteheadScreenLayout } & (
  | { kind: "pitch"; pitch: Pitch; activated: boolean }
  | { kind: "time"; x: number; y: number; destination: { measureId: string; tick: number } | null; label: string }
);

interface StaffMeasureHitLayout {
  partId: string;
  staffId: string;
  measureId: string;
  systemIndex: number;
  startX: number;
  endX: number;
  topLineY: number;
  bottomLineY: number;
  lineSpacing: number;
  clef: Clef;
}

interface RangeDestinationPreview {
  source: EngravingSource;
  destination: ScoreRangeDestination | null;
  x: number;
  y: number;
  label: string;
}

interface EngravingSource {
  score: ScoreDocument;
  rows: readonly RenderRow[];
  renderWidth: number;
}

interface EngravingState {
  source: EngravingSource | null;
  measureLayouts: MeasureScreenLayout[];
  eventLayouts: EventScreenLayout[];
  noteheadLayouts: NoteheadScreenLayout[];
  staffHitLayouts: StaffMeasureHitLayout[];
  error: string;
}

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectedEventDetails {
  event: MusicEvent;
  measureId: string;
  part: PartData;
  staffIndex: number;
}

interface PointerNotePreviewVariant {
  x: number;
  label: string;
  unsupported: boolean;
}

interface PointerNotePreview {
  context: EngravingState;
  score: ScoreDocument;
  selectedEventId: string | null;
  chordMode: boolean;
  durationTicks: number;
  durationLabel: string;
  y: number;
  normal: PointerNotePreviewVariant;
  chord: PointerNotePreviewVariant;
}

const ROW_HEIGHT = 86;
const SYSTEM_GAP = 42;
const LABEL_WIDTH = 88;
const RIGHT_MARGIN = 14;
const TOP_PADDING = 32;
const FOLLOW_MARGIN = 12;
const EMPTY_MEASURE_LAYOUTS: readonly MeasureScreenLayout[] = [];
const EMPTY_EVENT_LAYOUTS: readonly EventScreenLayout[] = [];
const EMPTY_NOTEHEAD_LAYOUTS: readonly NoteheadScreenLayout[] = [];
const EMPTY_STAFF_HIT_LAYOUTS: readonly StaffMeasureHitLayout[] = [];
const LIVE_LIMIT_LABELS: Record<keyof typeof LIVE_ENGRAVING_LIMITS, string> = {
  measures: "measures",
  rows: "staff rows",
  staffMeasureCells: "staff-by-measure cells",
  events: "events",
  notes: "notes",
  ties: "ties",
};

function pointToRectDistance(x: number, y: number, rect: ScreenRect): number {
  const dx = x < rect.x ? rect.x - x : x > rect.x + rect.width ? x - rect.x - rect.width : 0;
  const dy = y < rect.y ? rect.y - y : y > rect.y + rect.height ? y - rect.y - rect.height : 0;
  return Math.hypot(dx, dy);
}

function pointToRectCenterDistance(x: number, y: number, rect: ScreenRect): number {
  return Math.hypot(x - (rect.x + rect.width / 2), y - (rect.y + rect.height / 2));
}

function scrollScreenRectIntoView(frame: HTMLDivElement | null, rect: ScreenRect, scale: number): void {
  if (!frame) return;

  const targetLeft = rect.x * scale;
  const targetRight = (rect.x + rect.width) * scale;
  const viewportLeft = frame.scrollLeft;
  const viewportRight = viewportLeft + frame.clientWidth;
  let nextScrollLeft = viewportLeft;
  const targetCoversHorizontalViewport = targetLeft <= viewportLeft && targetRight >= viewportRight;
  if (!targetCoversHorizontalViewport) {
    if (targetLeft < viewportLeft) nextScrollLeft = Math.max(0, targetLeft - FOLLOW_MARGIN);
    else if (targetRight > viewportRight) nextScrollLeft = Math.min(
      Math.max(0, frame.scrollWidth - frame.clientWidth),
      targetRight + FOLLOW_MARGIN - frame.clientWidth,
    );
  }
  if (Math.abs(nextScrollLeft - viewportLeft) >= 1) {
    frame.scrollTo({ left: nextScrollLeft, behavior: "auto" });
  }

  const canvas = frame.closest<HTMLElement>(".canvas-area");
  if (!canvas) return;
  const frameBounds = frame.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  const rangeBar = canvas.querySelector<HTMLElement>(":scope > .range-selection-bar");
  // The range controls stay above the score while it scrolls; keyboard selection
  // must reveal notation below those controls instead of behind them.
  const visibleTop = Math.max(canvasBounds.top, rangeBar?.getBoundingClientRect().bottom ?? canvasBounds.top);
  const targetTop = frameBounds.top + rect.y * scale;
  const targetBottom = frameBounds.top + (rect.y + rect.height) * scale;
  let verticalDelta = 0;
  const targetCoversVerticalViewport = targetTop <= visibleTop && targetBottom >= canvasBounds.bottom;
  if (!targetCoversVerticalViewport) {
    if (targetTop < visibleTop) verticalDelta = targetTop - visibleTop - FOLLOW_MARGIN;
    else if (targetBottom > canvasBounds.bottom) verticalDelta = targetBottom - canvasBounds.bottom + FOLLOW_MARGIN;
  }
  if (Math.abs(verticalDelta) >= 1) {
    canvas.scrollTo({ top: Math.max(0, canvas.scrollTop + verticalDelta), behavior: "auto" });
  }
}

function scrollStaffRowIntoView(
  frame: HTMLDivElement | null,
  rowIndex: number,
  systemCount: number,
  systemHeight: number,
  rowHeight: number,
  engravingWidth: number,
  scale: number,
): void {
  if (!frame || systemCount <= 0) return;
  const canvas = frame.closest<HTMLElement>(".canvas-area");
  if (!canvas) return;
  const frameBounds = frame.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  const viewportCenter = (canvasBounds.top + canvasBounds.bottom) / 2;
  const nearestRow = Array.from({ length: systemCount }, (_, systemIndex): ScreenRect => ({
    x: 0,
    y: TOP_PADDING + systemIndex * systemHeight + rowIndex * rowHeight,
    width: engravingWidth,
    height: rowHeight,
  })).map((rect) => {
    const top = frameBounds.top + rect.y * scale;
    const bottom = frameBounds.top + (rect.y + rect.height) * scale;
    const viewportDistance = bottom < canvasBounds.top
      ? canvasBounds.top - bottom
      : top > canvasBounds.bottom
        ? top - canvasBounds.bottom
        : 0;
    return { rect, viewportDistance, centerDistance: Math.abs((top + bottom) / 2 - viewportCenter) };
  }).sort((left, right) => left.viewportDistance - right.viewportDistance || left.centerDistance - right.centerDistance)[0]?.rect;
  if (nearestRow) scrollScreenRectIntoView(frame, nearestRow, scale);
}

const VEXFLOW_ARTICULATION_CODES = {
  staccato: "a.",
  tenuto: "a-",
  accent: "a>",
  marcato: "a^",
} as const;

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function accessibleDurationLabel(event: MusicEvent): string {
  const dotPrefix = event.duration.dots === 1
    ? "dotted "
    : event.duration.dots === 2
      ? "double-dotted "
      : "";
  return `${dotPrefix}${DURATION_LABELS[event.duration.base].toLowerCase()}`;
}

function accessibleEventLabel(event: MusicEvent): string {
  const duration = accessibleDurationLabel(event);
  if (event.kind === "rest") return `${duration} rest`;
  const pitches = event.notes.map((note) => pitchName(note.pitch));
  if (pitches.length === 1) return `${pitches[0]} ${duration} note`;
  return `${duration} chord with ${pitches.join(", ")}, ${countLabel(pitches.length, "note")}`;
}

function findSelectedEventDetails(score: ScoreDocument, selectedEventId?: string | null): SelectedEventDetails | null {
  if (!selectedEventId) return null;
  for (const part of score.parts) {
    for (const [staffIndex, staff] of part.staves.entries()) {
      for (const measureId of score.measureOrder) {
        const event = staff.measures[measureId]?.voices[0]?.events.find((candidate) => candidate.id === selectedEventId);
        if (event) return { event, measureId, part, staffIndex };
      }
    }
  }
  return null;
}

function vexKey(event: MusicEvent, clef: string): string[] {
  if (event.kind === "rest") return [clef === "bass" ? "d/3" : clef === "alto" || clef === "tenor" ? "c/4" : "b/4"];
  return event.notes.map((note) => {
    const accidental = note.pitch.alter === -2 ? "bb" : note.pitch.alter === -1 ? "b" : note.pitch.alter === 1 ? "#" : note.pitch.alter === 2 ? "##" : "";
    return `${note.pitch.step.toLowerCase()}${accidental}/${note.pitch.octave}`;
  });
}

function vexDuration(event: MusicEvent): string {
  const base = event.duration.base === 1 ? "w" : event.duration.base === 2 ? "h" : event.duration.base === 4 ? "q" : String(event.duration.base);
  return `${base}${"d".repeat(event.duration.dots)}${event.kind === "rest" ? "r" : ""}`;
}

function buildRenderRows(parts: readonly PartData[]): { rows: RenderRow[]; partGroups: PartRowGroup[] } {
  const rows: RenderRow[] = [];
  const partGroups: PartRowGroup[] = [];
  parts.forEach((part, partIndex) => {
    const firstRowIndex = rows.length;
    part.staves.forEach((staff, staffIndex) => rows.push({ rowIndex: rows.length, partIndex, staffIndex, part, staff }));
    if (rows.length > firstRowIndex) {
      partGroups.push({ partIndex, part, firstRowIndex, lastRowIndex: rows.length - 1 });
    }
  });
  return { rows, partGroups };
}

function getStaffVoice(row: RenderRow, measureId: string): VoiceData {
  return row.staff.measures[measureId]?.voices[0] ?? {
    id: `${row.part.id}-${row.staff.id}-${measureId}-v1`,
    events: [],
  };
}

function measureMusicWidth(rows: readonly RenderRow[], measureId: string): number {
  const widths = rows.map((row) => {
    const events = getStaffVoice(row, measureId).events;
    let width = 92 + events.length * 18;
    for (const event of events) {
      width += event.duration.dots * 8;
      if (event.dynamic) width += 10;
      if (event.kind === "note" && event.articulation) width += 10;
      if (event.kind === "note") {
        width += Math.max(0, event.notes.length - 1) * 9;
        width += event.notes.filter((note) => note.pitch.alter !== 0).length * 7;
      }
    }
    return width;
  });
  // A legal 4/4 measure can contain 64 sixty-fourth notes. Capping this width
  // made VexFlow spill dense notes through the right barline and into the next
  // measure, so an intrinsically wide measure now owns horizontal scroll.
  return Math.max(104, ...(widths.length ? widths : [104]));
}

function modifierWidth(score: ScoreDocument, rows: readonly RenderRow[], measureId: string, absoluteIndex: number, systemStart: boolean): number {
  const measure = score.measures[measureId];
  const previous = absoluteIndex > 0 ? score.measures[score.measureOrder[absoluteIndex - 1]] : null;
  const maxFifths = Math.max(0, ...rows.filter((row) => row.staff.clef !== "percussion").map((row) => Math.abs(writtenKeyForPart(measure.key, row.part).fifths)));
  const keyChanged = previous && rows.some((row) => !keySignaturesEqual(writtenKeyForPart(previous.key, row.part), writtenKeyForPart(measure.key, row.part)));
  const timeChanged = !previous || !timeSignaturesEqual(previous.time, measure.time);
  let width = 0;
  if (systemStart) width += 54 + maxFifths * 8;
  else if (keyChanged) width += 26 + maxFifths * 8;
  if (timeChanged) width += 38;
  return width;
}

function buildSystems(score: ScoreDocument, rows: readonly RenderRow[], renderWidth: number): SystemLayout[] {
  const usableWidth = Math.max(360, renderWidth - LABEL_WIDTH - RIGHT_MARGIN);
  const systems: Array<{ measureIds: string[]; minimums: number[] }> = [];
  let current: { measureIds: string[]; minimums: number[] } = { measureIds: [], minimums: [] };

  for (const [absoluteIndex, measureId] of score.measureOrder.entries()) {
    let minimum = measureMusicWidth(rows, measureId) + modifierWidth(score, rows, measureId, absoluteIndex, current.measureIds.length === 0);
    const used = current.minimums.reduce((sum, value) => sum + value, 0);
    if (current.measureIds.length && used + minimum > usableWidth) {
      systems.push(current);
      current = { measureIds: [], minimums: [] };
      minimum = measureMusicWidth(rows, measureId) + modifierWidth(score, rows, measureId, absoluteIndex, true);
    }
    current.measureIds.push(measureId);
    current.minimums.push(Math.max(96, minimum));
  }
  if (current.measureIds.length) systems.push(current);

  return systems.map((system, index) => {
    const minimumTotal = system.minimums.reduce((sum, value) => sum + value, 0);
    const availableExtra = Math.max(0, usableWidth - minimumTotal);
    const isLast = index === systems.length - 1;
    const distributedExtra = isLast ? Math.min(availableExtra, system.measureIds.length * 76) : availableExtra;
    const widths = system.minimums.map((minimum) => minimum + distributedExtra * (minimum / minimumTotal));
    return { measureIds: system.measureIds, widths };
  });
}

export function ScoreRenderer({
  score,
  selectedPartId,
  viewMode,
  zoom,
  onSelectPart,
  selectedStaffId,
  onSelectStaff,
  playbackSeconds = null,
  playbackPaused = false,
  playbackFollowEnabled = true,
  playbackFollowRevision = 0,
  entryMeasureId = null,
  entryTick = 0,
  selectedEventId = null,
  selectedNoteId = null,
  selectedEventIds = [],
  rangeSelectionMode = false,
  rangeDestinationMode = null,
  onRangeEventSelect,
  onRangeDestination,
  inputFollowRevision = 0,
  onSelectEvent,
  onPlaybackSeek,
  noteEntryMethod = "duration-letter",
  chordMode = false,
  pointerDurationTicks = 0,
  pointerDurationLabel = "Selected duration",
  onShiftInputPitch,
  onPointerNoteIntent,
  onNotePitchChange,
  onEventMove,
}: ScoreRendererProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const forceFollowRef = useRef(false);
  const autoScrollRef = useRef({ left: 0, top: 0 });
  const [followHold, setFollowHold] = useState({ revision: -1, held: false });
  const followHeld = followHold.held && followHold.revision === playbackFollowRevision;
  const playbackActive = playbackSeconds !== null;
  const completedInputFollowRef = useRef(inputFollowRevision);
  const engravingRequestRef = useRef(0);
  const pointerTapRef = useRef<{ tap: ScorePointerTap; source: EngravingSource; method: NoteEntryMethod; interaction: string; notehead?: NoteheadScreenLayout; extend: boolean } | null>(null);
  const noteDragRef = useRef<NoteDragGesture | null>(null);
  const [physicalWidth, setPhysicalWidth] = useState(640);
  const [engravingState, setEngravingState] = useState<EngravingState>({
    source: null,
    measureLayouts: [],
    eventLayouts: [],
    noteheadLayouts: [],
    staffHitLayouts: [],
    error: "",
  });
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [pointerNotePreview, setPointerNotePreview] = useState<PointerNotePreview | null>(null);
  const [pointerShiftPressed, setPointerShiftPressed] = useState(false);
  const [rangeDestinationPreview, setRangeDestinationPreview] = useState<RangeDestinationPreview | null>(null);
  const [noteDragPreview, setNoteDragPreview] = useState<NoteDragPreview | null>(null);
  const engravingPlan = useMemo(
    () => planLiveEngraving(score, viewMode, selectedPartId),
    [score, selectedPartId, viewMode],
  );
  const parts = engravingPlan.parts;
  const { rows, partGroups } = useMemo(() => buildRenderRows(parts), [parts]);
  const scale = Math.max(.55, Math.min(1.5, zoom / 100));
  const renderWidth = Math.max(480, Math.floor(physicalWidth / scale));
  const interactiveRenderBlocked = engravingPlan.kind === "blocked";
  const systems = useMemo(
    () => interactiveRenderBlocked ? [] : buildSystems(score, rows, renderWidth),
    [interactiveRenderBlocked, renderWidth, rows, score],
  );
  const engravingWidth = Math.max(
    renderWidth,
    ...systems.map((system) => LABEL_WIDTH + RIGHT_MARGIN + system.widths.reduce((sum, width) => sum + width, 0)),
  );
  const rowHeight = score.hairpins?.length ? 124 : ROW_HEIGHT;
  const systemHeight = rows.length * rowHeight + SYSTEM_GAP;
  const renderHeight = interactiveRenderBlocked ? 230 : Math.max(230, systems.length * systemHeight + TOP_PADDING + 4);
  const engravingSource = useMemo<EngravingSource>(
    () => ({ score, rows, renderWidth }),
    [renderWidth, rows, score],
  );
  const layoutsAreCurrent = engravingState.source === engravingSource;
  const measureLayouts = layoutsAreCurrent ? engravingState.measureLayouts : EMPTY_MEASURE_LAYOUTS;
  const eventLayouts = layoutsAreCurrent ? engravingState.eventLayouts : EMPTY_EVENT_LAYOUTS;
  const noteheadLayouts = layoutsAreCurrent ? engravingState.noteheadLayouts : EMPTY_NOTEHEAD_LAYOUTS;
  const staffHitLayouts = layoutsAreCurrent ? engravingState.staffHitLayouts : EMPTY_STAFF_HIT_LAYOUTS;
  const renderError = layoutsAreCurrent ? engravingState.error : "";
  const rangeEventIds = new Set(selectedEventIds);
  const rangeInteraction = rangeSelectionMode || selectedEventIds.length > 0 || Boolean(rangeDestinationMode);
  const pointerInteraction = `${Boolean(onPlaybackSeek)}:${rangeSelectionMode}:${selectedEventIds.length > 0}:${rangeDestinationMode ?? ""}`;
  const selectedEventDetails = useMemo(
    () => findSelectedEventDetails(score, selectedEventId),
    [score, selectedEventId],
  );

  const cancelNoteDrag = useCallback(() => {
    const gesture = noteDragRef.current;
    noteDragRef.current = null;
    setNoteDragPreview(null);
    if (gesture?.target.hasPointerCapture(gesture.drag.start.pointerId)) {
      gesture.target.releasePointerCapture(gesture.drag.start.pointerId);
    }
  }, []);

  useEffect(() => {
    const handleShiftKey = (event: KeyboardEvent) => {
      if (event.key === "Shift") setPointerShiftPressed(event.type === "keydown");
      if (event.key === "Escape") {
        pointerTapRef.current = null;
        setPointerNotePreview(null);
        setRangeDestinationPreview(null);
      }
      if (event.key === "Escape" && noteDragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        cancelNoteDrag();
      }
    };
    const handleWindowBlur = () => {
      setPointerShiftPressed(false);
      pointerTapRef.current = null;
      setPointerNotePreview(null);
      setRangeDestinationPreview(null);
      cancelNoteDrag();
    };
    window.addEventListener("keydown", handleShiftKey, true);
    window.addEventListener("keyup", handleShiftKey);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleShiftKey, true);
      window.removeEventListener("keyup", handleShiftKey);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [cancelNoteDrag]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let initialized = false;
    let resizeTimer: number | null = null;
    let pendingWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      pendingWidth = Math.max(240, Math.floor(entry.contentRect.width));
      if (!initialized) {
        initialized = true;
        setPhysicalWidth(pendingWidth);
        return;
      }
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        setPhysicalWidth(pendingWidth);
      }, 120);
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = frame?.closest<HTMLElement>(".canvas-area") ?? null;
    const clearPointerPreview = () => {
      pointerTapRef.current = null;
      setPointerNotePreview(null);
      setRangeDestinationPreview(null);
      cancelNoteDrag();
    };
    const cancelAdditionalPointer = (event: PointerEvent) => {
      const noteGesture = noteDragRef.current;
      if (noteGesture && event.pointerId !== noteGesture.drag.start.pointerId) cancelNoteDrag();
      const gesture = pointerTapRef.current;
      if (gesture && event.pointerId !== gesture.tap.start.pointerId) {
        gesture.tap = { ...gesture.tap, cancelled: true };
        setPointerNotePreview(null);
        setRangeDestinationPreview(null);
      }
    };
    frame?.addEventListener("scroll", clearPointerPreview, { passive: true });
    canvas?.addEventListener("scroll", clearPointerPreview, { passive: true });
    window.addEventListener("scroll", clearPointerPreview, { passive: true });
    window.addEventListener("resize", clearPointerPreview, { passive: true });
    document.addEventListener("pointerdown", cancelAdditionalPointer, true);
    return () => {
      frame?.removeEventListener("scroll", clearPointerPreview);
      canvas?.removeEventListener("scroll", clearPointerPreview);
      window.removeEventListener("scroll", clearPointerPreview);
      window.removeEventListener("resize", clearPointerPreview);
      document.removeEventListener("pointerdown", cancelAdditionalPointer, true);
    };
  }, [cancelNoteDrag]);

  useEffect(() => {
    let disposed = false;
    const requestId = ++engravingRequestRef.current;
    async function draw() {
      const host = hostRef.current;
      if (!host) return;
      host.replaceChildren();
      if (interactiveRenderBlocked) {
        if (!disposed && requestId === engravingRequestRef.current && hostRef.current === host) {
          setEngravingState({ source: engravingSource, measureLayouts: [], eventLayouts: [], noteheadLayouts: [], staffHitLayouts: [], error: "" });
        }
        return;
      }
      if (!rows.length) {
        if (!disposed && requestId === engravingRequestRef.current && hostRef.current === host) {
          setEngravingState({ source: engravingSource, measureLayouts: [], eventLayouts: [], noteheadLayouts: [], staffHitLayouts: [], error: "" });
        }
        return;
      }
      try {
        const vexflow = await import("vexflow/bravura");
        await waitForEngravingFonts(document.fonts);
        if (disposed || requestId !== engravingRequestRef.current || hostRef.current !== host) return;
        const { Accidental, Articulation, Beam, Dot, Formatter, Fraction, GhostNote, ModifierPosition, Renderer, Stave, StaveConnector, StaveNote, StaveTie, TextDynamics, Voice } = vexflow;
        const renderer = new Renderer(host, Renderer.Backends.SVG);
        renderer.resize(engravingWidth, renderHeight);
        const context = renderer.getContext();
        context.setFillStyle("#25251f");
        context.setStrokeStyle("#30302a");
        const noteRefs = new Map<string, { note: StaveNote; index: number; systemIndex: number }>();
        const tiedDestinations = new Set(score.ties.map((tie) => tie.toNoteId));
        const tiedNoteIds = new Set(score.ties.flatMap((tie) => [tie.fromNoteId, tie.toNoteId]));
        const absoluteIndex = new Map(score.measureOrder.map((measureId, index) => [measureId, index]));
        const nextMeasureLayouts: MeasureScreenLayout[] = [];
        const nextEventLayouts: EventScreenLayout[] = [];
        const nextNoteheadLayouts: NoteheadScreenLayout[] = [];
        const nextStaffHitLayouts: StaffMeasureHitLayout[] = [];

        systems.forEach((system, systemIndex) => {
          const yBase = TOP_PADDING + systemIndex * systemHeight;
          const stavesByMeasure: VexStave[][] = system.measureIds.map(() => []);
          const xPositions: number[] = [];
          let runningX = LABEL_WIDTH;
          system.widths.forEach((measureWidth) => {
            xPositions.push(runningX);
            runningX += measureWidth;
          });

          partGroups.forEach((group) => {
            const centerRow = (group.firstRowIndex + group.lastRowIndex) / 2;
            context.save();
            context.setFont(systemIndex === 0 ? "11px Arial" : "10px Arial");
            context.fillText(group.part.shortName, 8, yBase + centerRow * rowHeight + 38);
            context.restore();
          });

          rows.forEach((row) => {
            const y = yBase + row.rowIndex * rowHeight;
            system.measureIds.forEach((measureId, measureIndex) => {
              const index = absoluteIndex.get(measureId) ?? 0;
              const measure = score.measures[measureId];
              const previous = index > 0 ? score.measures[score.measureOrder[index - 1]] : null;
              const stave = new Stave(xPositions[measureIndex], y, system.widths[measureIndex] + .5);
              const atSystemStart = measureIndex === 0;
              if (atSystemStart) stave.addClef(row.staff.clef);
              if (row.staff.clef !== "percussion") {
                const writtenKey = writtenKeyForPart(measure.key, row.part);
                const previousWrittenKey = previous ? writtenKeyForPart(previous.key, row.part) : null;
                const keyChanged = previousWrittenKey && !keySignaturesEqual(previousWrittenKey, writtenKey);
                if (atSystemStart || keyChanged) {
                  stave.addKeySignature(
                    fifthsToVexFlowKey(writtenKey.fifths),
                    keyChanged && !atSystemStart ? fifthsToVexFlowKey(previousWrittenKey.fifths) : undefined,
                  );
                }
              }
              if (!previous || !timeSignaturesEqual(previous.time, measure.time)) {
                stave.addTimeSignature(`${measure.time.numerator}/${measure.time.denominator}`);
              }
              stavesByMeasure[measureIndex].push(stave);
            });
          });

          stavesByMeasure.forEach((staves) => Stave.formatBegModifiers(staves));
          stavesByMeasure.flat().forEach((stave) => stave.setContext(context).draw());

          if (rows.length > 1) {
            const firstColumn = stavesByMeasure[0];
            new StaveConnector(firstColumn[0], firstColumn[firstColumn.length - 1]).setType("singleLeft").setContext(context).draw();
            partGroups.forEach((group) => {
              if (group.lastRowIndex > group.firstRowIndex) {
                new StaveConnector(firstColumn[group.firstRowIndex], firstColumn[group.lastRowIndex]).setType("brace").setContext(context).draw();
              }
            });

            let familyStart = 0;
            for (let groupIndex = 1; groupIndex <= partGroups.length; groupIndex += 1) {
              const familyEnded = groupIndex === partGroups.length || partGroups[groupIndex].part.instrument.family !== partGroups[familyStart].part.instrument.family;
              if (!familyEnded) continue;
              if (groupIndex - familyStart > 1) {
                const firstGroup = partGroups[familyStart];
                const lastGroup = partGroups[groupIndex - 1];
                new StaveConnector(firstColumn[firstGroup.firstRowIndex], firstColumn[lastGroup.lastRowIndex]).setType("bracket").setContext(context).draw();
              }
              familyStart = groupIndex;
            }
            const lastColumn = stavesByMeasure[stavesByMeasure.length - 1];
            new StaveConnector(lastColumn[0], lastColumn[lastColumn.length - 1]).setType("singleRight").setContext(context).draw();
          }

          context.save();
          context.setFont("9px Arial");
          context.setFillStyle("#777168");
          system.measureIds.forEach((measureId, measureIndex) => context.fillText(String(score.measures[measureId].number), xPositions[measureIndex] + 4, yBase - 4));
          context.restore();

          system.measureIds.forEach((measureId, measureIndex) => {
            const measure = score.measures[measureId];
            const cells: Array<{ voice: VexVoice; dynamicsVoice?: VexVoice; notes: StaveNote[]; events: MusicEvent[]; eventTicks: number[]; placeholder: boolean; beams: VexBeam[]; stave: VexStave; row: RenderRow }> = [];

            rows.forEach((row) => {
              const stave = stavesByMeasure[measureIndex][row.rowIndex];
              const voiceData = getStaffVoice(row, measureId);
              const isEmptyMeasure = voiceData.events.length === 0;
              const sourceEvents: MusicEvent[] = isEmptyMeasure ? [{ id: `placeholder-${row.staff.id}-${measureId}`, kind: "rest", duration: { base: 1, dots: 0 } }] : voiceData.events;
              let runningTick = 0;
              const eventTicks = sourceEvents.map((event) => {
                const tick = runningTick;
                runningTick += durationTicks(event.duration);
                return tick;
              });
              const writtenKey = writtenKeyForPart(measure.key, row.part);
              const accidentals = resolveMeasureAccidentals(sourceEvents, writtenKey, tiedDestinations);
              const notes = sourceEvents.map((event) => {
                const fullMeasure = getFullMeasureDuration(measure.time);
                const note = new StaveNote({
                  keys: vexKey(event, row.staff.clef),
                  duration: vexDuration(event),
                  clef: row.staff.clef,
                  autoStem: true,
                  alignCenter: isEmptyMeasure,
                  durationOverride: isEmptyMeasure ? new Fraction(fullMeasure.numerator, fullMeasure.denominator) : undefined,
                });
                if (event.kind === "note") {
                  event.notes.forEach((scoreNote, noteIndex) => {
                    const accidental = accidentals.get(scoreNote.id);
                    if (accidental) note.addModifier(new Accidental(accidental), noteIndex);
                    noteRefs.set(scoreNote.id, { note, index: noteIndex, systemIndex });
                  });
                  if (event.articulation) {
                    note.addModifier(
                      new Articulation(VEXFLOW_ARTICULATION_CODES[event.articulation]).setPosition(ModifierPosition.ABOVE),
                      0,
                    );
                  }
                }
                for (let dotIndex = 0; dotIndex < event.duration.dots; dotIndex += 1) {
                  Dot.buildAndAttach([note], { all: true });
                }
                note.setStave(stave);
                return note;
              });
              const voice = new Voice({ numBeats: measure.time.numerator, beatValue: measure.time.denominator })
                .setMode(Voice.Mode.SOFT)
                .setStave(stave)
                .addTickables(notes);
              const hasDynamics = sourceEvents.some((event) => event.dynamic);
              const dynamicsVoice = hasDynamics
                ? new Voice({ numBeats: measure.time.numerator, beatValue: measure.time.denominator })
                  .setMode(Voice.Mode.SOFT)
                  .setStave(stave)
                  .addTickables(sourceEvents.map((event) => {
                    const duration = vexDuration(event).replace(/r$/, "");
                    const dynamic = event.dynamic
                      ? new TextDynamics({ duration, text: event.dynamic, line: 9 })
                      : new GhostNote(duration);
                    dynamic.setStave(stave);
                    return dynamic;
                  }))
                : undefined;
              const beams = Beam.generateBeams(notes, {
                groups: getDefaultBeamGroups(measure.time).map((group) => new Fraction(group.numerator, group.denominator)),
              });
              cells.push({ voice, dynamicsVoice, notes, events: sourceEvents, eventTicks, placeholder: isEmptyMeasure, beams, stave, row });
            });

            const noteStartX = Math.max(...cells.map((cell) => cell.stave.getNoteStartX()));
            cells.forEach((cell) => cell.stave.setNoteStartX(noteStartX));
            const noteEndX = Math.min(...cells.map((cell) => cell.stave.getNoteEndX()));
            const justifyWidth = Math.max(24, noteEndX - noteStartX - Stave.defaultPadding);
            const voices = cells.flatMap((cell) => cell.dynamicsVoice ? [cell.voice, cell.dynamicsVoice] : [cell.voice]);
            new Formatter().joinVoices(voices).format(voices, justifyWidth, { context });
            const anchorXs = new Map<number, number[]>();
            cells.filter((cell) => !cell.placeholder).forEach((cell) => cell.notes.forEach((note, noteIndex) => {
              const tick = cell.eventTicks[noteIndex];
              const x = note.getAbsoluteX();
              anchorXs.set(tick, [...(anchorXs.get(tick) ?? []), x]);
            }));
            const tickAnchors = [...anchorXs.entries()]
              .sort(([left], [right]) => left - right)
              .map(([tick, xs]) => ({ tick, x: xs.reduce((sum, x) => sum + x, 0) / xs.length }));
            const rhythmicStartX = noteStartX + Stave.defaultPadding - Stave.rightPadding;
            nextMeasureLayouts.push({
              measureId,
              systemIndex,
              startX: rhythmicStartX,
              endX: noteEndX,
              top: TOP_PADDING + systemIndex * systemHeight + 5,
              height: Math.max(56, rows.length * rowHeight - 10),
              tickAnchors,
            });
            cells.forEach((cell) => {
              nextStaffHitLayouts.push({
                partId: cell.row.part.id,
                staffId: cell.row.staff.id,
                measureId,
                systemIndex,
                startX: rhythmicStartX,
                endX: noteEndX,
                topLineY: cell.stave.getYForLine(0),
                bottomLineY: cell.stave.getYForLine(4),
                lineSpacing: cell.stave.getSpacingBetweenLines(),
                clef: cell.row.staff.clef,
              });
            });
            cells.forEach((cell) => {
              cell.voice.draw(context, cell.stave);
              cell.dynamicsVoice?.draw(context, cell.stave);
              cell.beams.forEach((beam) => beam.setContext(context).draw());
              if (!cell.placeholder) {
                cell.notes.forEach((note, noteIndex) => {
                  const event = cell.events[noteIndex];
                  const bounds = note.getBoundingBox();
                  const noteHeadStart = note.getNoteHeadBeginX();
                  const noteHeadEnd = note.getNoteHeadEndX();
                  const x = Math.min(bounds.x, noteHeadStart) - 7;
                  const width = Math.max(bounds.w, noteHeadEnd - noteHeadStart, 12) + 14;
                  nextEventLayouts.push({
                    partId: cell.row.part.id,
                    staffId: cell.row.staff.id,
                    measureId,
                    eventId: event.id,
                    tick: cell.eventTicks[noteIndex],
                    systemIndex,
                    x,
                    y: bounds.y - 7,
                    width,
                    height: Math.max(bounds.h, 30) + 14,
                  });
                  if (event.kind === "note") {
                    // VexFlow preserves the original key index here, including displaced chord heads.
                    // Read the rendered head bounds: getAbsoluteX() would apply displacement again.
                    note.noteHeads.forEach((head, pitchIndex) => {
                      const scoreNote = event.notes[pitchIndex];
                      const headBounds = head.getBoundingBox();
                      nextNoteheadLayouts.push({
                        partId: cell.row.part.id,
                        staffId: cell.row.staff.id,
                        measureId,
                        eventId: event.id,
                        noteId: scoreNote.id,
                        systemIndex,
                        x: headBounds.x,
                        y: headBounds.y,
                        width: headBounds.w,
                        height: headBounds.h,
                        centerY: head.getY(),
                        lineSpacing: cell.stave.getSpacingBetweenLines(),
                        pitch: scoreNote.pitch,
                        tick: cell.eventTicks[noteIndex],
                        draggable: cell.row.staff.clef !== "percussion",
                        tied: tiedNoteIds.has(scoreNote.id),
                      });
                    });
                  }
                });
              }
            });
          });
        });

        score.ties.forEach((tie) => {
          const first = noteRefs.get(tie.fromNoteId);
          const last = noteRefs.get(tie.toNoteId);
          if (!first || !last) return;
          if (first.systemIndex === last.systemIndex) {
            new StaveTie({ firstNote: first.note, lastNote: last.note, firstIndexes: [first.index], lastIndexes: [last.index] }).setContext(context).draw();
          } else {
            new StaveTie({ firstNote: first.note, lastNote: null, firstIndexes: [first.index], lastIndexes: [first.index] }).setContext(context).draw();
            new StaveTie({ firstNote: null, lastNote: last.note, firstIndexes: [last.index], lastIndexes: [last.index] }).setContext(context).draw();
          }
        });
        const eventById = new Map(nextEventLayouts.map((layout) => [layout.eventId, layout]));
        for (const span of timedHairpins(score)) {
          const first = eventById.get(span.startEventId);
          const last = eventById.get(span.endEventId);
          if (!first || !last) continue;
          const firstIndex = absoluteIndex.get(first.measureId)!;
          const lastIndex = absoluteIndex.get(last.measureId)!;
          const endEvent = rows.find((row) => row.staff.id === span.staffId)?.staff.measures[last.measureId].voices[0].events.find((event) => event.id === last.eventId);
          if (!endEvent) continue;
          context.save();
          const group = context.openGroup("hairpin");
          group.setAttribute("role", "img");
          group.setAttribute("aria-label", `${span.kind}, ${span.from} to ${span.to}, measures ${firstIndex + 1} to ${lastIndex + 1}`);
          group.setAttribute("data-hairpin-id", span.id);
          context.setLineWidth(1.35);
          context.setFont("Georgia, serif", 12, "bold", "italic");
          for (let systemIndex = first.systemIndex; systemIndex <= last.systemIndex; systemIndex += 1) {
            const cells = nextStaffHitLayouts.filter((cell) => cell.staffId === span.staffId && cell.systemIndex === systemIndex
              && absoluteIndex.get(cell.measureId)! >= firstIndex && absoluteIndex.get(cell.measureId)! <= lastIndex);
            if (!cells.length) continue;
            const startCell = cells[0];
            const endCell = cells.at(-1)!;
            const startLayout = nextMeasureLayouts.find((layout) => layout.measureId === startCell.measureId)!;
            const endLayout = nextMeasureLayouts.find((layout) => layout.measureId === endCell.measureId)!;
            const startsHere = systemIndex === first.systemIndex;
            const endsHere = systemIndex === last.systemIndex;
            const x1 = startsHere ? xForMeasureTick(startLayout, first.tick, measureCapacity(score.measures[first.measureId])) : startCell.startX;
            const x2 = Math.max(x1 + 24, (endsHere ? xForMeasureTick(endLayout, last.tick + durationTicks(endEvent.duration), measureCapacity(score.measures[last.measureId])) : endCell.endX) - 6);
            const lowNote = nextEventLayouts.filter((event) => event.staffId === span.staffId && event.systemIndex === systemIndex && event.x < x2 && event.x + event.width > x1)
              .reduce((bottom, event) => Math.max(bottom, event.y + event.height), 0);
            const y = Math.max(startCell.bottomLineY + 36, lowNote + 15);
            const openingStart = span.kind === "crescendo" ? (startsHere ? 0 : 3) : 5;
            const openingEnd = span.kind === "diminuendo" ? (endsHere ? 0 : 3) : 5;
            context.beginPath().moveTo(x1, y - openingStart).lineTo(x2, y - openingEnd)
              .moveTo(x1, y + openingStart).lineTo(x2, y + openingEnd).stroke();
            if (startsHere) context.fillText(span.from, x1, y + 17);
            if (endsHere) context.fillText(span.to, x2 - context.measureText(span.to).width, y + 17);
          }
          context.closeGroup();
          context.restore();
        }
        if (!disposed && requestId === engravingRequestRef.current && hostRef.current === host) {
          setEngravingState({
            source: engravingSource,
            measureLayouts: nextMeasureLayouts,
            eventLayouts: nextEventLayouts,
            noteheadLayouts: nextNoteheadLayouts,
            staffHitLayouts: nextStaffHitLayouts,
            error: "",
          });
        }
      } catch (error) {
        if (disposed || requestId !== engravingRequestRef.current || hostRef.current !== host) return;
        host.replaceChildren();
        setEngravingState({
          source: engravingSource,
          measureLayouts: [],
          eventLayouts: [],
          noteheadLayouts: [],
          staffHitLayouts: [],
          error: error instanceof Error ? error.message : "The score could not be engraved.",
        });
      }
    }
    void draw();
    return () => { disposed = true; };
  }, [engravingSource, engravingWidth, interactiveRenderBlocked, partGroups, renderAttempt, renderHeight, rowHeight, rows, score, systemHeight, systems]);

  const selectEventLayout = (layout: EventScreenLayout, extend = false) => {
    if (onPlaybackSeek) { onPlaybackSeek(layout.measureId, layout.tick); return; }
    const selection = {
      partId: layout.partId, staffId: layout.staffId, measureId: layout.measureId,
      eventId: layout.eventId, ...(layout.noteId ? { noteId: layout.noteId } : {}),
    };
    if ((rangeSelectionMode || extend) && onRangeEventSelect) {
      onRangeEventSelect(selection, true);
      return;
    }
    onSelectPart(layout.partId);
    onSelectStaff?.(layout.staffId);
    onSelectEvent?.(selection);
  };

  const scorePoint = (pointer: { clientX: number; clientY: number }) => {
    const surface = hostRef.current?.parentElement;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    const scaleX = bounds.width / surface.offsetWidth;
    const scaleY = bounds.height / surface.offsetHeight;
    return { x: (pointer.clientX - bounds.left) / scaleX, y: (pointer.clientY - bounds.top) / scaleY, scaleX, scaleY };
  };

  const previewRangeDestination = (x: number, y: number, eventLayout?: EventScreenLayout): RangeDestinationPreview => {
    const target = staffHitLayouts
      .filter((candidate) => eventLayout
        ? candidate.measureId === eventLayout.measureId && candidate.staffId === eventLayout.staffId
        : x >= candidate.startX - 12 && x <= candidate.endX)
      .map((candidate) => ({ candidate, distance: Math.abs((candidate.topLineY + candidate.bottomLineY) / 2 - y) }))
      .sort((left, right) => left.distance - right.distance)[0];
    const staffLayout = target && (eventLayout || target.distance <= rowHeight / 2)
      && target.candidate.partId === selectedPartId && target.candidate.staffId === selectedStaffId
      ? target.candidate : null;
    const measureLayout = staffLayout ? measureLayouts.find((candidate) => candidate.measureId === staffLayout.measureId) : null;
    const measure = staffLayout ? score.measures[staffLayout.measureId] : null;
    if (!staffLayout || !measureLayout || !measure) {
      return { source: engravingSource, destination: null, x, y, label: "Choose a position in the selected staff" };
    }
    const staff = score.parts.find((part) => part.id === staffLayout.partId)?.staves.find((item) => item.id === staffLayout.staffId);
    let runningTick = 0;
    const onsets = (staff?.measures[staffLayout.measureId]?.voices[0]?.events ?? []).map((item) => {
      const tick = runningTick;
      runningTick += durationTicks(item.duration);
      return tick;
    });
    const capacity = measureCapacity(measure);
    const tick = eventLayout?.tick ?? snappedTickForMeasureX(measureLayout, x, capacity, TICKS_PER_QUARTER / 4, onsets);
    const beat = Number((1 + tick / (TICKS_PER_QUARTER * 4 / measure.time.denominator)).toFixed(3));
    return {
      source: engravingSource,
      destination: { partId: staffLayout.partId, staffId: staffLayout.staffId, measureId: staffLayout.measureId, tick },
      x: xForMeasureTick(measureLayout, tick, capacity),
      y: (staffLayout.topLineY + staffLayout.bottomLineY) / 2,
      label: `${rangeDestinationMode === "copy" ? "Copy" : "Move"} range → m. ${measure.number} · beat ${beat} · tap to apply`,
    };
  };

  const activateScorePoint = (event: React.MouseEvent<HTMLElement>, notehead?: NoteheadScreenLayout, extend = event.shiftKey) => {
    if (!rows.length || !layoutsAreCurrent) return;
    const point = scorePoint(event);
    if (!point) return;
    const { x: localX, y: localY, scaleX: renderedScaleX, scaleY: renderedScaleY } = point;
    const choosingRange = rangeSelectionMode || (extend && noteEntryMethod !== "score-pointer");
    const directSelectionRadius = noteEntryMethod === "score-pointer" || choosingRange || rangeDestinationMode
      ? 12 / Math.min(renderedScaleX, renderedScaleY)
      : 0;
    const directHit = notehead ?? eventLayouts
      .map((layout) => ({
        layout,
        distance: pointToRectDistance(localX, localY, layout),
        centerDistance: pointToRectCenterDistance(localX, localY, layout),
      }))
      .filter(({ distance }) => distance <= directSelectionRadius)
      .sort((left, right) => left.centerDistance - right.centerDistance)[0]?.layout;
    if (onPlaybackSeek) {
      if (directHit) { onPlaybackSeek(directHit.measureId, directHit.tick); return; }
      const measure = measureLayouts.find(layout => localX >= layout.startX && localX <= layout.endX && localY >= layout.top && localY <= layout.top + layout.height);
      if (measure) {
        const capacity = measureCapacity(score.measures[measure.measureId]);
        onPlaybackSeek(measure.measureId, snappedTickForMeasureX(measure, localX, capacity, TICKS_PER_QUARTER / 4));
      }
      return;
    }
    if (rangeDestinationMode) {
      const preview = previewRangeDestination(localX, localY, directHit);
      if (preview.destination) onRangeDestination?.(preview.destination);
      return;
    }
    if (directHit) {
      selectEventLayout(directHit, extend);
      return;
    }

    if (noteEntryMethod === "score-pointer" && !choosingRange) {
      const screenPaddingX = 4 / renderedScaleX;
      const screenPaddingY = 24 / renderedScaleY;
      const pointerLayout = staffHitLayouts
        .filter((layout) => (
          localX >= layout.startX + screenPaddingX
          && localX <= layout.endX - screenPaddingX
          && localY >= layout.topLineY - screenPaddingY
          && localY <= layout.bottomLineY + screenPaddingY
        ))
        .map((layout) => ({
          layout,
          distance: Math.abs(localY - (layout.topLineY + layout.bottomLineY) / 2),
        }))
        .sort((left, right) => left.distance - right.distance)[0]?.layout;
      if (!pointerLayout) return;
      const pitch = pitchFromStaffPointer(pointerLayout.clef, localY, pointerLayout.bottomLineY, pointerLayout.lineSpacing);
      if (!pitch) {
        onPointerNoteIntent?.({ kind: "unsupported", partId: pointerLayout.partId, staffId: pointerLayout.staffId, measureId: pointerLayout.measureId, clef: pointerLayout.clef });
        return;
      }
      onPointerNoteIntent?.({ kind: "pitch", partId: pointerLayout.partId, staffId: pointerLayout.staffId, measureId: pointerLayout.measureId, step: pitch.step, octave: pitch.octave, addToChord: event.shiftKey });
      return;
    }

    const scoreY = localY - TOP_PADDING;
    if (scoreY < 0) return;
    const systemIndex = Math.floor(scoreY / systemHeight);
    if (systemIndex < 0 || systemIndex >= systems.length) return;
    const withinSystem = scoreY - systemIndex * systemHeight;
    if (withinSystem < 0 || withinSystem >= rows.length * rowHeight) return;
    const row = rows[Math.floor(withinSystem / rowHeight)];
    const nearest = eventLayouts
      .filter((layout) => layout.partId === row.part.id && layout.staffId === row.staff.id && layout.systemIndex === systemIndex)
      .map((layout) => ({ layout, distance: pointToRectDistance(localX, localY, layout), centerDistance: pointToRectCenterDistance(localX, localY, layout) }))
      .filter(({ distance }) => distance <= 22 / Math.min(renderedScaleX, renderedScaleY))
      .sort((left, right) => left.distance - right.distance || left.centerDistance - right.centerDistance)[0]?.layout;
    if (nearest) selectEventLayout(nearest, extend);
    else if (!choosingRange) {
      onSelectPart(row.part.id);
      onSelectStaff?.(row.staff.id);
      onSelectEvent?.(null);
    }
  };

  const updatePointerPreview = (event: React.PointerEvent<HTMLButtonElement>, notehead?: NoteheadScreenLayout) => {
    if (onPlaybackSeek) return;
    if (rangeDestinationMode && layoutsAreCurrent) {
      const point = scorePoint(event);
      if (point) setRangeDestinationPreview(previewRangeDestination(point.x, point.y, notehead));
      setPointerNotePreview(null);
      return;
    }
    setRangeDestinationPreview(null);
    if (rangeSelectionMode || noteEntryMethod !== "score-pointer" || !layoutsAreCurrent) {
      if (pointerNotePreview) setPointerNotePreview(null);
      return;
    }
    setPointerShiftPressed(event.shiftKey);
    const rect = event.currentTarget.getBoundingClientRect();
    const renderedScaleX = event.currentTarget.offsetWidth > 0 ? rect.width / event.currentTarget.offsetWidth : scale;
    const renderedScaleY = event.currentTarget.offsetHeight > 0 ? rect.height / event.currentTarget.offsetHeight : scale;
    const localX = (event.clientX - rect.left) / renderedScaleX;
    const localY = (event.clientY - rect.top) / renderedScaleY;
    const selectionHalo = 12 / Math.min(renderedScaleX, renderedScaleY);
    if (eventLayouts.some((layout) => pointToRectDistance(localX, localY, layout) <= selectionHalo)) {
      setPointerNotePreview(null);
      return;
    }
    const screenPaddingX = 4 / renderedScaleX;
    const screenPaddingY = 24 / renderedScaleY;
    const layout = staffHitLayouts
      .filter((candidate) => (
        localX >= candidate.startX + screenPaddingX
        && localX <= candidate.endX - screenPaddingX
        && localY >= candidate.topLineY - screenPaddingY
        && localY <= candidate.bottomLineY + screenPaddingY
      ))
      .map((candidate) => ({
        candidate,
        distance: Math.abs(localY - (candidate.topLineY + candidate.bottomLineY) / 2),
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;
    if (!layout) {
      setPointerNotePreview(null);
      return;
    }
    const pitch = pitchFromStaffPointer(layout.clef, localY, layout.bottomLineY, layout.lineSpacing);
    const snappedStep = Math.round((layout.bottomLineY - localY) / (layout.lineSpacing / 2));
    const measureLayout = measureLayouts.find((candidate) => candidate.measureId === layout.measureId);
    const row = rows.find((candidate) => candidate.part.id === layout.partId && candidate.staff.id === layout.staffId);
    const tailTick = row
      ? getStaffVoice(row, layout.measureId).events.reduce((sum, item) => sum + durationTicks(item.duration), 0)
      : 0;
    const capacity = measureCapacity(score.measures[layout.measureId]);
    const durationFits = pointerDurationTicks <= 0 || pointerDurationTicks <= capacity - tailTick;
    const tailX = measureLayout
      ? xForMeasureTick(measureLayout, tailTick, capacity)
      : layout.startX;
    const selectedChordLayout = chordMode && selectedEventDetails?.event.kind === "note"
      ? eventLayouts.find((candidate) => candidate.eventId === selectedEventId)
      : undefined;
    const shiftTargetsSelectedChord = Boolean(
      selectedChordLayout
      && selectedChordLayout.partId === layout.partId
      && selectedChordLayout.staffId === layout.staffId
      && selectedChordLayout.measureId === layout.measureId,
    );
    const measureNumber = score.measures[layout.measureId]?.number ?? layout.measureId;
    setPointerNotePreview({
      context: engravingState,
      score,
      selectedEventId,
      chordMode,
      durationTicks: pointerDurationTicks,
      durationLabel: pointerDurationLabel,
      y: layout.bottomLineY - snappedStep * (layout.lineSpacing / 2),
      normal: {
        x: tailX,
        label: pitch
          ? durationFits
            ? `${pitch.step}${pitch.octave} → m. ${measureNumber} NEXT`
            : `${pitch.step}${pitch.octave} · ${pointerDurationLabel} does not fit in m. ${measureNumber}`
          : "Percussion · use buttons",
        unsupported: !pitch || !durationFits,
      },
      chord: {
        x: shiftTargetsSelectedChord && selectedChordLayout
          ? selectedChordLayout.x + selectedChordLayout.width / 2
          : tailX,
        label: pitch
          ? shiftTargetsSelectedChord
            ? `Add ${pitch.step}${pitch.octave} to selected chord · m. ${measureNumber}`
            : `${pitch.step}${pitch.octave} · Shift-click needs a selected note in m. ${measureNumber}`
          : "Percussion · use buttons",
        unsupported: !pitch || !shiftTargetsSelectedChord,
      },
    });
  };

  const cancelPointerInput = () => {
    pointerTapRef.current = null;
    setPointerNotePreview(null);
    setRangeDestinationPreview(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, notehead?: NoteheadScreenLayout) => {
    if (pointerTapRef.current) {
      pointerTapRef.current.tap = { ...pointerTapRef.current.tap, cancelled: true };
      setPointerNotePreview(null);
      return;
    }
    if (!layoutsAreCurrent) return;
    const tap = startScorePointerTap(event);
    if (!tap) return;
    pointerTapRef.current = { tap, source: engravingSource, method: noteEntryMethod, interaction: pointerInteraction, notehead, extend: event.shiftKey };
    updatePointerPreview(event, notehead);
    // Leave native touch pan and pinch gestures available; they cancel the tap.
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerTapRef.current;
    if (gesture) {
      gesture.tap = trackScorePointerTap(gesture.tap, event);
      if (gesture.tap.cancelled) {
        setPointerNotePreview(null);
        setRangeDestinationPreview(null);
        return;
      }
    } else if (event.pointerType === "touch" || event.buttons !== 0) {
      setPointerNotePreview(null);
      setRangeDestinationPreview(null);
      return;
    }
    updatePointerPreview(event, gesture?.notehead);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerTapRef.current;
    if (!gesture || gesture.tap.start.pointerId !== event.pointerId) return;
    cancelPointerInput();
    if (gesture.source !== engravingSource || gesture.method !== noteEntryMethod || gesture.interaction !== pointerInteraction || !finishesScorePointerTap(gesture.tap, event)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    activateScorePoint(event, gesture.notehead, gesture.extend);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Pointer taps already ran on pointerup. Keyboard clicks have no pitch coordinate.
    if (event.detail === 0 && noteEntryMethod !== "score-pointer") activateScorePoint(event);
  };

  const selectNotehead = (layout: NoteheadScreenLayout, extend = false) => {
    if (onPlaybackSeek) { onPlaybackSeek(layout.measureId, layout.tick); return; }
    if (rangeDestinationMode) {
      const preview = previewRangeDestination(layout.x + layout.width / 2, layout.centerY, layout);
      if (preview.destination) onRangeDestination?.(preview.destination);
      return;
    }
    selectEventLayout(layout, extend);
  };

  const previewEventMove = (gesture: NoteDragGesture, pointer: { clientX: number; clientY: number }): NoteDragPreview => {
    const surface = hostRef.current?.parentElement;
    const bounds = surface?.getBoundingClientRect();
    const scaleX = surface && bounds ? bounds.width / surface.offsetWidth : scale;
    const scaleY = surface && bounds ? bounds.height / surface.offsetHeight : scale;
    const x = bounds ? (pointer.clientX - bounds.left) / scaleX - gesture.grabOffsetX : gesture.layout.x;
    const rowY = bounds ? (pointer.clientY - bounds.top) / scaleY - gesture.grabOffsetY : gesture.sourceStaffCenterY;
    // Compare every rendered row before accepting the original staff. This prevents a
    // drop over another staff from silently jumping back to the selected one.
    const target = staffHitLayouts
      .filter((candidate) => x >= candidate.startX - 12 && x <= candidate.endX)
      .map((candidate) => ({ candidate, distance: Math.abs((candidate.topLineY + candidate.bottomLineY) / 2 - rowY) }))
      .sort((left, right) => left.distance - right.distance)[0];
    const staffLayout = target && target.distance <= rowHeight / 2
      && target.candidate.partId === gesture.layout.partId && target.candidate.staffId === gesture.layout.staffId
      ? target.candidate : null;
    const measureLayout = staffLayout ? measureLayouts.find((candidate) => candidate.measureId === staffLayout.measureId) : null;
    const measure = staffLayout ? score.measures[staffLayout.measureId] : null;
    if (!staffLayout || !measureLayout || !measure || !onEventMove) {
      return {
        source: gesture.source, layout: gesture.layout, kind: "time", x,
        y: rowY + gesture.layout.centerY - gesture.sourceStaffCenterY,
        destination: null, label: "Move within the same staff · Esc cancels",
      };
    }
    const targetStaff = score.parts.find((part) => part.id === gesture.layout.partId)?.staves.find((staff) => staff.id === gesture.layout.staffId);
    let runningTick = 0;
    const onsets = (targetStaff?.measures[staffLayout.measureId]?.voices[0]?.events ?? []).map((event) => {
      const tick = runningTick;
      runningTick += durationTicks(event.duration);
      return tick;
    });
    const capacity = measureCapacity(measure);
    const tick = snappedTickForMeasureX(measureLayout, x, capacity, TICKS_PER_QUARTER / 4, onsets);
    const beat = Number((1 + tick / (TICKS_PER_QUARTER * 4 / measure.time.denominator)).toFixed(3));
    return {
      source: gesture.source, layout: gesture.layout, kind: "time",
      x: xForMeasureTick(measureLayout, tick, capacity),
      y: (staffLayout.topLineY + staffLayout.bottomLineY) / 2 + gesture.layout.centerY - gesture.sourceStaffCenterY,
      destination: { measureId: staffLayout.measureId, tick },
      label: `m. ${measure.number} · beat ${beat} · chord and ties move together · release to apply`,
    };
  };

  const handleNotePointerDown = (event: React.PointerEvent<HTMLButtonElement>, target: NoteheadScreenLayout) => {
    if (!layoutsAreCurrent || !event.isPrimary || event.button !== 0 || noteDragRef.current) return;
    const surface = hostRef.current?.parentElement;
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    const renderedScaleX = bounds.width / surface.offsetWidth;
    const renderedScaleY = bounds.height / surface.offsetHeight;
    const localX = (event.clientX - bounds.left) / renderedScaleX;
    const localY = (event.clientY - bounds.top) / renderedScaleY;
    const halo = 4 / Math.min(renderedScaleX, renderedScaleY);
    const layout = noteheadLayouts
      .filter((candidate) => pointToRectDistance(localX, localY, candidate) <= halo)
      .sort((left, right) => pointToRectCenterDistance(localX, localY, left) - pointToRectCenterDistance(localX, localY, right))[0] ?? target;
    if (onPlaybackSeek || rangeInteraction || event.shiftKey) {
      event.stopPropagation();
      handlePointerDown(event, layout);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    cancelPointerInput();
    if ((!layout.draggable || !onNotePitchChange) && !onEventMove) {
      selectNotehead(layout);
      return;
    }
    // Keep selection-dependent panels from moving the staff under the held pointer.
    // A tap selects on release; a completed drag selects through its committed edit.
    const drag = startScoreNoteDrag(event, layout.pitch, layout.lineSpacing / 2 * renderedScaleY);
    const measureLayout = measureLayouts.find((candidate) => candidate.measureId === layout.measureId);
    const staffLayout = staffHitLayouts.find((candidate) => candidate.measureId === layout.measureId && candidate.staffId === layout.staffId);
    if (!drag || !measureLayout || !staffLayout) return;
    const sourceStaffCenterY = (staffLayout.topLineY + staffLayout.bottomLineY) / 2;
    noteDragRef.current = {
      drag, layout, source: engravingSource, target: event.currentTarget, sourceTick: layout.tick,
      grabOffsetX: localX - xForMeasureTick(measureLayout, layout.tick, measureCapacity(score.measures[layout.measureId])),
      grabOffsetY: localY - sourceStaffCenterY,
      sourceStaffCenterY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setNoteDragPreview({ source: engravingSource, layout, kind: "pitch", pitch: drag.pitch, activated: false });
  };

  const handleNotePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerTapRef.current?.notehead || rangeDestinationMode) {
      handlePointerMove(event);
      return;
    }
    const gesture = noteDragRef.current;
    if (!gesture || gesture.drag.start.pointerId !== event.pointerId) return;
    if (gesture.source !== engravingSource || rangeInteraction) {
      cancelNoteDrag();
      return;
    }
    gesture.drag = trackScoreNoteDrag(gesture.drag, event);
    if (gesture.drag.cancelled) {
      cancelNoteDrag();
      return;
    }
    setNoteDragPreview(gesture.drag.axis === "time"
      ? previewEventMove(gesture, event)
      : { source: gesture.source, layout: gesture.layout, kind: "pitch", pitch: gesture.drag.pitch, activated: gesture.drag.activated });
  };

  const handleNotePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerTapRef.current?.notehead) {
      handlePointerUp(event);
      return;
    }
    const gesture = noteDragRef.current;
    if (!gesture || gesture.drag.start.pointerId !== event.pointerId) return;
    const finalDrag = trackScoreNoteDrag(gesture.drag, event);
    const pitch = finishesScoreNoteDrag(gesture.drag, event);
    const movePreview = finalDrag.axis === "time" ? previewEventMove(gesture, event) : null;
    cancelNoteDrag();
    if (finalDrag.cancelled || gesture.source !== engravingSource || rangeInteraction) return;
    const { partId, staffId, measureId, eventId, noteId } = gesture.layout;
    if (movePreview?.kind === "time") {
      const destination = movePreview.destination;
      if (destination && (destination.measureId !== measureId || destination.tick !== gesture.sourceTick)) {
        onEventMove?.({ partId, staffId, measureId, eventId, noteId, targetMeasureId: destination.measureId, targetTick: destination.tick });
      }
      return;
    }
    if (!pitch || !gesture.layout.draggable) {
      selectNotehead(gesture.layout);
      return;
    }
    onNotePitchChange?.({ partId, staffId, measureId, eventId, noteId, pitch });
  };

  const selectedStaffRow = selectedStaffId ? rows.find((row) => row.staff.id === selectedStaffId) : undefined;
  const highlightedRows = selectedStaffRow
    ? [selectedStaffRow]
    : viewMode === "score"
      ? rows.filter((row) => row.part.id === selectedPartId)
      : [];
  const keyboardRow = selectedStaffRow ?? rows.find((row) => row.part.id === selectedPartId) ?? rows[0];
  const playbackPosition = useMemo(
    () => playbackSeconds === null ? null : locatePlaybackPosition(score, playbackSeconds),
    [playbackSeconds, score],
  );
  const playbackLayout = playbackPosition
    ? measureLayouts.find((layout) => layout.measureId === playbackPosition.measureId)
    : undefined;
  const playbackCursor = useMemo(() => playbackPosition && playbackLayout ? {
    ...playbackLayout,
    x: xForMeasureTick(playbackLayout, playbackPosition.tickInMeasure, measureCapacity(score.measures[playbackPosition.measureId])),
    label: `m. ${playbackPosition.measureNumber} · beat ${playbackPosition.beat}`,
  } : null, [playbackLayout, playbackPosition, score.measures]);
  const entryLayout = entryMeasureId ? measureLayouts.find((layout) => layout.measureId === entryMeasureId) : undefined;
  const entryMeasure = entryMeasureId ? score.measures[entryMeasureId] : undefined;
  const entryCursor = playbackSeconds === null && entryLayout && selectedStaffRow ? {
    x: xForMeasureTick(entryLayout, entryTick, entryMeasure ? measureCapacity(entryMeasure) : 0),
    top: TOP_PADDING + entryLayout.systemIndex * systemHeight + selectedStaffRow.rowIndex * rowHeight + 8,
  } : null;
  const entryCursorX = entryCursor?.x;
  const entryCursorTop = entryCursor?.top;
  const selectedEventLayout = selectedEventId ? eventLayouts.find((layout) => layout.eventId === selectedEventId) : undefined;
  const rangeRectangles = [...eventLayouts.filter((layout) => rangeEventIds.has(layout.eventId)).reduce((groups, layout) => {
    const key = `${layout.systemIndex}:${layout.partId}:${layout.staffId}`;
    const staff = staffHitLayouts.find((candidate) => candidate.systemIndex === layout.systemIndex && candidate.staffId === layout.staffId);
    const top = Math.min(layout.y, (staff?.topLineY ?? layout.y) - 10);
    const bottom = Math.max(layout.y + layout.height, (staff?.bottomLineY ?? layout.y + layout.height) + 12);
    const previous = groups.get(key);
    groups.set(key, previous ? {
      x: Math.min(previous.x, layout.x), y: Math.min(previous.y, top),
      width: Math.max(previous.x + previous.width, layout.x + layout.width) - Math.min(previous.x, layout.x),
      height: Math.max(previous.y + previous.height, bottom) - Math.min(previous.y, top),
    } : { x: layout.x, y: top, width: layout.width, height: bottom - top });
    return groups;
  }, new Map<string, ScreenRect>()).entries()];
  const visibleRangeDestination = rangeDestinationMode && rangeDestinationPreview?.source === engravingSource ? rangeDestinationPreview : null;
  const pointerPreviewIsCurrent = Boolean(
    pointerNotePreview
    && layoutsAreCurrent
    && pointerNotePreview.context === engravingState
    && pointerNotePreview.score === score
    && pointerNotePreview.selectedEventId === selectedEventId
    && pointerNotePreview.chordMode === chordMode
    && pointerNotePreview.durationTicks === pointerDurationTicks
    && pointerNotePreview.durationLabel === pointerDurationLabel
    && !rangeSelectionMode && !rangeDestinationMode,
  );
  const visiblePointerNotePreview = pointerNotePreview && pointerPreviewIsCurrent
    ? {
        y: pointerNotePreview.y,
        ...(chordMode && pointerShiftPressed ? pointerNotePreview.chord : pointerNotePreview.normal),
      }
    : null;
  const visibleNoteDrag = noteDragPreview?.source === engravingSource ? noteDragPreview : null;

  useEffect(() => {
    if (!layoutsAreCurrent || inputFollowRevision === completedInputFollowRef.current) return;
    const selectedRect = selectedEventLayout;
    const caretRect = entryCursorX !== undefined && entryCursorTop !== undefined
      ? { x: entryCursorX - 1, y: entryCursorTop, width: 2, height: 70 }
      : undefined;
    const target = selectedRect && caretRect
      ? {
        x: Math.min(selectedRect.x, caretRect.x),
        y: Math.min(selectedRect.y, caretRect.y),
        width: Math.max(selectedRect.x + selectedRect.width, caretRect.x + caretRect.width) - Math.min(selectedRect.x, caretRect.x),
        height: Math.max(selectedRect.y + selectedRect.height, caretRect.y + caretRect.height) - Math.min(selectedRect.y, caretRect.y),
      }
      : selectedRect ?? caretRect;
    if (!target) return;
    completedInputFollowRef.current = inputFollowRevision;
    scrollScreenRectIntoView(frameRef.current, target, scale);
  }, [entryCursorTop, entryCursorX, inputFollowRevision, layoutsAreCurrent, scale, selectedEventLayout]);

  useEffect(() => {
    if (!playbackActive) return;
    const frame = frameRef.current;
    const canvas = frame?.closest<HTMLElement>(".canvas-area");
    if (!frame || !canvas) return;
    autoScrollRef.current = { left: frame.scrollLeft, top: canvas.scrollTop };
    const hold = () => {
      setFollowHold({ revision: playbackFollowRevision, held: true });
    };
    const scroll = () => {
      const expected = autoScrollRef.current;
      if (Math.abs(frame.scrollLeft - expected.left) > 1 || Math.abs(canvas.scrollTop - expected.top) > 1) hold();
    };
    const key = (event: KeyboardEvent) => {
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) hold();
    };
    canvas.addEventListener("wheel", hold, { passive: true });
    canvas.addEventListener("touchmove", hold, { passive: true });
    canvas.addEventListener("keydown", key);
    canvas.addEventListener("scroll", scroll, { passive: true });
    frame.addEventListener("scroll", scroll, { passive: true });
    return () => {
      canvas.removeEventListener("wheel", hold);
      canvas.removeEventListener("touchmove", hold);
      canvas.removeEventListener("keydown", key);
      canvas.removeEventListener("scroll", scroll);
      frame.removeEventListener("scroll", scroll);
    };
  }, [playbackActive, playbackFollowRevision]);

  useEffect(() => {
    if (!layoutsAreCurrent || !playbackCursor || (playbackPaused && !forceFollowRef.current)) return;
    forceFollowRef.current = false;
    if (!playbackFollowEnabled || followHeld) return;
    // Follow the active staff in a tall orchestral system, rather than trying
    // to fit a whole system that may be taller than the viewport.
    const top = playbackCursor.top + (selectedStaffRow?.rowIndex ?? 0) * rowHeight;
    scrollScreenRectIntoView(frameRef.current, {
      x: playbackCursor.x - 1, y: top, width: 2,
      height: Math.min(rowHeight, playbackCursor.height),
    }, scale);
    const frame = frameRef.current;
    const canvas = frame?.closest<HTMLElement>(".canvas-area");
    if (frame && canvas) autoScrollRef.current = { left: frame.scrollLeft, top: canvas.scrollTop };
  }, [layoutsAreCurrent, playbackCursor, playbackPaused, playbackFollowRevision, playbackFollowEnabled, followHeld, rowHeight, selectedStaffRow, scale]);

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
    const arrowDurationStaffMove = event.altKey
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown");
    const extendingRange = event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
      && (event.key === "ArrowLeft" || event.key === "ArrowRight");
    if (hasSystemShortcutModifier(event) && !arrowDurationStaffMove && !extendingRange) return;
    // During destination choice, arrows keep native scrolling and focused noteheads
    // retain their normal Enter/Space activation instead of changing the source range.
    if (rangeDestinationMode) return;
    // Selected pitch edits are handled by the studio, including tied tones.
    if (!rangeInteraction && selectedNoteId && !event.altKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
    if (
      noteEntryMethod === "arrow-duration"
      && !rangeInteraction
      && (event.key === "ArrowUp" || event.key === "ArrowDown")
      && !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      onShiftInputPitch?.(event.key === "ArrowUp" ? 1 : -1);
      return;
    }
    if (!rangeInteraction && !event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (!layoutsAreCurrent) return;
      const rowEvents = eventLayouts
        .filter((layout) => layout.partId === keyboardRow.part.id && layout.staffId === keyboardRow.staff.id)
        .sort((left, right) => left.systemIndex - right.systemIndex || left.x - right.x);
      if (!rowEvents.length) {
        onSelectEvent?.(null);
        return;
      }
      const selectedIndex = rowEvents.findIndex((layout) => layout.eventId === selectedEventId);
      const nextIndex = selectedIndex < 0
        ? event.key === "ArrowLeft" ? rowEvents.length - 1 : 0
        : event.key === "ArrowLeft"
          ? Math.max(0, selectedIndex - 1)
          : Math.min(rowEvents.length - 1, selectedIndex + 1);
      const nextEvent = rowEvents[nextIndex];
      selectEventLayout(nextEvent, extendingRange);
      scrollScreenRectIntoView(frameRef.current, nextEvent, scale);
      return;
    }
    const currentIndex = Math.max(0, rows.indexOf(keyboardRow));
    const nextIndex = event.key === "ArrowUp"
      ? Math.max(0, currentIndex - 1)
      : event.key === "ArrowDown"
        ? Math.min(rows.length - 1, currentIndex + 1)
        : currentIndex;
    const next = rows[nextIndex];
    if (!next) return;
    onSelectPart(next.part.id);
    onSelectStaff?.(next.staff.id);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      scrollStaffRowIntoView(frameRef.current, next.rowIndex, systems.length, systemHeight, rowHeight, engravingWidth, scale);
    }
  };
  const selectedEventContext = selectedEventDetails
    ? ` Selected ${accessibleEventLabel(selectedEventDetails.event)} in part ${selectedEventDetails.part.name}, staff ${selectedEventDetails.staffIndex + 1}, measure ${score.measures[selectedEventDetails.measureId]?.number ?? selectedEventDetails.measureId}.`
    : selectedEventId
      ? " The selected event is no longer available."
      : " No event selected; input uses the NEXT marker.";
  const entryMethodGuidance = noteEntryMethod === "arrow-duration"
    ? "Use the Up and Down Arrow keys to choose a written pitch, then choose length with 1 through 7 and enter with QWERTYU. Use Alt with Up or Down to select a staff."
    : noteEntryMethod === "duration-letter"
      ? "Use 1 through 7 to choose duration and Q W E R T Y U to enter C D E F G A B. Shift with Q W E R T Y U adds a tone to the selected note or chord. Z and X lower and raise the input octave. A toggles rest input; S D F choose flat, natural, sharp; tilde cycles dots. Use Alt with Up or Down to select a staff."
      : noteEntryMethod === "score-pointer"
        ? "Click or tap an empty staff line or space to append that written pitch at the NEXT position in the clicked measure. Existing notes and rests remain selectable. In Chord mode, Shift-click adds a tone only when a note is selected in that same staff and measure."
        : "Use the visible Do through Ti pitch buttons or Rest. Use Alt with Up or Down to select a staff.";
  const rangeGuidance = rangeDestinationMode
    ? `${rangeDestinationMode === "copy" ? "Copy" : "Move"} range: tap the destination beat in the selected staff. Existing music is never overwritten. Swipe blank space to scroll. Escape cancels.`
    : rangeSelectionMode
      ? "Range selection: tap the first and last note or rest. Whole chords and connected ties are included. Swipe to scroll, then tap an endpoint on another system."
      : "Shift-click a note or use Shift with Left or Right Arrow to extend a range. Select range offers the same action by touch.";
  const scoreControlLabel = keyboardRow
    ? `${score.metadata.title}. ${countLabel(score.parts.length, "part")}, ${countLabel(score.measureOrder.length, "measure")}. Selected ${keyboardRow.part.name}, staff ${keyboardRow.staffIndex + 1}, ${keyboardRow.staff.clef} clef.${selectedEventContext} Click or tap a note or rest to select it, then use Edit selection to change its notation. Drag a notehead up or down to change that tone and its tied notes. Drag left or right to move the whole chord and its linked notes to another beat or measure in the same staff. The initial direction chooses pitch or time. Use the Left and Right Arrow keys to select events. ${rangeGuidance} With a note selected, Up and Down edit that tone by a semitone; Shift changes an octave, preserving ties. Shift Z or X adds the input pitch one octave below or above to the selected chord. Numbers 1 through 7 edit selected event length; tilde cycles its dots. Without selection, only input settings change. Tab moves to the next measure input position and creates a measure at the end; Shift Tab moves back. ${rangeDestinationMode || rangeSelectionMode ? "" : entryMethodGuidance}`
    : `${score.metadata.title}. No editable staff rows.`;
  const engravingPending = !interactiveRenderBlocked && engravingState.source !== engravingSource && !renderError;
  const firstExceeded = engravingPlan.exceeded[0];
  const engravingSurfaceStyle = {
    width: `${engravingWidth}px`,
    height: `${renderHeight}px`,
    transform: `scale(${scale})`,
    "--engraving-ui-scale": 1 / scale,
  } as React.CSSProperties;

  return (
    <div ref={frameRef} className="engraving-frame" style={{ height: `${renderHeight * scale}px` }} aria-busy={engravingPending}>
      {playbackFollowEnabled && followHeld && playbackSeconds !== null ? <button type="button" className="playback-follow-return" onClick={() => { forceFollowRef.current = true; setFollowHold({ revision: playbackFollowRevision, held: false }); }} title="Resume following the current playback position">Follow playback</button> : null}
      <div className="engraving-scroll-size" style={{ width: `${engravingWidth * scale}px`, height: `${renderHeight * scale}px` }}>
        <div className="engraving-surface" style={engravingSurfaceStyle}>
          {systems.flatMap((_, systemIndex) => highlightedRows.map((row) => (
            <div
              className="staff-selection"
              key={`${systemIndex}-${row.staff.id}`}
              style={{ top: TOP_PADDING + systemIndex * systemHeight + row.rowIndex * rowHeight, height: rowHeight }}
            />
          )))}
          {rangeRectangles.map(([key, rect]) => (
            <div key={key} className="event-selection event-range-selection" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-hidden="true" />
          ))}
          {selectedEventLayout && !selectedEventIds.length ? (
            <div
              className="event-selection"
              style={{ left: selectedEventLayout.x, top: selectedEventLayout.y, width: selectedEventLayout.width, height: selectedEventLayout.height }}
              aria-hidden="true"
            />
          ) : null}
          {noteEntryMethod === "score-pointer" && visiblePointerNotePreview ? (
            <div
              className={`pointer-note-preview ${visiblePointerNotePreview.unsupported ? "unsupported" : ""}`}
              style={{ left: visiblePointerNotePreview.x, top: visiblePointerNotePreview.y }}
              aria-hidden="true"
            ><span>{visiblePointerNotePreview.label}</span></div>
          ) : null}
          {visibleRangeDestination ? (
            <div className={`pointer-note-preview event-move-preview score-range-destination ${visibleRangeDestination.destination ? "" : "unsupported"}`} style={{ left: visibleRangeDestination.x, top: visibleRangeDestination.y }} role="status">
              <span>{visibleRangeDestination.label}</span>
            </div>
          ) : null}
          {visibleNoteDrag?.kind === "pitch" ? (
            <div
              className="pointer-note-preview notehead-drag-preview"
              style={{
                left: visibleNoteDrag.layout.x + visibleNoteDrag.layout.width / 2,
                top: visibleNoteDrag.layout.centerY - (diatonicPitchIndex(visibleNoteDrag.pitch) - diatonicPitchIndex(visibleNoteDrag.layout.pitch)) * visibleNoteDrag.layout.lineSpacing / 2,
              }}
              role="status"
            ><span>{visibleNoteDrag.activated
              ? `${pitchName(visibleNoteDrag.pitch)} · ${visibleNoteDrag.layout.tied ? "linked notes follow · " : ""}release to apply · Esc cancels`
              : "Up/down: pitch · Left/right: beat or measure"}</span></div>
          ) : visibleNoteDrag?.kind === "time" ? (
            <div
              className={`pointer-note-preview event-move-preview ${visibleNoteDrag.destination ? "" : "unsupported"}`}
              style={{ left: visibleNoteDrag.x, top: visibleNoteDrag.y }}
              role="status"
            ><span>{visibleNoteDrag.label}</span></div>
          ) : null}
          {entryCursor ? (
            <div className="entry-caret" style={{ left: entryCursor.x, top: entryCursor.top }} aria-hidden="true"><span>NEXT</span></div>
          ) : null}
          {playbackCursor ? (
            <div
              className="notation-playhead"
              style={{ left: playbackCursor.x, top: playbackCursor.top, height: playbackCursor.height }}
              aria-hidden="true"
            ><span>{playbackCursor.label}</span></div>
          ) : null}
          <div ref={hostRef} className="vexflow-host" aria-hidden="true" />
          {!interactiveRenderBlocked ? <button type="button" className={`score-hit-target ${rangeDestinationMode ? "score-range-destination" : noteEntryMethod === "score-pointer" && !rangeSelectionMode ? "score-pointer-entry" : ""}`} onClick={handleClick} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={cancelPointerInput} onPointerLeave={cancelPointerInput} onLostPointerCapture={cancelPointerInput} onKeyDown={handleRowKeyDown} aria-label={scoreControlLabel} /> : null}
          {noteheadLayouts.map((layout) => (
            <button
              key={layout.noteId}
              type="button"
              className={`notehead-hit-target ${layout.noteId === selectedNoteId || layout.noteId === visibleNoteDrag?.layout.noteId || rangeEventIds.has(layout.eventId) ? "selected" : ""} ${onPlaybackSeek || rangeInteraction ? "range-interaction" : ""}`}
              style={{ left: layout.x - 4 / scale, top: layout.y - 4 / scale, width: layout.width + 8 / scale, height: layout.height + 8 / scale }}
              tabIndex={layout.noteId === selectedNoteId ? 0 : -1}
              aria-label={`${pitchName(layout.pitch)} in measure ${score.measures[layout.measureId]?.number ?? layout.measureId}${layout.tied ? ", tied note" : ""}. ${onPlaybackSeek ? "Tap to play from this beat" : rangeDestinationMode ? "Tap to place the range at this beat" : rangeSelectionMode ? "Tap to choose a range endpoint" : `${layout.draggable ? "Drag up or down to change pitch. " : ""}Drag left or right to move the chord and linked notes. Shift-click to extend a range`}`}
              aria-pressed={rangeEventIds.has(layout.eventId) || layout.noteId === selectedNoteId}
              onPointerDown={(event) => handleNotePointerDown(event, layout)}
              onPointerMove={handleNotePointerMove}
              onPointerUp={handleNotePointerUp}
              onPointerCancel={() => { cancelPointerInput(); cancelNoteDrag(); }}
              onPointerLeave={() => { if (pointerTapRef.current?.notehead) cancelPointerInput(); }}
              onLostPointerCapture={() => { cancelPointerInput(); cancelNoteDrag(); }}
              onContextMenu={(event) => event.preventDefault()}
              onClick={(event) => { if (event.detail === 0) selectNotehead(layout, event.shiftKey); }}
              onKeyDown={handleRowKeyDown}
            />
          ))}
        </div>
      </div>
      {engravingPlan.kind === "part-fallback" ? (
        <div className="engraving-fallback" role="status">
          Full-score engraving is above the live drawing budget. Showing {parts[0]?.name ?? "the selected part"} without changing or truncating the score.
        </div>
      ) : null}
      {interactiveRenderBlocked ? (
        <div className="engraving-deferred" role="status">
          <strong>Interactive engraving paused to keep this score responsive.</strong>
          <span>{countLabel(score.measureOrder.length, "measure")} × {countLabel(rows.length, "staff row")} is above this alpha&apos;s safe single-page drawing budget.</span>
          {firstExceeded ? <span>{LIVE_LIMIT_LABELS[firstExceeded]}: {engravingPlan.stats[firstExceeded].toLocaleString("en-US")} · live limit {LIVE_ENGRAVING_LIMITS[firstExceeded].toLocaleString("en-US")}</span> : null}
          <span>{viewMode === "score" ? "Switch to Part view to try a smaller layout. Your full score remains intact and can still be exported." : "Your score remains intact and can still be exported. Split the document into a smaller part for visual editing."}</span>
        </div>
      ) : null}
      {engravingPending ? <div className="engraving-loading" role="status">Preparing notation…</div> : null}
      {renderError ? <div className="engraving-error" role="alert"><span>{renderError}</span><button type="button" onClick={() => {
        setEngravingState({ source: null, measureLayouts: [], eventLayouts: [], noteheadLayouts: [], staffHitLayouts: [], error: "" });
        setRenderAttempt((attempt) => attempt + 1);
      }}>Retry engraving</button></div> : null}
    </div>
  );
}
