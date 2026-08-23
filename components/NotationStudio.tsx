"use client";

import {
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INSTRUMENTS, SCORE_TEMPLATES } from "../lib/music/catalog";
import { collectPlaybackNotes, scoreToMidi, scoreToMusicXML } from "../lib/music/exporters";
import { KEY_SIGNATURES, keySignatureAlterForStep, keySignatureName, writtenKeyForPart } from "../lib/music/key-signatures";
import type { KeySignature } from "../lib/music/key-signatures";
import type { DurationBase, DurationValue, PitchStep, ScoreDocument } from "../lib/music/model";
import { DURATION_LABELS, TICKS_PER_WHOLE, eventCount, getPrimaryVoice, pitchName, validateScore, voiceTicks } from "../lib/music/model";
import { addInstrument, appendEvent, appendMeasure, createScore, findEventTargetMeasureId, makeEvent, removeInstrument, removeLastEvent, removeLastMeasure, setScoreKey, toggleTieLastTwo, updatePart } from "../lib/music/score";
import { DurationIcon } from "./DurationIcon";
import { ScoreRenderer } from "./ScoreRenderer";

const STORAGE_KEY = "garak.score.v1";
const HISTORY_LIMIT = 100;
type AccidentalMode = "auto" | "sharp" | "flat" | "natural";

const DURATION_CHOICES: Array<{ value: DurationBase; shortcut: string }> = [
  { value: 1, shortcut: "1" },
  { value: 2, shortcut: "2" },
  { value: 4, shortcut: "3" },
  { value: 8, shortcut: "4" },
  { value: 16, shortcut: "5" },
];

function keyValue(key: KeySignature): string {
  return `${key.fifths}:${key.mode}`;
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

export function NotationStudio() {
  const [score, setScore] = useState<ScoreDocument>(() => createScore("chamber"));
  const [past, setPast] = useState<ScoreDocument[]>([]);
  const [future, setFuture] = useState<ScoreDocument[]>([]);
  const [selectedPartId, setSelectedPartId] = useState(() => createScore("chamber").parts[0].id);
  const [viewMode, setViewMode] = useState<"score" | "part">("score");
  const [duration, setDuration] = useState<DurationBase>(4);
  const [dotted, setDotted] = useState(false);
  const [restMode, setRestMode] = useState(false);
  const [accidentalMode, setAccidentalMode] = useState<AccidentalMode>("auto");
  const [octave, setOctave] = useState(4);
  const [zoom, setZoom] = useState(82);
  const [status, setStatus] = useState("Opening your local score…");
  const [hydrated, setHydrated] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [activeFamily, setActiveFamily] = useState("All");
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [metadataDraft, setMetadataDraft] = useState(score.metadata);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventSequence = useRef(1000);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const selectedPart = score.parts.find((part) => part.id === selectedPartId) ?? score.parts[0];
  const initialConcertKey = score.measures[score.measureOrder[0]].key;
  const selectedWrittenKey = selectedPart ? writtenKeyForPart(initialConcertKey, selectedPart) : initialConcertKey;
  const selectedEvents = selectedPart ? score.measureOrder.flatMap((measureId) => getPrimaryVoice(selectedPart, measureId).events) : [];
  const lastEvent = selectedEvents.at(-1);
  const totalEvents = eventCount(score);

  const commit = useCallback((next: ScoreDocument, message: string) => {
    if (next === score) {
      setStatus(message);
      return;
    }
    setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), score]);
    setFuture([]);
    setScore(next);
    setStatus(message);
  }, [score]);

  const undo = useCallback(() => {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [score, ...items].slice(0, HISTORY_LIMIT));
    setScore(previous);
    setMetadataDraft(previous.metadata);
    setSelectedPartId((current) => previous.parts.some((part) => part.id === current) ? current : previous.parts[0]?.id ?? "");
    setStatus("Undid the last edit");
  }, [past, score]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), score]);
    setScore(next);
    setMetadataDraft(next.metadata);
    setSelectedPartId((current) => next.parts.some((part) => part.id === current) ? current : next.parts[0]?.id ?? "");
    setStatus("Redid the edit");
  }, [future, score]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as ScoreDocument;
          const errors = validateScore(stored);
          if (!errors.length) {
            setScore(stored);
            setSelectedPartId(stored.parts[0].id);
            setMetadataDraft(stored.metadata);
            setStatus("Recovered your local score");
          } else setStatus("Started a fresh score — the saved draft was incompatible");
        } else setStatus("Ready — changes save on this device");
      } catch {
        setStatus("Started a fresh score — the saved draft could not be read");
      } finally {
        setHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(score));
      setStatus("Saved locally");
    }, 450);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [hydrated, score]);

  const saveNow = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(score));
    setStatus("Saved locally");
  }, [score]);

  const stopPlayback = useCallback(() => {
    if (playbackTimerRef.current) window.clearInterval(playbackTimerRef.current);
    playbackTimerRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setPlaying(false);
    setPlayhead(0);
    setStatus("Playback stopped");
  }, []);

  const playScore = useCallback(() => {
    if (playing) {
      stopPlayback();
      return;
    }
    const notes = collectPlaybackNotes(score).slice(0, 600);
    if (!notes.length) {
      setStatus("Add a note before playback");
      return;
    }
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = Math.min(.32, .9 / Math.sqrt(Math.max(1, score.parts.length)));
    master.connect(context.destination);
    const start = context.currentTime + .08;
    const total = Math.max(...notes.map((note) => note.startSeconds + note.durationSeconds));
    notes.forEach((item, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const part = score.parts.find((candidate) => candidate.id === item.partId);
      oscillator.type = part?.instrument.family === "Brass" ? "sawtooth" : part?.instrument.family === "Strings" ? "triangle" : "sine";
      oscillator.frequency.value = 440 * 2 ** ((item.midi - 69) / 12);
      const noteStart = start + item.startSeconds;
      const noteEnd = noteStart + item.durationSeconds;
      gain.gain.setValueAtTime(.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(index % 3 === 0 ? .09 : .065, noteStart + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, noteEnd);
      oscillator.connect(gain).connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + .02);
    });
    audioContextRef.current = context;
    setPlaying(true);
    setStatus(`Playing ${notes.length} notes at ♩ = ${score.tempo}`);
    const startedAt = performance.now();
    playbackTimerRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000;
      setPlayhead(Math.min(100, elapsed / total * 100));
      if (elapsed >= total + .15) stopPlayback();
    }, 40);
  }, [playing, score, stopPlayback]);

  const enterEvent = useCallback((step: PitchStep, forceRest = false) => {
    if (!selectedPart) return;
    const eventId = `event-${Date.now()}-${eventSequence.current++}`;
    const durationValue: DurationValue = { base: duration, dots: dotted ? 1 : 0 };
    const targetMeasureId = findEventTargetMeasureId(score, selectedPart.id, durationValue) ?? score.measureOrder.at(-1)!;
    const entryWrittenKey = writtenKeyForPart(score.measures[targetMeasureId].key, selectedPart);
    const alter = inputAlter(accidentalMode, entryWrittenKey, step);
    const event = makeEvent({
      id: eventId,
      pitch: { step, alter, octave },
      duration: durationValue,
      rest: restMode || forceRest,
      accidentalDisplay: accidentalMode === "auto" ? "auto" : "force",
    });
    const result = appendEvent(score, selectedPart.id, event);
    if (result.error) setStatus(result.error);
    else commit(result.score, `${event.kind === "rest" ? "Entered rest" : `Entered ${pitchName(event.notes[0].pitch)}`} · ${DURATION_LABELS[duration]}`);
  }, [accidentalMode, commit, dotted, duration, octave, restMode, score, selectedPart]);

  const toggleTie = useCallback(() => {
    if (!selectedPart) return;
    const result = toggleTieLastTwo(score, selectedPart.id);
    if (result.error) setStatus(result.error);
    else commit(result.score, result.tied ? "Tied the last two notes" : "Removed the tie");
  }, [commit, score, selectedPart]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") { setAddOpen(false); setNewOpen(false); setHelpOpen(false); setExportOpen(false); return; }
      const typing = target?.matches("input, textarea, select, [contenteditable='true']") || (target?.matches("button") && !target.classList.contains("score-hit-target"));
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
        if (selectedPart) commit(removeLastEvent(score, selectedPart.id), "Removed the last event");
        return;
      }
      if (event.key === ".") { event.preventDefault(); setDotted((value) => !value); return; }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); if (!event.repeat) enterEvent("C", true); return; }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); if (!event.repeat) toggleTie(); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setOctave((value) => Math.min(8, value + 1)); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setOctave((value) => Math.max(0, value - 1)); return; }
      const durationIndex = Number(event.key) - 1;
      if (durationIndex >= 0 && durationIndex < DURATION_CHOICES.length) {
        event.preventDefault();
        setDuration(DURATION_CHOICES[durationIndex].value);
        return;
      }
      const step = event.key.toUpperCase();
      if (["A", "B", "C", "D", "E", "F", "G"].includes(step)) {
        event.preventDefault();
        if (!event.repeat) enterEvent(step as PitchStep);
      }
      if (event.key === "?") { event.preventDefault(); setHelpOpen(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commit, enterEvent, playScore, redo, saveNow, score, selectedPart, toggleTie, undo]);

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
    setScore(next);
    setPast([]);
    setFuture([]);
    setSelectedPartId(next.parts[0].id);
    setViewMode("score");
    setNewOpen(false);
    setStatus(`Created ${next.metadata.subtitle}`);
  };

  const importScore = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("This score is larger than the 10 MB safety limit.");
      const parsed = JSON.parse(await file.text()) as ScoreDocument;
      const errors = validateScore(parsed);
      if (errors.length) throw new Error(errors[0]);
      setScore(parsed);
      setPast([]);
      setFuture([]);
      setSelectedPartId(parsed.parts[0].id);
      setStatus(`Opened ${parsed.metadata.title}`);
    } catch (error) {
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
    const safeTempo = Math.max(30, Math.min(300, tempo || 96));
    if (safeTempo === score.tempo) return;
    const next = structuredClone(score);
    next.tempo = safeTempo;
    next.updatedAt = new Date().toISOString();
    commit(next, `Tempo set to ${safeTempo}`);
  };

  const setMeter = (value: string) => {
    const [numerator, denominator] = value.split("/").map(Number);
    const capacity = numerator * TICKS_PER_WHOLE / denominator;
    const overflow = score.parts.some((part) => score.measureOrder.some((measureId) => voiceTicks(getPrimaryVoice(part, measureId)) > capacity));
    if (overflow) {
      setStatus(`Cannot change to ${value}: at least one measure contains more music than it can hold.`);
      return;
    }
    const next = structuredClone(score);
    next.measureOrder.forEach((measureId) => { next.measures[measureId].time = { numerator, denominator }; });
    next.updatedAt = new Date().toISOString();
    commit(next, `Time signature set to ${value}`);
  };

  const setKeySignature = (value: string) => {
    const option = KEY_SIGNATURES.find((candidate) => keyValue(candidate) === value);
    if (!option) {
      setStatus("Choose a supported major or minor key signature.");
      return;
    }
    const key: KeySignature = { fifths: option.fifths, mode: option.mode };
    if (keyValue(initialConcertKey) === keyValue(key)) return;
    commit(setScoreKey(score, key), `Concert key set to ${keySignatureName(key)}`);
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
    commit(result.score, `Removed empty measure ${result.measureNumber}`);
  };

  return (
    <main className="studio-shell">
      <header className="app-header">
        <div className="brand" aria-label="Garak Studio"><span className="brand-mark">G</span><span>Garak</span><span className="beta-tag">ALPHA</span></div>
        <button className="project-title" onClick={() => document.getElementById("score-title")?.focus()} aria-label="Edit score details">
          <span className="eyebrow">{viewMode === "score" ? "FULL SCORE" : "LINKED PART"}</span>
          <strong>{score.metadata.title}</strong>
        </button>
        <div className="save-state" aria-live="polite"><span className="status-dot" />{status}</div>
        <div className="transport">
          <button className="icon-button" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 size={16} /></button>
          <button className="icon-button" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={16} /></button>
          <button className={`play-button ${playing ? "playing" : ""}`} onClick={playScore} aria-label={playing ? "Stop playback" : "Play score"}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
        </div>
        <div className="header-actions">
          <button className="quiet-button" onClick={() => setNewOpen(true)}><Plus size={14} /> New</button>
          <button className="icon-button" onClick={() => fileInputRef.current?.click()} aria-label="Open Garak score"><FolderOpen size={16} /></button>
          <button className="icon-button" onClick={saveNow} aria-label="Save now"><Save size={16} /></button>
          <button className="icon-button" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts"><Keyboard size={16} /></button>
          <div className="export-anchor">
            <button className="primary-button" onClick={() => setExportOpen((value) => !value)} aria-expanded={exportOpen}><Download size={14} /> Export <ChevronDown size={13} /></button>
            {exportOpen ? (
              <div className="export-menu" role="menu">
                <button onClick={exportMusicXML}><FileMusic size={16} /><span><strong>MusicXML</strong><small>Open in notation apps</small></span></button>
                <button onClick={exportMidi}><FileDown size={16} /><span><strong>MIDI</strong><small>Performance data</small></span></button>
                <button onClick={exportNative}><FileJson size={16} /><span><strong>Garak JSON</strong><small>Editable native snapshot</small></span></button>
                <button onClick={() => { setExportOpen(false); window.print(); }}><Printer size={16} /><span><strong>Print / PDF</strong><small>Clean score pages</small></span></button>
              </div>
            ) : null}
          </div>
        </div>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".json,.garak" onChange={(event) => { void importScore(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </header>

      <section className="note-toolbar" aria-label="Notation tools">
        <div className="tool-section mode-section"><span className="toolbar-label">INPUT</span><button className={`mode-pill ${!restMode ? "active" : ""}`} onClick={() => setRestMode(false)}>Note</button><button className={`mode-pill ${restMode ? "active" : ""}`} onClick={() => setRestMode(true)}>Rest</button></div>
        <div className="tool-group note-values">
          {DURATION_CHOICES.map((choice) => (
            <button className={`tool-button note-button ${duration === choice.value ? "active" : ""}`} key={choice.value} onClick={() => setDuration(choice.value)} aria-label={`${DURATION_LABELS[choice.value]} note, shortcut ${choice.shortcut}`}>
              <DurationIcon value={choice.value} /><kbd>{choice.shortcut}</kbd>
            </button>
          ))}
        </div>
        <div className="tool-group" role="group" aria-label="Accidental input mode">
          <button className={`mode-pill ${accidentalMode === "auto" ? "active" : ""}`} onClick={() => setAccidentalMode("auto")} aria-label="Automatic accidental from the selected part key signature" aria-pressed={accidentalMode === "auto"}>Auto</button>
          <button className={`tool-button accidental ${accidentalMode === "sharp" ? "active" : ""}`} onClick={() => setAccidentalMode("sharp")} aria-label="Force sharp accidental" aria-pressed={accidentalMode === "sharp"}>♯</button>
          <button className={`tool-button accidental ${accidentalMode === "flat" ? "active" : ""}`} onClick={() => setAccidentalMode("flat")} aria-label="Force flat accidental" aria-pressed={accidentalMode === "flat"}>♭</button>
          <button className={`tool-button accidental ${accidentalMode === "natural" ? "active" : ""}`} onClick={() => setAccidentalMode("natural")} aria-label="Force natural accidental" aria-pressed={accidentalMode === "natural"}>♮</button>
        </div>
        <div className="tool-group">
          <button className={`tool-button dot-tool ${dotted ? "active" : ""}`} onClick={() => setDotted(!dotted)} aria-label="Dotted duration">·<kbd>.</kbd></button>
          <button className="tool-button tie-tool" onClick={toggleTie} aria-label="Tie the last two matching notes">⌒<kbd>T</kbd></button>
        </div>
        <div className="octave-control"><button onClick={() => setOctave(Math.max(0, octave - 1))} aria-label="Lower octave">−</button><span><small>OCTAVE</small>{octave}</span><button onClick={() => setOctave(Math.min(8, octave + 1))} aria-label="Raise octave">＋</button></div>
        <div className="pitch-keys" aria-label="Enter pitch">
          {(["C", "D", "E", "F", "G", "A", "B"] as PitchStep[]).map((step) => {
            const previewAlter = inputAlter(accidentalMode, selectedWrittenKey, step);
            const suffix = previewAlter === 0 && accidentalMode === "auto" ? "" : accidentalGlyph(previewAlter);
            return <button key={step} onClick={() => enterEvent(step)} aria-label={`Enter ${step}${suffix}${octave}, ${accidentalMode} accidental mode`}><span>{step}{suffix}{octave}</span><kbd>{step}</kbd></button>;
          })}
          <button className="rest-key" onClick={() => enterEvent("C", true)}><span>Rest</span><kbd>R</kbd></button>
        </div>
        <div className="toolbar-spacer" />
        <div className="zoom-control"><button onClick={() => setZoom(Math.max(55, zoom - 10))} aria-label="Zoom out"><Minus size={13} /></button><span>{zoom}%</span><button onClick={() => setZoom(Math.min(150, zoom + 10))} aria-label="Zoom in"><Plus size={13} /></button></div>
      </section>

      <div className="workspace">
        <aside className="instrument-panel">
          <div className="panel-heading"><div><span className="eyebrow">{score.parts.length} PARTS</span><h2>Instruments</h2></div><button className="round-button" onClick={() => setAddOpen(true)} aria-label="Add instrument"><Plus size={15} /></button></div>
          <div className="instrument-list">
            {score.parts.map((part, index) => (
              <button className={`instrument-row ${part.id === selectedPartId ? "selected" : ""}`} key={part.id} onClick={() => setSelectedPartId(part.id)}>
                <span className="family-line" style={{ background: part.instrument.color }} />
                <span className="instrument-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="instrument-name"><strong>{part.name}</strong><small>{part.instrument.family}{part.instrument.transposition.chromatic || part.instrument.transposition.octaveChange ? " · transposing" : ""}</small></span>
                <span className="mini-mixers"><span className={part.muted ? "on" : ""} title="Muted">M</span><span className={part.solo ? "on" : ""} title="Solo">S</span></span>
              </button>
            ))}
          </div>
          <button className="add-staff-button" onClick={() => setAddOpen(true)}><Plus size={13} /> Add instrument</button>
          <div className="panel-footer"><button className={`view-tab ${viewMode === "score" ? "active" : ""}`} onClick={() => setViewMode("score")}><Music2 size={14} /> Score</button><button className={`view-tab ${viewMode === "part" ? "active" : ""}`} onClick={() => setViewMode("part")}><FileMusic size={14} /> Part</button></div>
        </aside>

        <section className="canvas-area" aria-label="Score canvas">
          <div className="canvas-controls">
            <span>{viewMode === "score" ? `${score.parts.length}-part score` : selectedPart?.name}</span><span className="separator">•</span><span>{score.measureOrder.length} measures</span><span className="separator">•</span><span>{totalEvents} events</span>
            <span className="tool-section" role="group" aria-label="Measure controls">
              <button className="mode-pill" onClick={addEmptyMeasure} aria-label="Add empty measure"><Plus size={11} aria-hidden="true" /> Measure</button>
              <button className="mode-pill" onClick={removeEmptyMeasure} aria-label="Remove last empty measure"><Trash2 size={11} aria-hidden="true" /> Remove empty measure</button>
            </span>
            <span className="canvas-hint"><kbd>A–G</kbd> pitch <kbd>R</kbd> rest <kbd>⌫</kbd> delete <kbd>Space</kbd> play</span>
          </div>
          <article className="score-page">
            <div className="score-heading"><p>{score.metadata.subtitle.toUpperCase()}</p><h1>{score.metadata.title}</h1><span>{score.metadata.composer}</span></div>
            {playing ? <div className="playhead" style={{ left: `${12 + playhead * .76}%` }} aria-hidden="true" /> : null}
            <ScoreRenderer score={score} selectedPartId={selectedPartId} viewMode={viewMode} zoom={zoom} onSelectPart={setSelectedPartId} />
            <span className="page-number">1</span>
          </article>
        </section>

        <aside className="properties-panel">
          <div className="panel-heading compact"><div><span className="eyebrow">INSPECTOR</span><h2>{lastEvent ? "Last event" : "Score setup"}</h2></div></div>
          {selectedPart ? (
            <div className="selection-summary">
              <span className="selection-icon">{lastEvent?.kind === "rest" ? "𝄽" : "♪"}</span>
              <span><strong>{lastEvent?.kind === "note" ? pitchName(lastEvent.notes[0].pitch) : lastEvent?.kind === "rest" ? "Rest" : selectedPart.name}</strong><small>{selectedPart.name} · {DURATION_LABELS[lastEvent?.duration.base ?? duration]}</small></span>
            </div>
          ) : null}
          <div className="inspector-section">
            <div className="section-title"><span>Score</span></div>
            <label>Title<input id="score-title" value={metadataDraft.title} onChange={(event) => setMetadataDraft({ ...metadataDraft, title: event.target.value })} onBlur={applyMetadata} /></label>
            <label>Composer<input value={metadataDraft.composer} onChange={(event) => setMetadataDraft({ ...metadataDraft, composer: event.target.value })} onBlur={applyMetadata} /></label>
            <label>Tempo<span className="input-suffix"><input type="number" min="30" max="300" defaultValue={score.tempo} key={score.tempo} onBlur={(event) => setTempo(Number(event.target.value))} /><small>BPM</small></span></label>
            <label>Meter<select value={`${score.measures[score.measureOrder[0]].time.numerator}/${score.measures[score.measureOrder[0]].time.denominator}`} onChange={(event) => setMeter(event.target.value)}><option value="2/4">2/4</option><option value="3/4">3/4</option><option value="4/4">4/4</option><option value="5/8">5/8</option><option value="6/8">6/8</option><option value="7/8">7/8</option><option value="9/8">9/8</option><option value="12/8">12/8</option></select></label>
            <label>Concert key<select aria-label="Concert key signature" value={keyValue(initialConcertKey)} onChange={(event) => setKeySignature(event.target.value)}>
              {(["major", "minor"] as const).map((mode) => <optgroup key={mode} label={mode === "major" ? "Major keys" : "Minor keys"}>
                {KEY_SIGNATURES.filter((key) => key.mode === mode).map((key) => <option data-key-signature-option key={keyValue(key)} value={keyValue(key)}>{key.label}</option>)}
              </optgroup>)}
            </select></label>
          </div>
          {selectedPart ? (
            <div className="inspector-section">
              <div className="section-title"><span>Part</span><span className="family-badge" style={{ color: selectedPart.instrument.color }}>{selectedPart.instrument.family}</span></div>
              <label>Instrument<output>{selectedPart.name}</output></label>
              <label>Clef<output>{selectedPart.staves[0].clef}</output></label>
              <label>Written key<output aria-label={`${selectedPart.name} written key`}>{keySignatureName(selectedWrittenKey)}</output></label>
              <label>Written C sounds<output>{selectedPart.instrument.transposition.chromatic + selectedPart.instrument.transposition.octaveChange * 12 > 0 ? "+" : ""}{selectedPart.instrument.transposition.chromatic + selectedPart.instrument.transposition.octaveChange * 12} st</output></label>
              <div className="mixer-buttons"><button className={selectedPart.muted ? "active" : ""} onClick={() => commit(updatePart(score, selectedPart.id, { muted: !selectedPart.muted }), selectedPart.muted ? "Unmuted part" : "Muted part")}><Volume2 size={13} /> Mute</button><button className={selectedPart.solo ? "active" : ""} onClick={() => commit(updatePart(score, selectedPart.id, { solo: !selectedPart.solo }), selectedPart.solo ? "Unsoloed part" : "Soloed part")}>S Solo</button></div>
              <button className="danger-link" onClick={() => { const next = removeInstrument(score, selectedPart.id); setSelectedPartId(next.parts[0]?.id ?? ""); commit(next, `Removed ${selectedPart.name}`); }} disabled={score.parts.length <= 1}><Trash2 size={13} /> Remove part</button>
            </div>
          ) : null}
          <div className="shortcut-card"><span>QUICK INPUT</span><p><kbd>1–5</kbd> duration <kbd>.</kbd> dotted</p><p><kbd>A–G</kbd> pitch <kbd>R</kbd> rest</p><p><kbd>T</kbd> tie <kbd>⌫</kbd> delete</p><p><kbd>↑ ↓</kbd> octave <kbd>Space</kbd> play</p><button onClick={() => setHelpOpen(true)}>View all shortcuts <ChevronDown size={12} /></button></div>
        </aside>
      </div>

      {newOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewOpen(false); }}>
          <section className="modal template-modal" role="dialog" aria-modal="true" aria-labelledby="new-score-title"><header><div><span className="eyebrow">START A SCORE</span><h2 id="new-score-title">Choose an ensemble</h2><p>You can add, remove, and reorder instruments later.</p></div><button className="icon-button" onClick={() => setNewOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="template-grid">{SCORE_TEMPLATES.map((template, index) => <button key={template.id} onClick={() => createFromTemplate(template.id)}><span className="template-number">0{index + 1}</span><Music2 size={22} /><strong>{template.name}</strong><small>{template.description}</small><em>{template.instruments.length} {template.instruments.length === 1 ? "part" : "parts"}</em></button>)}</div>
          </section>
        </div>
      ) : null}

      {addOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <section className="modal instrument-modal" role="dialog" aria-modal="true" aria-labelledby="add-instrument-title"><header><div><span className="eyebrow">ORCHESTRA LIBRARY</span><h2 id="add-instrument-title">Add an instrument</h2><p>{INSTRUMENTS.length} standard orchestral, keyboard, and vocal definitions.</p></div><button className="icon-button" onClick={() => setAddOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="instrument-search"><Search size={16} /><input value={instrumentQuery} onChange={(event) => setInstrumentQuery(event.target.value)} placeholder="Search flute, B♭ clarinet, violin…" aria-label="Search instruments" /></div>
            <div className="family-tabs">{["All", "Woodwinds", "Brass", "Percussion", "Keyboards", "Voices", "Strings"].map((family) => <button key={family} className={activeFamily === family ? "active" : ""} onClick={() => setActiveFamily(family)}>{family}</button>)}</div>
            <div className="catalog-list">{filteredInstruments.map((instrument) => <button key={instrument.catalogId} onClick={() => { const next = addInstrument(score, instrument.catalogId); commit(next, `Added ${instrument.name}`); setSelectedPartId(next.parts.at(-1)!.id); setAddOpen(false); }}><span className="catalog-color" style={{ background: instrument.color }} /><span><strong>{instrument.name}</strong><small>{instrument.family} · {instrument.clef} clef{instrument.transposition.chromatic || instrument.transposition.octaveChange ? ` · ${instrument.transposition.chromatic + instrument.transposition.octaveChange * 12} semitones` : ""}</small></span><Plus size={15} /></button>)}</div>
          </section>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><header><div><span className="eyebrow">KEYBOARD FIRST</span><h2 id="shortcut-title">Compose without leaving the score</h2><p>Shortcuts are ignored while you type in a text field.</p></div><button className="icon-button" onClick={() => setHelpOpen(false)} aria-label="Close"><X size={18} /></button></header>
            <div className="shortcut-grid"><div><span>Notes</span><p><kbd>A–G</kbd> Enter written pitch</p><p><kbd>R</kbd> Enter a rest</p><p><kbd>T</kbd> Tie matching notes</p><p><kbd>↑</kbd><kbd>↓</kbd> Change octave</p><p><kbd>⌫</kbd> Delete last event</p></div><div><span>Rhythm</span><p><kbd>1–5</kbd> Whole → sixteenth</p><p><kbd>.</kbd> Toggle dotted duration</p></div><div><span>Project</span><p><kbd>⌘ Z</kbd> Undo</p><p><kbd>⌘ ⇧ Z</kbd> Redo</p><p><kbd>⌘ S</kbd> Save locally</p><p><kbd>⌘ P</kbd> Print / PDF</p></div><div><span>Playback</span><p><kbd>Space</kbd> Play / stop</p><p><kbd>?</kbd> This guide</p></div></div>
            <footer><CircleHelp size={15} /><span>This alpha supports one voice per staff. Chords, tuplets, articulations, and linked-part layout follow in the roadmap.</span></footer>
          </section>
        </div>
      ) : null}
      <div className="sr-status" aria-live="polite">{status}</div>
    </main>
  );
}
