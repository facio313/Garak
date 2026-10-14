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
  assert.match(html, /<span class="action-label">Save a copy<\/span>/);
  assert.match(html, /class="[^"]*file-menu-button[^"]*"[^>]*aria-label="File and export menu"/);
  assert.match(html, /<span class="file-menu-label">File<\/span>/);
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
  assert.match(html, /Chord mode\. Add the next pitch to the latest note event/);
  assert.match(html, /aria-pressed="false"[^>]*>Chord<\/button>/);
  assert.match(html, /id="note-entry-method"[^>]*aria-describedby="note-entry-method-help"/);
  assert.match(html, /id="note-entry-method"[^>]*aria-label="Note input method"/);
  assert.match(html, /value="arrow-duration"/);
  assert.match(html, /value="duration-letter"[^>]*selected/);
  assert.match(html, /value="score-pointer"/);
  assert.match(html, /value="buttons"/);
  assert.match(html, />도</);
  assert.match(html, />레</);
  assert.match(html, />미</);
  assert.match(html, />파</);
  assert.match(html, />솔</);
  assert.match(html, />라</);
  assert.match(html, />시</);
  assert.match(html, /aria-label="Delete previous [^"]+"[^>]*>[^<]*<svg[\s\S]*?Delete previous input<\/button>/);
  assert.match(html, /aria-label="Dynamic on last event"/);
  assert.match(html, /aria-label="Articulation on last note event"/);
  assert.match(html, /id="score-title"[^>]*maxLength="200"/);
  const inspectorCategories = html.match(/<div class="inspector-categories"[^>]*role="group"[^>]*aria-label="Inspector category"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(inspectorCategories, "the inspector must expose one labeled category selector");
  assert.match(inspectorCategories, /aria-pressed="true"[^>]*aria-controls="inspector-event"[^>]*>Event<\/button>/);
  assert.match(inspectorCategories, /aria-pressed="false"[^>]*aria-controls="inspector-score"[^>]*>Score<\/button>/);
  assert.match(inspectorCategories, /aria-pressed="false"[^>]*aria-controls="inspector-part"[^>]*>Part<\/button>/);
  assert.doesNotMatch(html.match(/<div id="inspector-event"[^>]*>/)?.[0] ?? "hidden", /\bhidden\b/, "the default Event category must be visible");
  assert.match(html, /<div id="inspector-score"[^>]*\bhidden(?:="")?[^>]*>/, "score fields must remain rendered but initially hidden");
  assert.match(html, /<div id="inspector-part"[^>]*\bhidden(?:="")?[^>]*>/, "part fields must remain rendered but initially hidden");
  const inspectorEventContent = html.split('id="inspector-event"')[1]?.split('id="inspector-score"')[0];
  assert.ok(inspectorEventContent?.includes('class="selection-summary"'), "selection details belong to the Event category");
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
  const canvasWorkspace = html.match(/<section class="canvas-workspace"[^>]*aria-label="Score canvas"[^>]*>([\s\S]*?)<aside[^>]*id="score-inspector"/)?.[1];
  assert.ok(canvasWorkspace, "the score canvas must own its floating input controls");
  const header = html.match(/<header class="app-header"[^>]*>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.match(header, /aria-label="Enter focus mode"[^>]*aria-pressed="false"[^>]*aria-controls="instrument-drawer score-inspector"/, "focus mode must be available in the existing header without a new row");
  assert.match(header, /class="header-panel-controls"[^>]*role="group"[^>]*aria-label="Workspace panels"/);
  assert.match(header, /class="icon-button panel-toggle"[^>]*aria-controls="instrument-drawer"[^>]*aria-expanded="true"/);
  assert.match(header, /class="icon-button panel-toggle"[^>]*aria-controls="score-inspector"[^>]*aria-expanded="true"/);
  assert.doesNotMatch(canvasWorkspace, /class="(?:workspace-panel-controls|header-panel-controls)"/, "panel toggles must not consume a separate canvas row");
  assert.equal((html.match(/id="notation-tools"/g) ?? []).length, 1, "all screen sizes must share one notation menu");
  assert.match(canvasWorkspace, /class="floating-note-entry"/);
  assert.match(canvasWorkspace, /<section[^>]*id="notation-tools"[^>]*\bhidden(?:="")?[^>]*aria-label="Notation tools"/);
  const entryLauncher = canvasWorkspace.match(/<button[^>]*class="note-entry-toggle"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(entryLauncher, "a visible note preview must launch the initially collapsed menu");
  assert.match(entryLauncher, /aria-label="Open note entry menu · [^"]+ · [^"]+"/);
  assert.match(entryLauncher, /aria-controls="notation-tools"[^>]*aria-expanded="false"/);
  assert.match(entryLauncher, /<svg[^>]*class="note-entry-preview"[^>]*viewBox="0 0 76 76"[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.match(entryLauncher, /<ellipse\b/);
  assert.match(canvasWorkspace, /class="note-entry-help-toggle"[^>]*aria-label="Note input help"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(html, /class="note-entry-help"[^>]*role="dialog"/, "input help must not obscure the initial canvas");
  assert.doesNotMatch(html, /class="mobile-input-dock"|class="mobile-pitch-keys"/, "a second persistent touch dock must not duplicate the shared input menu");
  assert.match(html, /class="[^"]*\bpitch-keys\b[^"]*"[^>]*aria-label="Enter pitch or rest"/);
  assert.match(html, /class="[^"]*\bdelete-input-button\b[^"]*"[^>]*aria-label="Delete [^"]+"/);
  assert.match(html, /aria-label="Undo last edit"/);
  assert.match(html, /aria-label="Redo edit"/);
  assert.match(html, />Written key</);
  assert.match(html, /aria-label="Measure controls"/);
  assert.match(html, /aria-label="Add empty measure"/);
  assert.match(html, /aria-label="Remove last empty measure"/);
  const canvasControls = canvasWorkspace.match(/<div class="canvas-area"[^>]*>([\s\S]*?)<article class="score-page">/)?.[1];
  assert.ok(canvasControls, "score view and navigation controls must live beside the canvas");
  assert.match(canvasControls, /class="score-view-switch"[^>]*role="group"[^>]*aria-label="Score view"/);
  assert.match(canvasControls, /class="view-tab active"[^>]*aria-pressed="true"[^>]*>[\s\S]*? Score<\/button>/);
  assert.match(canvasControls, /class="view-tab "[^>]*aria-pressed="false"[^>]*>[\s\S]*? Part<\/button>/);
  assert.match(canvasControls, /aria-label="Zoom out"/);
  assert.match(canvasControls, /aria-label="Zoom in"/);
  for (const meter of ["2/4", "3/4", "4/4", "5/8", "6/8", "7/8", "9/8", "12/8"]) {
    assert.match(html, new RegExp(`value="${meter.replace("/", "\\/")}"`));
  }
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("keeps floating note entry accessible, canvas-bound, and usable on compact screens", async () => {
  const [studio, styles] = await Promise.all([
    readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const notationToolbar = studio.match(/<section ref=\{notationToolsRef\}[\s\S]*?<\/section>/)?.[0];
  assert.ok(notationToolbar, "the same accessible section must contain all input controls");
  assert.match(notationToolbar, /hidden=\{!inputToolsOpen\}/, "closed input controls must leave keyboard navigation and the accessibility tree");
  for (const control of ["note-values", "pitch-keys", "octave-control", "mode-section", "delete-input-button", "note-entry-method"]) {
    assert.ok(notationToolbar.includes(control), `${control} must remain available in the shared menu`);
  }
  assert.ok(studio.includes('<NoteEntryPreview rest={restInput} pitch={floatingPitch} duration={{ base: duration, dots: dotCount }} clef={selectedStaff?.clef ?? "treble"}'), "the launcher preview must receive the selected pitch, dotted duration, and staff clef");
  const toggleInputTools = studio.match(/const toggleInputTools = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[[^\]]*inputToolsOpen[^\]]*\]\);/)?.[1];
  assert.ok(toggleInputTools?.includes("setInputToolsOpen(next)"), "the disclosure must toggle its controlled panel");
  assert.ok(toggleInputTools.includes("setInputHelpOpen(false)"), "opening note entry must dismiss overlapping help");
  assert.ok(toggleInputTools.includes("(activeDuration ?? firstControl)?.focus()"), "opening a menu before its launcher must move keyboard focus into its active duration");
  assert.ok(toggleInputTools.includes("inputToolsButtonRef.current?.focus()"), "closing note entry must return focus to its launcher");
  assert.match(studio, /className="note-entry-help-toggle"[^>]*aria-expanded=\{inputHelpOpen\}[^>]*onClick=\{\(\) => setInputHelpOpen\(\(open\) => !open\)\}/, "the help disclosure must announce and toggle its actual open state");
  assert.ok(studio.includes('inputHelpOpen ? <section className="note-entry-help" role="dialog" aria-modal="false" aria-label="Note input help"'), "input help must be a named nonmodal dialog");
  assert.match(studio, /if \(inputHelpOpen && !activeDialogOpen\) \{[^}]*setInputHelpOpen\(false\);[^}]*inputHelpButtonRef\.current\?\.focus\(\)/, "Escape must close local help and restore its launcher without bypassing an active modal");
  assert.ok(studio.includes("if (returnToInputTools) window.requestAnimationFrame(() => inputToolsButtonRef.current?.focus())"), "Escape from note entry must preserve a visible keyboard focus target");
  const floatingDismiss = studio.slice(studio.indexOf("if (!inputHelpOpen) return;"), studio.indexOf("const toggleInputTools"));
  assert.ok(floatingDismiss.includes("setInputHelpOpen(false)"), "outside clicks may dismiss transient help");
  assert.ok(!floatingDismiss.includes("setInputToolsOpen(false)"), "outside clicks must preserve the manually opened note palette");
  assert.ok(!studio.includes("note-entry-toggle-indicator"), "the note launcher must not show a redundant plus/minus badge");
  assert.match(studio, /className="score-tap-action"[^>]*onClick=\{\(\) => \{ chooseNoteEntryMethod\("score-pointer"\);[^}]*\.score-hit-target/, "the touch/Pencil action must switch input method and return focus without closing the palette");
  assert.match(styles, /\.canvas-workspace\s*\{[^}]*position:\s*relative/, "floating controls must be positioned against the score workspace");
  assert.match(styles, /\.floating-note-entry\s*\{[^}]*position:\s*absolute[^}]*safe-area-inset-bottom[^}]*pointer-events:\s*none/, "the floating wrapper must respect the safe area without blocking score input around its controls");
  assert.match(styles, /\.note-entry-launchers\s*\{[^}]*flex-direction:\s*column/, "the help launcher must sit above the round input preview");
  assert.match(styles, /\.note-entry-launchers button\s*\{[^}]*pointer-events:\s*auto/, "visible launchers must remain clickable inside the transparent wrapper");
  assert.match(styles, /\.note-toolbar\s*\{[^}]*pointer-events:\s*auto[^}]*max-height:\s*calc\(100dvh[^}]*overflow-y:\s*auto/, "the shared panel must stay interactive and scroll within short viewports");
  assert.match(styles, /\.note-toolbar\[hidden\]\s*\{[^}]*display:\s*none/, "toolbar layout rules must not override the native hidden state");
  assert.match(styles, /\.note-toolbar \.pitch-keys button, \.note-toolbar \.tool-button\s*\{[^}]*min-height:\s*44px/, "shared pitch and duration controls must retain touch-sized targets");
  assert.match(styles, /\.note-toolbar \.quick-edit-group button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/, "Undo, Redo, and Delete must retain touch-sized targets");
  assert.doesNotMatch(notationToolbar, /<strong>Add notes<\/strong>|note-entry-panel-heading/, "the compact palette must not have a redundant title row");
  assert.match(notationToolbar, /note-entry-length-row[\s\S]*?>Length<\/span>[\s\S]*?note-entry-note-row[\s\S]*?>Note<\/span>[\s\S]*?octave-control[\s\S]*?note-entry-options-row/, "the narrow palette must keep Length, Note with octave, then options in reading order");
  assert.match(styles, /\.floating-note-entry\s*\{[^}]*flex-direction:\s*row[^}]*align-items:\s*flex-end/, "the menu must extend beside the launcher and share its bottom edge, not stack above it");
  assert.match(styles, /\.note-entry-launchers\s*\{[^}]*flex:\s*0 0 80px/, "the circle must retain its own space beside the expanding palette");
  assert.match(styles, /\.note-entry-row\s*\{[^}]*height:\s*50px[^}]*overflow-x:\s*auto/, "compact tool rows must scroll sideways instead of growing taller");
  assert.match(styles, /\.note-entry-primary\s*\{[^}]*overflow-x:\s*auto/, "Length and Note must share one horizontal scroll to keep their columns aligned");
  assert.match(styles, /\.note-toolbar \.note-values, \.note-toolbar \.pitch-keys\s*\{[^}]*gap:\s*4px/, "duration and pitch columns must use equal gaps");
  assert.match(styles, /@container note-dock\s*\(min-width:\s*1144px\)[\s\S]*?grid-template-columns:\s*570px minmax\(0,1fr\)/, "the actual palette width determines its columns after moving it");
  assert.match(notationToolbar, /note-entry-primary[\s\S]*note-entry-length-row[\s\S]*note-entry-note-row/, "the primary column keeps the two core input rows together");
  assert.match(styles, /@container score-entry\s*\(max-width:\s*460px\)/, "compact spacing must follow the available score canvas");
  assert.doesNotMatch(styles, /\.note-toolbar[^{}]*\{[^}]*\border:\s*\d/, "visual control order must follow keyboard focus order");
  assert.match(notationToolbar, /id="note-entry-method-help" className="visually-hidden"/, "the input method keeps its accessible instructions without a fourth visible row");
  assert.match(styles, /\.note-entry-help\s*\{[^}]*max-height:\s*var\(--dock-help-height[^}]*overflow-y:\s*auto/, "local input help must remain readable in short viewports");
  assert.match(styles, /@media print[\s\S]*?\.floating-note-entry[^{}]*\{[^}]*display:\s*none\s*!important/, "input launchers, their preview, and open panels must never appear in print output");
});

test("routes a released notehead drag to either chord-tone pitch editing or tied-event movement while preserving touch scrolling", async () => {
  const [studio, renderer, styles] = await Promise.all([
    readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ScoreRenderer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /note\.noteHeads\.forEach\(\(head, pitchIndex\) => \{\s*const scoreNote = event\.notes\[pitchIndex\];\s*const headBounds = head\.getBoundingBox\(\)/, "individual rendered heads must retain their original chord tone IDs, including displaced heads");
  const noteDragHandlers = renderer.match(/const handleNotePointerDown =[\s\S]*?\n\s*const selectedStaffRow/)?.[0];
  assert.ok(noteDragHandlers, "notehead gestures must have one bounded down/move/up path");
  const notePointerDown = noteDragHandlers.split("const handleNotePointerMove")[0];
  const dragStart = notePointerDown.replace(/if \(\(!layout\.draggable \|\| !onNotePitchChange\) && !onEventMove\) \{\s*selectNotehead\(layout\);\s*return;\s*\}/, "");
  assert.doesNotMatch(dragStart, /selectNotehead\(|onSelectEvent\?\.\(/, "starting a draggable note must not open selection panels and shift the staff under the held pointer");
  const beforeRelease = noteDragHandlers.split("const handleNotePointerUp")[0];
  assert.doesNotMatch(beforeRelease, /onNotePitchChange\?\.\(|onEventMove\?\.\(/, "captured pointer movement must preview without creating history edits");
  assert.equal((noteDragHandlers.match(/onNotePitchChange\?\.\(/g) ?? []).length, 1, "one pitch drag must apply at most one history edit");
  assert.equal((noteDragHandlers.match(/onEventMove\?\.\(/g) ?? []).length, 1, "one time drag must apply at most one history edit");
  assert.match(noteDragHandlers, /const handleNotePointerUp =[\s\S]*?finishesScoreNoteDrag\(gesture\.drag, event\)[\s\S]*?gesture\.source !== engravingSource[\s\S]*?onNotePitchChange\?\.\(\{ partId, staffId, measureId, eventId, noteId, pitch \}\)/, "release must send the exact note ID and reject stale engraving coordinates");
  assert.match(noteDragHandlers, /if \(finalDrag\.cancelled \|\| gesture\.source !== engravingSource \|\| rangeInteraction\) return;[\s\S]*?if \(movePreview\?\.kind === "time"\) \{[\s\S]*?if \(destination && \(destination\.measureId !== measureId \|\| destination\.tick !== gesture\.sourceTick\)\) \{\s*onEventMove\?\.\(\{ partId, staffId, measureId, eventId, noteId, targetMeasureId: destination\.measureId, targetTick: destination\.tick \}\);\s*\}\s*return;\s*\}/, "a time release must reject stale/cancelled geometry, ignore invalid or unchanged positions, and return before pitch editing");
  assert.match(noteDragHandlers, /if \(!pitch \|\| !gesture\.layout\.draggable\) \{\s*selectNotehead\(gesture\.layout\);\s*return;\s*\}/, "a valid tap or unchanged pitch release must select its exact tone without creating a history edit");
  assert.ok(noteDragHandlers.includes('gesture.drag.axis === "time"') && noteDragHandlers.includes('finalDrag.axis === "time"'), "preview and release must respect the same locked gesture direction");
  assert.match(noteDragHandlers, /grabOffsetX: localX - xForMeasureTick\(measureLayout, layout\.tick/, "grabbing a displaced chord head must retain its original rhythmic position");
  assert.match(renderer, /target\.candidate\.partId === gesture\.layout\.partId && target\.candidate\.staffId === gesture\.layout\.staffId/, "a drag over another rendered staff must not move music between staves");
  assert.ok(renderer.includes("snappedTickForMeasureX(measureLayout, x, capacity, TICKS_PER_QUARTER / 4, onsets)"), "time previews must use sixteenth-note snapping and exact existing onsets");
  assert.ok(noteDragHandlers.includes("setPointerCapture(event.pointerId)"), "touch and pen drags must continue after leaving a small notehead");
  assert.match(renderer, /onPointerCancel=\{\(\) => \{ cancelPointerInput\(\); cancelNoteDrag\(\); \}\}/, "interrupted notehead gestures must cancel both range taps and note drags");
  assert.match(renderer, /onLostPointerCapture=\{\(\) => \{ cancelPointerInput\(\); cancelNoteDrag\(\); \}\}/, "lost capture must not commit a range tap, pitch, or time change");
  assert.match(renderer, /event\.key === "Escape" && noteDragRef\.current[\s\S]*?cancelNoteDrag\(\)/, "Escape must cancel the preview before an edit is committed");
  assert.match(renderer, /const clearPointerPreview = \(\) => \{[^}]*cancelNoteDrag\(\)/, "scroll and resize must invalidate an in-progress note drag");
  assert.ok(studio.includes("selectedNoteId={selectedTone?.id}") && studio.includes("onNotePitchChange={changeDraggedNotePitch}"), "the highlighted chord tone and the committed drag must share the studio selection");
  const commitDrag = studio.match(/const changeDraggedNotePitch = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(commitDrag);
  assert.match(commitDrag, /editEventNotation\(score, intent\.partId, intent\.staffId, intent\.measureId, intent\.eventId, \{\s*noteId: intent\.noteId,\s*pitch: intent\.pitch/, "dragging a chord tone must use the tie-preserving exact-note command");
  assert.equal((commitDrag.match(/\bcommit\(/g) ?? []).length, 1, "a released pitch change must remain one undo step");
  assert.ok(commitDrag.includes("if (result.error)") && commitDrag.includes('scope: "drag"'), "a duplicate pitch or rejected edit must expose feedback at the score");
  assert.ok(studio.includes("onEventMove={moveDraggedEvent}"), "the released time intent must reach the shared studio mutation path");
  const commitMove = studio.match(/const moveDraggedEvent = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(commitMove);
  assert.ok(commitMove.includes("moveEventToPosition(score, intent.partId, intent.staffId, intent.measureId, intent.eventId, intent.targetMeasureId, intent.targetTick)"), "time dragging must use the chord- and tie-preserving movement command");
  assert.equal((commitMove.match(/\bcommit\(/g) ?? []).length, 1, "a released time move must remain one undo step");
  assert.ok(commitMove.includes("result.error") && commitMove.includes('scope: "move"'), "an occupied or invalid drop must expose score feedback without hiding the error");
  assert.match(styles, /\.notehead-hit-target\s*\{[^}]*touch-action:\s*none/, "native panning must be disabled only while grabbing an actual notehead");
  assert.doesNotMatch(styles, /\.(?:score-hit-target|engraving-frame|canvas-area)\s*\{[^}]*touch-action:\s*none/, "blank score areas must preserve native touch scrolling");
  assert.match(styles, /@media print[\s\S]*?\.notehead-hit-target[^{}]*\{[^}]*display:\s*none/, "interactive notehead handles must never print over the music");
});

test("range selection uses cancellable taps and applies each bulk edit through one validated history step", async () => {
  const [studio, renderer, styles] = await Promise.all([
    readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ScoreRenderer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const tapHandlers = renderer.match(/const handlePointerDown =[\s\S]*?\n\s*const handleClick/)?.[0];
  assert.ok(tapHandlers, "staff taps must use one down/move/up path");
  assert.doesNotMatch(tapHandlers.split("const handlePointerUp")[0], /activateScorePoint\(|onRangeDestination\?\.\(/, "moving a finger may preview but must not apply a range operation");
  assert.match(tapHandlers, /gesture\.source !== engravingSource[\s\S]*gesture\.interaction !== pointerInteraction[\s\S]*finishesScorePointerTap\(gesture\.tap, event\)[\s\S]*activateScorePoint\(event, gesture\.notehead, gesture\.extend\)/, "release must reject changed notation, changed selection modes, scrolling, and cancelled touches");
  assert.match(renderer, /const clearPointerPreview = \(\) => \{\s*pointerTapRef\.current = null;[\s\S]*?setRangeDestinationPreview\(null\)/, "scroll and resize must discard range tap candidates and stale target previews");
  assert.match(renderer, /if \(onPlaybackSeek \|\| rangeInteraction \|\| event\.shiftKey\) \{\s*event\.stopPropagation\(\);\s*handlePointerDown\(event, layout\);\s*return;/, "range noteheads must use a tap gesture before single-note drag capture begins");
  assert.match(styles, /\.notehead-hit-target\.range-interaction\s*\{[^}]*touch-action:\s*auto/, "a range-selection swipe beginning on a notehead must retain native panning");
  assert.match(renderer, /eventLayouts\.filter\(\(layout\) => rangeEventIds\.has\(layout\.eventId\)\)/, "all selected chord/rest events must contribute to the range highlight");
  assert.ok(renderer.includes('className="event-selection event-range-selection"'), "the selected range must remain visible across rendered systems");
  const scrollSelection = renderer.match(/function scrollScreenRectIntoView[\s\S]*?\nfunction scrollStaffRowIntoView/)?.[0];
  assert.ok(scrollSelection?.includes('canvas.querySelector<HTMLElement>(":scope > .range-selection-bar")'), "range navigation must account for its sticky controls in the same canvas");
  assert.match(scrollSelection, /const visibleTop = Math\.max\(canvasBounds\.top, rangeBar\?\.getBoundingClientRect\(\)\.bottom \?\? canvasBounds\.top\)/, "the visible top must include the sticky range bar while preserving the normal canvas fallback");
  assert.match(scrollSelection, /if \(targetTop < visibleTop\) verticalDelta = targetTop - visibleTop - FOLLOW_MARGIN/, "Shift+Arrow navigation must reveal the selected event below the range bar, not behind it");
  assert.ok(renderer.includes("eventLayout?.tick ?? snappedTickForMeasureX"), "tapping an existing event preserves its exact rhythmic onset while blank staff positions snap");
  assert.ok(renderer.includes("onRangeEventSelect(selection, true)") && renderer.includes("selectEventLayout(nextEvent, extendingRange)"), "touch endpoints and Shift+Arrow must share range selection semantics");
  for (const prop of ["selectedEventIds={selectedRange?.eventIds}", "rangeSelectionMode={rangeSelectionMode}", "onRangeEventSelect={selectRangeEvent}", "onRangeDestination={applyRangeDestination}"]) {
    assert.ok(studio.includes(prop), `${prop} must connect range state to the renderer`);
  }
  const applyRange = studio.match(/const applyRangeDestination = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(applyRange);
  assert.ok(applyRange.includes("copyEventRangeToPosition : moveEventRangeToPosition"), "move and copy must use score commands that preserve chord and tie topology");
  assert.match(applyRange, /result\.error !== undefined[\s\S]*return;[\s\S]*if \(result\.changed\) commit\(/, "rejected placement must return before committing score history");
  assert.equal((applyRange.match(/\bcommit\(/g) ?? []).length, 1, "one placement must be one undo step");
  const transposeRange = studio.match(/const transposeRange = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(transposeRange?.includes("transposeEventRange(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, semitones)"));
  assert.equal((transposeRange.match(/\bcommit\(/g) ?? []).length, 1, "one pitch change must be one undo step");
  assert.match(transposeRange, /result\.error !== undefined[\s\S]*return;[\s\S]*commit\(/, "a rejected transpose must not enter history");
  assert.ok(transposeRange.includes("setRangeTarget(rangeTarget)") && transposeRange.includes("setRangeSelectionMode(true)"), "repeated touch transpositions must keep the range selected");
  assert.ok(studio.includes('aria-label="Transpose selected range"') && studio.includes('([-12, -1, 1, 12] as const)'), "the selection offers semitone and octave steps in both directions");
  const rhythmRange = studio.match(/const changeRangeRhythm = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(rhythmRange?.includes("changeEventRangeDuration(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, change)"));
  assert.equal((rhythmRange.match(/\bcommit\(/g) ?? []).length, 1, "a complete rhythm reflow must be one undo step");
  assert.ok(rhythmRange.includes("result.eventIds[result.eventIds.length - 1]"), "the range must include newly split segments for subsequent edits");
  const expressionRange = studio.match(/const changeRangeExpression = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(expressionRange?.includes("setEventRangeExpression(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds, change)"));
  assert.equal((expressionRange.match(/\bcommit\(/g) ?? []).length, 1, "one expression change must be one undo step");
  assert.match(expressionRange, /result\.error !== undefined[\s\S]*return;[\s\S]*commit\(/);
  assert.ok(expressionRange.includes("setRangeSelectionMode(true)"), "expression edits keep the range for repeated touch changes");
  assert.ok(studio.includes('aria-label="Dynamic on selected range"') && studio.includes('aria-label="Articulation on selected range"'));
  assert.ok(studio.includes('value={rangeExpression.dynamic}') && studio.includes('value={rangeExpression.articulation}'), "mixed expression and applied values must be visible");
  for (const tool of ["pitch", "rhythm", "expression", "hairpin"]) assert.ok(studio.includes(`!rangeDestinationMode && rangeEditTool === "${tool}"`), "compact range tools show one edit category and hide while choosing a destination");
  const clearRange = studio.match(/const deleteRange = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(clearRange?.includes("clearEventRange(score, rangeTarget.partId, rangeTarget.staffId, selectedRange.eventIds)"), "Delete must replace the complete range with rests through its score command");
  assert.equal((clearRange.match(/\bcommit\(/g) ?? []).length, 1, "one bulk deletion must be one undo step");
  for (const command of ["undo", "redo"]) {
    const handler = studio.match(new RegExp(`const ${command} = useCallback\\([\\s\\S]*?\\n {2}\\}, \\[[^\\]]*\\]\\);`))?.[0];
    assert.ok(handler?.includes("clearRangeSelection()"), `${command} must discard ranges whose event IDs belong to an older score`);
  }
});

test("ships a complete, locally readable, version-matched license inventory", async () => {
  const response = await render("/licenses");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Open-source licenses — Garak Studio<\/title>/i);
  assert.match(html, />Open-source licenses</);
  assert.match(html, />19(?:<!-- -->)? shipped components and font payloads</);
  assert.match(html, /href="\/licenses\/manifest\.json"/);
  assert.match(html, /href="\/licenses\/react-19\.2\.8-LICENSE\.txt"/);
  assert.match(html, /Academico Regular/);
  assert.match(html, /Academico Bold/);
  assert.match(html, /Bravura/);

  const [manifestText, packageLockText, studio, styles] = await Promise.all([
    readFile(new URL("../public/licenses/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const packageLock = JSON.parse(packageLockText);
  assert.equal(manifest.entries.length, 19);
  assert.ok(studio.includes('href="/licenses"'), "licenses must be discoverable from the editor UI");
  assert.ok(studio.includes("About & licenses"));
  assert.ok(studio.includes("Third-party licenses"));
  assert.match(styles, /\.export-menu button, \.export-menu>a\s*\{[^}]*min-height:\s*44px/, "the license disclosure must retain the same touch target as export actions");

  const packageEntries = manifest.entries.filter((entry) => !entry.provenancePath);
  for (const entry of packageEntries) {
    assert.equal(packageLock.packages[`node_modules/${entry.name}`]?.version, entry.version, `${entry.name} notice version must match the lockfile`);
  }
  for (const entry of manifest.entries) {
    assert.match(entry.noticePath, /^\.\/[a-z0-9][a-z0-9._-]+$/i);
    const source = new URL(entry.source);
    assert.equal(source.protocol, "https:");
    assert.equal(source.username, "");
    assert.equal(source.password, "");
    assert.equal(source.search, "");
    assert.equal(source.hash, "");
    const noticeUrl = new URL(`../public/licenses/${entry.noticePath.slice(2)}`, import.meta.url);
    const notice = await readFile(noticeUrl, "utf8");
    assert.ok(notice.length > 500, `${entry.name} must ship its complete local notice`);
    await access(new URL(`../dist/client/licenses/${entry.noticePath.slice(2)}`, import.meta.url));
    if (entry.provenancePath) {
      const provenance = await readFile(new URL(`../public/licenses/${entry.provenancePath.slice(2)}`, import.meta.url), "utf8");
      assert.match(provenance, new RegExp(entry.sha256, "i"));
      await access(new URL(`../dist/client/licenses/${entry.provenancePath.slice(2)}`, import.meta.url));
    }
  }

  const academico = await readFile(new URL("../public/licenses/academico-0.902-OFL-1.1.txt", import.meta.url), "utf8");
  assert.match(academico, /Copyright © 2022, Steinberg Media Technologies GmbH/);
  assert.match(academico, /Reserved Font Name "Academico"/);
  assert.match(academico, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(academico, /OTHER DEALINGS IN THE FONT SOFTWARE\./);
  const bravura = await readFile(new URL("../public/licenses/bravura-1.392-OFL-1.1.txt", import.meta.url), "utf8");
  assert.match(bravura, /Copyright © 2019, Steinberg Media Technologies GmbH/);
  assert.match(bravura, /Reserved Font Name "Bravura"/);
  assert.match(bravura, /OTHER DEALINGS IN THE FONT SOFTWARE\./);
  const lucide = await readFile(new URL("../public/licenses/lucide-react-1.33.0-LICENSE.txt", import.meta.url), "utf8");
  assert.match(lucide, /ISC License/);
  assert.match(lucide, /Cole Bemis/);
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
  assert.match(studio, /className="edit-tool-button delete-input-button"[^>]*onClick=\{\(\) => removeLatestInput\(\)\}/, "the shared notation menu must use the non-collapsing Delete action");
  const eventInspector = studio.match(/id="inspector-event"([\s\S]*?)id="inspector-score"/)?.[1];
  assert.ok(eventInspector?.includes("onClick={() => removeLatestInput(false, true)}"), "the inspector must expose the explicit whole-event clear action");
  assert.ok(studio.includes("Clear whole chord to rest"), "clearing a chord must disclose that all tones become a rest");
  assert.ok(studio.includes("deleteRemovesChordTone && !collapseTime && !clearAllNotes"), "explicit whole-chord clear must not silently remove just its last tone");
  assert.ok(studio.includes('useState<NoteEntryMethod>("duration-letter")'), "the existing number-then-letter grammar must remain the default");
  assert.ok(studio.includes('<option value="arrow-duration">Pitch → duration</option>'));
  assert.ok(studio.includes('<option value="duration-letter">Duration → pitch</option>'));
  assert.ok(studio.includes('<option value="score-pointer">Tap / click the score</option>'));
  assert.ok(studio.includes('<option value="buttons">Pitch buttons / touch</option>'));
  assert.ok(studio.includes("With no selection, only the input length changes."), "duration shortcuts must explain selection editing versus input settings");
  assert.ok(studio.includes("if (hasSystemShortcutModifier(event)) return;"), "OS and browser modifier chords must not fall through to plain notation input");
  assert.ok(studio.includes("event.target instanceof Element ? event.target : null"), "global shortcut handling must ignore non-element event targets safely");
  assert.ok(studio.includes('pitchButtonAction(noteEntryMethod) === "select"'), "pitch buttons must select, rather than immediately enter, in arrow-then-number mode");
  assert.ok(studio.includes("<kbd>{PITCH_SHORTCUTS[step]}</kbd>"), "pitch buttons must show their QWERTYU entry keys");
  assert.ok(studio.includes('noteEntryMethod === "arrow-duration" ? "Select pitch or enter rest" : "Enter pitch or rest"'), "the shared pitch group must describe selection semantics in arrow mode");
  assert.ok(studio.includes("sameStaffMeasureTarget(selectedEventTarget, intent)"), "Shift-click chord entry must not silently modify a chord in another measure");
  assert.ok(studio.includes("if (!addToSelectedChord) setSelectedEventTarget(null);"), "ordinary pointer entry must clear a stale event selection while valid Shift-chord entry preserves it");
  assert.ok(studio.indexOf("Shift-click needs a selected note in the same staff and measure") < studio.indexOf("setSelectedPartId(intent.partId);", studio.indexOf("const requestedSelectedChord")), "an invalid Shift-click must preserve the selected chord for immediate retry");
  assert.ok(studio.includes("pointerDurationTicks={durationTicks({ base: duration, dots: dotCount })}"), "pointer preview must receive the exact selected dotted duration for capacity feedback");
  assert.ok(studio.includes("ordinary score click starts a new chord"), "pointer-mode Chord feedback must distinguish ordinary click from Shift-click");
  assert.ok(studio.includes('result.score.measures[result.measureId].number'), "status text for an auto-appended measure must read the new score instead of crashing on the previous snapshot");
  assert.ok(studio.includes('onPointerNoteIntent={enterPointerNote}'), "the renderer must send coordinate intent through the shared studio command path");
  assert.ok(renderer.includes('pitchFromStaffPointer('), "score clicks must snap using clef-aware staff geometry");
  assert.ok(renderer.includes('event.detail === 0'), "synthetic keyboard clicks must not create coordinate-based notes");
  assert.ok(renderer.includes('12 / Math.min(renderedScaleX, renderedScaleY)'), "pointer mode must preserve a touch-safe selection halo around existing events");
  assert.ok(renderer.includes("xForMeasureTick(measureLayout, tailTick"), "the pointer ghost must show the actual NEXT insertion position instead of the mouse x coordinate");
  assert.ok(renderer.includes("hasSystemShortcutModifier(event) && !arrowDurationStaffMove"), "modified score-navigation keys must preserve OS and browser shortcuts");
  assert.ok(renderer.includes("&& !event.metaKey\n      && !event.ctrlKey\n      && !event.shiftKey"), "Alt staff movement must not swallow combined Meta/Ctrl/Shift browser shortcuts");
  assert.ok(renderer.includes("pointerDurationTicks <= capacity - tailTick"), "a pointer ghost must become invalid before a selected duration overflows the measure");
  assert.ok(renderer.includes('event.key === "Shift"'), "stationary pointer previews must react when Shift is pressed or released");
  assert.ok(renderer.includes('window.addEventListener("keydown", handleShiftKey, true)'), "Shift and Escape must stay tracked even when a captured drag or input method changes focus");
  assert.ok(renderer.includes("chordMode && pointerShiftPressed ? pointerNotePreview.chord : pointerNotePreview.normal"), "the visible ghost must follow the live Shift state used by click entry");
  assert.ok(renderer.includes("pointerNotePreview.context === engravingState"), "pointer preview must disappear when score layout changes without pointer movement");
  assert.ok(renderer.includes("pointerNotePreview\n    && layoutsAreCurrent"), "pointer preview must disappear immediately while a resized or zoomed layout is stale");
  assert.ok(renderer.includes("pointerNotePreview.selectedEventId === selectedEventId"), "pointer preview must disappear when keyboard selection changes without pointer movement");
  assert.ok(renderer.includes('frame?.addEventListener("scroll", clearPointerPreview'), "horizontal score scrolling must clear stale pointer previews");
  assert.ok(renderer.includes('canvas?.addEventListener("scroll", clearPointerPreview'), "vertical canvas scrolling must clear stale pointer previews");
  assert.ok(renderer.includes('window.addEventListener("resize", clearPointerPreview'), "viewport resizing must clear pointer previews before new geometry is ready");
  assert.match(styles, /\.input-method-section select \{[^}]*min-height:\s*44px/, "the shared input-method selector must have a touch-sized target");
  assert.match(styles, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.note-toolbar \.input-method-section select \{[^}]*font-size:\s*16px/, "the mobile input selector must avoid disruptive focus zoom");
  const deleteCallback = studio.match(/const removeLatestInput = useCallback\(\(collapseTime = false, clearAllNotes = false\) => \{([\s\S]*?)\n {2}\}, \[[^\]]+\]\);\n\n {2}const applyDynamic/)?.[1];
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
  assert.ok(studio.includes('trimStudioHistory([{ score, selection: selectedEventTarget, range: rangeSelectionMode ? rangeTarget : null, rangeTool: rangeEditTool, rangeExpanded: rangeToolsExpanded, action: previous.action }, ...items], "start")'), "redo snapshots must retain range context and honor the byte and entry budget");
  assert.ok(studio.includes("entries.map((entry) => entry.score)"), "history budgeting must measure score snapshots while retaining their paired selection metadata");
  assert.ok(studio.includes("oldest undo steps released to protect memory"), "history budget truncation must be surfaced to the editor");
  assert.ok(studio.includes("autosave paused — use Save in this browser or New to replace preserved drafts"), "edits after recovery must keep the persistence pause visible");
  assert.ok(studio.includes('aria-label="Toggle rest input" aria-pressed={restInput}'), "the requested persistent rest toggle must expose its state");
  assert.ok(studio.includes("const enteringRest = forceRest;"), "rest entry must use the resolved rest flag");
  assert.ok(studio.includes('aria-pressed={!chordMode}'), "note mode must not appear active while chord mode is active");
  assert.ok(studio.includes("setLastEventDynamic(score, part.id, dynamic, part.staves[staffIndex].id)"));
  assert.ok(studio.includes("setLastNoteArticulation(score, part.id, articulation, part.staves[staffIndex].id)"));
  assert.ok(studio.includes("setEventDynamic("), "the inspector must edit the exact selected event instead of silently changing the latest one");
  assert.ok(studio.includes("selectedEventTarget.measureId"), "selected inspector edits must retain their exact measure target");
  assert.ok(studio.includes("setEventArticulation("), "the inspector must edit the exact selected note articulation");
  assert.ok(studio.includes('Articulations apply to notes; select a note instead of a rest.'), "a selected rest must never redirect an articulation edit to another note");
  assert.ok(studio.includes("commit(\n      result.score,"), "articulation edits must enter the shared undo and autosave path");
  const playbackGain = await readFile(new URL("../lib/music/playback-gain.ts", import.meta.url), "utf8");
  const livePlayback = await readFile(new URL("../lib/music/live-playback.ts", import.meta.url), "utf8");
  assert.ok(livePlayback.includes("schedulePlaybackGain(gain.gain, item, noteStart)"), "live playback must schedule the tested dynamic envelope on the actual oscillator gain");
  assert.ok(playbackGain.includes("amplitude(note.velocity)"), "notes without a hairpin retain their dynamic velocity");
  assert.ok(playbackGain.includes("Math.min(.018, note.durationSeconds * .35)"), "live playback attack must fit short 32nd/64th note gates");
  assert.ok(studio.includes("Number.isFinite(tempo) ? Math.max(30, Math.min(300, Math.round(tempo))) : score.tempo"), "tempo must stay within the integer contract and empty input must retain the current tempo");
  assert.ok(studio.includes("event.currentTarget.value = String(setTempo(event.currentTarget.valueAsNumber))"), "tempo input must show the applied value even when normalization produces no score change");
  assert.ok(studio.includes("createPlaybackQueue(playbackNotes, from, to, loop)"), "playback must use the streaming queue in the visible score or part scope");
  assert.ok(studio.includes('viewMode === "part" && selectedPart ? [selectedPart.id] : undefined'), "part-view playback must not traverse hidden full-score parts");
  assert.ok(studio.includes("const wholeScoreEngravingPlan = useMemo"), "large-score edit safety must be based on the whole document even while a small part is visible");
  assert.ok(studio.includes('planLiveEngraving(score, "score", selectedPartId)'), "part fallback must never make an oversized whole document silently editable");
  assert.ok(studio.includes("if (guardLargeScoreEditing()) return;"), "mutation paths must stop before cloning an oversized document");
  assert.ok(studio.includes("Large score · editing paused for responsiveness · save and export remain available"), "read-only large-score behavior must be explicit and preserve escape hatches");
  assert.ok(studio.includes("MAX_MUSICXML_FILE_BYTES, MAX_NATIVE_FILE_BYTES, serializeNativeScore"), "native JSON and MusicXML must have explicit format-specific file boundaries");
  assert.ok(studio.includes("downloadBlob(serializeNativeScore(score)"), "native snapshots must be compact and remain inside their re-importable canonical budget");
  assert.ok(studio.includes("serializeNativeScore(next)"), "edits must be rejected atomically before they can leave the portable native-snapshot domain");
  assert.ok(studio.includes("window.clearInterval(playbackTimerRef.current)"), "stopping must cancel future audio scheduling");
  assert.ok(studio.includes('countLabel(musicNoteCount, "note")'), "playback status must count musical notes, excluding synthetic metronome clicks");
  assert.ok(studio.includes("musicNotes.filter(note => note.startSeconds < to && note.startSeconds + note.durationSeconds > from).length"), "the status count must include only music overlapping the complete playback interval");
  assert.match(livePlayback, /context\.currentTime - anchorAudio/, "the visual cursor must share Web Audio's scheduled clock and pre-roll");
  assert.ok(studio.includes("window.requestAnimationFrame(updatePlayback)"), "the visual cursor must sample the audio clock every display frame instead of skipping notation anchors");
  assert.ok(studio.includes("window.cancelAnimationFrame(playbackFrameRef.current)"), "playback frame updates must be cancelled on stop, failure, and teardown");
  assert.doesNotMatch(studio, /window\.setInterval\(\(\) => \{[\s\S]*?context!?\.currentTime - start/, "playback must not reduce cursor motion to 25 Hz intervals");
  assert.match(studio, /try \{[\s\S]*?context = new AudioContext\(\);[\s\S]*?context\.createGain\(\);[\s\S]*?createLivePlayback\(context, master,[\s\S]*?\} catch \{[\s\S]*?context\.close\(\)/, "audio graph construction failures must close the partial context and restore idle playback state");
  assert.doesNotMatch(studio, /performance\.now\(\)/, "playback must not mix the document clock with the AudioContext clock");
  assert.ok(studio.includes("scoreNotatedDurationSeconds(score)"), "playback must keep the cursor through the complete score timeline, including engraved trailing measures");
  assert.ok(studio.includes("setPlaybackSeconds(live.position())"), "loop playhead must use the same clipped interval as audio");
  assert.ok(studio.includes("Silent playback"), "muted and rest-only intervals must still support visual practice");
  assert.ok(studio.includes('window.localStorage.getItem("garak.practice.beat-guide") !== "off"'), "visual beat preference defaults on and restores independently of sound");
  assert.ok(studio.includes('rememberPracticePreference("beat-guide", enabled ? "on" : "off")'), "visual beat toggle persists");
  assert.ok(studio.includes('(countInProgress || beatGuideEnabled)'), "count-in remains visible when ordinary beat display is disabled");
  assert.ok(studio.includes("data-downbeat={transportBeat === 1"), "visual guide must accent the current measure first beat independently of click sound");
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
  assert.ok(studio.includes("const importRequestIdRef = useRef(0)"), "file imports must have a last-request-wins identity");
  assert.ok((studio.match(/requestId !== importRequestIdRef\.current/g) ?? []).length >= 3, "every asynchronous import boundary and error path must reject stale requests");
  assert.ok(studio.includes("const previousScore = scoreRef.current"), "import Undo must capture the score that exists when replacement actually happens");
  assert.ok(studio.includes("revalidateEventSelection(previousScore, selectedEventTargetRef.current)"), "import Undo must pair the latest valid event selection with that score");
  assert.ok(studio.includes("setPast((items) => preserveUndo"), "import completion must update the latest history instead of overwriting edits from a stale closure");
  assert.ok(studio.includes('trimStudioHistory([...items, { score: previousScore, selection: previousSelection }], "end")'), "safe previous scores must enter bounded import Undo history");
  assert.ok(studio.includes("Cancel MusicXML import"));
  assert.ok(studio.includes("siblings.forEach((element) => { element.inert = true; })"), "modal background controls must become inert");
  assert.ok(studio.includes('document.addEventListener("keydown", handleDialogKey)'), "dialogs must trap Tab and handle Escape");
  assert.ok(studio.includes('target?.closest("#score-inspector")'), "the inspector shortcut exception must be scoped to the inspector, including its fallback focus container");
  assert.ok(studio.includes('(event.metaKey || event.ctrlKey) && ["z", "s"].includes(event.key.toLowerCase())'), "only explicit undo/redo and save shortcuts may pass through the inspector dialog");
  assert.ok(studio.includes("if (activeDialogOpen && !(inspectorOpen && inspectorEditingControl && editingShortcut)) return;"), "other dialog shortcuts must not mutate or play the background score");
  assert.ok(studio.includes("previousFocus?.getClientRects().length"), "closing a dialog must verify that the return target remains visible");
  assert.ok(studio.includes("else fallbackFocus?.focus()"), "closing a dialog must fall back to a visible header control after responsive changes");
  assert.ok(studio.includes("document.activeElement === dialog"), "the first Tab or Shift+Tab from a focused dialog container must enter the trap in the correct direction");
  assert.ok(studio.includes("const activeDialogKind = pendingImport"), "dialog transitions must retrap focus even when one modal replaces another without an unmodalized frame");
  assert.ok(studio.includes('className="note-entry-help-toggle" aria-label="Note input help"'), "input guidance must remain reachable beside the floating note preview");
  assert.ok(studio.includes("!element.hidden && element.getClientRects().length > 0"), "drawer focus traps must skip controls in hidden inspector categories");
  assert.match(studio, /className="project-title"[\s\S]*?setInspectorSection\("score"\);[\s\S]*?window\.requestAnimationFrame\(\(\) => document\.getElementById\("score-title"\)\?\.focus\(\)\)/, "editing the title must reveal Score settings before focusing the field");
  assert.match(styles, /\.inspector-pane\[hidden\]\s*\{[^}]*display:\s*none/, "inactive inspector categories must stay out of layout and keyboard navigation");
  assert.ok(studio.includes('!element.classList.contains("sr-status")'), "modal inerting must preserve the sole assistive live status region");
  assert.ok(studio.includes("modalReturnFocusRef.current = captureModalReturnFocus()"), "modal launchers that unmount must retain an explicit visible return target");
  assert.ok(studio.includes("openFilePicker(exportButtonRef.current)"), "mobile file-import warnings must restore focus to the visible file disclosure, not a hidden desktop control");
  assert.equal((studio.match(/ref=\{activeDialogRef\} tabIndex=\{-1\}/g) ?? []).length, 4, "every modal must receive initial programmatic focus");
  assert.ok(studio.includes("Your current score is unchanged"));
  assert.ok(studio.includes("setPendingImport({ score: parsed, warnings: imported.warnings })"), "lossy MusicXML imports must remain staged");
  assert.ok(studio.includes("Cancel import"));
  assert.ok(studio.includes("Open editable copy"));
  assert.ok(studio.includes('aria-expanded={inspectorVisible}'), "inspector disclosures must report actual visibility on desktop and in drawer mode");
  assert.ok(studio.includes("query.addEventListener(\"change\", syncMode)"), "compact inspector semantics must follow viewport changes");
  assert.ok(studio.includes("else if (!query.matches)"), "leaving inspector drawer mode must release its modal focus trap");
  assert.ok(studio.includes("query.matches && focusedInspector"), "entering inspector drawer mode must preserve an inspector editing task");
  assert.ok(studio.includes("lastFocusedControlRef.current"), "breakpoint handlers must remember focus even when CSS hides a control before matchMedia runs");
  assert.ok(studio.includes("setInstrumentsOpen(false)"), "leaving the mobile breakpoint must close the instrument drawer and its scrim");
  assert.ok(studio.includes("!focused.isConnected || focused.getClientRects().length === 0"), "responsive transitions must move focus away from controls that become hidden");
  assert.ok(studio.includes("current === document.body) focused.focus()"), "a responsive panel that reappears must restore its remembered keyboard focus instead of leaving focus on the document body");
  assert.ok(studio.includes('aria-controls="instrument-drawer"'));
  assert.ok(studio.includes('aria-label="File and export menu"'));
  assert.ok(studio.includes('role="group" aria-label="File and export options"'));
  assert.doesNotMatch(studio, /aria-haspopup="true"/, "the export disclosure must not claim menu keyboard semantics while exposing ordinary buttons");
  assert.ok(studio.includes("ref={fileInputRef} hidden type=\"file\""), "the programmatic file input must be absent from layout and the accessibility tree");
  assert.equal((studio.match(/aria-live="polite"/g) ?? []).length, 1, "filtered instrument results must keep one scoped polite live region");
  assert.ok(studio.includes('className="catalog-results" role="status" aria-live="polite"'), "instrument search must announce its result count in context");
  assert.ok(studio.includes('className="sr-status" role={statusTone(status) === "error" ? "alert" : "status"}'), "editing feedback must retain one severity-aware global live region");
  assert.ok(studio.includes('aria-live={statusTone(status) === "error" ? "assertive" : "polite"}'), "data-loss and import failures must interrupt polite editing feedback");
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
  assert.match(studio, /cycle 0 → 1 → 2 dots/i);
  assert.ok(studio.includes("nextAugmentationDotCount(dotCount)"));
  assert.ok(studio.includes("setTimeFromMeasure(score, activeChangeMeasureId"));
  assert.ok(studio.includes("setKeyFromMeasure(score, activeChangeMeasureId"));
  assert.ok(studio.includes("!changeMeterIsPreset ? <option value={changeMeterValue}>{changeMeterValue} · imported/custom</option>"), "an imported exact meter outside the presets must remain visibly selected");
  assert.ok(studio.includes("later changes kept"));
  assert.ok(studio.includes("commit(result.score, `Time signature"), "a meter range change enters the shared undo/autosave commit path once");
  assert.ok(studio.includes("commit(result.score, `${keySignatureName(key)} concert key"), "a key range change enters the shared undo/autosave commit path once");
  assert.ok(studio.includes("loadStoredScore(window.localStorage)"), "hydration must validate the primary and backup snapshots through the storage boundary");
  assert.ok(studio.includes("saveStoredScore(window.localStorage, score)"), "autosave and Save in this browser must share the guarded storage boundary");
  assert.ok(studio.includes("Recovered the last-known-good backup — the damaged latest draft was preserved; autosave is paused until Save in this browser or New"));
  assert.ok(studio.includes('setAutoSaveEnabled(stored.source === "primary")'), "backup recovery must preserve the damaged primary until explicit confirmation");
  assert.ok(studio.includes("Local save failed"));
  assert.ok(studio.includes("damaged drafts were preserved; autosave is paused until Save in this browser or New"), "unrecoverable raw drafts must not be overwritten by the fresh score timer");
  assert.ok(studio.includes("Started a fresh score — local storage is unavailable"), "a blocked localStorage getter must still finish hydration with a fresh score");
  assert.ok(studio.includes("if (!hydrated || !autoSaveEnabled) return;"), "autosave must remain gated after an unrecoverable load");
  assert.ok(studio.includes('window.addEventListener("pagehide", handlePageHide)'), "navigation must synchronously flush a pending debounced save");
  assert.ok(studio.includes('document.addEventListener("visibilitychange", handleVisibilityChange)'), "backgrounding a mobile tab must flush a pending debounced save");
  assert.ok(studio.includes("persistScoreLocally(scoreRef.current)"), "exit-time persistence must use the latest score instead of a stale effect closure");
  assert.ok(studio.includes("if (!autoSaveEnabledRef.current) return false;"), "an edited recovery draft must trigger unload protection while deliberate autosave pause preserves damaged storage");
  assert.ok(studio.includes("Undid the last edit · autosave paused"), "Undo must not hide a recovery draft's persistence warning");
  assert.ok(studio.includes("Redid the edit · autosave paused"), "Redo must not hide a recovery draft's persistence warning");
  assert.ok(studio.includes('input.addEventListener("cancel", restoreFilePickerFocus)'), "cancelling the native file picker must restore a visible editor control");
  assert.ok(studio.includes("filePickerReturnFocusRef.current === returnFocus"), "browsers without a file-input cancel event need a window-focus fallback");
  assert.match(studio, /finally \{\s*hydratedRef\.current = true;\s*setHydrated\(true\);\s*\}/, "hydration refs and UI state must complete together after every storage outcome");
  assert.equal((studio.match(/persistScoreLocally\(score\)/g) ?? []).length, 2, "debounced autosave and Save in this browser must share getter-safe failure handling");
  const newScoreHandler = studio.match(/const createFromTemplate = \(templateId: string\) => \{([\s\S]*?)\n {2}\};/)?.[1];
  assert.ok(newScoreHandler?.includes("setMetadataDraft(next.metadata)"), "a new whole-document score must reset the editable metadata draft");
  assert.ok(newScoreHandler?.includes('preserveUndo ? trimStudioHistory([...past, { score, selection: selectedEventTarget }], "end") : []'), "creating a new score must preserve bounded Undo unless retaining an oversized document would freeze the editor");
  assert.ok(studio.includes("This large score cannot be kept in Undo without freezing the editor"), "the large-score New escape hatch must disclose its Undo tradeoff before replacement");
  const importedScoreHandler = studio.match(/const openImportedScore = \(parsed: ScoreDocument, message: string\) => \{([\s\S]*?)\n {2}\};/)?.[1];
  assert.ok(importedScoreHandler?.includes('planLiveEngraving(previousScore, "score", previousSelectionFallback.partId).kind === "safe"'), "opening a score must assess the previous live document before attempting to retain it");
  assert.ok(importedScoreHandler?.includes('preserveUndo\n      ? trimStudioHistory([...items, { score: previousScore, selection: previousSelection }], "end")\n      : []'), "opening a score must preserve bounded Undo unless retaining an oversized document would freeze the editor");
  assert.ok(studio.includes('setStatus("Playback finished")'), "natural playback completion must not be announced as a manual stop");
  assert.doesNotMatch(studio, /localStorage\.setItem\((?!"garak\.playback-(?:follow|speed)"|`garak\.practice\.)/, "score writes must not bypass validation and backup rotation; only the UI follow preference writes directly");
  for (const [duration, flagCount] of [[1, 0], [2, 0], [4, 0], [8, 1], [16, 2], [32, 3], [64, 4]]) {
    assert.ok(durationIcon.includes(`${duration}: ${flagCount}`), `${duration} duration must preserve its exact visible flag count`);
  }
  assert.ok(durationIcon.includes("<svg"), "duration icons must use deterministic code-native vector geometry");
  assert.ok(durationIcon.includes('className="duration-stem"'), "stemmed durations need a visible vector stem");
  assert.ok(durationIcon.includes('className="duration-flag"'), "eighth through sixty-fourth durations need distinct vector flags");
  assert.ok(durationIcon.includes('aria-hidden="true"'), "decorative music glyphs must not duplicate the button accessible name");
  assert.doesNotMatch(layout, /Noto_Music/, "vector duration icons must not ship an otherwise-unused music webfont");
  assert.match(styles, /\.duration-notehead\.open\s*\{[^}]*fill:\s*none[^}]*stroke:\s*currentColor/, "whole and half notes must retain open noteheads at every theme color");
  assert.match(styles, /\.export-menu\s*\{[^}]*max-height:\s*calc\(100dvh[^}]*overflow-y:\s*auto/, "short viewports must be able to scroll every file and export action");
  assert.match(styles, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.note-toolbar \.mode-pill[^{]*\{[^}]*min-height:\s*44px/, "compact notation controls must keep 44px touch targets across the full mobile-editor breakpoint");
  assert.match(styles, /@media\s*\(max-width:\s*860px\) and \(max-height:\s*600px\)[\s\S]*?\.canvas-controls \.mode-pill\s*\{[^}]*min-height:\s*44px/, "short mobile screens must not shrink measure controls below touch size");
  assert.match(styles, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.app-header\s*\{[^}]*grid-template-columns:\s*70px/, "the mid-width header must compact before playback can overflow it");
  assert.match(styles, /\.workspace\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/, "the canvas must fill the available editor workspace");
  assert.match(styles, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.file-menu-icon, \.file-menu-label\s*\{[^}]*display:\s*inline/, "compact file actions must have a visible File label and matching icon");
  assert.match(styles, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.inspector-section input[^}]*font-size:\s*16px/, "mobile form controls must avoid disruptive iOS focus zoom");
  assert.match(styles, /\.instrument-search:focus-within\s*\{[^}]*border-color:\s*var\(--blue\)/, "instrument search must retain a visible keyboard focus ring");
  assert.match(styles, /@media\s*\(max-height:\s*600px\)[\s\S]*?\.canvas-controls\s*\{[^}]*min-height:\s*32px/, "low-height layouts must retain compact measure controls");
  assert.doesNotMatch(styles, /@media\s*\(max-height:\s*600px\)[\s\S]*?\.canvas-controls\s*\{[^}]*display:\s*none/, "low-height layouts must not remove the only measure actions");
  assert.match(styles, /@media\s*\(max-height:\s*600px\)[\s\S]*?\.canvas-controls \.selected-event-summary\s*\{[^}]*max-width:\s*100%/, "short viewports must retain room for the selected delete target");
  assert.doesNotMatch(styles, /\.selected-event-summary\s*\{[^}]*display:\s*none/, "the selected delete target must remain visible at every viewport size");
  assert.match(styles, /@media\s*\(max-width:\s*860px\) and \(prefers-reduced-motion:\s*reduce\)[\s\S]*?mobile-status-discrete/, "mobile reduced-motion users need a non-moving timed status dismissal without hiding desktop save state");
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation-duration:\s*\.01ms/, "reduced-motion suppression must remain global at desktop widths");
  assert.match(styles, /@media print[\s\S]*?\.pointer-note-preview[^{}]*\{\s*display:\s*none/, "pointer hover and drag guidance must never appear in print or PDF output");
  assert.ok(renderer.includes('"d".repeat(event.duration.dots)'));
  assert.ok(renderer.includes("new TextDynamics({ duration, text: event.dynamic, line: 9 })"));
  assert.ok(renderer.includes("new Articulation(VEXFLOW_ARTICULATION_CODES[event.articulation]).setPosition(ModifierPosition.ABOVE)"));
  assert.ok(renderer.includes('await import("vexflow/bravura")'), "the renderer must use the audited three-font Bravura entry");
  const fontGateIndex = renderer.indexOf("await waitForEngravingFonts(document.fonts)");
  const firstVexFlowLayoutIndex = renderer.indexOf("new Stave(");
  assert.ok(fontGateIndex >= 0, "engraving must wait for its embedded music fonts");
  assert.ok(fontGateIndex < firstVexFlowLayoutIndex, "music fonts must be ready before VexFlow measures or positions any glyph");
  assert.match(
    renderer.slice(fontGateIndex, firstVexFlowLayoutIndex),
    /requestId !== engravingRequestRef\.current \|\| hostRef\.current !== host/,
    "engraving must revalidate its async request after waiting for fonts",
  );
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
  assert.ok(styles.includes("margin-left: calc(-1px * var(--engraving-ui-scale,1))"), "the two-screen-pixel notation cursors must be centered on their VexFlow anchor");
  assert.ok(renderer.includes("xForMeasureTick(playbackLayout, playbackPosition.tickInMeasure"), "the notation cursor must interpolate from semantic ticks through engraved anchors");
  assert.ok(renderer.includes("const x = note.getAbsoluteX()"), "playback tick anchors must use VexFlow's shared rhythmic position rather than stem direction or glyph width");
  assert.ok(renderer.includes("noteStartX + Stave.defaultPadding - Stave.rightPadding"), "an empty measure must begin on VexFlow's padded rhythmic grid rather than at the modifier boundary");
  assert.ok(renderer.includes("endX: noteEndX"), "silent measure tails must carry the playback cursor to the actual right barline");
  assert.doesNotMatch(renderer, /endX: noteEndX - Stave\.defaultPadding/, "the playback endpoint must not subtract VexFlow's formatting padding twice");
  assert.ok(renderer.includes("cells.filter((cell) => !cell.placeholder)"), "centered placeholder rests must not skew the shared playback cursor");
  assert.doesNotMatch(renderer, /playbackLayout\.startX\s*\+[^\n]*measureProgress/, "playback must not regress to linear page or measure percentages");
  assert.ok(renderer.includes("note.getBoundingBox()"), "rendered event bounds must drive direct note/rest selection");
  assert.ok(renderer.includes("distance <= 22"), "note selection must include a forgiving near-hit target without selecting another staff");
  assert.ok(renderer.includes("pointToRectCenterDistance"), "overlapping direct event boxes must resolve by two-dimensional pointer-to-center distance");
  assert.ok(renderer.includes("distance <= 22 / Math.min(renderedScaleX, renderedScaleY)"), "near-hit forgiveness must remain 22 screen pixels even during a zoom transition");
  assert.ok(renderer.includes("engravingState.source === engravingSource"), "async event and measure geometry must be consumed only for its exact score, rows, and width source");
  assert.ok(renderer.includes("requestId === engravingRequestRef.current && hostRef.current === host"), "async engraving completion and error paths must reject stale requests and hosts");
  assert.ok(renderer.includes("planLiveEngraving(score, viewMode, selectedPartId)"), "the renderer must plan a bounded visible scope before importing or invoking VexFlow");
  assert.ok(renderer.includes("if (interactiveRenderBlocked)"), "unsafe single-SVG scores must skip engraving work instead of freezing the main thread");
  assert.ok(renderer.includes("without changing or truncating the score"), "automatic part fallback must disclose that the document remains intact");
  assert.ok(renderer.includes("Preparing notation…"), "cold dynamic engraving must expose progress rather than an unexplained blank score");
  assert.ok(renderer.includes("Retry engraving"), "a transient renderer failure must have an explicit recovery action");
  const retryHandler = renderer.match(/onClick=\{\(\) => \{([\s\S]*?)\}\}>Retry engraving<\/button>/)?.[1];
  const retryReset = 'setEngravingState({ source: null, measureLayouts: [], eventLayouts: [], noteheadLayouts: [], staffHitLayouts: [], error: "" })';
  assert.ok(retryHandler?.includes(retryReset), "retrying engraving must clear the stale error and re-enter the aria-busy loading state before drawing again");
  assert.ok(retryHandler.includes("setRenderAttempt((attempt) => attempt + 1)"), "retrying engraving must launch a fresh render attempt");
  assert.ok(retryHandler.indexOf(retryReset) < retryHandler.indexOf("setRenderAttempt"), "retrying engraving must reset transient state before launching the fresh render attempt");
  assert.ok(renderer.includes('className="event-selection"'), "the selected event must receive a visible score-local highlight");
  assert.ok(renderer.includes("accessibleEventLabel(selectedEventDetails.event)"), "the focused score control must retain the exact selected note, chord, or rest description");
  assert.ok(renderer.includes("selectedEventDetails.part.name"), "the focused score control must retain the selected event's part context");
  assert.ok(renderer.includes("selectedEventDetails.staffIndex + 1"), "the focused score control must retain the selected event's staff context");
  assert.ok(renderer.includes("selectedEventDetails.measureId"), "the focused score control must retain the selected event's measure context");
  assert.ok(renderer.includes("duration.dots === 1"), "selected-event duration context must distinguish dotted values");
  assert.ok(renderer.includes("duration.dots === 2"), "selected-event duration context must distinguish double-dotted values");
  assert.ok(renderer.includes("pitchName(note.pitch)"), "selected notes and chord tones must retain their written pitch context");
  assert.ok(renderer.includes('event.kind === "rest"'), "selected rests must be identified without inventing pitch context");
  assert.ok(renderer.includes("chord with"), "multi-note events must be identified as chords");
  assert.ok(renderer.includes("Click or tap a note or rest to select it, then use Edit selection to change its notation"), "the accessible score label must explain direct event selection");
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
  assert.match(styles, /@media print[\s\S]*?\.engraving-surface\s*\{[^}]*width:\s*100%\s*!important[^}]*transform:\s*none\s*!important/, "print output must replace interactive zoom with a page-width surface");
  assert.match(styles, /@media print[\s\S]*?\.vexflow-host svg\s*\{[^}]*width:\s*100%\s*!important[^}]*height:\s*auto\s*!important/, "print notation must scale the SVG proportionally inside the A4 imageable width");
  assert.ok(renderer.includes("Use the Left and Right Arrow keys to select events"), "the bounded score label must explain keyboard event selection");
  assert.ok(renderer.includes("Alt with Up or Down to select a staff"), "the bounded score label must explain keyboard staff selection");
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


test("floating input can move without accidentally opening, entering music, or becoming unreachable", async () => {
  const [studio, dock, styles] = await Promise.all([
    readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/useFloatingNoteDock.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.ok(studio.includes('aria-label="Move note palette"') && studio.includes('aria-label="Reset note palette to bottom right"'));
  assert.equal((studio.match(/\{\.\.\.floatingDock\.dragHandlers\}/g) ?? []).length, 2, "the round launcher and explicit handle both support dragging");
  assert.ok(dock.includes("Math.hypot(dx, dy) < 6") && dock.includes("event.stopPropagation()"), "small taps still open while actual drags suppress their click");
  for (const cancellation of ['"pointercancel"', '"blur"', '"resize"', '"Escape"']) assert.ok(dock.includes(cancellation));
  assert.ok(dock.includes("current.pointerId !== event.pointerId") && dock.includes("finish(true)"), "additional touches must cancel instead of moving unpredictably");
  assert.match(styles, /\.note-entry-toggle\s*\{[^}]*touch-action:\s*none/);
  assert.match(styles, /\.note-entry-drag-handle\s*\{[^}]*touch-action:\s*none/);
  assert.ok(dock.includes('event.key === "Home"') && dock.includes('"ArrowLeft"'), "keyboard users can reposition and reset the palette");
  assert.ok(dock.includes("loadDockPosition(window.localStorage)") && dock.includes("saveDockPosition(window.localStorage, next)"));
  assert.match(dock, /if \(cancel\) setPosition\(current\.original\);\s*else if \(current\.moved\) \{[\s\S]*remember\(next\)/, "only a completed drag persists its new position");
  assert.ok(dock.includes("setPosition(null); remember(null)"), "reset must persist, not only move the current palette");
  assert.ok(dock.includes('visibility: positionLoaded && bounds.width > 0 ? undefined : "hidden"'), "the launcher must not jump from its default position under a tap during restoration");
  assert.ok(studio.includes("floatingDock.storageError") && studio.includes('className="note-dock-storage-error" role="status"'), "storage failure must be visible without interrupting score editing");
});

test("playback following yields to manual navigation and freezes while paused", async () => {
  const renderer = await readFile(new URL("../components/ScoreRenderer.tsx", import.meta.url), "utf8");
  const studio = await readFile(new URL("../components/NotationStudio.tsx", import.meta.url), "utf8");
  assert.match(renderer, /playbackPaused && !forceFollowRef.current/);
  assert.ok(renderer.includes("if (!playbackFollowEnabled || followHeld) return;"));
  for (const event of ["wheel", "touchmove", "keydown", "scroll"]) {
    assert.ok(renderer.includes(`addEventListener("${event}"`));
    assert.ok(renderer.includes(`removeEventListener("${event}"`));
  }
  assert.ok(renderer.includes("frame.scrollLeft - expected.left"));
  assert.ok(renderer.includes("canvas.scrollTop - expected.top"));
  assert.ok(!renderer.includes("releaseTimer"), "manual scrolling must never expire on a timer");
  assert.ok(studio.includes('localStorage.getItem("garak.playback-follow")'));
  assert.ok(studio.includes('localStorage.setItem("garak.playback-follow", enabled ? "on" : "off")'));
  assert.ok(studio.includes('aria-label="Auto-follow playback" aria-pressed={playbackFollowEnabled}'));
  assert.ok(studio.includes("playbackPaused={paused}"));
  assert.ok(studio.includes("playbackFollowRevision={playbackFollowRevision}"));
});
