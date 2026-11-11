import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { XMLParser } from "fast-xml-parser";
import { createPlaybackPositionLocator, locatePlaybackPosition } from "../lib/music/playback-position";
import { createScore } from "../lib/music/score";

// Run with: node --import tsx scripts/benchmark-library-performance.ts
// Microbenchmarks only: these timings do not represent whole-app frame latency.
function medianMilliseconds(run: () => number): number {
  run();
  const samples = Array.from({ length: 7 }, () => {
    const start = performance.now();
    assert.ok(Number.isFinite(run()));
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return Number(samples[3].toFixed(3));
}

for (const measures of [128, 20_000]) {
  const score = createScore("solo", { seedDemo: false });
  score.tempo = 120;
  const template = score.measures[score.measureOrder[0]];
  // Timeline-only fixture: engraving and note content do not affect clock lookup.
  score.measureOrder = Array.from({ length: measures }, (_, i) => `m-${i}`);
  score.measures = Object.fromEntries(score.measureOrder.map((id, i) => [id, { ...template, id, number: i + 1 }]));
  const start = performance.now();
  const indexed = createPlaybackPositionLocator(score);
  const setupMs = Number((performance.now() - start).toFixed(3));
  const positions = Array.from({ length: 10_000 }, (_, i) => (i * 7919 % measures) * 2 + 0.25);
  const lookup = (locate: typeof indexed) => positions.reduce((sum, seconds) => sum + locate(seconds)!.measureNumber, 0);
  assert.equal(lookup(indexed), lookup((seconds) => locatePlaybackPosition(score, seconds)));
  console.log(JSON.stringify({ operation: "10,000 playback positions", measures, setupMs,
    linearMs: medianMilliseconds(() => lookup((seconds) => locatePlaybackPosition(score, seconds))),
    indexedMs: medianMilliseconds(() => lookup(indexed)),
  }));
}

const note = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>";
const xml = `<score-partwise><part id="P1">${Array.from({ length: 1000 }, (_, i) => `<measure number="${i + 1}">${note.repeat(4)}</measure>`).join("")}</part></score-partwise>`;
const options = { ignoreAttributes: false, preserveOrder: true, trimValues: true };
console.log(JSON.stringify({ operation: "parse 1,000 measures / 4,000 notes", xmlBytes: Buffer.byteLength(xml),
  automaticValuesMs: medianMilliseconds(() => new XMLParser(options).parse(xml).length),
  textValuesMs: medianMilliseconds(() => new XMLParser({ ...options, parseTagValue: false }).parse(xml).length),
}));
