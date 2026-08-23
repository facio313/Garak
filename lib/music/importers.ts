import { XMLParser, XMLValidator } from "fast-xml-parser";
import { INSTRUMENTS } from "./catalog";
import { normalizeKeyFifths, transpositionFifths } from "./key-signatures";
import type { KeySignature } from "./key-signatures";
import type {
  Clef,
  DurationBase,
  DurationValue,
  DynamicMarking,
  InstrumentSnapshot,
  MusicEvent,
  PartData,
  Pitch,
  PitchStep,
  ScoreDocument,
  ScoreNote,
  StaffData,
  Transposition,
} from "./model";
import { DYNAMIC_MARKINGS, durationTicks, measureCapacity, SCORE_VALIDATION_LIMITS, TICKS_PER_QUARTER, TICKS_PER_WHOLE } from "./model";

type XmlNode = Record<string, unknown>;

export interface MusicXMLImportResult {
  score: ScoreDocument;
  warnings: string[];
}

const TYPE_TO_BASE: Record<string, DurationBase | undefined> = {
  whole: 1,
  half: 2,
  quarter: 4,
  eighth: 8,
  "16th": 16,
  "32nd": 32,
  "64th": 64,
};

const SUPPORTED_DURATIONS: readonly DurationValue[] = ([1, 2, 4, 8, 16, 32, 64] as const).flatMap((base) => [
  { base, dots: 2 as const },
  { base, dots: 1 as const },
  { base, dots: 0 as const },
]);
const MAX_XML_LENGTH = 64 * 1024 * 1024;
const MAX_PARTS = 256;
const MAX_STAVES_PER_PART = 32;
const MAX_TOTAL_STAVES = 512;
const MAX_MEASURES = 20_000;
const MAX_STAFF_MEASURE_CELLS = 10_000;
const MAX_SOURCE_MEASURE_ELEMENTS = 100_000;
const MAX_VISIBLE_WARNINGS = 200;
const MAX_WARNING_LENGTH = 500;
const MAX_SOURCE_ID_LENGTH = 256;
const MAX_IMPORTED_NAME_LENGTH = 200;
const MAX_IMPORTED_SHORT_NAME_LENGTH = 80;
const MAX_IMPORTED_RIGHTS_LENGTH = 500;
const MAX_MATERIALIZED_EVENTS = 50_000;
const MAX_MATERIALIZED_NOTES = 100_000;
const MAX_MATERIALIZED_TIES = 50_000;
const TICK_EPSILON = 0.001;
const SUPPORTED_DYNAMIC_MARKINGS = new Set<DynamicMarking>(DYNAMIC_MARKINGS);

interface WarningSink {
  push(message: string): void;
}

function truncateWithoutSplittingSurrogate(value: string, maximumLength: number): string {
  let truncated = value.slice(0, maximumLength);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) truncated = truncated.slice(0, -1);
  return truncated;
}

/** Keeps import diagnostics useful to the UI without letting hostile notation create an unbounded list. */
class ImportWarningCollector implements WarningSink {
  private readonly visible: string[] = [];
  private readonly visibleSet = new Set<string>();
  private omitted = 0;

  push(message: string): void {
    const bounded = message.length <= MAX_WARNING_LENGTH
      ? message
      : `${truncateWithoutSplittingSurrogate(message, MAX_WARNING_LENGTH - 1)}…`;
    if (this.visibleSet.has(bounded)) return;
    if (this.visible.length < MAX_VISIBLE_WARNINGS) {
      this.visible.push(bounded);
      this.visibleSet.add(bounded);
      return;
    }
    this.omitted += 1;
  }

  toArray(): string[] {
    return this.omitted > 0
      ? [...this.visible, `${this.omitted} additional warning${this.omitted === 1 ? "" : "s"} omitted.`]
      : [...this.visible];
  }
}

function elementName(node: XmlNode | undefined): string | undefined {
  if (!node) return undefined;
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text" && !key.startsWith("?"));
}

function nodes(value: unknown): XmlNode[] {
  return Array.isArray(value) ? value.filter((item): item is XmlNode => Boolean(item) && typeof item === "object") : [];
}

function content(node: XmlNode | undefined): XmlNode[] {
  if (!node) return [];
  const name = elementName(node);
  return name ? nodes(node[name]) : [];
}

function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return content(node).filter((child) => Object.prototype.hasOwnProperty.call(child, name));
}

function firstChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return children(node, name)[0];
}

function childEntries(node: XmlNode | undefined, name: string): XmlNode[] {
  return children(node, name);
}

function text(node: XmlNode | undefined): string | undefined {
  const directValue = node?.["#text"];
  if (typeof directValue === "string" || typeof directValue === "number") return String(directValue);
  const value = content(node).find((child) => Object.prototype.hasOwnProperty.call(child, "#text"))?.["#text"];
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

function childText(node: XmlNode | undefined, name: string): string | undefined {
  return text(firstChild(node, name));
}

function attribute(node: XmlNode | undefined, name: string): string | undefined {
  const attributes = node?.[":@"];
  if (!attributes || typeof attributes !== "object") return undefined;
  const value = (attributes as Record<string, unknown>)[`@_${name}`];
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

function directionDynamic(node: XmlNode, warnings: WarningSink, context: string): DynamicMarking | null {
  if (firstChild(node, "offset")) {
    warnings.push(`${context}: direction offsets are not editable yet; the offset was ignored without moving the musical cursor.`);
  }

  const candidates: DynamicMarking[] = [];
  for (const directionType of children(node, "direction-type")) {
    for (const entry of content(directionType)) {
      const kind = elementName(entry);
      if (kind === "wedge") {
        warnings.push(`${context}: wedge and hairpin directions are not editable yet and were skipped.`);
        continue;
      }
      if (kind === "words" || kind === "other-direction" || kind === "symbol" || kind === "rehearsal") {
        warnings.push(`${context}: text directions are not editable yet and were skipped.`);
        continue;
      }
      if (kind === "metronome" && attribute(firstChild(node, "sound"), "tempo") !== undefined) continue;
      if (kind !== "dynamics") {
        if (kind) warnings.push(`${context}: direction type ${kind} is not editable yet and was skipped.`);
        continue;
      }

      const names = content(entry).map((mark) => elementName(mark)).filter((name): name is string => Boolean(name));
      const supported = names.filter((name): name is DynamicMarking => SUPPORTED_DYNAMIC_MARKINGS.has(name as DynamicMarking));
      const unsupported = names.filter((name) => !SUPPORTED_DYNAMIC_MARKINGS.has(name as DynamicMarking));
      if (unsupported.length) {
        const description = names.length > 1 ? `composite dynamic ${names.join("+")}` : `dynamic ${unsupported[0]}`;
        warnings.push(`${context}: unsupported ${description} was skipped.`);
        continue;
      }
      candidates.push(...supported);
    }
  }

  const soundDynamics = attribute(firstChild(node, "sound"), "dynamics");
  if (!candidates.length && soundDynamics !== undefined) {
    warnings.push(`${context}: sound-only dynamics has no supported printable dynamic mark and was skipped.`);
  }
  if (!candidates.length) return null;
  const distinct = [...new Set(candidates)];
  const selected = candidates.at(-1)!;
  if (distinct.length > 1) {
    warnings.push(`${context}: conflicting dynamic marks ${distinct.join(" and ")} target one event; the later ${selected} mark was used.`);
  }
  const placement = attribute(node, "placement")?.toLowerCase();
  if (placement && placement !== "below") {
    warnings.push(`${context}: ${placement} dynamic placement is not editable yet; the mark was normalized below the staff.`);
  }
  return selected;
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function strictInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[+-]?\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function strictPositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sanitizeId(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizedName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function boundedImportedText(
  value: string | undefined,
  fallback: string,
  maximumLength: number,
  warnings: WarningSink,
  context: string,
): string {
  const normalized = value?.trim() || fallback;
  if (normalized.length <= maximumLength) return normalized;
  warnings.push(`${context} exceeds Garak's ${maximumLength}-character import limit and was truncated.`);
  return truncateWithoutSplittingSurrogate(normalized, maximumLength);
}

function xmlClef(node: XmlNode | undefined): Clef {
  const sign = childText(node, "sign")?.toUpperCase();
  const line = integer(childText(node, "line"), 0);
  if (sign === "F") return "bass";
  if (sign === "C") return line === 4 ? "tenor" : "alto";
  if (sign === "PERCUSSION") return "percussion";
  return "treble";
}

function sourceDurationTicks(node: XmlNode, divisions: number, warnings: WarningSink, context: string): number | null {
  const rawDuration = strictPositiveNumber(childText(node, "duration"));
  if (rawDuration === undefined) {
    warnings.push(`${context}: a positive duration is required and the event was skipped.`);
    return null;
  }
  if (!Number.isFinite(divisions) || divisions <= 0) {
    warnings.push(`${context}: duration could not be read because divisions is not positive.`);
    return null;
  }
  const ticks = rawDuration / divisions * TICKS_PER_QUARTER;
  if (!Number.isFinite(ticks) || ticks <= 0) {
    warnings.push(`${context}: duration is outside Garak's safe numeric range and the event was skipped.`);
    return null;
  }
  return ticks;
}

function noteDuration(noteNode: XmlNode, importedTicks: number, warnings: WarningSink, context: string): DurationValue | null {
  const type = childText(noteNode, "type")?.toLowerCase();
  const dotCount = children(noteNode, "dot").length;
  const typedBase = type ? TYPE_TO_BASE[type] : undefined;
  const notated = typedBase && dotCount <= 2 ? { base: typedBase, dots: dotCount as 0 | 1 | 2 } : undefined;
  const exact = SUPPORTED_DURATIONS.find((candidate) => Math.abs(durationTicks(candidate) - importedTicks) < TICK_EPSILON);
  if (!exact) {
    const tuplet = firstChild(noteNode, "time-modification") ? " tuplet" : "";
    warnings.push(`${context}: Garak cannot represent the${tuplet} duration exactly and skipped the event.`);
    return null;
  }

  if (notated && Math.abs(durationTicks(notated) - importedTicks) >= TICK_EPSILON) {
    warnings.push(`${context}: the notated ${type}${dotCount ? " with dots" : ""} differs from duration/divisions; the sounding duration was preserved.`);
  } else if ((type && !typedBase) || dotCount > 2) {
    warnings.push(`${context}: unsupported graphic note type or dot count was normalized to the exact duration/divisions value.`);
  }
  if (firstChild(noteNode, "time-modification")) {
    warnings.push(`${context}: tuplet notation is not editable yet; only its exact sounding duration was preserved.`);
  }
  return { ...exact };
}

function decomposeDurationTicks(ticks: number): DurationValue[] | null {
  const target = Math.round(ticks);
  if (target < 0 || Math.abs(target - ticks) >= TICK_EPSILON) return null;
  if (target === 0) return [];
  const candidates = SUPPORTED_DURATIONS
    .map((duration) => ({ duration, ticks: durationTicks(duration) }))
    .sort((left, right) => right.ticks - left.ticks);
  const memo = new Map<number, DurationValue[] | null>();
  const visit = (remaining: number): DurationValue[] | null => {
    if (remaining === 0) return [];
    if (remaining < 0) return null;
    if (memo.has(remaining)) return memo.get(remaining) ?? null;
    memo.set(remaining, null);
    for (const candidate of candidates) {
      if (candidate.ticks > remaining) continue;
      const tail = visit(remaining - candidate.ticks);
      if (tail) {
        const result = [{ ...candidate.duration }, ...tail];
        memo.set(remaining, result);
        return result;
      }
    }
    return null;
  };
  return visit(target);
}

function pitchFromNote(noteNode: XmlNode, warnings: WarningSink, context: string): Pitch | null {
  const pitchNode = firstChild(noteNode, "pitch");
  if (!pitchNode) {
    const unpitched = firstChild(noteNode, "unpitched");
    const displayStep = childText(unpitched, "display-step");
    const displayOctave = childText(unpitched, "display-octave");
    const normalizedStep = displayStep?.toUpperCase();
    const octave = strictInteger(displayOctave);
    if (!normalizedStep || !["A", "B", "C", "D", "E", "F", "G"].includes(normalizedStep) || octave === undefined || octave < -1 || octave > 9) {
      warnings.push(`${context}: an unpitched note without a display pitch was skipped.`);
      return null;
    }
    return { step: normalizedStep as PitchStep, alter: 0, octave };
  }

  const step = childText(pitchNode, "step")?.toUpperCase();
  const alterText = childText(pitchNode, "alter");
  const alter = alterText === undefined ? 0 : strictInteger(alterText);
  const octave = strictInteger(childText(pitchNode, "octave"));
  if (!step || !["A", "B", "C", "D", "E", "F", "G"].includes(step) || alter === undefined || alter < -2 || alter > 2 || octave === undefined || octave < -1 || octave > 9) {
    warnings.push(`${context}: unsupported pitch spelling was skipped.`);
    return null;
  }
  return { step: step as PitchStep, alter: alter as Pitch["alter"], octave };
}

function allAttributes(partNode: XmlNode): XmlNode[] {
  return childEntries(partNode, "measure").flatMap((measureNode) => children(measureNode, "attributes"));
}

function inferredDiatonic(chromatic: number): number {
  const direction = chromatic < 0 ? -1 : 1;
  const absolute = Math.abs(chromatic);
  const octaves = Math.floor(absolute / 12);
  const remainder = absolute % 12;
  const withinOctave = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6][remainder];
  return direction * (octaves * 7 + withinOctave);
}

function readInitialTransposition(partNode: XmlNode, warnings: WarningSink, context: string): Transposition {
  const transposeEntries = allAttributes(partNode).flatMap((attributes) => children(attributes, "transpose"));
  if (!transposeEntries.length) return { diatonic: 0, chromatic: 0, octaveChange: 0 };

  let foundTranspose = false;
  let musicBeforeTranspose = false;
  for (const measureNode of childEntries(partNode, "measure")) {
    for (const child of content(measureNode)) {
      if (Object.prototype.hasOwnProperty.call(child, "attributes") && children(child, "transpose").length) foundTranspose = true;
      else if (!foundTranspose && Object.prototype.hasOwnProperty.call(child, "note")) musicBeforeTranspose = true;
    }
  }
  if (musicBeforeTranspose) warnings.push(`${context}: transposition begins after musical data; the first declared value was applied to the whole editable part.`);

  const first = transposeEntries.find((node) => attribute(node, "number") === undefined || attribute(node, "number") === "1") ?? transposeEntries[0];
  const chromatic = strictInteger(childText(first, "chromatic"));
  const rawOctaveChange = childText(first, "octave-change");
  const octaveChange = rawOctaveChange === undefined ? 0 : strictInteger(rawOctaveChange);
  if (chromatic === undefined || octaveChange === undefined || Math.abs(chromatic) > 96 || Math.abs(octaveChange) > 8) {
    warnings.push(`${context}: a missing, non-integer, or out-of-range transposition is unsupported; concert pitch was used.`);
    return { diatonic: 0, chromatic: 0, octaveChange: 0 };
  }
  const rawDiatonic = childText(first, "diatonic");
  const parsedDiatonic = strictInteger(rawDiatonic);
  const diatonic = parsedDiatonic ?? inferredDiatonic(chromatic);
  if (rawDiatonic !== undefined && parsedDiatonic === undefined) {
    warnings.push(`${context}: a non-integer diatonic transposition was inferred from the chromatic interval.`);
  } else if (rawDiatonic === undefined && chromatic !== 0) {
    warnings.push(`${context}: diatonic transposition was omitted and was inferred from the chromatic interval.`);
  }
  if (Math.abs(diatonic) > 56) {
    warnings.push(`${context}: diatonic transposition is outside Garak's editable range; concert pitch was used.`);
    return { diatonic: 0, chromatic: 0, octaveChange: 0 };
  }
  const transposeSignatures = new Set(transposeEntries.map((node) => [
    attribute(node, "number") ?? "all",
    childText(node, "diatonic") ?? "",
    childText(node, "chromatic") ?? "",
    childText(node, "octave-change") ?? "",
  ].join(":")));
  if (transposeSignatures.size > 1 || transposeEntries.some((node) => attribute(node, "number") !== undefined)) {
    warnings.push(`${context}: per-staff or changing transpositions are not editable yet; the initial staff-1 transposition was used for the whole part.`);
  }
  if (firstChild(first, "double")) {
    warnings.push(`${context}: doubled transposition notation is not editable yet.`);
  }
  return { diatonic, chromatic, octaveChange };
}

function parseTimeSignature(attributes: XmlNode | undefined, fallback: { numerator: number; denominator: number }, warnings: WarningSink, context: string) {
  const timeNode = firstChild(attributes, "time");
  if (!timeNode) return fallback;
  const beats = children(timeNode, "beats").map((node) => text(node));
  const beatTypes = children(timeNode, "beat-type").map((node) => strictInteger(text(node)));
  if (!beats.length || beats.length !== beatTypes.length || beatTypes.some((value) => value === undefined || value <= 0)) {
    warnings.push(`${context}: unsupported or malformed time signature was ignored.`);
    return fallback;
  }
  const parsedBeats = beats.map((value) => value?.split("+").map((token) => strictInteger(token)).filter((token): token is number => token !== undefined && token > 0));
  if (parsedBeats.some((group, index) => !group?.length || group.length !== beats[index]?.split("+").length)) {
    warnings.push(`${context}: unsupported or malformed time signature was ignored.`);
    return fallback;
  }
  const denominators = beatTypes as number[];
  if (denominators.some((value) => !Number.isInteger(Math.log2(value)))) {
    warnings.push(`${context}: Garak currently supports power-of-two beat types; this time signature was ignored.`);
    return fallback;
  }
  const commonDenominator = denominators.reduce((product, value) => {
    const gcd = (left: number, right: number): number => right === 0 ? left : gcd(right, left % right);
    return product / gcd(product, value) * value;
  }, 1);
  const numerator = parsedBeats.reduce((sum, group, index) =>
    sum + (group?.reduce((groupSum, value) => groupSum + value, 0) ?? 0) * (commonDenominator / denominators[index]), 0);
  const capacity = numerator * TICKS_PER_WHOLE / commonDenominator;
  if (!Number.isSafeInteger(numerator) || numerator <= 0 || numerator > 255 || commonDenominator > 1024 || !Number.isSafeInteger(capacity)) {
    warnings.push(`${context}: time signature is outside Garak's editable range and was ignored.`);
    return fallback;
  }
  return { numerator, denominator: commonDenominator };
}

function parseConcertKey(
  attributes: XmlNode | undefined,
  fallback: KeySignature,
  transposition: Transposition,
  warnings: WarningSink,
  context: string,
): KeySignature {
  const keyNodes = children(attributes, "key");
  if (!keyNodes.length) return fallback;
  const keyNode = keyNodes.find((node) => attribute(node, "number") === undefined || attribute(node, "number") === "1") ?? keyNodes[0];
  const fifths = strictInteger(childText(keyNode, "fifths"));
  if (fifths === undefined || Math.abs(fifths) > 120) {
    warnings.push(`${context}: non-traditional or malformed key signature was ignored.`);
    return fallback;
  }
  const rawMode = childText(keyNode, "mode")?.toLowerCase();
  const mode = rawMode === "minor" ? "minor" as const : rawMode === "major" || rawMode === undefined ? fallback.mode : "major" as const;
  if (rawMode && rawMode !== "major" && rawMode !== "minor") warnings.push(`${context}: ${rawMode} mode was imported as major.`);
  if (keyNodes.length > 1 || attribute(keyNode, "number") !== undefined) {
    warnings.push(`${context}: per-staff key signatures are not editable yet; the staff-1 key was used.`);
  }
  const concertFifths = fifths + transpositionFifths(transposition);
  const normalized = normalizeKeyFifths(concertFifths);
  if (normalized !== concertFifths) warnings.push(`${context}: the key signature was respelled enharmonically within Garak's seven-accidental range.`);
  return { fifths: normalized, mode };
}

function catalogMatch(name: string, midiProgram: number | undefined, clef: Clef, transposition: Transposition) {
  const target = normalizedName(name);
  return INSTRUMENTS.find((instrument) => normalizedName(instrument.name) === target) ??
    INSTRUMENTS.find((instrument) => target.length >= 4 && (normalizedName(instrument.name).includes(target) || target.includes(normalizedName(instrument.name)))) ??
    INSTRUMENTS.find((instrument) => instrument.midiProgram === midiProgram && instrument.clef === clef &&
      instrument.transposition.chromatic === transposition.chromatic && instrument.transposition.octaveChange === transposition.octaveChange) ??
    INSTRUMENTS.find((instrument) => instrument.midiProgram === midiProgram && instrument.clef === clef);
}

function snapshotForPart(name: string, shortName: string, midiProgram: number | undefined, clefs: Clef[], transposition: Transposition): InstrumentSnapshot {
  const match = catalogMatch(name, midiProgram, clefs[0] ?? "treble", transposition);
  return {
    catalogId: match?.catalogId ?? `musicxml-${sanitizeId(name.toLowerCase(), "instrument")}`,
    family: match?.family ?? "Imported",
    name,
    shortName: shortName || match?.shortName || name.slice(0, 8),
    clef: clefs[0] ?? match?.clef ?? "treble",
    transposition,
    midiProgram: midiProgram ?? match?.midiProgram ?? 0,
    color: match?.color ?? "#6f7d80",
  };
}

function directScorePartNodes(partList: XmlNode | undefined): XmlNode[] {
  return children(partList, "score-part");
}

function directPartNodes(root: XmlNode): XmlNode[] {
  return children(root, "part");
}

function measureSoundNodes(measureNode: XmlNode): XmlNode[] {
  return content(measureNode).flatMap((entry) => {
    const kind = elementName(entry);
    if (kind === "sound") return [entry];
    if (kind === "direction") return children(entry, "sound");
    return [];
  });
}

function normalizedTempo(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 30 || parsed > 300) return undefined;
  return Math.round(parsed);
}

function sourceMeasureTiming(measureNode: XmlNode, initialDivisions: number): { divisions: number; extent: number } {
  let divisions = initialDivisions;
  let cursor = 0;
  let extent = 0;
  for (const entry of content(measureNode)) {
    const kind = elementName(entry);
    if (kind === "attributes") {
      const parsed = strictPositiveNumber(childText(entry, "divisions"));
      if (parsed !== undefined) divisions = parsed;
      continue;
    }
    if (kind !== "note" && kind !== "backup" && kind !== "forward") continue;
    if (kind === "note" && (firstChild(entry, "grace") || firstChild(entry, "chord"))) continue;
    const rawDuration = strictPositiveNumber(childText(entry, "duration"));
    if (rawDuration === undefined || !Number.isFinite(divisions) || divisions <= 0) continue;
    const movement = rawDuration / divisions * TICKS_PER_QUARTER;
    if (!Number.isFinite(movement) || movement <= 0) continue;
    if (kind === "backup") cursor = Math.max(0, cursor - movement);
    else {
      cursor += movement;
      extent = Math.max(extent, cursor);
    }
  }
  return { divisions, extent };
}

function followsMusicalCursorContent(measureNode: XmlNode, target: XmlNode): boolean {
  let sawCursorContent = false;
  for (const entry of content(measureNode)) {
    if (entry === target) return sawCursorContent;
    const kind = elementName(entry);
    if (kind === "note" || kind === "backup" || kind === "forward") sawCursorContent = true;
  }
  return false;
}

function warningTickValue(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * Imports the editable subset of uncompressed MusicXML score-partwise files.
 * Unsupported secondary voices and specialist notation are reported as warnings
 * instead of silently changing Garak's primary-voice model.
 */
export function importMusicXML(xml: string): MusicXMLImportResult {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("The MusicXML file is empty.");
  if (xml.length > MAX_XML_LENGTH) throw new Error("The MusicXML file is too large to import safely.");
  if (/<!\s*ENTITY\b/i.test(xml) || /<!\s*DOCTYPE\b[^>]*\[/i.test(xml)) {
    throw new Error("MusicXML internal document type and entity declarations are not accepted for security reasons.");
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`The MusicXML file is not well-formed: ${validation.err.msg}`);

  const parsed = new XMLParser({ ignoreAttributes: false, preserveOrder: true, trimValues: true }).parse(xml) as XmlNode[];
  const root = parsed.find((node) => Object.prototype.hasOwnProperty.call(node, "score-partwise"));
  if (!root) throw new Error("Garak currently imports MusicXML score-partwise documents. Convert timewise scores before opening them.");

  const warnings = new ImportWarningCollector();
  const partList = firstChild(root, "part-list");
  if (!partList) throw new Error("The MusicXML score is missing its required part-list.");
  const scorePartNodes = directScorePartNodes(partList);
  if (!scorePartNodes.length) throw new Error("The MusicXML part-list has no score-part entries.");
  if (scorePartNodes.length > MAX_PARTS) throw new Error(`The MusicXML score exceeds Garak's ${MAX_PARTS}-part safety limit.`);
  const scorePartById = new Map<string, XmlNode>();
  scorePartNodes.forEach((node) => {
    const id = attribute(node, "id");
    if (!id) throw new Error("Every MusicXML score-part needs an id.");
    if (id.length > MAX_SOURCE_ID_LENGTH) throw new Error(`A MusicXML score-part id exceeds Garak's ${MAX_SOURCE_ID_LENGTH}-character safety limit.`);
    if (scorePartById.has(id)) throw new Error(`The MusicXML part-list contains duplicate id ${id}.`);
    scorePartById.set(id, node);
  });

  const documentParts = directPartNodes(root);
  if (!documentParts.length) throw new Error("The MusicXML score has no parts.");
  const documentPartById = new Map<string, XmlNode>();
  documentParts.forEach((node) => {
    const id = attribute(node, "id");
    if (!id) throw new Error("Every MusicXML part needs an id that references part-list.");
    if (id.length > MAX_SOURCE_ID_LENGTH) throw new Error(`A MusicXML part id exceeds Garak's ${MAX_SOURCE_ID_LENGTH}-character safety limit.`);
    if (documentPartById.has(id)) throw new Error(`The MusicXML score contains duplicate part id ${id}.`);
    if (!scorePartById.has(id)) throw new Error(`MusicXML part ${id} does not reference a score-part in part-list.`);
    documentPartById.set(id, node);
  });
  const sourceParts = scorePartNodes.map((scorePart) => {
    const id = attribute(scorePart, "id")!;
    const part = documentPartById.get(id);
    if (!part) throw new Error(`MusicXML score-part ${id} has no matching part data.`);
    return part;
  });

  const sourceMeasures = sourceParts.map((part) => childEntries(part, "measure"));
  const measureCount = Math.max(0, ...sourceMeasures.map((measures) => measures.length));
  if (!measureCount) throw new Error("The MusicXML score has no measures.");
  if (measureCount > MAX_MEASURES) throw new Error(`The MusicXML score exceeds Garak's ${MAX_MEASURES}-measure safety limit.`);
  if (sourceMeasures.some((measures) => measures.length !== measureCount)) {
    warnings.push("Parts contain different measure counts; missing trailing measures were imported as empty measures.");
  }
  const measureOrder = Array.from({ length: measureCount }, (_, index) => `measure-${index + 1}`);

  const sourcePartNames = sourceParts.map((partNode, index) => {
    const listNode = scorePartById.get(attribute(partNode, "id")!);
    return boundedImportedText(childText(listNode, "part-name"), `Part ${index + 1}`, MAX_IMPORTED_NAME_LENGTH, warnings, `Part ${index + 1} name`);
  });
  const sourcePartShortNames = sourceParts.map((partNode, index) => {
    const listNode = scorePartById.get(attribute(partNode, "id")!);
    return boundedImportedText(childText(listNode, "part-abbreviation"), sourcePartNames[index].slice(0, 8), MAX_IMPORTED_SHORT_NAME_LENGTH, warnings, `${sourcePartNames[index]} abbreviation`);
  });
  const sourceStaffCounts = sourceParts.map((partNode, partIndex) => {
    let count = 1;
    allAttributes(partNode).forEach((attributesNode) => {
      const declared = strictInteger(childText(attributesNode, "staves"));
      if (declared !== undefined && declared > 0) count = Math.max(count, declared);
      children(attributesNode, "clef").forEach((clefNode) => {
        const numbered = strictInteger(attribute(clefNode, "number"));
        if (numbered !== undefined && numbered > 0) count = Math.max(count, numbered);
      });
    });
    sourceMeasures[partIndex].forEach((measureNode) => children(measureNode, "note").forEach((noteNode) => {
      const numbered = strictInteger(childText(noteNode, "staff"));
      if (numbered !== undefined && numbered > 0) count = Math.max(count, numbered);
    }));
    if (count > MAX_STAVES_PER_PART) {
      throw new Error(`${sourcePartNames[partIndex]} exceeds Garak's ${MAX_STAVES_PER_PART}-staff safety limit.`);
    }
    return count;
  });
  const totalSourceStaves = sourceStaffCounts.reduce((sum, staffCount) => sum + staffCount, 0);
  if (!Number.isSafeInteger(totalSourceStaves) || totalSourceStaves > MAX_TOTAL_STAVES) {
    throw new Error(`The MusicXML score exceeds Garak's ${MAX_TOTAL_STAVES.toLocaleString("en-US")}-staff total safety limit.`);
  }
  const staffMeasureCells = sourceStaffCounts.reduce((sum, staffCount) => sum + staffCount * measureCount, 0);
  if (!Number.isSafeInteger(staffMeasureCells) || staffMeasureCells > MAX_STAFF_MEASURE_CELLS) {
    throw new Error(`The MusicXML score exceeds Garak's ${MAX_STAFF_MEASURE_CELLS.toLocaleString("en-US")}-cell staff-by-measure complexity limit.`);
  }
  const sourceMeasureElements = sourceMeasures.reduce((total, partMeasures) =>
    total + partMeasures.reduce((partTotal, measureNode) => partTotal + content(measureNode).length, 0), 0);
  if (!Number.isSafeInteger(sourceMeasureElements) || sourceMeasureElements > MAX_SOURCE_MEASURE_ELEMENTS) {
    throw new Error(`The MusicXML score exceeds Garak's ${MAX_SOURCE_MEASURE_ELEMENTS.toLocaleString("en-US")}-element notation complexity limit.`);
  }

  let importedTempo: number | undefined;
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    sourceMeasures.forEach((partMeasures, partIndex) => {
      const measureNode = partMeasures[measureIndex];
      if (!measureNode) return;
      measureSoundNodes(measureNode).forEach((soundNode, soundIndex) => {
        const rawTempo = attribute(soundNode, "tempo");
        if (rawTempo === undefined) return;
        const context = `${sourcePartNames[partIndex]}, measure ${measureIndex + 1}, sound ${soundIndex + 1}`;
        const candidate = normalizedTempo(rawTempo);
        if (candidate === undefined) {
          warnings.push(`${context}: tempo ${JSON.stringify(rawTempo)} is outside Garak's 30–300 BPM range and was ignored.`);
          return;
        }
        if (importedTempo === undefined) importedTempo = candidate;
        else if (candidate !== importedTempo) {
          warnings.push(`${context}: tempo change to ${candidate} BPM is not editable yet; the initial ${importedTempo} BPM remains global.`);
        }
      });
    });
  }
  const tempo = importedTempo ?? 96;

  const sourceMeasureExtents = sourceMeasures.map((partMeasures) => {
    let divisions = 1;
    return partMeasures.map((measureNode) => {
      const timing = sourceMeasureTiming(measureNode, divisions);
      divisions = timing.divisions;
      return timing.extent;
    });
  });
  const sourceTranspositions = sourceParts.map((partNode, index) => readInitialTransposition(partNode, warnings, sourcePartNames[index]));
  let activeTime = { numerator: 4, denominator: 4 };
  let activeKey: KeySignature = { fifths: 0, mode: "major" };
  const measures: ScoreDocument["measures"] = {};
  for (let index = 0; index < measureCount; index += 1) {
    const measureEntries = sourceMeasures.flatMap((partMeasures, partIndex) => {
      const measureNode = partMeasures[index];
      return measureNode ? [{ measureNode, partIndex }] : [];
    });
    const timeCandidates = measureEntries.flatMap(({ measureNode, partIndex }) => {
      const matches = children(measureNode, "attributes").filter((node) => firstChild(node, "time"));
      if (matches.length > 1) warnings.push(`${sourcePartNames[partIndex]}, measure ${index + 1}: mid-measure time changes are not editable yet; the first was used.`);
      if (matches[0] && followsMusicalCursorContent(measureNode, matches[0])) {
        warnings.push(`${sourcePartNames[partIndex]}, measure ${index + 1}: the time signature occurs after musical content; Garak normalized it to the start of the measure.`);
      }
      return matches[0] ? [{ attributes: matches[0], partIndex }] : [];
    });
    if (timeCandidates.length) {
      const importedTime = parseTimeSignature(timeCandidates[0].attributes, activeTime, warnings, `${sourcePartNames[timeCandidates[0].partIndex]}, measure ${index + 1}`);
      timeCandidates.slice(1).forEach((candidate) => {
        const comparison = parseTimeSignature(candidate.attributes, activeTime, warnings, `${sourcePartNames[candidate.partIndex]}, measure ${index + 1}`);
        if (comparison.numerator !== importedTime.numerator || comparison.denominator !== importedTime.denominator) {
          warnings.push(`Measure ${index + 1}: parts disagree about the time signature; ${sourcePartNames[timeCandidates[0].partIndex]}'s value was used.`);
        }
      });
      activeTime = importedTime;
    }

    const keyCandidates = measureEntries.flatMap(({ measureNode, partIndex }) => {
      const matches = children(measureNode, "attributes").filter((node) => children(node, "key").length);
      if (matches.length > 1) warnings.push(`${sourcePartNames[partIndex]}, measure ${index + 1}: mid-measure key changes are not editable yet; the first was used.`);
      if (matches[0] && followsMusicalCursorContent(measureNode, matches[0])) {
        warnings.push(`${sourcePartNames[partIndex]}, measure ${index + 1}: the key signature occurs after musical content; Garak normalized it to the start of the measure.`);
      }
      return matches[0] ? [{ attributes: matches[0], partIndex }] : [];
    });
    if (keyCandidates.length) {
      const firstCandidate = keyCandidates[0];
      const importedKey = parseConcertKey(
        firstCandidate.attributes,
        activeKey,
        sourceTranspositions[firstCandidate.partIndex],
        warnings,
        `${sourcePartNames[firstCandidate.partIndex]}, measure ${index + 1}`,
      );
      keyCandidates.slice(1).forEach((candidate) => {
        const comparison = parseConcertKey(
          candidate.attributes,
          activeKey,
          sourceTranspositions[candidate.partIndex],
          warnings,
          `${sourcePartNames[candidate.partIndex]}, measure ${index + 1}`,
        );
        if (comparison.fifths !== importedKey.fifths || comparison.mode !== importedKey.mode) {
          warnings.push(`Measure ${index + 1}: written keys do not resolve to one concert key; ${sourcePartNames[firstCandidate.partIndex]}'s value was used.`);
        }
      });
      activeKey = importedKey;
    }

    const id = measureOrder[index];
    const numericMeasureNumbers = measureEntries.map(({ measureNode }) => strictInteger(attribute(measureNode, "number"))).filter((value): value is number => value !== undefined);
    if (new Set(numericMeasureNumbers).size > 1) warnings.push(`Measure ${index + 1}: parts use different measure numbers; score order was preserved.`);
    measures[id] = {
      id,
      number: numericMeasureNumbers[0] ?? index + 1,
      time: { ...activeTime },
      key: { ...activeKey },
    };
  }

  const measureStartTicks = new Map<string, number>();
  let nextMeasureStart = 0;
  for (const measureId of measureOrder) {
    const capacity = measureCapacity(measures[measureId]);
    if (
      !Number.isSafeInteger(capacity) ||
      capacity <= 0 ||
      nextMeasureStart > SCORE_VALIDATION_LIMITS.timelineTicks - capacity
    ) {
      throw new Error(`The MusicXML score timeline exceeds Garak's ${SCORE_VALIDATION_LIMITS.timelineTicks.toLocaleString("en-US")}-tick safety limit.`);
    }
    measureStartTicks.set(measureId, nextMeasureStart);
    nextMeasureStart += capacity;
  }

  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    const implicitParts = sourceMeasures.flatMap((partMeasures, partIndex) => {
      const measureNode = partMeasures[measureIndex];
      return measureNode && attribute(measureNode, "implicit")?.toLowerCase() === "yes" ? [sourcePartNames[partIndex]] : [];
    });
    if (implicitParts.length) {
      warnings.push(`Measure ${measureIndex + 1}: ${implicitParts.join(", ")} marks the source measure implicit; Garak cannot preserve pickup/implicit measure metadata and will export it as an explicit measure.`);
    }
    if (measureIndex === measureCount - 1) continue;
    const extents = sourceMeasureExtents.flatMap((partExtents) => {
      const extent = partExtents[measureIndex];
      return extent === undefined ? [] : [extent];
    });
    const sourceExtent = extents.length ? Math.max(...extents) : 0;
    const capacity = measureCapacity(measures[measureOrder[measureIndex]]);
    if (sourceExtent < capacity - TICK_EPSILON) {
      const delay = capacity - sourceExtent;
      warnings.push(`Measure ${measureIndex + 1}: the source measure is underfilled at ${warningTickValue(sourceExtent)} of ${warningTickValue(capacity)} ticks; Garak uses the full active meter, so the following measure starts ${warningTickValue(delay)} ticks later than the source content ends.`);
    }
  }

  const ties: ScoreDocument["ties"] = [];
  let materializedEventCount = 0;
  let materializedNoteCount = 0;
  const parts: PartData[] = sourceParts.map((partNode, partIndex) => {
    const sourceId = attribute(partNode, "id") ?? `P${partIndex + 1}`;
    const listNode = scorePartById.get(sourceId);
    const name = sourcePartNames[partIndex];
    const shortName = sourcePartShortNames[partIndex];
    const midiInstrument = firstChild(listNode, "midi-instrument");
    const importedProgram = childText(midiInstrument, "midi-program");
    const midiProgram = importedProgram === undefined ? undefined : Math.max(0, Math.min(127, integer(importedProgram, 1) - 1));
    const partAttributes = allAttributes(partNode);
    const transposition = sourceTranspositions[partIndex];
    let declaredStaves = 1;
    partAttributes.forEach((attributesNode) => {
      const stavesText = childText(attributesNode, "staves");
      if (stavesText === undefined) return;
      const value = strictInteger(stavesText);
      if (value === undefined || value < 1) warnings.push(`${name}: an invalid staves value was ignored.`);
      else declaredStaves = Math.max(declaredStaves, value);
    });
    if (declaredStaves > MAX_STAVES_PER_PART) throw new Error(`${name} exceeds Garak's ${MAX_STAVES_PER_PART}-staff safety limit.`);

    const clefByNumber = new Map<number, Clef>();
    partAttributes.forEach((attributesNode) => {
      const clefNodes = children(attributesNode, "clef");
      clefNodes.forEach((node, index) => {
        const parsedNumber = attribute(node, "number") === undefined ? (clefNodes.length === 1 ? 1 : index + 1) : strictInteger(attribute(node, "number"));
        if (parsedNumber === undefined || parsedNumber < 1 || parsedNumber > MAX_STAVES_PER_PART) {
          warnings.push(`${name}: a clef with an invalid staff number was ignored.`);
          return;
        }
        const importedClef = xmlClef(node);
        const initialClef = clefByNumber.get(parsedNumber);
        if (initialClef && initialClef !== importedClef) {
          warnings.push(`${name}, staff ${parsedNumber}: clef changes are not editable yet; the initial clef was used.`);
        } else if (!initialClef) clefByNumber.set(parsedNumber, importedClef);
      });
    });

    let notedStaffCount = 1;
    sourceMeasures[partIndex].forEach((measureNode) => children(measureNode, "note").forEach((note) => {
      const staffText = childText(note, "staff");
      const staffNumber = staffText === undefined ? 1 : strictInteger(staffText);
      if (staffNumber !== undefined && staffNumber > 0) notedStaffCount = Math.max(notedStaffCount, staffNumber);
    }));
    const staffCount = Math.max(declaredStaves, notedStaffCount, ...clefByNumber.keys());
    if (staffCount > MAX_STAVES_PER_PART) throw new Error(`${name} exceeds Garak's ${MAX_STAVES_PER_PART}-staff safety limit.`);
    const clefs = Array.from({ length: staffCount }, (_, staffIndex) => clefByNumber.get(staffIndex + 1) ?? (staffIndex === 0 ? "treble" : "bass"));
    const instrument = snapshotForPart(name, shortName, midiProgram, clefs, transposition);
    const partId = `part-${partIndex + 1}`;
    const staves: StaffData[] = clefs.map((clef, staffIndex) => {
      const staffId = `${partId}-staff-${staffIndex + 1}`;
      return {
        id: staffId,
        clef,
        measures: Object.fromEntries(measureOrder.map((measureId) => [measureId, {
          voices: [{ id: `${staffId}-${measureId}-v1`, events: [] }],
        }])),
      };
    });
    const voiceCandidatesByStaff = new Map<number, string[]>();
    sourceMeasures[partIndex].forEach((measureNode) => children(measureNode, "note").forEach((noteNode) => {
      const staffText = childText(noteNode, "staff");
      const staffNumber = staffText === undefined ? 1 : strictInteger(staffText);
      if (staffNumber === undefined || staffNumber < 1 || staffNumber > staves.length) return;
      const staffIndex = staffNumber - 1;
      const voiceNumber = childText(noteNode, "voice")?.trim() || "1";
      const candidates = voiceCandidatesByStaff.get(staffIndex) ?? [];
      if (!candidates.includes(voiceNumber)) candidates.push(voiceNumber);
      voiceCandidatesByStaff.set(staffIndex, candidates);
    }));
    const chosenVoiceByStaff = new Map(Array.from({ length: staffCount }, (_, staffIndex) => {
      const candidates = voiceCandidatesByStaff.get(staffIndex) ?? [];
      return [staffIndex, candidates.includes("1") ? "1" : candidates[0] ?? "1"] as const;
    }));
    const warnedVoices = new Set<string>();
    const pendingTies = new Map<string, { noteId: string; endTick: number; eventSequence: number }>();
    const noteEventSequenceByVoice = new Map<string, number>();
    const pendingDynamics = new Map<string, { dynamic: DynamicMarking; context: string }>();
    let divisions = 1;

    sourceMeasures[partIndex].forEach((measureNode, measureIndex) => {
      const measureId = measureOrder[measureIndex];
      const capacity = measureCapacity(measures[measureId]);
      const materializedTicks = Array.from({ length: staffCount }, () => 0);
      let sourceCursor = 0;
      let noteIndex = 0;
      let directionIndex = 0;
      let precedingSource: {
        onset: number;
        duration: number;
        staffIndex: number;
        voiceNumber: string;
        event?: Extract<MusicEvent, { kind: "note" }>;
      } | undefined;

      const appendAtOnset = (staffIndex: number, onset: number, event: MusicEvent, context: string): boolean => {
        const eventTicks = durationTicks(event.duration);
        if (onset < -TICK_EPSILON || onset + eventTicks > capacity + TICK_EPSILON) {
          warnings.push(`${context}: event exceeds the measure and was skipped.`);
          return false;
        }
        const current = materializedTicks[staffIndex];
        if (onset < current - TICK_EPSILON) {
          warnings.push(`${context}: overlapping events in the selected voice cannot be represented and were skipped.`);
          return false;
        }
        const gap = decomposeDurationTicks(onset - current);
        if (!gap) {
          warnings.push(`${context}: the leading rhythmic gap cannot be represented exactly and the event was skipped.`);
          return false;
        }
        if (materializedEventCount + gap.length + 1 > MAX_MATERIALIZED_EVENTS) {
          throw new Error(`The MusicXML score exceeds Garak's ${MAX_MATERIALIZED_EVENTS.toLocaleString("en-US")}-event materialization safety limit.`);
        }
        const voice = staves[staffIndex].measures[measureId].voices[0];
        gap.forEach((duration) => voice.events.push({
          id: `${partId}-${measureId}-staff-${staffIndex + 1}-gap-${voice.events.length + 1}`,
          kind: "rest",
          duration,
        }));
        voice.events.push(event);
        materializedEventCount += gap.length + 1;
        materializedTicks[staffIndex] = onset + eventTicks;
        return true;
      };

      const applyTies = (
        scoreNote: ScoreNote,
        noteNode: XmlNode,
        staffIndex: number,
        voiceNumber: string,
        context: string,
        onset: number,
        eventTicks: number,
        eventSequence: number,
      ) => {
        const tieTypes = new Set(children(noteNode, "tie").map((tieNode) => attribute(tieNode, "type")));
        const pitch = scoreNote.pitch;
        const tieKey = `${staffIndex}:${voiceNumber}:${pitch.step}:${pitch.alter}:${pitch.octave}`;
        const absoluteOnset = (measureStartTicks.get(measureId) ?? 0) + onset;
        if (tieTypes.has("stop")) {
          const pending = pendingTies.get(tieKey);
          if (pending) {
            pendingTies.delete(tieKey);
            const isContinuous = Math.abs(pending.endTick - absoluteOnset) < TICK_EPSILON;
            const isNextNoteEvent = eventSequence === pending.eventSequence + 1;
            if (isContinuous && isNextNoteEvent) {
              if (ties.length >= MAX_MATERIALIZED_TIES) {
                throw new Error(`The MusicXML score exceeds Garak's ${MAX_MATERIALIZED_TIES.toLocaleString("en-US")}-tie materialization safety limit.`);
              }
              ties.push({ id: `tie-${pending.noteId}-${scoreNote.id}`, fromNoteId: pending.noteId, toNoteId: scoreNote.id });
            } else {
              warnings.push(`${context}: tie stop is not adjacent to its start after Garak's measure and timing normalization and was skipped.`);
            }
          } else warnings.push(`${context}: tie stop had no matching start.`);
        }
        if (tieTypes.has("start")) {
          if (pendingTies.has(tieKey)) warnings.push(`${context}: a newer tie start replaced an unmatched start on the same pitch.`);
          pendingTies.set(tieKey, { noteId: scoreNote.id, endTick: absoluteOnset + eventTicks, eventSequence });
        }
      };

      const pendingDynamicKey = (staffIndex: number, voiceNumber: string) => `${staffIndex}:${voiceNumber}`;
      const decorateWithPendingDynamic = (event: MusicEvent, staffIndex: number, voiceNumber: string): string | null => {
        const key = pendingDynamicKey(staffIndex, voiceNumber);
        const pending = pendingDynamics.get(key);
        if (!pending) return null;
        event.dynamic = pending.dynamic;
        return key;
      };

      for (const measureChild of content(measureNode)) {
        if (Object.prototype.hasOwnProperty.call(measureChild, "attributes")) {
          const divisionsText = childText(measureChild, "divisions");
          if (divisionsText !== undefined) {
            const importedDivisions = strictPositiveNumber(divisionsText);
            if (importedDivisions === undefined) warnings.push(`${name}, measure ${measureIndex + 1}: invalid divisions was ignored.`);
            else divisions = importedDivisions;
          }
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(measureChild, "direction")) {
          directionIndex += 1;
          const context = `${name}, measure ${measureIndex + 1}, direction ${directionIndex}`;
          const dynamic = directionDynamic(measureChild, warnings, context);
          if (!dynamic) continue;

          const staffText = childText(measureChild, "staff");
          const parsedStaffNumber = staffText === undefined ? 1 : strictInteger(staffText);
          if (parsedStaffNumber === undefined || parsedStaffNumber < 1 || parsedStaffNumber > staves.length) {
            warnings.push(`${context}: dynamic has an invalid staff assignment and was skipped.`);
            continue;
          }
          const staffIndex = parsedStaffNumber - 1;
          const chosenVoice = chosenVoiceByStaff.get(staffIndex) ?? "1";
          const voiceNumber = childText(measureChild, "voice")?.trim() || chosenVoice;
          if (voiceNumber !== chosenVoice) {
            warnings.push(`${context}: dynamic for voice ${voiceNumber} was skipped because voice ${chosenVoice} is the editable voice on staff ${staffIndex + 1}.`);
            continue;
          }

          const key = pendingDynamicKey(staffIndex, voiceNumber);
          const previous = pendingDynamics.get(key);
          if (previous && previous.dynamic !== dynamic) {
            warnings.push(`${context}: conflicting pending dynamics ${previous.dynamic} and ${dynamic} target the same next event; the later ${dynamic} mark was used.`);
          }
          pendingDynamics.set(key, { dynamic, context });
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(measureChild, "backup") || Object.prototype.hasOwnProperty.call(measureChild, "forward")) {
          const kind = Object.prototype.hasOwnProperty.call(measureChild, "backup") ? "backup" : "forward";
          const context = `${name}, measure ${measureIndex + 1}, ${kind}`;
          const movement = sourceDurationTicks(measureChild, divisions, warnings, context);
          precedingSource = undefined;
          if (movement === null) continue;
          if (kind === "backup") {
            if (movement > sourceCursor + TICK_EPSILON) {
              warnings.push(`${context}: movement crosses the start of the measure and was clamped.`);
              sourceCursor = 0;
            } else sourceCursor -= movement;
          } else {
            sourceCursor += movement;
            if (sourceCursor > capacity + TICK_EPSILON) warnings.push(`${context}: movement exceeds the measure.`);
          }
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(measureChild, "note")) continue;
        const noteNode = measureChild;
        noteIndex += 1;
        const context = `${name}, measure ${measureIndex + 1}, note ${noteIndex}`;
        if (firstChild(noteNode, "grace")) {
          warnings.push(`${context}: grace notes are not editable yet and were skipped.`);
          precedingSource = undefined;
          continue;
        }

        const staffText = childText(noteNode, "staff");
        const parsedStaffNumber = staffText === undefined ? 1 : strictInteger(staffText);
        if (parsedStaffNumber === undefined || parsedStaffNumber < 1 || parsedStaffNumber > staves.length) {
          warnings.push(`${context}: invalid staff assignment was skipped.`);
          precedingSource = undefined;
          continue;
        }
        const staffIndex = parsedStaffNumber - 1;
        const voiceNumber = childText(noteNode, "voice")?.trim() || "1";
        const isChordTone = Boolean(firstChild(noteNode, "chord"));
        const importedTicks = sourceDurationTicks(noteNode, divisions, warnings, context);
        if (importedTicks === null) {
          precedingSource = undefined;
          continue;
        }

        let onset = sourceCursor;
        const chordPredecessor = precedingSource;
        if (isChordTone) {
          if (!chordPredecessor || chordPredecessor.staffIndex !== staffIndex || chordPredecessor.voiceNumber !== voiceNumber) {
            warnings.push(`${context}: chord marker had no preceding note in the same staff and voice and was skipped.`);
            precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
            continue;
          }
          onset = chordPredecessor.onset;
          if (importedTicks > chordPredecessor.duration + TICK_EPSILON) {
            warnings.push(`${context}: a chord tone is longer than its preceding note and was skipped.`);
            precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
            continue;
          }
        } else sourceCursor += importedTicks;

        const chosenVoice = chosenVoiceByStaff.get(staffIndex) ?? "1";
        if (voiceNumber !== chosenVoice) {
          const key = `${staffIndex}:${voiceNumber}`;
          if (!warnedVoices.has(key)) {
            warnings.push(`${name}, staff ${staffIndex + 1}: voice ${voiceNumber} was skipped because this version edits one voice per staff.`);
            warnedVoices.add(key);
          }
          precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
          continue;
        }

        const voice = staves[staffIndex].measures[measureId].voices[0];
        const restNode = firstChild(noteNode, "rest");
        if (restNode) {
          if (isChordTone) {
            warnings.push(`${context}: a rest marked as a chord tone was skipped.`);
            precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
            continue;
          }
          if (attribute(restNode, "measure") === "yes" && Math.abs(onset) < TICK_EPSILON && Math.abs(importedTicks - capacity) < TICK_EPSILON && voice.events.length === 0) {
            const key = pendingDynamicKey(staffIndex, voiceNumber);
            const pendingDynamic = pendingDynamics.get(key);
            if (pendingDynamic) {
              const restDurations = decomposeDurationTicks(capacity);
              if (restDurations?.length) {
                if (materializedEventCount + restDurations.length > MAX_MATERIALIZED_EVENTS) {
                  throw new Error(`The MusicXML score exceeds Garak's ${MAX_MATERIALIZED_EVENTS.toLocaleString("en-US")}-event materialization safety limit.`);
                }
                restDurations.forEach((duration, restIndex) => voice.events.push({
                  id: `${partId}-${measureId}-staff-${staffIndex + 1}-event-${voice.events.length + 1}`,
                  kind: "rest",
                  duration,
                  ...(restIndex === 0 ? { dynamic: pendingDynamic.dynamic } : {}),
                }));
                materializedEventCount += restDurations.length;
              } else {
                warnings.push(`${context}: the full-measure rest cannot be decomposed into Garak durations, so its ${pendingDynamic.dynamic} dynamic was skipped instead of moving to a later measure.`);
              }
              pendingDynamics.delete(key);
            }
            materializedTicks[staffIndex] = capacity;
            precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
            continue;
          }
          const noteValue = noteDuration(noteNode, importedTicks, warnings, context);
          if (!noteValue) {
            precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
            continue;
          }
          const event: MusicEvent = { id: `${partId}-${measureId}-staff-${staffIndex + 1}-event-${voice.events.length + 1}`, kind: "rest", duration: noteValue };
          const dynamicKey = decorateWithPendingDynamic(event, staffIndex, voiceNumber);
          if (appendAtOnset(staffIndex, onset, event, context) && dynamicKey) pendingDynamics.delete(dynamicKey);
          precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
          continue;
        }

        const noteValue = noteDuration(noteNode, importedTicks, warnings, context);
        const pitch = pitchFromNote(noteNode, warnings, context);
        if (!noteValue || !pitch) {
          precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
          continue;
        }
        const noteId = `${partId}-${measureId}-note-${noteIndex}`;
        const scoreNote: ScoreNote = {
          id: noteId,
          pitch,
          accidentalDisplay: firstChild(noteNode, "accidental") ? "force" : "auto",
        };
        let importedEvent: Extract<MusicEvent, { kind: "note" }> | undefined;
        if (isChordTone) {
          const precedingEvent = chordPredecessor?.event;
          if (!precedingEvent) {
            warnings.push(`${context}: the preceding chord event was not importable, so this tone was skipped.`);
            precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber };
            continue;
          }
          const dynamicKey = pendingDynamicKey(staffIndex, voiceNumber);
          const pendingDynamic = pendingDynamics.get(dynamicKey);
          if (pendingDynamic) {
            if (precedingEvent.dynamic && precedingEvent.dynamic !== pendingDynamic.dynamic) {
              warnings.push(`${context}: conflicting dynamics ${precedingEvent.dynamic} and ${pendingDynamic.dynamic} target one editable chord event; the later ${pendingDynamic.dynamic} mark was used.`);
            }
            precedingEvent.dynamic = pendingDynamic.dynamic;
            pendingDynamics.delete(dynamicKey);
          }
          if (precedingEvent.notes.some((existing) => existing.pitch.step === pitch.step && existing.pitch.alter === pitch.alter && existing.pitch.octave === pitch.octave)) {
            warnings.push(`${context}: duplicate chord tone was skipped.`);
            precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber, event: precedingEvent };
            continue;
          }
          if (Math.abs(importedTicks - durationTicks(precedingEvent.duration)) >= TICK_EPSILON) {
            warnings.push(`${context}: a shorter chord-tone duration was normalized to the duration of the editable chord event.`);
          }
          if (materializedNoteCount >= MAX_MATERIALIZED_NOTES) {
            throw new Error(`The MusicXML score exceeds Garak's ${MAX_MATERIALIZED_NOTES.toLocaleString("en-US")}-note materialization safety limit.`);
          }
          precedingEvent.notes.push(scoreNote);
          materializedNoteCount += 1;
          importedEvent = precedingEvent;
          const sequenceKey = `${staffIndex}:${voiceNumber}`;
          const eventSequence = noteEventSequenceByVoice.get(sequenceKey) ?? 0;
          applyTies(scoreNote, noteNode, staffIndex, voiceNumber, context, onset, durationTicks(precedingEvent.duration), eventSequence);
        } else {
          const event: Extract<MusicEvent, { kind: "note" }> = {
            id: `${partId}-${measureId}-staff-${staffIndex + 1}-event-${voice.events.length + 1}`,
            kind: "note",
            duration: noteValue,
            notes: [scoreNote],
          };
          const dynamicKey = decorateWithPendingDynamic(event, staffIndex, voiceNumber);
          if (materializedNoteCount >= MAX_MATERIALIZED_NOTES) {
            throw new Error(`The MusicXML score exceeds Garak's ${MAX_MATERIALIZED_NOTES.toLocaleString("en-US")}-note materialization safety limit.`);
          }
          if (appendAtOnset(staffIndex, onset, event, context)) {
            materializedNoteCount += 1;
            if (dynamicKey) pendingDynamics.delete(dynamicKey);
            importedEvent = event;
            const sequenceKey = `${staffIndex}:${voiceNumber}`;
            const eventSequence = (noteEventSequenceByVoice.get(sequenceKey) ?? 0) + 1;
            noteEventSequenceByVoice.set(sequenceKey, eventSequence);
            applyTies(scoreNote, noteNode, staffIndex, voiceNumber, context, onset, durationTicks(event.duration), eventSequence);
          }
        }
        precedingSource = { onset, duration: importedTicks, staffIndex, voiceNumber, event: importedEvent };
      }
    });
    if (pendingTies.size) warnings.push(`${name}: ${pendingTies.size} tie start${pendingTies.size === 1 ? "" : "s"} had no matching destination.`);
    if (pendingDynamics.size) {
      warnings.push(`${name}: ${pendingDynamics.size} dynamic mark${pendingDynamics.size === 1 ? "" : "s"} had no following supported event and ${pendingDynamics.size === 1 ? "was" : "were"} skipped.`);
    }

    return {
      id: partId,
      name,
      shortName,
      instrument,
      staves,
      muted: false,
      solo: false,
    };
  });

  const work = firstChild(root, "work");
  const identification = firstChild(root, "identification");
  const creator = children(identification, "creator").find((node) => attribute(node, "type") === "composer") ?? firstChild(identification, "creator");
  const importedTitle = childText(work, "work-title")?.trim() || childText(root, "movement-title")?.trim();
  const title = boundedImportedText(
    importedTitle,
    "Imported score",
    MAX_IMPORTED_NAME_LENGTH,
    warnings,
    "Score title",
  );
  const composer = boundedImportedText(text(creator), "Unknown composer", MAX_IMPORTED_NAME_LENGTH, warnings, "Composer name");
  const rights = boundedImportedText(childText(identification, "rights"), "", MAX_IMPORTED_RIGHTS_LENGTH, warnings, "Copyright notice");
  const now = new Date().toISOString();
  const score: ScoreDocument = {
    format: "garak-score",
    schemaVersion: 1,
    id: `score-import-${Date.now()}`,
    metadata: {
      title,
      subtitle: "MusicXML import",
      composer,
      copyright: rights,
    },
    tempo,
    measureOrder,
    measures,
    parts,
    ties,
    updatedAt: now,
  };
  return { score, warnings: warnings.toArray() };
}
