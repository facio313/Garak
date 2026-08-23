"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MusicEvent, PartData, ScoreDocument } from "../lib/music/model";
import { getPrimaryVoice } from "../lib/music/model";

interface ScoreRendererProps {
  score: ScoreDocument;
  selectedPartId: string;
  viewMode: "score" | "part";
  zoom: number;
  onSelectPart: (partId: string) => void;
}

const KEY_NAMES = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const ROW_HEIGHT = 82;
const SYSTEM_GAP = 34;

function vexKey(event: MusicEvent, clef: string): string[] {
  if (event.kind === "rest") return [clef === "bass" ? "d/3" : clef === "alto" ? "c/4" : "b/4"];
  return event.notes.map((note) => `${note.pitch.step.toLowerCase()}/${note.pitch.octave}`);
}

export function ScoreRenderer({ score, selectedPartId, viewMode, zoom, onSelectPart }: ScoreRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(820);
  const [renderError, setRenderError] = useState("");
  const parts = useMemo(() => viewMode === "part" ? score.parts.filter((part) => part.id === selectedPartId) : score.parts, [score.parts, selectedPartId, viewMode]);
  const systems = useMemo(() => {
    const result: string[][] = [];
    for (let index = 0; index < score.measureOrder.length; index += 4) result.push(score.measureOrder.slice(index, index + 4));
    return result;
  }, [score.measureOrder]);

  useEffect(() => {
    if (!hostRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(640, Math.floor(entry.contentRect.width))));
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    async function draw() {
      const host = hostRef.current;
      if (!host) return;
      host.replaceChildren();
      try {
        const { Accidental, Dot, Formatter, Renderer, Stave, StaveNote, StaveTie, Voice } = await import("vexflow");
        if (disposed || !hostRef.current) return;
        const renderWidth = Math.max(640, width);
        const systemHeight = parts.length * ROW_HEIGHT + SYSTEM_GAP;
        const renderHeight = Math.max(230, systems.length * systemHeight + 20);
        const renderer = new Renderer(host, Renderer.Backends.SVG);
        renderer.resize(renderWidth, renderHeight);
        const context = renderer.getContext();
        context.setFillStyle("#272722");
        context.setStrokeStyle("#34342f");
        const labelWidth = 86;
        const usableWidth = renderWidth - labelWidth - 20;
        const measureWidth = usableWidth / 4;
        const noteRefs = new Map<string, { note: InstanceType<typeof StaveNote>; index: number }>();

        systems.forEach((measureIds, systemIndex) => parts.forEach((part: PartData, partIndex: number) => {
          const y = 18 + systemIndex * systemHeight + partIndex * ROW_HEIGHT;
          context.save();
          context.setFont("11px Georgia");
          context.fillText(part.shortName, 8, y + 38);
          context.restore();
          measureIds.forEach((measureId, measureIndex) => {
            const measure = score.measures[measureId];
            const x = labelWidth + measureIndex * measureWidth;
            const stave = new Stave(x, y, measureWidth + .5);
            if (measureIndex === 0) {
              if (part.staves[0].clef !== "percussion") stave.addClef(part.staves[0].clef);
              else stave.addClef("percussion");
              const keyName = KEY_NAMES[Math.max(0, Math.min(14, measure.key.fifths + 7))];
              if (keyName && part.staves[0].clef !== "percussion") stave.addKeySignature(keyName);
              stave.addTimeSignature(`${measure.time.numerator}/${measure.time.denominator}`);
            }
            stave.setContext(context).draw();
            const voiceData = getPrimaryVoice(part, measureId);
            const sourceEvents: MusicEvent[] = voiceData.events.length ? voiceData.events : [{ id: `placeholder-${part.id}-${measureId}`, kind: "rest", duration: { base: 1, dots: 0 } }];
            const notes = sourceEvents.map((event) => {
              const duration = `${event.duration.base === 1 ? "w" : event.duration.base === 2 ? "h" : event.duration.base === 4 ? "q" : event.duration.base}${event.kind === "rest" ? "r" : ""}`;
              const note = new StaveNote({ keys: vexKey(event, part.staves[0].clef), duration, clef: part.staves[0].clef, autoStem: true });
              if (event.kind === "note") {
                event.notes.forEach((scoreNote, noteIndex) => {
                  const accidental = scoreNote.pitch.alter === -2 ? "bb" : scoreNote.pitch.alter === -1 ? "b" : scoreNote.pitch.alter === 1 ? "#" : scoreNote.pitch.alter === 2 ? "##" : null;
                  if (accidental && scoreNote.accidentalDisplay !== "hide") note.addModifier(new Accidental(accidental), noteIndex);
                  noteRefs.set(scoreNote.id, { note, index: noteIndex });
                });
              }
              if (event.duration.dots) Dot.buildAndAttach([note], { all: true });
              return note;
            });
            const voice = new Voice({ numBeats: measure.time.numerator, beatValue: measure.time.denominator }).setMode(Voice.Mode.SOFT).addTickables(notes);
            new Formatter().joinVoices([voice]).formatToStave([voice], stave);
            voice.draw(context, stave);
          });
        }));
        score.ties.forEach((tie) => {
          const first = noteRefs.get(tie.fromNoteId);
          const last = noteRefs.get(tie.toNoteId);
          if (first && last) new StaveTie({ firstNote: first.note, lastNote: last.note, firstIndexes: [first.index], lastIndexes: [last.index] }).setContext(context).draw();
        });
        setRenderError("");
      } catch (error) {
        setRenderError(error instanceof Error ? error.message : "The score could not be engraved.");
      }
    }
    void draw();
    return () => { disposed = true; };
  }, [parts, score, systems, width]);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!parts.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const systemHeight = parts.length * ROW_HEIGHT + SYSTEM_GAP;
    const withinSystem = Math.max(0, (localY - 18) % systemHeight);
    const index = Math.max(0, Math.min(parts.length - 1, Math.floor(withinSystem / ROW_HEIGHT)));
    onSelectPart(parts[index].id);
  };

  const selectedIndex = parts.findIndex((part) => part.id === selectedPartId);

  return (
    <div className="engraving-frame" style={{ width: `${zoom}%` }}>
      {selectedIndex >= 0 && viewMode === "score" ? systems.map((_, systemIndex) => <div className="staff-selection" key={systemIndex} style={{ top: 18 + systemIndex * (parts.length * ROW_HEIGHT + SYSTEM_GAP) + selectedIndex * ROW_HEIGHT, height: ROW_HEIGHT }} />) : null}
      <div ref={hostRef} className="vexflow-host" aria-hidden="true" />
      <button type="button" className="score-hit-target" onClick={handleClick} aria-label="Score. Select a staff, then use A through G to enter notes." />
      {renderError ? <div className="engraving-error" role="alert">{renderError}</div> : null}
    </div>
  );
}
