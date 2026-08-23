import type { Clef, InstrumentSnapshot, Transposition } from "./model";

export interface InstrumentDefinition extends InstrumentSnapshot {
  keywords: string[];
}

const T = (diatonic = 0, chromatic = 0, octaveChange = 0): Transposition => ({ diatonic, chromatic, octaveChange });

const make = (
  catalogId: string,
  family: string,
  name: string,
  shortName: string,
  clef: Clef,
  midiProgram: number,
  transposition = T(),
  keywords: string[] = [],
): InstrumentDefinition => ({ catalogId, family, name, shortName, clef, midiProgram, transposition, keywords, color: FAMILY_COLORS[family] ?? "#7c827e" });

export const FAMILY_COLORS: Record<string, string> = {
  Woodwinds: "#4c9a8b",
  Brass: "#c29643",
  Percussion: "#a76b7a",
  Keyboards: "#756aa6",
  Voices: "#b06f54",
  Strings: "#be744d",
};

export const INSTRUMENTS: InstrumentDefinition[] = [
  make("piccolo", "Woodwinds", "Piccolo", "Picc.", "treble", 72, T(0, 0, 1), ["flute"]),
  make("flute", "Woodwinds", "Flute", "Fl.", "treble", 73),
  make("alto-flute", "Woodwinds", "Alto Flute in G", "A. Fl.", "treble", 73, T(-3, -5, 0)),
  make("oboe", "Woodwinds", "Oboe", "Ob.", "treble", 68),
  make("english-horn", "Woodwinds", "English Horn in F", "E. Hn.", "treble", 69, T(-4, -7, 0), ["cor anglais"]),
  make("clarinet-eb", "Woodwinds", "E♭ Clarinet", "E♭ Cl.", "treble", 71, T(2, 3, 0)),
  make("clarinet-bb", "Woodwinds", "B♭ Clarinet", "B♭ Cl.", "treble", 71, T(-1, -2, 0)),
  make("clarinet-a", "Woodwinds", "Clarinet in A", "A Cl.", "treble", 71, T(-2, -3, 0)),
  make("bass-clarinet", "Woodwinds", "Bass Clarinet in B♭", "B. Cl.", "treble", 71, T(-1, -2, -1)),
  make("bassoon", "Woodwinds", "Bassoon", "Bsn.", "bass", 70),
  make("contrabassoon", "Woodwinds", "Contrabassoon", "Cbsn.", "bass", 70, T(0, 0, -1)),
  make("soprano-sax", "Woodwinds", "Soprano Saxophone in B♭", "S. Sax.", "treble", 64, T(-1, -2, 0)),
  make("alto-sax", "Woodwinds", "Alto Saxophone in E♭", "A. Sax.", "treble", 65, T(-5, -9, 0)),
  make("tenor-sax", "Woodwinds", "Tenor Saxophone in B♭", "T. Sax.", "treble", 66, T(-1, -2, -1)),
  make("baritone-sax", "Woodwinds", "Baritone Saxophone in E♭", "Bar. Sax.", "treble", 67, T(-5, -9, -1)),

  make("horn-f", "Brass", "Horn in F", "Hn.", "treble", 60, T(-4, -7, 0), ["french horn"]),
  make("trumpet-bb", "Brass", "Trumpet in B♭", "Tpt.", "treble", 56, T(-1, -2, 0)),
  make("trumpet-c", "Brass", "Trumpet in C", "Tpt.", "treble", 56),
  make("cornet-bb", "Brass", "Cornet in B♭", "Cor.", "treble", 56, T(-1, -2, 0)),
  make("trombone", "Brass", "Trombone", "Tbn.", "bass", 57),
  make("bass-trombone", "Brass", "Bass Trombone", "B. Tbn.", "bass", 57),
  make("euphonium", "Brass", "Euphonium", "Euph.", "bass", 58),
  make("tuba", "Brass", "Tuba", "Tba.", "bass", 58),

  make("timpani", "Percussion", "Timpani", "Timp.", "bass", 47),
  make("glockenspiel", "Percussion", "Glockenspiel", "Glock.", "treble", 9, T(0, 0, 2)),
  make("xylophone", "Percussion", "Xylophone", "Xyl.", "treble", 13, T(0, 0, 1)),
  make("vibraphone", "Percussion", "Vibraphone", "Vib.", "treble", 11),
  make("marimba", "Percussion", "Marimba", "Mar.", "treble", 12),
  make("tubular-bells", "Percussion", "Tubular Bells", "T. Bells", "treble", 14),
  make("snare-drum", "Percussion", "Snare Drum", "S.D.", "percussion", 0),
  make("bass-drum", "Percussion", "Bass Drum", "B.D.", "percussion", 0),
  make("cymbals", "Percussion", "Cymbals", "Cym.", "percussion", 0),
  make("percussion", "Percussion", "Percussion", "Perc.", "percussion", 0),

  make("piano", "Keyboards", "Piano", "Pno.", "treble", 0),
  make("celesta", "Keyboards", "Celesta", "Cel.", "treble", 8),
  make("harpsichord", "Keyboards", "Harpsichord", "Hpsd.", "treble", 6),
  make("organ", "Keyboards", "Organ", "Org.", "treble", 19),
  make("harp", "Keyboards", "Harp", "Hp.", "treble", 46),
  make("guitar", "Keyboards", "Classical Guitar", "Gtr.", "treble", 24, T(0, 0, -1)),

  make("soprano", "Voices", "Soprano", "S.", "treble", 52),
  make("alto", "Voices", "Alto", "A.", "treble", 52),
  make("tenor", "Voices", "Tenor", "T.", "treble", 52, T(0, 0, -1)),
  make("baritone", "Voices", "Baritone", "Bar.", "bass", 52),
  make("bass-voice", "Voices", "Bass", "B.", "bass", 52),
  make("choir", "Voices", "Choir", "Ch.", "treble", 52),

  make("violin", "Strings", "Violin", "Vln.", "treble", 40),
  make("viola", "Strings", "Viola", "Vla.", "alto", 41),
  make("cello", "Strings", "Violoncello", "Vc.", "bass", 42, T(), ["cello"]),
  make("double-bass", "Strings", "Double Bass", "Cb.", "bass", 43, T(0, 0, -1), ["contrabass"]),
];

export const FAMILIES = Object.keys(FAMILY_COLORS);

export function getInstrument(catalogId: string): InstrumentDefinition {
  return INSTRUMENTS.find((instrument) => instrument.catalogId === catalogId) ?? INSTRUMENTS[1];
}

export const SCORE_TEMPLATES = [
  { id: "solo", name: "Solo", description: "A focused single-instrument score", instruments: ["piano"] },
  { id: "quartet", name: "String quartet", description: "Two violins, viola, and cello", instruments: ["violin", "violin", "viola", "cello"] },
  { id: "chamber", name: "Chamber orchestra", description: "A balanced 11-part ensemble", instruments: ["flute", "oboe", "clarinet-bb", "bassoon", "horn-f", "trumpet-c", "violin", "violin", "viola", "cello", "double-bass"] },
  { id: "orchestra", name: "Symphony orchestra", description: "Full winds, brass, percussion, and strings", instruments: ["piccolo", "flute", "flute", "oboe", "english-horn", "clarinet-bb", "clarinet-bb", "bass-clarinet", "bassoon", "contrabassoon", "horn-f", "horn-f", "trumpet-c", "trumpet-c", "trombone", "bass-trombone", "tuba", "timpani", "percussion", "harp", "violin", "violin", "viola", "cello", "double-bass"] },
] as const;
