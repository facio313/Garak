"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Beam as VexBeam, Stave as VexStave, StaveNote, Voice as VexVoice } from "vexflow";
import { keySignaturesEqual, resolveMeasureAccidentals, timeSignaturesEqual } from "../lib/music/engraving";
import { fifthsToVexFlowKey, writtenKeyForPart } from "../lib/music/key-signatures";
import { getDefaultBeamGroups, getFullMeasureDuration } from "../lib/music/meter";
import type { MusicEvent, PartData, ScoreDocument, StaffData, VoiceData } from "../lib/music/model";

interface ScoreRendererProps {
  score: ScoreDocument;
  selectedPartId: string;
  viewMode: "score" | "part";
  zoom: number;
  onSelectPart: (partId: string) => void;
  selectedStaffId?: string;
  onSelectStaff?: (staffId: string) => void;
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

const ROW_HEIGHT = 86;
const SYSTEM_GAP = 42;
const LABEL_WIDTH = 88;
const RIGHT_MARGIN = 14;
const VEXFLOW_ARTICULATION_CODES = {
  staccato: "a.",
  tenuto: "a-",
  accent: "a>",
  marcato: "a^",
} as const;

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
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
  return Math.max(96, Math.min(430, ...(widths.length ? widths : [96])));
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

export function ScoreRenderer({ score, selectedPartId, viewMode, zoom, onSelectPart, selectedStaffId, onSelectStaff }: ScoreRendererProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [physicalWidth, setPhysicalWidth] = useState(640);
  const [renderError, setRenderError] = useState("");
  const parts = useMemo(() => viewMode === "part" ? score.parts.filter((part) => part.id === selectedPartId) : score.parts, [score.parts, selectedPartId, viewMode]);
  const { rows, partGroups } = useMemo(() => buildRenderRows(parts), [parts]);
  const scale = Math.max(.55, Math.min(1.5, zoom / 100));
  const renderWidth = Math.max(640, Math.floor(physicalWidth / scale));
  const systems = useMemo(() => buildSystems(score, rows, renderWidth), [renderWidth, rows, score]);
  const systemHeight = rows.length * ROW_HEIGHT + SYSTEM_GAP;
  const renderHeight = Math.max(230, systems.length * systemHeight + 22);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let initialized = false;
    let resizeTimer: number | null = null;
    let pendingWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      pendingWidth = Math.max(320, Math.floor(entry.contentRect.width));
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
    async function draw() {
      const host = hostRef.current;
      if (!host) return;
      host.replaceChildren();
      if (!rows.length) {
        setRenderError("");
        return;
      }
      try {
        const { Accidental, Articulation, Beam, Dot, Formatter, Fraction, GhostNote, ModifierPosition, Renderer, Stave, StaveConnector, StaveNote, StaveTie, TextDynamics, Voice } = await import("vexflow/bravura");
        if (disposed || !hostRef.current) return;
        const renderer = new Renderer(host, Renderer.Backends.SVG);
        renderer.resize(renderWidth, renderHeight);
        const context = renderer.getContext();
        context.setFillStyle("#25251f");
        context.setStrokeStyle("#30302a");
        const noteRefs = new Map<string, { note: StaveNote; index: number; systemIndex: number }>();
        const tiedDestinations = new Set(score.ties.map((tie) => tie.toNoteId));
        const absoluteIndex = new Map(score.measureOrder.map((measureId, index) => [measureId, index]));

        systems.forEach((system, systemIndex) => {
          const yBase = 18 + systemIndex * systemHeight;
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
            const cells: Array<{ voice: VexVoice; dynamicsVoice?: VexVoice; notes: StaveNote[]; beams: VexBeam[]; stave: VexStave }> = [];

            rows.forEach((row) => {
              const stave = stavesByMeasure[measureIndex][row.rowIndex];
              const voiceData = getStaffVoice(row, measureId);
              const isEmptyMeasure = voiceData.events.length === 0;
              const sourceEvents: MusicEvent[] = isEmptyMeasure ? [{ id: `placeholder-${row.staff.id}-${measureId}`, kind: "rest", duration: { base: 1, dots: 0 } }] : voiceData.events;
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
              cells.push({ voice, dynamicsVoice, notes, beams, stave });
            });

            const noteStartX = Math.max(...cells.map((cell) => cell.stave.getNoteStartX()));
            cells.forEach((cell) => cell.stave.setNoteStartX(noteStartX));
            const justifyWidth = Math.max(24, cells[0].stave.getNoteEndX() - noteStartX);
            const voices = cells.flatMap((cell) => cell.dynamicsVoice ? [cell.voice, cell.dynamicsVoice] : [cell.voice]);
            new Formatter().joinVoices(voices).format(voices, justifyWidth, { context });
            cells.forEach((cell) => {
              cell.voice.draw(context, cell.stave);
              cell.dynamicsVoice?.draw(context, cell.stave);
              cell.beams.forEach((beam) => beam.setContext(context).draw());
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
        setRenderError("");
      } catch (error) {
        setRenderError(error instanceof Error ? error.message : "The score could not be engraved.");
      }
    }
    void draw();
    return () => { disposed = true; };
  }, [partGroups, renderHeight, renderWidth, rows, score, systemHeight, systems]);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!rows.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = (event.clientY - rect.top) / scale;
    const scoreY = localY - 18;
    if (scoreY < 0) return;
    const systemIndex = Math.floor(scoreY / systemHeight);
    if (systemIndex < 0 || systemIndex >= systems.length) return;
    const withinSystem = scoreY - systemIndex * systemHeight;
    if (withinSystem < 0 || withinSystem >= rows.length * ROW_HEIGHT) return;
    const row = rows[Math.floor(withinSystem / ROW_HEIGHT)];
    onSelectPart(row.part.id);
    onSelectStaff?.(row.staff.id);
  };

  const selectedStaffRow = selectedStaffId ? rows.find((row) => row.staff.id === selectedStaffId) : undefined;
  const highlightedRows = selectedStaffRow
    ? [selectedStaffRow]
    : viewMode === "score"
      ? rows.filter((row) => row.part.id === selectedPartId)
      : [];
  const keyboardRow = selectedStaffRow ?? rows.find((row) => row.part.id === selectedPartId) ?? rows[0];
  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
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
  };
  const scoreControlLabel = keyboardRow
    ? `${score.metadata.title}. ${countLabel(score.parts.length, "part")}, ${countLabel(score.measureOrder.length, "measure")}. Selected ${keyboardRow.part.name}, staff ${keyboardRow.staffIndex + 1}, ${keyboardRow.staff.clef} clef. Use the Up and Down Arrow keys to select a staff; use A through G to enter notes.`
    : `${score.metadata.title}. No editable staff rows.`;

  return (
    <div ref={frameRef} className="engraving-frame" style={{ height: `${renderHeight * scale}px` }}>
      <div className="engraving-surface" style={{ width: `${renderWidth}px`, height: `${renderHeight}px`, transform: `scale(${scale})` }}>
        {systems.flatMap((_, systemIndex) => highlightedRows.map((row) => (
          <div
            className="staff-selection"
            key={`${systemIndex}-${row.staff.id}`}
            style={{ top: 18 + systemIndex * systemHeight + row.rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
          />
        )))}
        <div ref={hostRef} className="vexflow-host" aria-hidden="true" />
        <button type="button" className="score-hit-target" onClick={handleClick} onKeyDown={handleRowKeyDown} aria-label={scoreControlLabel} />
      </div>
      {renderError ? <div className="engraving-error" role="alert">{renderError}</div> : null}
    </div>
  );
}
