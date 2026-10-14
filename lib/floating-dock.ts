export interface DockPoint { x: number; y: number }
export interface DockBounds { width: number; height: number; dockHeight: number }
/** Fractions of the workspace, independent of screen size and score zoom. */
export interface DockPosition { x: number; y: number }
export const DOCK_POSITION_STORAGE_KEY = "garak.note-dock.v1";

export function relativeDockPosition(bounds: DockBounds, point: DockPoint): DockPosition {
  return { x: clamp(point.x / Math.max(1, bounds.width), 0, 1), y: clamp(point.y / Math.max(1, bounds.height), 0, 1) };
}

export function dockPointFromPosition(bounds: DockBounds, position: DockPosition): DockPoint {
  return { x: position.x * bounds.width, y: position.y * bounds.height };
}

function validPosition(value: unknown): value is DockPosition | null {
  return value === null || (typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 2 && "x" in value && "y" in value
    && typeof value.x === "number" && Number.isFinite(value.x) && value.x >= 0 && value.x <= 1
    && typeof value.y === "number" && Number.isFinite(value.y) && value.y >= 0 && value.y <= 1);
}

export function loadDockPosition(storage: Pick<Storage, "getItem">): { position: DockPosition | null; error: string | null } {
  try {
    const raw = storage.getItem(DOCK_POSITION_STORAGE_KEY);
    const position: unknown = raw === null ? null : JSON.parse(raw);
    if (!validPosition(position)) throw new Error("Invalid position");
    return { position, error: null };
  } catch {
    return { position: null, error: "Saved palette position could not be read. Move the palette to save a new position." };
  }
}

export function saveDockPosition(storage: Pick<Storage, "setItem">, position: DockPosition | null): string | null {
  if (!validPosition(position)) return "This palette position cannot be saved.";
  try {
    storage.setItem(DOCK_POSITION_STORAGE_KEY, JSON.stringify(position));
    return null;
  } catch {
    return "Palette moved for this visit only. Browser storage could not save its position.";
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** x is the launcher's left edge; y is its bottom, relative to the score workspace. */
export function floatingDockPlacement(bounds: DockBounds, point: DockPoint, expanded: boolean, helpOpen: boolean) {
  const margin = 12;
  const x = clamp(point.x, margin, bounds.width - 80 - margin);
  const side = x + 40 < bounds.width / 2 ? "right" : "left";
  const available = side === "right" ? bounds.width - x - margin : x + 80 - margin;
  const minimum = Math.min(expanded ? 480 : helpOpen ? 300 : 80, bounds.width - margin * 2);
  const width = expanded || helpOpen ? Math.min(expanded ? 1280 : 408, Math.max(minimum, available)) : 80;
  const left = clamp(side === "right" ? x : x + 80 - width, margin, bounds.width - width - margin);
  const height = Math.min(bounds.dockHeight, bounds.height - margin * 2);
  const bottom = clamp(bounds.height - point.y, margin, bounds.height - height - margin);
  const above = bounds.height - bottom - height - margin;
  const below = bottom - margin;
  const helpBelow = below > above;
  return { left, bottom, width, side, helpBelow, helpHeight: Math.max(80, (helpBelow ? below : above) - 12) };
}
