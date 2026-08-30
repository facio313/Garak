import assert from "node:assert/strict";
import test from "node:test";
import { xForMeasureTick } from "../lib/music/engraving-position";

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
