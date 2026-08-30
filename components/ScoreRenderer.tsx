"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Beam as VexBeam, Stave as VexStave, StaveNote, Voice as VexVoice } from "vexflow";
import { keySignaturesEqual, resolveMeasureAccidentals, timeSignaturesEqual } from "../lib/music/engraving";
import { LIVE_ENGRAVING_LIMITS, planLiveEngraving } from "../lib/music/engraving-budget";
import { fifthsToVexFlowKey, writtenKeyForPart } from "../lib/music/key-signatures";
import { getDefaultBeamGroups, getFullMeasureDuration } from "../lib/music/meter";
import type { MusicEvent, PartData, ScoreDocument, StaffData, VoiceData } from "../lib/music/model";
import { DURATION_LABELS, durationTicks, measureCapacity, pitchName } from "../lib/music/model";
import { locatePlaybackPosition } from "../lib/music/playback-position";

export interface ScoreEventSelection {
  partId: string;
  staffId: string;
  measureId: string;
  eventId: string;
}

interface ScoreRendererProps {
  score: ScoreDocument;
  selectedPartId: string;
  viewMode: "score" | "part";
  zoom: number;
  onSelectPart: (partId: string) => void;
  selectedStaffId?: string;
  onSelectStaff?: (staffId: string) => void;
  playbackSeconds?: number | null;
  entryMeasureId?: string | null;
  entryTick?: number;
  selectedEventId?: string | null;
  inputFollowRevision?: number;
  onSelectEvent?: (selection: ScoreEventSelection | null) => void;
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

interface MeasureScreenLayout {
  measureId: string;
  systemIndex: number;
  startX: number;
  endX: number;
  top: number;
  height: number;
  tickAnchors: Array<{ tick: number; x: number }>;
}

interface EventScreenLayout extends ScoreEventSelection {
  systemIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
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

const ROW_HEIGHT = 86;
const SYSTEM_GAP = 42;
const LABEL_WIDTH = 88;
const RIGHT_MARGIN = 14;
const TOP_PADDING = 32;
const FOLLOW_MARGIN = 12;
const EMPTY_MEASURE_LAYOUTS: readonly MeasureScreenLayout[] = [];
const EMPTY_EVENT_LAYOUTS: readonly EventScreenLayout[] = [];
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
  const targetTop = frameBounds.top + rect.y * scale;
  const targetBottom = frameBounds.top + (rect.y + rect.height) * scale;
  let verticalDelta = 0;
  const targetCoversVerticalViewport = targetTop <= canvasBounds.top && targetBottom >= canvasBounds.bottom;
  if (!targetCoversVerticalViewport) {
    if (targetTop < canvasBounds.top) verticalDelta = targetTop - canvasBounds.top - FOLLOW_MARGIN;
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
    y: TOP_PADDING + systemIndex * systemHeight + rowIndex * ROW_HEIGHT,
    width: engravingWidth,
    height: ROW_HEIGHT,
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

function xForMeasureTick(layout: MeasureScreenLayout, tick: number, capacity: number): number {
  const safeTick = Math.max(0, Math.min(capacity, tick));
  const anchors = [
    ...(layout.tickAnchors.length ? layout.tickAnchors : [{ tick: 0, x: layout.startX }]),
    { tick: capacity, x: layout.endX },
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
  entryMeasureId = null,
  entryTick = 0,
  selectedEventId = null,
  inputFollowRevision = 0,
  onSelectEvent,
}: ScoreRendererProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const completedInputFollowRef = useRef(inputFollowRevision);
  const engravingRequestRef = useRef(0);
  const [physicalWidth, setPhysicalWidth] = useState(640);
  const [engravingState, setEngravingState] = useState<EngravingState>({
    source: null,
    measureLayouts: [],
    eventLayouts: [],
    error: "",
  });
  const [renderAttempt, setRenderAttempt] = useState(0);
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
  const systemHeight = rows.length * ROW_HEIGHT + SYSTEM_GAP;
  const renderHeight = interactiveRenderBlocked ? 230 : Math.max(230, systems.length * systemHeight + TOP_PADDING + 4);
  const engravingSource = useMemo<EngravingSource>(
    () => ({ score, rows, renderWidth }),
    [renderWidth, rows, score],
  );
  const layoutsAreCurrent = engravingState.source === engravingSource;
  const measureLayouts = layoutsAreCurrent ? engravingState.measureLayouts : EMPTY_MEASURE_LAYOUTS;
  const eventLayouts = layoutsAreCurrent ? engravingState.eventLayouts : EMPTY_EVENT_LAYOUTS;
  const renderError = layoutsAreCurrent ? engravingState.error : "";

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
    let disposed = false;
    const requestId = ++engravingRequestRef.current;
    async function draw() {
      const host = hostRef.current;
      if (!host) return;
      host.replaceChildren();
      if (interactiveRenderBlocked) {
        if (!disposed && requestId === engravingRequestRef.current && hostRef.current === host) {
          setEngravingState({ source: engravingSource, measureLayouts: [], eventLayouts: [], error: "" });
        }
        return;
      }
      if (!rows.length) {
        if (!disposed && requestId === engravingRequestRef.current && hostRef.current === host) {
          setEngravingState({ source: engravingSource, measureLayouts: [], eventLayouts: [], error: "" });
        }
        return;
      }
      try {
        const { Accidental, Articulation, Beam, Dot, Formatter, Fraction, GhostNote, ModifierPosition, Renderer, Stave, StaveConnector, StaveNote, StaveTie, TextDynamics, Voice } = await import("vexflow/bravura");
        if (disposed || requestId !== engravingRequestRef.current || hostRef.current !== host) return;
        const renderer = new Renderer(host, Renderer.Backends.SVG);
        renderer.resize(engravingWidth, renderHeight);
        const context = renderer.getContext();
        context.setFillStyle("#25251f");
        context.setStrokeStyle("#30302a");
        const noteRefs = new Map<string, { note: StaveNote; index: number; systemIndex: number }>();
        const tiedDestinations = new Set(score.ties.map((tie) => tie.toNoteId));
        const absoluteIndex = new Map(score.measureOrder.map((measureId, index) => [measureId, index]));
        const nextMeasureLayouts: MeasureScreenLayout[] = [];
        const nextEventLayouts: EventScreenLayout[] = [];

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
            context.fillText(group.part.shortName, 8, yBase + centerRow * ROW_HEIGHT + 38);
            context.restore();
          });

          rows.forEach((row) => {
            const y = yBase + row.rowIndex * ROW_HEIGHT;
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
              const x = (note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2;
              anchorXs.set(tick, [...(anchorXs.get(tick) ?? []), x]);
            }));
            const tickAnchors = [...anchorXs.entries()]
              .sort(([left], [right]) => left - right)
              .map(([tick, xs]) => ({ tick, x: xs.reduce((sum, x) => sum + x, 0) / xs.length }));
            nextMeasureLayouts.push({
              measureId,
              systemIndex,
              startX: noteStartX,
              endX: noteEndX - Stave.defaultPadding,
              top: TOP_PADDING + systemIndex * systemHeight + 5,
              height: Math.max(56, rows.length * ROW_HEIGHT - 10),
              tickAnchors,
            });
            cells.forEach((cell) => {
              cell.voice.draw(context, cell.stave);
              cell.dynamicsVoice?.draw(context, cell.stave);
              cell.beams.forEach((beam) => beam.setContext(context).draw());
              if (!cell.placeholder) {
                cell.notes.forEach((note, noteIndex) => {
                  const bounds = note.getBoundingBox();
                  const noteHeadStart = note.getNoteHeadBeginX();
                  const noteHeadEnd = note.getNoteHeadEndX();
                  const x = Math.min(bounds.x, noteHeadStart) - 7;
                  const width = Math.max(bounds.w, noteHeadEnd - noteHeadStart, 12) + 14;
                  nextEventLayouts.push({
                    partId: cell.row.part.id,
                    staffId: cell.row.staff.id,
                    measureId,
                    eventId: cell.events[noteIndex].id,
                    systemIndex,
                    x,
                    y: bounds.y - 7,
                    width,
                    height: Math.max(bounds.h, 30) + 14,
                  });
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
        if (!disposed && requestId === engravingRequestRef.current && hostRef.current === host) {
          setEngravingState({
            source: engravingSource,
            measureLayouts: nextMeasureLayouts,
            eventLayouts: nextEventLayouts,
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
          error: error instanceof Error ? error.message : "The score could not be engraved.",
        });
      }
    }
    void draw();
    return () => { disposed = true; };
  }, [engravingSource, engravingWidth, interactiveRenderBlocked, partGroups, renderAttempt, renderHeight, rows, score, systemHeight, systems]);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!rows.length || !layoutsAreCurrent) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = (event.clientX - rect.left) / scale;
    const localY = (event.clientY - rect.top) / scale;
    const directHit = eventLayouts
      .map((layout) => ({
        layout,
        distance: pointToRectDistance(localX, localY, layout),
        centerDistance: pointToRectCenterDistance(localX, localY, layout),
      }))
      .filter(({ distance }) => distance === 0)
      .sort((left, right) => left.centerDistance - right.centerDistance)[0]?.layout;
    if (directHit) {
      onSelectPart(directHit.partId);
      onSelectStaff?.(directHit.staffId);
      onSelectEvent?.({
        partId: directHit.partId,
        staffId: directHit.staffId,
        measureId: directHit.measureId,
        eventId: directHit.eventId,
      });
      return;
    }

    const scoreY = localY - TOP_PADDING;
    if (scoreY < 0) return;
    const systemIndex = Math.floor(scoreY / systemHeight);
    if (systemIndex < 0 || systemIndex >= systems.length) return;
    const withinSystem = scoreY - systemIndex * systemHeight;
    if (withinSystem < 0 || withinSystem >= rows.length * ROW_HEIGHT) return;
    const row = rows[Math.floor(withinSystem / ROW_HEIGHT)];
    onSelectPart(row.part.id);
    onSelectStaff?.(row.staff.id);
    const nearest = eventLayouts
      .filter((layout) => (
        layout.partId === row.part.id && layout.staffId === row.staff.id && layout.systemIndex === systemIndex
      ))
      .map((layout) => ({
        layout,
        distance: pointToRectDistance(localX, localY, layout),
        centerDistance: pointToRectCenterDistance(localX, localY, layout),
      }))
      .filter(({ distance }) => distance <= 22 / scale)
      .sort((left, right) => left.distance - right.distance || left.centerDistance - right.centerDistance)[0]?.layout;
    onSelectEvent?.(nearest ? {
      partId: nearest.partId,
      staffId: nearest.staffId,
      measureId: nearest.measureId,
      eventId: nearest.eventId,
    } : null);
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
    top: TOP_PADDING + entryLayout.systemIndex * systemHeight + selectedStaffRow.rowIndex * ROW_HEIGHT + 8,
  } : null;
  const entryCursorX = entryCursor?.x;
  const entryCursorTop = entryCursor?.top;
  const selectedEventLayout = selectedEventId ? eventLayouts.find((layout) => layout.eventId === selectedEventId) : undefined;

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
    if (!layoutsAreCurrent || !playbackCursor) return;
    scrollScreenRectIntoView(frameRef.current, {
      x: playbackCursor.x - 1,
      y: playbackCursor.top,
      width: 2,
      height: playbackCursor.height,
    }, scale);
  }, [layoutsAreCurrent, playbackCursor, scale]);

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
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
      onSelectEvent?.({
        partId: nextEvent.partId,
        staffId: nextEvent.staffId,
        measureId: nextEvent.measureId,
        eventId: nextEvent.eventId,
      });
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
      scrollStaffRowIntoView(frameRef.current, next.rowIndex, systems.length, systemHeight, engravingWidth, scale);
    }
  };
  const selectedEventDetails = useMemo(
    () => findSelectedEventDetails(score, selectedEventId),
    [score, selectedEventId],
  );
  const selectedEventContext = selectedEventDetails
    ? ` Selected ${accessibleEventLabel(selectedEventDetails.event)} in part ${selectedEventDetails.part.name}, staff ${selectedEventDetails.staffIndex + 1}, measure ${score.measures[selectedEventDetails.measureId]?.number ?? selectedEventDetails.measureId}.`
    : selectedEventId
      ? " The selected event is no longer available."
      : " No event selected; input uses the NEXT marker.";
  const scoreControlLabel = keyboardRow
    ? `${score.metadata.title}. ${countLabel(score.parts.length, "part")}, ${countLabel(score.measureOrder.length, "measure")}. Selected ${keyboardRow.part.name}, staff ${keyboardRow.staffIndex + 1}, ${keyboardRow.staff.clef} clef.${selectedEventContext} Click or tap a note or rest to select it for deletion. Use the Left and Right Arrow keys to select events, the Up and Down Arrow keys to select a staff, and A through G to enter notes.`
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
      <div className="engraving-scroll-size" style={{ width: `${engravingWidth * scale}px`, height: `${renderHeight * scale}px` }}>
        <div className="engraving-surface" style={engravingSurfaceStyle}>
          {systems.flatMap((_, systemIndex) => highlightedRows.map((row) => (
            <div
              className="staff-selection"
              key={`${systemIndex}-${row.staff.id}`}
              style={{ top: TOP_PADDING + systemIndex * systemHeight + row.rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
            />
          )))}
          {selectedEventLayout ? (
            <div
              className="event-selection"
              style={{ left: selectedEventLayout.x, top: selectedEventLayout.y, width: selectedEventLayout.width, height: selectedEventLayout.height }}
              aria-hidden="true"
            />
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
          {!interactiveRenderBlocked ? <button type="button" className="score-hit-target" onClick={handleClick} onKeyDown={handleRowKeyDown} aria-label={scoreControlLabel} /> : null}
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
        setEngravingState({ source: null, measureLayouts: [], eventLayouts: [], error: "" });
        setRenderAttempt((attempt) => attempt + 1);
      }}>Retry engraving</button></div> : null}
    </div>
  );
}
