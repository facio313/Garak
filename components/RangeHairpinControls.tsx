import { useState } from "react";
import { DYNAMIC_MARKINGS } from "../lib/music/model";
import type { DynamicMarking } from "../lib/music/model";
import type { TimedHairpin } from "../lib/music/hairpins";
import type { HairpinChange } from "../lib/music/score";

export function RangeHairpinControls({ spans, partialOverlap, disabled, onChange }: {
  spans: TimedHairpin[];
  partialOverlap: boolean;
  disabled: boolean;
  onChange: (change: HairpinChange | null) => void;
}) {
  const [kind, setKind] = useState<HairpinChange["kind"]>(spans[0]?.kind ?? "crescendo");
  const [from, setFrom] = useState<DynamicMarking>(spans[0]?.from ?? "p");
  const [to, setTo] = useState<DynamicMarking>(spans[0]?.to ?? "f");
  const valid = kind === "crescendo" ? DYNAMIC_MARKINGS.indexOf(from) < DYNAMIC_MARKINGS.indexOf(to)
    : DYNAMIC_MARKINGS.indexOf(from) > DYNAMIC_MARKINGS.indexOf(to);
  return <div id="range-hairpin-tools" className="range-hairpin-tools" role="group" aria-label="Crescendo and diminuendo on selected range">
    <div className="hairpin-direction" role="group" aria-label="Hairpin direction">
      {(["crescendo", "diminuendo"] as const).map((direction) => <button key={direction} type="button" disabled={disabled} aria-pressed={kind === direction}
        onClick={() => { if (kind !== direction) { setKind(direction); setFrom(to); setTo(from); } }}>
        <svg viewBox="0 0 40 16" width="40" height="16" aria-hidden="true"><path d={direction === "crescendo" ? "M38 1 L2 8 L38 15" : "M2 1 L38 8 L2 15"} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        <span>{direction === "crescendo" ? "Crescendo" : "Diminuendo"}</span>
      </button>)}
    </div>
    <div className="hairpin-levels">
      <label>From<select aria-label="Hairpin start dynamic" value={from} disabled={disabled} onChange={(event) => setFrom(event.target.value as DynamicMarking)}>
        {DYNAMIC_MARKINGS.map((mark) => <option key={mark}>{mark}</option>)}
      </select></label>
      <span aria-hidden="true">→</span>
      <label>To<select aria-label="Hairpin end dynamic" value={to} disabled={disabled} onChange={(event) => setTo(event.target.value as DynamicMarking)}>
        {DYNAMIC_MARKINGS.map((mark) => <option key={mark}>{mark}</option>)}
      </select></label>
    </div>
    <div className="hairpin-actions">
      <button type="button" className="hairpin-apply" disabled={disabled || !valid} onClick={() => onChange({ kind, from, to })}>{spans.length ? "Update hairpin" : "Apply hairpin"}</button>
      <button type="button" disabled={disabled || !spans.length} onClick={() => onChange(null)}>Remove hairpin</button>
    </div>
    {!valid ? <small role="status">{kind === "crescendo" ? "Choose an end dynamic louder than the start." : "Choose an end dynamic softer than the start."}</small>
      : <small>{disabled ? "Select the first and last note on one staff." : `Levels override marks in this range and change held ties too. The end level lasts until the next mark.`}</small>}
    {partialOverlap || spans.length > 1 ? <small className="hairpin-existing">{spans.length === 1 ? `Existing: ${spans[0].from} → ${spans[0].to}.` : `${spans.length} hairpins touch this range.`} Update replaces the whole touching hairpin with this range. Remove clears the whole hairpin and keeps the notes.</small> : null}
  </div>;
}
