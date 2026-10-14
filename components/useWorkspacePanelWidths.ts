"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { clampPanelWidth, loadPanelCollapsed, loadPanelWidth, PANEL_LIMITS, PANEL_SIDES, panelWidthsAfterResize, savePanelCollapsed, savePanelWidth, workspacePanelLayout } from "../lib/panel-widths";
import type { CollapsedPanels, PanelLayoutMode, PanelSide, PanelWidths } from "../lib/panel-widths";

interface PanelDrag {
  side: PanelSide;
  pointerId: number;
  startX: number;
  startWidth: number;
  maxWidth: number;
  original: PanelWidths;
  base: PanelWidths;
  width: number;
  element: HTMLElement;
}

export function useWorkspacePanelWidths(workspaceRef: RefObject<HTMLDivElement | null>) {
  const [preferred, setPreferred] = useState<PanelWidths>({ instrument: PANEL_LIMITS.instrument.defaultWidth, inspector: PANEL_LIMITS.inspector.defaultWidth });
  const [focusMode, setFocusMode] = useState(false);
  const [collapsed, setCollapsed] = useState<CollapsedPanels>({ instrument: false, inspector: false });
  const [visibilityErrors, setVisibilityErrors] = useState<Record<PanelSide, string | null>>({ instrument: null, inspector: null });
  const [viewport, setViewport] = useState<{ width: number; mode: PanelLayoutMode }>({ width: 0, mode: "docked" });
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState<PanelSide | null>(null);
  const [storageErrors, setStorageErrors] = useState<Record<PanelSide, string | null>>({ instrument: null, inspector: null });
  const drag = useRef<PanelDrag | null>(null);
  const layout = workspacePanelLayout(preferred, viewport.width, viewport.mode, focusMode ? { instrument: true, inspector: true } : collapsed);
  const ready = loaded && viewport.width > 0;

  const remember = useCallback((next: PanelWidths, previous: PanelWidths, changedSide: PanelSide) => {
    const errors: Partial<Record<PanelSide, string | null>> = {};
    for (const side of PANEL_SIDES) {
      if (side !== changedSide && next[side] === previous[side]) continue;
      try { errors[side] = savePanelWidth(window.localStorage, side, next[side]); }
      catch { errors[side] = `${PANEL_LIMITS[side].label} resized for this visit only. Browser storage is unavailable.`; }
    }
    setStorageErrors((previousErrors) => ({ ...previousErrors, ...errors }));
  }, []);

  const finish = useCallback((cancel: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (cancel || current.width === current.startWidth) setPreferred(current.original);
    else remember({ ...current.base, [current.side]: current.width }, current.original, current.side);
    setDragging(null);
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }, [remember]);

  const setPanelCollapsed = useCallback((side: PanelSide, value: boolean) => {
    finish(true);
    setFocusMode(false);
    setCollapsed((previous) => ({ ...previous, [side]: value }));
    let error: string | null;
    try { error = savePanelCollapsed(window.localStorage, side, value); }
    catch { error = `${PANEL_LIMITS[side].label} visibility changed for this visit only. Browser storage is unavailable.`; }
    setVisibilityErrors((previous) => ({ ...previous, [side]: error }));
  }, [finish]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const widths: PanelWidths = { instrument: PANEL_LIMITS.instrument.defaultWidth, inspector: PANEL_LIMITS.inspector.defaultWidth };
      const errors: Record<PanelSide, string | null> = { instrument: null, inspector: null };
      const hidden: CollapsedPanels = { instrument: false, inspector: false };
      const hiddenErrors: Record<PanelSide, string | null> = { instrument: null, inspector: null };
      for (const side of PANEL_SIDES) {
        try {
          const stored = loadPanelWidth(window.localStorage, side);
          widths[side] = stored.width;
          errors[side] = stored.error;
        } catch {
          errors[side] = `${PANEL_LIMITS[side].label} width is available for this visit only. Browser storage is unavailable.`;
        }
        try {
          const stored = loadPanelCollapsed(window.localStorage, side);
          hidden[side] = stored.collapsed;
          hiddenErrors[side] = stored.error;
        } catch {
          hiddenErrors[side] = `${PANEL_LIMITS[side].label} visibility is available for this visit only. Browser storage is unavailable.`;
        }
      }
      setPreferred(widths);
      setCollapsed(hidden);
      setVisibilityErrors(hiddenErrors);
      setStorageErrors(errors);
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const cancel = () => finish(true);
    const measure = () => {
      cancel();
      const mode: PanelLayoutMode = window.matchMedia("(max-width: 860px)").matches ? "drawers"
        : window.matchMedia("(max-width: 1180px)").matches ? "inspector-drawer" : "docked";
      const width = workspace.clientWidth;
      setViewport((previous) => previous.width === width && previous.mode === mode ? previous : { width, mode });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    const additionalPointer = (event: PointerEvent) => {
      if (drag.current && drag.current.pointerId !== event.pointerId) cancel();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener("resize", measure);
    window.addEventListener("blur", cancel);
    document.addEventListener("pointerdown", additionalPointer, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("pointerdown", additionalPointer, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [finish, workspaceRef]);

  // Temporarily hide panels without changing the saved visibility or width preferences.
  const toggleFocusMode = useCallback(() => {
    finish(true);
    setFocusMode((current) => !current);
  }, [finish]);

  const onPointerDown = (side: PanelSide, event: ReactPointerEvent<HTMLElement>) => {
    if (!ready || event.button !== 0 || !event.isPrimary || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const { width, maxWidth } = layout[side];
    drag.current = { side, pointerId: event.pointerId, startX: event.clientX, startWidth: width, maxWidth, original: preferred,
      base: panelWidthsAfterResize(preferred, layout, side, width), width, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(side);
  };
  const onPointerMove = (side: PanelSide, event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.side !== side || current.pointerId !== event.pointerId) return;
    const direction = side === "instrument" ? 1 : -1;
    current.width = clampPanelWidth(side, current.startWidth + direction * (event.clientX - current.startX), current.maxWidth);
    setPreferred({ ...current.base, [side]: current.width });
  };
  const onPointerUp = (side: PanelSide, event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.side !== side || drag.current.pointerId !== event.pointerId) return;
    onPointerMove(side, event);
    finish(false);
  };
  const onPointerCancel = (side: PanelSide, event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.side === side && drag.current.pointerId === event.pointerId) finish(true);
  };
  const onKeyDown = (side: PanelSide, event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.current || !ready) return;
    const { width, minWidth, maxWidth } = layout[side];
    const direction = side === "instrument" ? 1 : -1;
    const delta = (event.shiftKey ? 40 : 10) * direction;
    const nextWidth = event.key === "Home" ? minWidth : event.key === "End" ? maxWidth
      : clampPanelWidth(side, width + (event.key === "ArrowLeft" ? -delta : delta), maxWidth);
    if (nextWidth === width) return;
    const next = panelWidthsAfterResize(preferred, layout, side, nextWidth);
    setPreferred(next);
    remember(next, preferred, side);
  };
  const onDoubleClick = (side: PanelSide) => {
    finish(true);
    // Retain the default preference even when the current viewport cannot display it in full.
    const next = { ...panelWidthsAfterResize(preferred, layout, side, PANEL_LIMITS[side].defaultWidth), [side]: PANEL_LIMITS[side].defaultWidth };
    setPreferred(next);
    remember(next, preferred, side);
  };
  const style: CSSProperties & Record<"--instrument-panel-width" | "--inspector-panel-width" | "--instrument-panel-column" | "--inspector-panel-column", string> = {
    "--instrument-panel-width": `${layout.instrument.width}px`, "--inspector-panel-width": `${layout.inspector.width}px`,
    "--instrument-panel-column": `${layout.instrument.docked ? layout.instrument.width : 0}px`,
    "--inspector-panel-column": `${layout.inspector.docked ? layout.inspector.width : 0}px`,
  };
  return { style, dragging, focusMode, toggleFocusMode, setPanelCollapsed, visibilityError: PANEL_SIDES.map((side) => visibilityErrors[side]).filter(Boolean).join(" "),
    instrument: { ...layout.instrument, ready, dragging: dragging === "instrument", storageError: storageErrors.instrument,
      separatorHandlers: {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown("instrument", event),
        onPointerMove: (event: ReactPointerEvent<HTMLElement>) => onPointerMove("instrument", event),
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => onPointerUp("instrument", event),
        onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => onPointerCancel("instrument", event),
        onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => onPointerCancel("instrument", event),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown("instrument", event),
        onDoubleClick: () => onDoubleClick("instrument"),
      },
    },
    inspector: { ...layout.inspector, ready, dragging: dragging === "inspector", storageError: storageErrors.inspector,
      separatorHandlers: {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown("inspector", event),
        onPointerMove: (event: ReactPointerEvent<HTMLElement>) => onPointerMove("inspector", event),
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => onPointerUp("inspector", event),
        onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => onPointerCancel("inspector", event),
        onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => onPointerCancel("inspector", event),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown("inspector", event),
        onDoubleClick: () => onDoubleClick("inspector"),
      },
    },
  };
}
