export interface EngravingFontFaceSet {
  load(font: string, text?: string): Promise<FontFace[]>;
  readonly ready: Promise<FontFaceSet>;
}

export const ENGRAVING_FONT_REQUESTS = [
  { name: "Bravura", css: "400 40px Bravura", sample: "\uE0A4" },
  { name: "Academico Regular", css: "400 16px Academico", sample: "Garak" },
  { name: "Academico Bold", css: "700 16px Academico", sample: "Garak" },
] as const;

/**
 * VexFlow's bundled Bravura entry registers its embedded FontFace objects but
 * does not await them. Formatting before those faces are ready makes VexFlow
 * cache fallback-glyph widths, leaving SVG noteheads detached from stems,
 * flags, beams, and semantic cursor anchors.
 */
export async function waitForEngravingFonts(fonts: EngravingFontFaceSet): Promise<void> {
  const loadedFaces = await Promise.all(
    ENGRAVING_FONT_REQUESTS.map(({ css, sample }) => fonts.load(css, sample)),
  );
  await fonts.ready;

  const missing = ENGRAVING_FONT_REQUESTS
    .filter((_, index) => loadedFaces[index].length === 0)
    .map(({ name }) => name);
  if (missing.length) {
    throw new Error(`Music notation fonts could not be loaded: ${missing.join(", ")}.`);
  }
}
