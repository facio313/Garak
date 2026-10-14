import assert from "node:assert/strict";
import test from "node:test";
import { snappedTickForMeasureX, tickForMeasureX, xForMeasureTick } from "../lib/music/engraving-position";

test("maps exact rhythmic anchors without shifting them toward a notehead center", () => {
  const layout = {
    startX: 100,
    endX: 500,
    tickAnchors: [
      { tick: 0, x: 124 },
      { tick: 960, x: 208 },
      { tick: 1920, x: 304 },
    ],
  };

  assert.equal(xForMeasureTick(layout, 0, 3840), 124);
  assert.equal(xForMeasureTick(layout, 960, 3840), 208);
  assert.equal(xForMeasureTick(layout, 1920, 3840), 304);
});

test("interpolates through silent spans and reaches the actual right barline", () => {
  const layout = {
    startX: 100,
    endX: 500,
    tickAnchors: [
      { tick: 0, x: 120 },
      { tick: 1920, x: 300 },
    ],
  };

  assert.equal(xForMeasureTick(layout, 960, 3840), 210);
  assert.equal(xForMeasureTick(layout, 2880, 3840), 400);
  assert.equal(xForMeasureTick(layout, 3840, 3840), 500);
  assert.equal(xForMeasureTick(layout, 9999, 3840), 500);
});

test("maps an empty measure from its provided rhythmic start to its barline", () => {
  const layout = { startX: 140, endX: 460, tickAnchors: [] };

  assert.equal(xForMeasureTick(layout, 0, 3840), 140);
  assert.equal(xForMeasureTick(layout, 1920, 3840), 300);
  assert.equal(xForMeasureTick(layout, 3840, 3840), 460);
});

test("horizontal drops invert nonuniform engraved spacing and retain the original grab offset", () => {
  const layout = {
    startX: 100, endX: 600,
    tickAnchors: [{ tick: 0, x: 120 }, { tick: 960, x: 200 }, { tick: 1920, x: 360 }],
  };
  assert.equal(tickForMeasureX(layout, 200, 3840), 960);
  assert.equal(tickForMeasureX(layout, 280, 3840), 1440);
  assert.equal(tickForMeasureX(layout, 480, 3840), 2880);
  assert.equal(tickForMeasureX(layout, 20, 3840), 0);
  assert.equal(tickForMeasureX(layout, 800, 3840), 3840);
  const pointerAtDisplacedChordHead = 219;
  const grabOffset = pointerAtDisplacedChordHead - xForMeasureTick(layout, 960, 3840);
  assert.equal(snappedTickForMeasureX(layout, pointerAtDisplacedChordHead - grabOffset, 3840, 240, [0, 960, 1920]), 960);
  assert.equal(snappedTickForMeasureX(layout, pointerAtDisplacedChordHead + 80 - grabOffset, 3840, 240, [0, 960, 1920]), 1440);
});

test("time drops snap to sixteenths or closer exact onsets without selecting the following bar", () => {
  const layout = { startX: 100, endX: 484, tickAnchors: [] };
  assert.equal(snappedTickForMeasureX(layout, 150, 3840, 240), 480);
  assert.equal(snappedTickForMeasureX(layout, 151, 3840, 240, [510]), 510, "an imported off-grid onset remains reachable");
  assert.equal(snappedTickForMeasureX(layout, 484, 3840, 240), 3600, "the barline is not a start in this measure");
  assert.equal(snappedTickForMeasureX(layout, 478, 3840, 240, [3780, 3840]), 3780, "a final 64th-note onset stays reachable without jumping to the next bar");
  assert.equal(snappedTickForMeasureX(layout, 90, 3840, 240, [-100]), 0);
  assert.equal(snappedTickForMeasureX(layout, Number.NaN, 3840, 240), 0);
  assert.equal(snappedTickForMeasureX(layout, 120, 3840, 0), 0);
});
