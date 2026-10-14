export const PANEL_SIDES = ["instrument", "inspector"] as const;
export type PanelSide = typeof PANEL_SIDES[number];
export type PanelWidths = Record<PanelSide, number>;
export type CollapsedPanels = Record<PanelSide, boolean>;
export type PanelLayoutMode = "docked" | "inspector-drawer" | "drawers";
export const MIN_SCORE_WIDTH = 480;
export const PANEL_LIMITS = {
  instrument: { key: "garak.instrument-panel-width.v1", collapsedKey: "garak.instrument-panel-collapsed.v1", label: "Instruments panel", min: 200, max: 480, defaultWidth: 280 },
  inspector: { key: "garak.inspector-panel-width.v1", collapsedKey: "garak.inspector-panel-collapsed.v1", label: "Inspector panel", min: 240, max: 480, defaultWidth: 280 },
} as const;

export function clampPanelWidth(side: PanelSide, width: number, max: number = PANEL_LIMITS[side].max): number {
  return Math.max(PANEL_LIMITS[side].min, Math.min(Math.round(width), max));
}

/** Fit both panels together so neither resize can consume the score's reserved space. */
export function workspacePanelLayout(preferred: PanelWidths, workspaceWidth: number, mode: PanelLayoutMode, collapsed: CollapsedPanels = { instrument: false, inspector: false }) {
  const availableWidth = workspaceWidth > 0 ? Math.floor(workspaceWidth) : Infinity;
  const instrumentDrawer = mode === "drawers";
  const inspectorDrawer = mode !== "docked";
  const instrumentDocked = !instrumentDrawer && !collapsed.instrument;
  const inspectorDocked = !inspectorDrawer && !collapsed.inspector;
  let instrument = clampPanelWidth("instrument", preferred.instrument);
  let inspector = clampPanelWidth("inspector", preferred.inspector);
  const panelBudget = Math.max(PANEL_LIMITS.instrument.min + PANEL_LIMITS.inspector.min, availableWidth - MIN_SCORE_WIDTH);
  if (instrumentDocked && inspectorDocked && instrument + inspector > panelBudget) {
    const excess = instrument + inspector - panelBudget;
    const instrumentRoom = instrument - PANEL_LIMITS.instrument.min;
    const totalRoom = instrumentRoom + inspector - PANEL_LIMITS.inspector.min;
    instrument -= Math.ceil(excess * instrumentRoom / totalRoom);
    inspector = panelBudget - instrument;
  }
  const instrumentMax = Math.max(PANEL_LIMITS.instrument.min, Math.min(PANEL_LIMITS.instrument.max,
    instrumentDrawer ? availableWidth - 36 : availableWidth - MIN_SCORE_WIDTH - (inspectorDocked ? inspector : 0)));
  const inspectorMax = Math.max(PANEL_LIMITS.inspector.min, Math.min(PANEL_LIMITS.inspector.max,
    inspectorDrawer ? availableWidth - 36 : availableWidth - MIN_SCORE_WIDTH - (instrumentDocked ? instrument : 0)));
  return {
    instrument: { width: clampPanelWidth("instrument", instrument, instrumentMax), minWidth: PANEL_LIMITS.instrument.min, maxWidth: instrumentMax, drawer: instrumentDrawer, collapsed: collapsed.instrument, docked: instrumentDocked },
    inspector: { width: clampPanelWidth("inspector", inspector, inspectorMax), minWidth: PANEL_LIMITS.inspector.min, maxWidth: inspectorMax, drawer: inspectorDrawer, collapsed: collapsed.inspector, docked: inspectorDocked },
  };
}

/** An intentional resize keeps the other visible panel still, including after reopening. */
export function panelWidthsAfterResize(preferred: PanelWidths, layout: ReturnType<typeof workspacePanelLayout>, side: PanelSide, width: number): PanelWidths {
  const base = layout.instrument.docked && layout.inspector.docked
    ? { instrument: layout.instrument.width, inspector: layout.inspector.width } : preferred;
  return { ...base, [side]: clampPanelWidth(side, width, layout[side].maxWidth) };
}

function validWidth(side: PanelSide, width: unknown): width is number {
  return typeof width === "number" && Number.isInteger(width)
    && width >= PANEL_LIMITS[side].min && width <= PANEL_LIMITS[side].max;
}

export function loadPanelWidth(storage: Pick<Storage, "getItem">, side: PanelSide): { width: number; error: string | null } {
  const settings = PANEL_LIMITS[side];
  try {
    const raw = storage.getItem(settings.key);
    const width: unknown = raw === null ? settings.defaultWidth : JSON.parse(raw);
    if (!validWidth(side, width)) throw new Error("Invalid panel width");
    return { width, error: null };
  } catch {
    return { width: settings.defaultWidth, error: `Saved ${settings.label.toLowerCase()} width could not be read. Resize the panel to save a new width.` };
  }
}

export function savePanelWidth(storage: Pick<Storage, "setItem">, side: PanelSide, width: number): string | null {
  if (!validWidth(side, width)) return "This panel width cannot be saved.";
  try {
    storage.setItem(PANEL_LIMITS[side].key, JSON.stringify(width));
    return null;
  } catch {
    return `${PANEL_LIMITS[side].label} resized for this visit only. Browser storage could not save its width.`;
  }
}

export function loadPanelCollapsed(storage: Pick<Storage, "getItem">, side: PanelSide): { collapsed: boolean; error: string | null } {
  try {
    const raw = storage.getItem(PANEL_LIMITS[side].collapsedKey);
    const collapsed: unknown = raw === null ? false : JSON.parse(raw);
    if (typeof collapsed !== "boolean") throw new Error("Invalid panel visibility");
    return { collapsed, error: null };
  } catch {
    return { collapsed: false, error: `Saved ${PANEL_LIMITS[side].label.toLowerCase()} visibility could not be read. Toggle the panel to save it again.` };
  }
}

export function savePanelCollapsed(storage: Pick<Storage, "setItem">, side: PanelSide, collapsed: boolean): string | null {
  try {
    storage.setItem(PANEL_LIMITS[side].collapsedKey, JSON.stringify(collapsed));
    return null;
  } catch {
    return `${PANEL_LIMITS[side].label} visibility changed for this visit only. Browser storage could not save it.`;
  }
}
