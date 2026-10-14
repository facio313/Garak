import type { Clef, DurationValue, Pitch } from "../lib/music/model";

const STEPS = ["C", "D", "E", "F", "G", "A", "B"];
const BOTTOM_LINE: Record<Clef, number> = { treble: 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1, percussion: 4 * 7 + 2 };

/** A single written note on the selected staff, scaled to retain extreme ledger lines. */
export function NoteEntryPreview({ pitch, duration, clef, rest = false }: { rest?: boolean; pitch: Pitch; duration: DurationValue; clef: Clef }) {
  const y = rest ? 36 : 48 - (pitch.octave * 7 + STEPS.indexOf(pitch.step) - BOTTOM_LINE[clef]) * 3;
  const down = y <= 36;
  const stemEnd = y + (down ? 23 : -23);
  const top = Math.min(18, y - 5, stemEnd - 2);
  const bottom = Math.max(55, y + 5, stemEnd + 2);
  const scale = Math.min(1, 50 / (bottom - top));
  const offset = 9 + (50 - (bottom - top) * scale) / 2 - top * scale;
  const ledgerLines: number[] = [];
  for (let line = 54; line <= y; line += 6) ledgerLines.push(line);
  for (let line = 18; line >= y; line -= 6) ledgerLines.push(line);
  const flags = duration.base >= 8 ? Math.log2(duration.base) - 2 : 0;
  const dotY = (y - 24) % 6 === 0 ? y - 3 : y;
  return <svg className="note-entry-preview" viewBox="0 0 76 76" aria-hidden="true" focusable="false">
    <g transform={`translate(0 ${offset}) scale(1 ${scale})`}>
      {[24, 30, 36, 42, 48].map((line) => <line key={line} x1="8" x2="68" y1={line} y2={line} stroke="currentColor" strokeWidth=".7" opacity=".4" />)}
      {rest ? <text x="38" y="43" textAnchor="middle" fontSize="25" fill="currentColor">{({ 1: "𝄻", 2: "𝄼", 4: "𝄽", 8: "𝄾", 16: "𝄿", 32: "𝅀", 64: "𝅁" })[duration.base]}</text> : <>
      {ledgerLines.map((line) => <line key={line} x1="29" x2="48" y1={line} y2={line} stroke="currentColor" strokeWidth="1" />)}
      {pitch.alter !== 0 ? <text x="19" y={y + 4} fontSize="15" fill="currentColor">{pitch.alter > 0 ? "♯" : "♭"}</text> : null}
      <ellipse cx="38" cy={y} rx={duration.base === 1 ? 6.5 : 5.5} ry="3.6" transform={`rotate(-18 38 ${y})`} fill={duration.base <= 2 ? "var(--paper)" : "currentColor"} stroke="currentColor" strokeWidth="1.6" />
      {duration.base !== 1 ? <>
        <line x1={down ? 33 : 43} x2={down ? 33 : 43} y1={y} y2={stemEnd} stroke="currentColor" strokeWidth="1.6" />
        {Array.from({ length: flags }, (_, index) => {
          const end = stemEnd + (down ? -1 : 1) * index * 5;
          return <path key={index} d={down ? `M33 ${end} Q46 ${end - 4} 37 ${end - 12} Q42 ${end - 5} 33 ${end - 4}Z` : `M43 ${end} Q56 ${end + 4} 47 ${end + 12} Q52 ${end + 5} 43 ${end + 4}Z`} fill="currentColor" />;
        })}
      </> : null}
      </>}
      {Array.from({ length: duration.dots }, (_, index) => <circle key={index} cx={51 + index * 5} cy={dotY} r="1.6" fill="currentColor" />)}
    </g>
    <text x="38" y="70" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="700">{rest ? "REST" : `${pitch.step}${pitch.alter > 0 ? "♯" : pitch.alter < 0 ? "♭" : ""}${pitch.octave}`}</text>
  </svg>;
}
