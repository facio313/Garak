import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGRAVING_FONT_REQUESTS,
  type EngravingFontFaceSet,
  waitForEngravingFonts,
} from "../lib/music/engraving-fonts";

function loadedFace(): FontFace {
  return {} as FontFace;
}

test("waits for every embedded notation face before engraving", async () => {
  const requests: Array<{ font: string; text?: string }> = [];
  let readyResolved = false;
  const fonts: EngravingFontFaceSet = {
    load: async (font, text) => {
      requests.push({ font, text });
      return [loadedFace()];
    },
    ready: Promise.resolve({} as FontFaceSet).then((value) => {
      readyResolved = true;
      return value;
    }),
  };

  await waitForEngravingFonts(fonts);

  assert.equal(readyResolved, true);
  assert.deepEqual(
    requests,
    ENGRAVING_FONT_REQUESTS.map(({ css, sample }) => ({ font: css, text: sample })),
  );
});

test("rejects a fallback-font engraving when a required face is unavailable", async () => {
  const fonts: EngravingFontFaceSet = {
    load: async (font) => font.includes("Bravura") ? [] : [loadedFace()],
    ready: Promise.resolve({} as FontFaceSet),
  };

  await assert.rejects(
    waitForEngravingFonts(fonts),
    /Music notation fonts could not be loaded: Bravura\./,
  );
});
