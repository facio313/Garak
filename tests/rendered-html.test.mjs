import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("exposes a non-cached deployment health check", async () => {
  const response = await render("/healthz");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { service: "garak", status: "ok" });
});

test("server-renders the Garak notation studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Garak — Orchestra notation studio<\/title>/i);
  assert.match(html, />Garak</);
  assert.match(html, /class="bonifacio-return-link"[^>]*href="https:\/\/bonifacio\.work\/"[^>]*aria-label="← Bonifacio"/);
  assert.match(html, /<span>←<\/span><span class="bonifacio-return-label">Bonifacio<\/span>/);
  assert.doesNotMatch(html, /class="bonifacio-return-link"[^>]*target=/);
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
  assert.match(html, /Applies from the latest event[\s\S]*?on this staff until the next dynamic\./);
  assert.match(html, /Applies to the latest note on this staff; trailing rests are skipped\./);
  assert.match(html, /aria-label="Thirty-second note, shortcut 6"/);
  assert.match(html, /aria-label="Sixty-fourth note, shortcut 7"/);
  assert.match(html, /<svg[^>]*duration-icon duration-32/);
  assert.match(html, /<svg[^>]*duration-icon duration-64/);
  assert.match(html, /aria-label="Augmentation dots: none\. Activate for one dot"/);
  assert.match(html, /class="mobile-input-dock"[^>]*aria-label="Quick notation input"/);
  assert.match(html, /class="mobile-pitch-keys"[^>]*aria-label="Enter pitch or rest"/);
  assert.match(html, /class="[^"]*\bdelete-input-button\b[^"]*"[^>]*aria-label="Delete [^"]+"/);
  assert.match(html, /class="[^"]*\bmobile-delete-button\b[^"]*"[^>]*aria-label="Delete [^"]+"/);
  assert.match(html, /aria-label="Undo last edit"/);
  assert.match(html, /aria-label="Redo edit"/);
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
  const [page, layout, packageJson, og, studio, styles, renderer, durationIcon, playbackPosition, exporters] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/og.png", import.meta.url)),
    readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/ScoreRenderer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/DurationIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/music/playback-position.ts", import.meta.url), "utf8"),
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
  assert.ok(studio.includes("addChordToneToEvent(score, part.id, staffId, exactChordTarget.measureId, exactChordTarget.eventId, note)"), "subsequent Chord input must target the exact selected seed even when first-fit inserted it before a later event");
  assert.ok(studio.includes('latestChordEvent?.kind === "note"'), "Chord mode must seed a new chord instead of rejecting the first pitch or a pitch after a rest");
  assert.ok(studio.includes("Started chord with"), "the first pitch entered in Chord mode must explain that it started a chord");
  assert.ok(studio.includes('chordMode ? "Start a chord with"'), "pitch controls must announce the correct empty-chord action");
  assert.ok(studio.includes("removeLastChordTone(score, part.id, staffId)"));
  assert.ok(studio.includes('`Removed ${pitchName(result.removedNote.pitch)} · Chord · ${countLabel(result.remainingNoteCount, "note")} · Undo is available`'));
  assert.ok(studio.includes("const removeLatestInput = useCallback"), "keyboard and visible Delete controls must share one deletion callback");
  assert.equal((studio.match(/onClick=\{\(\) => removeLatestInput\(\)\}/g) ?? []).length, 2, "desktop and mobile must each expose the non-collapsing shared Delete action");
  assert.ok(studio.includes('className="mobile-input-dock" aria-label="Quick notation input"'), "touch input must have a dedicated persistent dock");
  assert.ok(studio.includes('className="mobile-pitch-keys" role="group" aria-label="Enter pitch or rest"'), "the mobile dock must keep every pitch and Rest together");
  assert.ok(studio.includes('className="mobile-rest-meta"'), "the narrowest layout must be able to move Rest aside and enlarge all seven pitch targets");
  assert.match(styles, /\.mobile-input-meta>\.mobile-rest-meta \{ display: none; \}/, "the narrow Rest shortcut must not create an implicit extra grid row above its breakpoint");
  const deleteCallback = studio.match(/const removeLatestInput = useCallback\(\(collapseTime = false\) => \{([\s\S]*?)\n {2}\}, \[[^\]]+\]\);\n\n {2}const applyDynamic/)?.[1];
  assert.ok(deleteCallback, "visible and keyboard deletion must have one bounded callback");
  assert.ok(deleteCallback.includes("removeEvent("), "a score selection must delete that exact event instead of falling back to the latest input");
  assert.ok(deleteCallback.includes("clearEventToRest("), "ordinary Delete must clear a selected note to a same-duration rest instead of collapsing the timeline");
  assert.ok(deleteCallback.includes('selectedEvent.kind === "note" && !collapseTime'), "Shift+Delete must remain an explicit opt-in for timeline collapse");
  assert.ok(deleteCallback.includes("selectedEventTarget.measureId"), "selected deletion must preserve the clicked measure target");
  assert.ok(deleteCallback.includes("setSelectedEventTarget(null)"), "a removed selection must be cleared instead of leaving a stale highlight");
  assert.ok(deleteCallback.includes("Nothing to delete on the selected staff"), "deletion without a target must report a no-op");
  assert.ok(deleteCallback.includes("removeChordTone();"), "Chord mode must preserve event rhythm while removing one tone");
  assert.ok(deleteCallback.indexOf("deleteRemovesChordTone") < deleteCallback.indexOf("selectedEvent && selectedEventTarget"), "Chord-mode Delete must remove one tone before an event-level selection can delete the whole chord");
  assert.ok(studio.includes('Delete clears it to a rest; Shift+Delete removes its time'), "selection feedback must explain rhythm-preserving and collapsing delete choices");
  assert.ok(deleteCallback.includes("removeLastEvent(score, selectedPart.id, activeStaffId)"), "normal Delete must remain staff-targeted");
  assert.equal((deleteCallback.match(/\bcommit\(/g) ?? []).length, 3, "clear-to-rest, collapse-time, and previous-event deletion branches must each create one undo step");
  assert.ok(studio.includes('trimStudioHistory(proposedHistory, "end")'), "undo snapshots must honor the byte and entry budget");
  assert.ok(studio.includes('trimStudioHistory([{ score, selection: selectedEventTarget }, ...items], "start")'), "redo snapshots must honor the byte and entry budget");
  assert.ok(studio.includes("entries.map((entry) => entry.score)"), "history budgeting must measure score snapshots while retaining their paired selection metadata");
  assert.ok(studio.includes("oldest undo steps released to protect memory"), "history budget truncation must be surfaced to the editor");
  assert.ok(studio.includes("autosave paused — use Save now or New to replace preserved drafts"), "edits after recovery must keep the persistence pause visible");
  assert.doesNotMatch(studio, /\brestMode\b/, "a dedicated Rest action must replace the misleading persistent rest mode");
  assert.ok(studio.includes("const enteringRest = forceRest;"), "only the explicit Rest action must create a rest");
  assert.ok(studio.includes('aria-pressed={!chordMode}'), "note mode must not appear active while chord mode is active");
  assert.ok(studio.includes("setLastEventDynamic(score, part.id, dynamic, part.staves[staffIndex].id)"));
  assert.ok(studio.includes("setLastNoteArticulation(score, part.id, articulation, part.staves[staffIndex].id)"));
  assert.ok(studio.includes("setEventDynamic("), "the inspector must edit the exact selected event instead of silently changing the latest one");
  assert.ok(studio.includes("selectedEventTarget.measureId"), "selected inspector edits must retain their exact measure target");
  assert.ok(studio.includes("setEventArticulation("), "the inspector must edit the exact selected note articulation");
  assert.ok(studio.includes('Articulations apply to notes; select a note instead of a rest.'), "a selected rest must never redirect an articulation edit to another note");
  assert.ok(studio.includes("commit(\n      result.score,"), "articulation edits must enter the shared undo and autosave path");
  assert.ok(studio.includes("item.velocity / 127"), "live playback must consume semantic dynamic velocity");
  assert.ok(studio.includes("Math.min(.018, item.durationSeconds * .35)"), "live playback attack must fit short 32nd/64th note gates");
  assert.ok(studio.includes("Math.round(tempo || 96)"), "the UI must preserve the integer tempo contract used by MusicXML");
  assert.ok(studio.includes("selectPlaybackWindow(collectPlaybackNotes(score), 600)"), "large-score playback must choose a chronological cross-part window");
  assert.ok(studio.includes('Playing the first ${notes.length} of ${countLabel(playbackWindow.total, "note")}'), "playback truncation must be explicit and grammatical");
  assert.ok(studio.includes('Playing ${countLabel(notes.length, "note")}'), "single-note playback status must use the singular noun");
  assert.ok(studio.includes("context.currentTime - start"), "the visual cursor must share Web Audio's scheduled clock and pre-roll");
  assert.doesNotMatch(studio, /performance\.now\(\)/, "playback must not mix the document clock with the AudioContext clock");
  assert.ok(studio.includes("scoreNotatedDurationSeconds(score)"), "playback must keep the cursor through the complete score timeline, including engraved trailing measures");
  assert.ok(studio.includes("note.startSeconds + note.notatedDurationSeconds"), "a truncated or articulated playback window must end on its rhythmic span rather than its shortened oscillator gate");
  assert.ok(studio.includes("No audible notes — check the instrument Mute and Solo controls"), "playback must distinguish an empty score from a muted or excluded performance");
  assert.ok((studio.match(/cancelPlayback\(\);/g) ?? []).length >= 4, "editing, history, new-score, and import paths must cancel stale scheduled playback");
  assert.ok(studio.includes('countLabel(score.parts.length, "PART", "PARTS")'), "the instrument count must use singular and plural labels");
  assert.ok(studio.includes('countLabel(score.measureOrder.length, "measure")'), "the measure count must use singular and plural labels");
  assert.ok(renderer.includes('countLabel(score.parts.length, "part")'), "the accessible score label must pluralize part counts");
  assert.ok(renderer.includes('countLabel(score.measureOrder.length, "measure")'), "the accessible score label must pluralize measure counts");
  assert.ok(studio.includes("removeLatestInput(event.shiftKey);"), "Backspace/Delete must use the guarded deletion path and reserve Shift for explicit timeline collapse");
  assert.match(studio, /event\.key === "Backspace" \|\| event\.key === "Delete"[\s\S]*?if \(event\.repeat\) return;[\s\S]*?removeLatestInput\(event\.shiftKey\);/, "held destructive shortcuts must not cascade from clearing a note into deleting its preserved rest");
  assert.ok(studio.includes("selectedEventTarget.partId === selectedPart?.id"), "a stale selection must never delete an event from a previously active part");
  assert.ok(studio.includes("selectedEventTarget.staffId === activeStaffId"), "a selected event must belong to the currently active staff");
  assert.equal((studio.match(/const restoredSelection = revalidateEventSelection\(/g) ?? []).length, 2, "undo and redo must preserve an exact chord seed when it still exists in the destination snapshot");
  assert.ok(studio.includes("revalidateEventSelection(next.score, next.selection)"), "Redo must restore a seed selection that disappeared during Undo and returned with its score snapshot");
  assert.equal((studio.match(/restoredSelection\?\.partId \?\? selectedPartId/g) ?? []).length, 2, "history must reactivate the part that owns a restored exact event selection");
  assert.equal((studio.match(/restoredSelection\?\.staffId \?\? selectedStaffId/g) ?? []).length, 2, "history must reactivate the staff that owns a restored exact event selection");
  const removalCallback = studio.match(/const removeChordTone = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[[^\]]+\]\);/)?.[1];
  assert.ok(removalCallback, "the chord-tone removal UI must have one shared callback");
  assert.equal((removalCallback.match(/\bcommit\(/g) ?? []).length, 1, "one tone removal must create exactly one undo step");
  assert.ok(removalCallback.includes("removeChordToneFromEvent("), "Chord-mode Delete must remove one tone from the exact selected chord");
  assert.ok(studio.includes("primaryEventOnsetTicks("), "the Chord preview caret must use the selected event onset instead of the end of its voice");
  assert.ok(studio.includes("? findLastEventMeasureId(score, part.id, staffIndex)"));
  assert.ok(studio.includes("writtenKeyForPart(score.measures[targetMeasureId].key, part)"));
  assert.ok(studio.includes("importMusicXML(contents)"));
  assert.ok(studio.includes('await import("../lib/music/importers")'), "the MusicXML parser must load only when an XML file is selected");
  assert.doesNotMatch(studio, /^import \{ importMusicXML \} from/m, "the initial studio chunk must not statically include the MusicXML parser");
  assert.ok(studio.includes("Cancel MusicXML import"));
  assert.ok(studio.includes("siblings.forEach((element) => { element.inert = true; })"), "modal background controls must become inert");
  assert.ok(studio.includes('document.addEventListener("keydown", handleDialogKey)'), "dialogs must trap Tab and handle Escape");
  assert.ok(studio.includes("if (activeDialogOpen) return;"), "notation shortcuts must not mutate or play the background score while a modal is open");
  assert.ok(studio.includes("previousFocus?.getClientRects().length"), "closing a dialog must verify that the return target remains visible");
  assert.ok(studio.includes("else fallbackFocus?.focus()"), "closing a dialog must fall back to a visible header control after responsive changes");
  assert.ok(studio.includes("document.activeElement === dialog"), "the first Tab or Shift+Tab from a focused dialog container must enter the trap in the correct direction");
  assert.ok(studio.includes("const activeDialogKind = pendingImport"), "dialog transitions must retrap focus even when one modal replaces another without an unmodalized frame");
  assert.ok(studio.includes("onClick={openHelpDialog}"), "opening Help from the inspector must close the drawer instead of nesting two focus traps");
  assert.ok(studio.includes('!element.classList.contains("sr-status")'), "modal inerting must preserve the sole assistive live status region");
  assert.ok(studio.includes("modalReturnFocusRef.current = captureModalReturnFocus()"), "modal launchers that unmount must retain an explicit visible return target");
  assert.ok(studio.includes("openFilePicker(exportButtonRef.current)"), "mobile file-import warnings must restore focus to the visible file disclosure, not a hidden desktop control");
  assert.equal((studio.match(/ref=\{activeDialogRef\} tabIndex=\{-1\}/g) ?? []).length, 4, "every modal must receive initial programmatic focus");
  assert.ok(studio.includes("Your current score is unchanged"));
  assert.ok(studio.includes("setPendingImport({ score: parsed, warnings: imported.warnings })"), "lossy MusicXML imports must remain staged");
  assert.ok(studio.includes("Cancel import"));
  assert.ok(studio.includes("Open editable copy"));
  assert.ok(studio.includes('aria-controls={inspectorDrawerMode ? "score-inspector" : undefined}'), "desktop must not announce its always-visible inspector as collapsed");
  assert.ok(studio.includes("query.addEventListener(\"change\", syncMode)"), "compact inspector semantics must follow viewport changes");
  assert.ok(studio.includes("else if (!query.matches)"), "leaving inspector drawer mode must release its modal focus trap");
  assert.ok(studio.includes("query.matches && focusedInspector"), "entering inspector drawer mode must preserve an inspector editing task");
  assert.ok(studio.includes("lastFocusedControlRef.current"), "breakpoint handlers must remember focus even when CSS hides a control before matchMedia runs");
  assert.ok(studio.includes("setInstrumentsOpen(false)"), "leaving the mobile breakpoint must close the instrument drawer and its scrim");
  assert.ok(studio.includes('active?.closest("#notation-tools")'), "entering mobile mode must keep a focused notation control visible");
  assert.ok(studio.includes("setMobileToolsOpen(false)"), "leaving the mobile breakpoint must normalize the notation toolbar state");
  assert.ok(studio.includes("!focused.isConnected || focused.getClientRects().length === 0"), "responsive transitions must move focus away from controls that become hidden");
  assert.ok(studio.includes("current === document.body) focused.focus()"), "a responsive panel that reappears must restore its remembered keyboard focus instead of leaving focus on the document body");
  assert.ok(studio.includes('aria-controls="instrument-drawer"'));
  assert.ok(studio.includes('aria-label="File and export menu"'));
  assert.ok(studio.includes('role="group" aria-label="File and export options"'));
  assert.doesNotMatch(studio, /aria-haspopup="true"/, "the export disclosure must not claim menu keyboard semantics while exposing ordinary buttons");
  assert.ok(studio.includes('tabIndex={-1} aria-hidden="true"'), "the programmatic file input must not create a duplicate tab stop");
  assert.equal((studio.match(/aria-live="polite"/g) ?? []).length, 1, "status updates must have one live region");
  assert.ok(studio.includes("revision: current.revision + 1"), "identical repeated actions must remount visual and assistive status feedback");
  assert.ok(studio.includes("key={statusRevision}"), "repeated mobile status text must restart its bounded visibility timer");
  assert.ok(studio.includes("<span key={statusRevision}>{status}</span>"), "the live region must stay mounted while repeated messages replace its observed content");
  assert.match(styles, /\.properties-panel\.drawer-open/);
  assert.match(styles, /\.instrument-panel\.drawer-open/);
  assert.match(styles, /\.status-warning \.status-dot/);
  assert.match(styles, /\.status-error \.status-dot/);
  assert.match(styles, /\.canvas-controls\s*\{[^}]*position:\s*relative/, "secondary canvas controls must scroll away instead of obscuring notation");
  assert.doesNotMatch(styles, /\.canvas-controls\s*\{[^}]*position:\s*sticky/, "canvas controls must never intercept notes while the score scrolls");
  assert.doesNotMatch(styles, /\.mode-section, \.octave-control \{ display: none; \}/);
  assert.ok(studio.includes('`Chord · ${inspectorEvent.notes.length} notes`'));
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
  for (const [duration, flagCount] of [[1, 0], [2, 0], [4, 0], [8, 1], [16, 2], [32, 3], [64, 4]]) {
    assert.ok(durationIcon.includes(`${duration}: ${flagCount}`), `${duration} duration must preserve its exact visible flag count`);
  }
  assert.ok(durationIcon.includes("<svg"), "duration icons must use deterministic code-native vector geometry");
  assert.ok(durationIcon.includes('className="duration-stem"'), "stemmed durations need a visible vector stem");
  assert.ok(durationIcon.includes('className="duration-flag"'), "eighth through sixty-fourth durations need distinct vector flags");
  assert.ok(durationIcon.includes('aria-hidden="true"'), "decorative music glyphs must not duplicate the button accessible name");
  assert.doesNotMatch(layout, /Noto_Music/, "vector duration icons must not ship an otherwise-unused music webfont");
  assert.match(styles, /\.duration-notehead\.open\s*\{[^}]*fill:\s*none[^}]*stroke:\s*currentColor/, "whole and half notes must retain open noteheads at every theme color");
  assert.match(styles, /\.mobile-input-dock\s*\{[^}]*display:\s*none/, "the compact input dock must stay out of the desktop layout");
  assert.match(styles, /\.export-menu\s*\{[^}]*max-height:\s*calc\(100dvh[^}]*overflow-y:\s*auto/, "short viewports must be able to scroll every file and export action");
  assert.match(
    styles,
    /@media\s*\(max-width:\s*860px\)[\s\S]*?\.mobile-input-dock\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*display:\s*(?:grid|flex|block)/,
    "the quick input dock must become a visible, viewport-anchored control at the mobile breakpoint",
  );
  assert.match(styles, /\.mobile-input-meta>button\s*\{[^}]*height:\s*(?:4[4-9]|[5-9]\d)px/, "mobile edit actions must keep a touch-sized target");
  assert.match(styles, /\.mobile-pitch-keys button\s*\{[^}]*height:\s*(?:4[4-9]|[5-9]\d)px/, "mobile pitch and Rest actions must keep a touch-sized target");
  assert.match(styles, /@media \(max-width: 389px\)[\s\S]*?\.mobile-pitch-keys \.mobile-rest-key \{ display: none; \}/, "narrow input should give seven pitch keys the full row instead of squeezing eight targets together");
  assert.match(styles, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.app-header\s*\{[^}]*grid-template-columns:\s*70px/, "the mid-width header must compact before playback can overflow it");
  assert.match(styles, /\.note-toolbar\.mobile-tools-open \.pitch-keys[^}]*display:\s*none/, "mobile notation settings must not duplicate the persistent pitch dock");
  assert.match(styles, /\.note-toolbar\.mobile-tools-open \.note-values\s*\{\s*order:\s*1/, "the mobile settings panel must present duration first");
  assert.ok(studio.includes("const toggleMobileTools = useCallback"), "mobile settings need an explicit keyboard focus handoff because their panel precedes its trigger in DOM order");
  assert.ok(studio.includes("(activeDuration ?? firstControl)?.focus()"), "opening mobile settings must place keyboard focus inside the revealed controls");
  assert.match(styles, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.export-menu\s*\{[^}]*var\(--mobile-dock-height\)/, "short compact export menus must stop above the persistent input dock");
  assert.match(styles, /\.studio-shell\.mobile-tools-visible \.save-state\s*\{[^}]*var\(--toolbar-height\)/, "notation feedback must rise above the open mobile settings panel");
  assert.match(styles, /\.studio-shell\.mobile-tools-visible \.workspace\s*\{[^}]*var\(--toolbar-height\)/, "score follow-scroll must treat the open mobile settings panel as occluded space");
  assert.match(styles, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.inspector-section input[^}]*font-size:\s*16px/, "mobile form controls must avoid disruptive iOS focus zoom");
  assert.match(styles, /\.instrument-search:focus-within\s*\{[^}]*border-color:\s*var\(--blue\)/, "instrument search must retain a visible keyboard focus ring");
  assert.match(styles, /@media\s*\(max-height:\s*600px\)[\s\S]*?\.canvas-controls\s*\{[^}]*min-height:\s*32px/, "low-height layouts must retain compact measure controls");
  assert.doesNotMatch(styles, /@media\s*\(max-height:\s*600px\)[\s\S]*?\.canvas-controls\s*\{[^}]*display:\s*none/, "low-height layouts must not remove the only measure actions");
  assert.match(styles, /@media\s*\(max-height:\s*600px\)[\s\S]*?span:not\(\.tool-section\):not\(\.selected-event-summary\)/, "short viewports must keep the selected delete target visible");
  assert.match(styles, /@media\s*\(max-width:\s*860px\) and \(prefers-reduced-motion:\s*reduce\)[\s\S]*?mobile-status-discrete/, "mobile reduced-motion users need a non-moving timed status dismissal without hiding desktop save state");
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation-duration:\s*\.01ms/, "reduced-motion suppression must remain global at desktop widths");
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
  assert.doesNotMatch(renderer, /Math\.min\(\s*430/, "dense measures must not be squeezed through the former 430px intrinsic-width cap");
  assert.ok(renderer.includes("return Math.max(104"), "measure width must retain the full event-derived intrinsic width");
  assert.ok(renderer.includes("renderer.resize(engravingWidth, renderHeight)"), "a dense measure must be allowed to widen the scrollable engraving surface");
  assert.match(renderer, /const noteEndX = Math\.min\([\s\S]*?cell\.stave\.getNoteEndX\(\)/, "multi-staff formatting must honor the narrowest stave note boundary");
  assert.ok(renderer.includes("noteEndX - noteStartX - Stave.defaultPadding"), "voice justification must reserve VexFlow's canonical right padding");
  assert.ok(playbackPosition.includes("targetTick < measureStartTick + capacity || isLast"), "exact barlines must advance to the next measure while the final measure clamps");
  assert.ok(playbackPosition.includes("TICKS_PER_WHOLE / measure.time.denominator"), "transport beats must follow each measure's denominator");
  assert.ok(renderer.includes("locatePlaybackPosition(score, playbackSeconds)"), "the engraved cursor must consume the shared semantic playback mapper");
  assert.ok(renderer.includes('className="notation-playhead"'), "playback must render a measure-local notation cursor");
  assert.ok(renderer.includes("xForMeasureTick(playbackLayout, playbackPosition.tickInMeasure"), "the notation cursor must interpolate from semantic ticks through engraved anchors");
  assert.ok(renderer.includes("getNoteHeadBeginX() + note.getNoteHeadEndX()"), "playback tick anchors must use the rendered notehead center rather than a page percentage");
  assert.ok(renderer.includes("cells.filter((cell) => !cell.placeholder)"), "centered placeholder rests must not skew the shared playback cursor");
  assert.doesNotMatch(renderer, /playbackLayout\.startX\s*\+[^\n]*measureProgress/, "playback must not regress to linear page or measure percentages");
  assert.ok(renderer.includes("note.getBoundingBox()"), "rendered event bounds must drive direct note/rest selection");
  assert.ok(renderer.includes("distance <= 22"), "note selection must include a forgiving near-hit target without selecting another staff");
  assert.ok(renderer.includes("pointToRectCenterDistance"), "overlapping direct event boxes must resolve by two-dimensional pointer-to-center distance");
  assert.ok(renderer.includes("distance <= 22 / scale"), "near-hit forgiveness must remain 22 screen pixels when the engraving is zoomed");
  assert.ok(renderer.includes("engravingState.source === engravingSource"), "async event and measure geometry must be consumed only for its exact score, rows, and width source");
  assert.ok(renderer.includes("requestId === engravingRequestRef.current && hostRef.current === host"), "async engraving completion and error paths must reject stale requests and hosts");
  assert.ok(renderer.includes('className="event-selection"'), "the selected event must receive a visible score-local highlight");
  assert.ok(renderer.includes("Click or tap a note or rest to select it for deletion"), "the accessible score label must explain direct event selection");
  assert.ok(renderer.includes("onKeyDown={handleRowKeyDown}"), "the score surface must expose keyboard staff-row navigation");
  assert.ok(renderer.includes("inputFollowRevision === completedInputFollowRef.current"), "repeated note entry must request one bounded follow-scroll without making pointer selections jump");
  assert.ok(renderer.includes("selectedRect && caretRect"), "input follow must keep both the entered event and the NEXT caret in view");
  assert.match(styles, /\.engraving-frame:focus-within\s*\{[^}]*box-shadow:\s*inset/, "the keyboard score surface needs a visible in-viewport focus indicator");
  assert.ok(renderer.includes('event.key === "ArrowLeft" || event.key === "ArrowRight"'), "the score surface must let keyboard users move through existing events");
  assert.ok(renderer.includes("selectedIndex < 0"), "event navigation must acquire a deterministic first or last target when nothing is selected");
  assert.ok(renderer.includes("scrollScreenRectIntoView(frameRef.current, nextEvent, scale)"), "horizontal event-key navigation must follow an offscreen selection with nearest scrolling");
  assert.ok(renderer.includes("scrollStaffRowIntoView(frameRef.current, next.rowIndex"), "vertical staff-key navigation must follow the nearest visible system row");
  const pointerHandler = renderer.match(/const handleClick = [\s\S]*?\n\s+};\n\n\s+const selectedStaffRow/)?.[0];
  assert.ok(pointerHandler, "the score pointer handler must remain statically inspectable");
  assert.doesNotMatch(pointerHandler, /scroll(?:ScreenRect|StaffRow)IntoView/, "pointer selection must not recenter the score under the user");
  assert.ok(renderer.includes('"--engraving-ui-scale": 1 / scale'), "the scaled score surface must expose inverse optical UI scale");
  assert.ok(styles.includes("calc(2px * var(--engraving-ui-scale,1))"), "selection and cursor strokes must retain their screen-space weight while zoomed");
  assert.ok(renderer.includes("Use the Left and Right Arrow keys to select events"), "the bounded score label must explain keyboard event selection");
  assert.ok(renderer.includes("the Up and Down Arrow keys to select a staff"), "the bounded score label must explain keyboard staff selection");
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
