"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { dockPointFromPosition, floatingDockPlacement, loadDockPosition, relativeDockPosition, saveDockPosition } from "../lib/floating-dock";
import type { DockBounds, DockPoint, DockPosition } from "../lib/floating-dock";

interface DockDrag {
  pointerId: number;
  clientX: number;
  clientY: number;
  anchor: DockPoint;
  original: DockPosition | null;
  element: HTMLElement;
  moved: boolean;
}

export function useFloatingNoteDock(ref: RefObject<HTMLDivElement | null>, expanded: boolean, helpOpen: boolean) {
  const [position, setPosition] = useState<DockPosition | null>(null);
  const [bounds, setBounds] = useState<DockBounds>({ width: 0, height: 0, dockHeight: 136 });
  const [dragging, setDragging] = useState(false);
  const [positionLoaded, setPositionLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const drag = useRef<DockDrag | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = loadDockPosition(window.localStorage);
        setPosition(stored.position);
        setStorageError(stored.error);
      } catch {
        setStorageError("Palette position is available for this visit only. Browser storage is unavailable.");
      } finally {
        setPositionLoaded(true);
      }
    });
    return () => { active = false; };
  }, []);

  const remember = useCallback((next: DockPosition | null) => {
    try { setStorageError(saveDockPosition(window.localStorage, next)); }
    catch { setStorageError("Palette position is available for this visit only. Browser storage is unavailable."); }
  }, []);

  const anchor = useCallback((): DockPoint => {
    const parent = ref.current!.parentElement!.getBoundingClientRect();
    const button = ref.current!.querySelector(".note-entry-toggle")!.getBoundingClientRect();
    return { x: button.left - parent.left, y: button.bottom - parent.top };
  }, [ref]);

  const finish = useCallback((cancel: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    suppressClick.current = cancel || current.moved;
    if (cancel) setPosition(current.original);
    else if (current.moved) {
      const parent = ref.current!.parentElement!;
      const next = relativeDockPosition({ width: parent.clientWidth, height: parent.clientHeight, dockHeight: 0 }, anchor());
      setPosition(next);
      remember(next);
    }
    setDragging(false);
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }, [anchor, ref, remember]);

  useEffect(() => {
    const dock = ref.current;
    const parent = dock?.parentElement;
    if (!dock || !parent) return;
    const measure = () => setBounds((previous) => {
      const next = { width: parent.clientWidth, height: parent.clientHeight, dockHeight: dock.getBoundingClientRect().height };
      return next.width === previous.width && next.height === previous.height && next.dockHeight === previous.dockHeight ? previous : next;
    });
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(dock);
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.clientX;
      const dy = event.clientY - current.clientY;
      if (!current.moved && Math.hypot(dx, dy) < 6) return;
      current.moved = true;
      setDragging(true);
      setPosition(relativeDockPosition({ width: parent.clientWidth, height: parent.clientHeight, dockHeight: 0 }, { x: current.anchor.x + dx, y: current.anchor.y + dy }));
    };
    const end = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) finish(event.type === "pointercancel"); };
    const additionalPointer = (event: PointerEvent) => { if (drag.current && drag.current.pointerId !== event.pointerId) finish(true); };
    const cancel = () => finish(true);
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopImmediatePropagation(); finish(true); }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    document.addEventListener("pointerdown", additionalPointer, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      document.removeEventListener("pointerdown", additionalPointer, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [finish, ref]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, anchor: anchor(), original: position, element: event.currentTarget, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const reset = () => { finish(true); setPosition(null); remember(null); };
  const onHandleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Home") { event.preventDefault(); event.stopPropagation(); reset(); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = anchor();
    const distance = event.shiftKey ? 60 : 20;
    const nextPoint = { x: current.x + (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0), y: current.y + (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0) };
    const nextPlacement = floatingDockPlacement(bounds, nextPoint, expanded, helpOpen);
    const next = relativeDockPosition(bounds, { x: nextPlacement.side === "right" ? nextPlacement.left : nextPlacement.left + nextPlacement.width - 80, y: bounds.height - nextPlacement.bottom });
    setPosition(next);
    remember(next);
  };

  const point = position ? dockPointFromPosition(bounds, position) : null;
  const placement = point && bounds.width ? floatingDockPlacement(bounds, point, expanded, helpOpen) : null;
  const style: CSSProperties & { "--dock-help-height"?: string } = {
    ...(placement
      ? { left: placement.left, right: "auto", bottom: placement.bottom, width: placement.width, "--dock-help-height": `${placement.helpHeight}px` }
      : { width: !expanded && !helpOpen ? 80 : undefined }),
    // Expose one stable target after hydration instead of jumping under a tap.
    visibility: positionLoaded && bounds.width > 0 ? undefined : "hidden",
  };
  const onLostPointerCapture = () => finish(true);
  return { style, side: placement?.side ?? "left", helpBelow: placement?.helpBelow ?? false, dragging, moved: position !== null, storageError, reset, onHandleKeyDown, dragHandlers: { onPointerDown, onClickCapture, onLostPointerCapture } };
}
