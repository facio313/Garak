import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Garak notation studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Garak — Orchestra notation studio<\/title>/i);
  assert.match(html, />Garak</);
  assert.match(html, />Instruments</);
  assert.match(html, /\bExport\b/);
  assert.match(html, /Score canvas/);
  assert.match(html, /Open Garak or MusicXML score/);
  assert.match(html, /\.musicxml,\.xml/);
  assert.match(html, /aria-label="Concert key signature"/);
  assert.match(html, /aria-label="Change key and meter from measure"/);
  assert.equal((html.match(/data-measure-change-option/g) ?? []).length, 4);
  assert.match(html, /Applies from the selected measure until the next existing change\./);
  assert.match(html, /aria-label="Time signature from selected measure"/);
  assert.match(html, />Meter from here</);
  assert.match(html, />Concert key from here</);
  assert.equal((html.match(/data-key-signature-option/g) ?? []).length, 30);
  assert.match(html, /Automatic accidental from the selected part key signature/);
  assert.match(html, /Force sharp accidental/);
  assert.match(html, /Chord mode\. Add A through G to the last note event/);
  assert.match(html, /aria-pressed="false"[^>]*>Chord<\/button>/);
  assert.match(html, /aria-label="Remove last chord tone"[^>]*disabled/);
  assert.match(html, /aria-label="Dynamic on last event"/);
  assert.match(html, /aria-label="Articulation on last note event"/);
  assert.match(html, /id="score-title"[^>]*maxLength="200"/);
  assert.match(html, /type="number"[^>]*min="30"[^>]*max="300"[^>]*step="1"/);
  assert.match(html, />None<\/option>/);
  for (const dynamic of ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"]) {
    assert.match(html, new RegExp(`value="${dynamic}"`));
  }
  for (const articulation of ["staccato", "tenuto", "accent", "marcato"]) {
    assert.match(html, new RegExp(`value="${articulation}"`));
  }
  assert.match(html, /Applies from this event on the selected staff until the next dynamic\./);
  assert.match(html, /Applies to the latest note event on this staff; trailing rests are skipped\./);
  assert.match(html, /aria-label="Thirty-second note, shortcut 6"/);
  assert.match(html, /aria-label="Sixty-fourth note, shortcut 7"/);
  assert.match(html, /duration-icon duration-32[^>]*>[\s\S]*?duration-flag flag-3/);
  assert.match(html, /duration-icon duration-64[^>]*>[\s\S]*?duration-flag flag-4/);
  assert.match(html, /aria-label="Augmentation dots: none\. Activate for one dot"/);
  assert.match(html, />Written key</);
  assert.match(html, /aria-label="Measure controls"/);
  assert.match(html, /aria-label="Add empty measure"/);
  assert.match(html, /aria-label="Remove last empty measure"/);
  for (const meter of ["2/4", "3/4", "4/4", "5/8", "6/8", "7/8", "9/8", "12/8"]) {
    assert.match(html, new RegExp(`value="${meter.replace("/", "\\/")}"`));
  }
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("ships product metadata and removes the disposable starter", async () => {
  const [page, layout, packageJson, og, studio, styles, renderer, exporters] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/og.png", import.meta.url)),
    readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/ScoreRenderer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/music/exporters.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /NotationStudio/);
  assert.match(layout, /Garak — Orchestra notation studio/);
  assert.match(packageJson, /"vexflow"/);
  assert.match(packageJson, /"lucide-react"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(studio, /staff selection/);
  assert.ok(studio.includes('aria-label={`Select staff ${staffIndex + 1}, ${staff.clef} clef`}'));
  assert.ok(studio.includes("selectedStaffId={selectedStaff?.id}"));
  assert.ok(studio.includes("addChordTone(score, part.id, note, staffId)"));
  assert.ok(studio.includes("removeLastChordTone(score, part.id, staffId)"));
  assert.ok(studio.includes('`Removed ${pitchName(result.removedNote.pitch)} · Chord · ${countLabel(result.remainingNoteCount, "note")}`'));
  assert.ok(studio.includes("if (chordMode) removeChordTone()"));
  assert.ok(studio.includes('trimHistorySnapshots(proposedHistory, "end")'), "undo snapshots must honor the byte and entry budget");
  assert.ok(studio.includes('trimHistorySnapshots([score, ...items], "start")'), "redo snapshots must honor the byte and entry budget");
  assert.ok(studio.includes("oldest undo steps released to protect memory"), "history budget truncation must be surfaced to the editor");
  assert.ok(studio.includes("autosave paused — use Save now or New to replace preserved drafts"), "edits after recovery must keep the persistence pause visible");
  assert.ok(studio.includes("setRestMode(true);\n            setChordMode(false);"), "rest mode must disable chord entry");
  assert.ok(studio.includes("if (next) setRestMode(false);"), "chord mode must disable rest entry");
  assert.ok(studio.includes('aria-pressed={!restMode && !chordMode}'), "note mode must not appear active while chord mode is active");
  assert.ok(studio.includes("setLastEventDynamic(score, part.id, dynamic, part.staves[staffIndex].id)"));
  assert.ok(studio.includes("setLastNoteArticulation(score, part.id, articulation, part.staves[staffIndex].id)"));
  assert.ok(studio.includes("commit(\n      result.score,"), "articulation edits must enter the shared undo and autosave path");
  assert.ok(studio.includes("item.velocity / 127"), "live playback must consume semantic dynamic velocity");
  assert.ok(studio.includes("Math.min(.018, item.durationSeconds * .35)"), "live playback attack must fit short 32nd/64th note gates");
  assert.ok(studio.includes("Math.round(tempo || 96)"), "the UI must preserve the integer tempo contract used by MusicXML");
  assert.ok(studio.includes("selectPlaybackWindow(collectPlaybackNotes(score), 600)"), "large-score playback must choose a chronological cross-part window");
  assert.ok(studio.includes('Playing the first ${notes.length} of ${countLabel(playbackWindow.total, "note")}'), "playback truncation must be explicit and grammatical");
  assert.ok(studio.includes('Playing ${countLabel(notes.length, "note")}'), "single-note playback status must use the singular noun");
  assert.ok(studio.includes('countLabel(score.parts.length, "PART", "PARTS")'), "the instrument count must use singular and plural labels");
  assert.ok(studio.includes('countLabel(score.measureOrder.length, "measure")'), "the measure count must use singular and plural labels");
  assert.ok(renderer.includes('countLabel(score.parts.length, "part")'), "the accessible score label must pluralize part counts");
  assert.ok(renderer.includes('countLabel(score.measureOrder.length, "measure")'), "the accessible score label must pluralize measure counts");
  assert.ok(studio.includes("else if (selectedPart && activeStaffId) commit(removeLastEvent(score, selectedPart.id, activeStaffId)"));
  const removalCallback = studio.match(/const removeChordTone = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[commit, score, selectedPartId, selectedStaffId\]\);/)?.[1];
  assert.ok(removalCallback, "the chord-tone removal UI must have one shared callback");
  assert.equal((removalCallback.match(/\bcommit\(/g) ?? []).length, 1, "one tone removal must create exactly one undo step");
  assert.ok(studio.includes("const targetMeasureId = findLastEventMeasureId(score, part.id, staffIndex)"));
  assert.ok(studio.includes("writtenKeyForPart(score.measures[targetMeasureId].key, part)"));
  assert.ok(studio.includes("importMusicXML(contents)"));
  assert.ok(studio.includes('await import("../lib/music/importers")'), "the MusicXML parser must load only when an XML file is selected");
  assert.doesNotMatch(studio, /^import \{ importMusicXML \} from/m, "the initial studio chunk must not statically include the MusicXML parser");
  assert.ok(studio.includes("Cancel MusicXML import"));
  assert.ok(studio.includes("siblings.forEach((element) => { element.inert = true; })"), "modal background controls must become inert");
  assert.ok(studio.includes('document.addEventListener("keydown", handleDialogKey)'), "dialogs must trap Tab and handle Escape");
  assert.ok(studio.includes("previousFocus?.focus()"), "closing a dialog must restore the trigger focus");
  assert.equal((studio.match(/ref=\{activeDialogRef\} tabIndex=\{-1\}/g) ?? []).length, 4, "every modal must receive initial programmatic focus");
  assert.ok(studio.includes("Your current score is unchanged"));
  assert.ok(studio.includes("setPendingImport({ score: parsed, warnings: imported.warnings })"), "lossy MusicXML imports must remain staged");
  assert.ok(studio.includes("Cancel import"));
  assert.ok(studio.includes("Open editable copy"));
  assert.ok(studio.includes('aria-controls="score-inspector"'));
  assert.ok(studio.includes('aria-controls="instrument-drawer"'));
  assert.ok(studio.includes('role="group" aria-label="Export options"'));
  assert.ok(studio.includes('tabIndex={-1} aria-hidden="true"'), "the programmatic file input must not create a duplicate tab stop");
  assert.equal((studio.match(/aria-live="polite"/g) ?? []).length, 1, "status updates must have one live region");
  assert.match(styles, /\.properties-panel\.drawer-open/);
  assert.match(styles, /\.instrument-panel\.drawer-open/);
  assert.match(styles, /\.status-warning \.status-dot/);
  assert.match(styles, /\.status-error \.status-dot/);
  assert.doesNotMatch(styles, /\.mode-section, \.octave-control \{ display: none; \}/);
  assert.ok(studio.includes('`Chord · ${lastEvent.notes.length} notes`'));
  assert.match(studio, /Chord mode ignored for rests/);
  assert.doesNotMatch(studio, /Chords, tuplets/);
  assert.match(studio, /1–7/);
  assert.match(studio, /Cycle 0 → 1 → 2 dots/);
  assert.ok(studio.includes("nextAugmentationDotCount(dotCount)"));
  assert.ok(studio.includes("setTimeFromMeasure(score, activeChangeMeasureId"));
  assert.ok(studio.includes("setKeyFromMeasure(score, activeChangeMeasureId"));
  assert.ok(studio.includes("!changeMeterIsPreset ? <option value={changeMeterValue}>{changeMeterValue} · imported/custom</option>"), "an imported exact meter outside the presets must remain visibly selected");
  assert.ok(studio.includes("later changes kept"));
  assert.ok(studio.includes("commit(result.score, `Time signature"), "a meter range change enters the shared undo/autosave commit path once");
  assert.ok(studio.includes("commit(result.score, `${keySignatureName(key)} concert key"), "a key range change enters the shared undo/autosave commit path once");
  assert.ok(studio.includes("loadStoredScore(window.localStorage)"), "hydration must validate the primary and backup snapshots through the storage boundary");
  assert.ok(studio.includes("saveStoredScore(window.localStorage, score)"), "autosave and Save now must share the guarded storage boundary");
  assert.ok(studio.includes("Recovered the last-known-good backup — the damaged latest draft was preserved; autosave is paused until Save now or New"));
  assert.ok(studio.includes('setAutoSaveEnabled(stored.source === "primary")'), "backup recovery must preserve the damaged primary until explicit confirmation");
  assert.ok(studio.includes("Local save failed"));
  assert.ok(studio.includes("damaged drafts were preserved; autosave is paused until Save now or New"), "unrecoverable raw drafts must not be overwritten by the fresh score timer");
  assert.ok(studio.includes("Started a fresh score — local storage is unavailable"), "a blocked localStorage getter must still finish hydration with a fresh score");
  assert.ok(studio.includes("if (!hydrated || !autoSaveEnabled) return;"), "autosave must remain gated after an unrecoverable load");
  assert.match(studio, /finally \{\s*setHydrated\(true\);\s*\}/, "hydration must complete after every storage outcome");
  assert.equal((studio.match(/persistScoreLocally\(score\)/g) ?? []).length, 2, "debounced autosave and Save now must share getter-safe failure handling");
  const newScoreHandler = studio.match(/const createFromTemplate = \(templateId: string\) => \{([\s\S]*?)\n {2}\};/)?.[1];
  assert.ok(newScoreHandler?.includes("setMetadataDraft(next.metadata)"), "a new whole-document score must reset the editable metadata draft");
  assert.doesNotMatch(studio, /localStorage\.setItem\(/, "the UI must not bypass validation and backup rotation");
  assert.ok(renderer.includes('"d".repeat(event.duration.dots)'));
  assert.ok(renderer.includes("new TextDynamics({ duration, text: event.dynamic, line: 9 })"));
  assert.ok(renderer.includes("new Articulation(VEXFLOW_ARTICULATION_CODES[event.articulation]).setPosition(ModifierPosition.ABOVE)"));
  assert.ok(renderer.includes('await import("vexflow/bravura")'), "the renderer must use the audited three-font Bravura entry");
  for (const code of ['staccato: "a."', 'tenuto: "a-"', 'accent: "a>"', 'marcato: "a^"']) {
    assert.ok(renderer.includes(code), `the installed VexFlow articulation map must include ${code}`);
  }
  assert.ok(renderer.includes("new Fraction(fullMeasure.numerator, fullMeasure.denominator)"), "empty-meter rests must use a whole-note fraction rather than pre-scaled ticks");
  assert.ok(renderer.includes("dynamicsVoice?: VexVoice"), "cells without dynamics must not allocate a spacer voice");
  assert.ok(renderer.includes("cell.dynamicsVoice?.draw"), "optional dynamics voices must draw only when present");
  assert.ok(renderer.includes("window.setTimeout(() =>"), "continuous resize events must be coalesced before re-engraving");
  assert.ok(renderer.includes("}, 120)"), "resize re-engraving must use the bounded debounce interval");
  assert.ok(renderer.includes("window.clearTimeout(resizeTimer)"), "resize debounce timers must be replaced and cleaned up");
  assert.ok(renderer.includes("onKeyDown={handleRowKeyDown}"), "the score surface must expose keyboard staff-row navigation");
  assert.ok(renderer.includes("Use the Up and Down Arrow keys to select a staff"), "the bounded score label must explain keyboard staff selection");
  assert.doesNotMatch(renderer, /measureOrder\.indexOf\(/, "system layout must not scan the full measure order once per measure");
  assert.match(renderer, /dotIndex < event\.duration\.dots/);
  assert.ok(renderer.includes("if (atSystemStart || keyChanged)"), "key signatures render at system starts and actual change boundaries");
  assert.ok(renderer.includes("if (!previous || !timeSignaturesEqual(previous.time, measure.time))"), "meter symbols render only at actual boundaries");
  assert.ok(exporters.includes("measureIndex === 0 || keyChanged || timeChanged"), "MusicXML attributes are emitted only for the initial state or an actual boundary");
  assert.deepEqual([...og.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(og.readUInt32BE(16), 1200);
  assert.equal(og.readUInt32BE(20), 630);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", import.meta.url)));
});
