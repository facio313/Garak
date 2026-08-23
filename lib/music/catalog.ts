import type { Clef, InstrumentSnapshot, Transposition } from "./model";

export interface InstrumentDefinition extends InstrumentSnapshot {
  keywords: string[];
  /** Staff layout used when a new part is created; absent definitions use the primary clef. */
  staffClefs?: readonly Clef[];
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
  staffClefs?: readonly Clef[],
): InstrumentDefinition => ({
  catalogId,
  family,
  name,
  shortName,
  clef,
  midiProgram,
  transposition,
  keywords,
  color: FAMILY_COLORS[family] ?? "#7c827e",
  ...(staffClefs?.length ? { staffClefs: [...staffClefs] } : {}),
});

const GRAND_STAFF = ["treble", "bass"] as const satisfies readonly Clef[];
const ORGAN_STAVES = ["treble", "bass", "bass"] as const satisfies readonly Clef[];

export const FAMILY_COLORS: Record<string, string> = {
  Woodwinds: "#4c9a8b",
  Brass: "#c29643",
  Percussion: "#a76b7a",
  Keyboards: "#756aa6",
  Voices: "#b06f54",
  Strings: "#be744d",
};

/**
 * Transposition is always written pitch -> sounding pitch. `chromatic` and
 * `diatonic` describe the keyed interval; `octaveChange` keeps octave-
 * transposing conventions explicit instead of folding them into chromatic.
 *
 * `clef` remains the primary clef stored in instrument snapshots for backward
 * compatibility. New multi-staff parts use the optional `staffClefs` layout.
 * Where established brass-band and orchestral notation conventions differ,
 * the catalog exposes separate, explicitly named presets.
 */
export const INSTRUMENTS: InstrumentDefinition[] = [
  // Woodwinds — flutes and recorders
  make("piccolo", "Woodwinds", "Piccolo", "Picc.", "treble", 72, T(0, 0, 1), ["flute"]),
  make("flute", "Woodwinds", "Flute", "Fl.", "treble", 73),
  make("alto-flute", "Woodwinds", "Alto Flute in G", "A. Fl.", "treble", 73, T(-3, -5, 0)),
  make("bass-flute", "Woodwinds", "Bass Flute in C", "B. Fl.", "treble", 73, T(0, 0, -1)),
  make("contrabass-flute", "Woodwinds", "Contrabass Flute in C", "Cb. Fl.", "treble", 73, T(0, 0, -2)),
  make("soprano-recorder", "Woodwinds", "Soprano Recorder in C", "S. Rec.", "treble", 74, T(), ["descant recorder"]),
  make("alto-recorder", "Woodwinds", "Alto Recorder in F", "A. Rec.", "treble", 74),
  make("tenor-recorder", "Woodwinds", "Tenor Recorder in C", "T. Rec.", "treble", 74),
  make("bass-recorder", "Woodwinds", "Bass Recorder in F", "B. Rec.", "bass", 74),

  // Woodwinds — double reeds
  make("oboe", "Woodwinds", "Oboe", "Ob.", "treble", 68),
  make("oboe-damore", "Woodwinds", "Oboe d'amore in A", "Ob. d'am.", "treble", 68, T(-2, -3, 0)),
  make("english-horn", "Woodwinds", "English Horn in F", "E. Hn.", "treble", 69, T(-4, -7, 0), ["cor anglais"]),
  make("bass-oboe", "Woodwinds", "Bass Oboe in C", "B. Ob.", "treble", 68, T(0, 0, -1), ["baritone oboe"]),
  make("bassoon", "Woodwinds", "Bassoon", "Bsn.", "bass", 70),
  make("contrabassoon", "Woodwinds", "Contrabassoon", "Cbsn.", "bass", 70, T(0, 0, -1), ["double bassoon"]),

  // Woodwinds — clarinets
  make("clarinet-eb", "Woodwinds", "E♭ Clarinet", "E♭ Cl.", "treble", 71, T(2, 3, 0)),
  make("clarinet-d", "Woodwinds", "Clarinet in D", "D Cl.", "treble", 71, T(1, 2, 0)),
  make("clarinet-c", "Woodwinds", "Clarinet in C", "C Cl.", "treble", 71),
  make("clarinet-bb", "Woodwinds", "B♭ Clarinet", "B♭ Cl.", "treble", 71, T(-1, -2, 0)),
  make("clarinet-a", "Woodwinds", "Clarinet in A", "A Cl.", "treble", 71, T(-2, -3, 0)),
  make("basset-clarinet-a", "Woodwinds", "Basset Clarinet in A", "Bas. Cl.", "treble", 71, T(-2, -3, 0)),
  make("basset-horn-f", "Woodwinds", "Basset Horn in F", "Bas. Hn.", "treble", 71, T(-4, -7, 0)),
  make("alto-clarinet-eb", "Woodwinds", "Alto Clarinet in E♭", "A. Cl.", "treble", 71, T(-5, -9, 0)),
  make("bass-clarinet", "Woodwinds", "Bass Clarinet in B♭", "B. Cl.", "treble", 71, T(-1, -2, -1)),
  make("contralto-clarinet-eb", "Woodwinds", "Contralto Clarinet in E♭", "CA. Cl.", "treble", 71, T(-5, -9, -1)),
  make("contrabass-clarinet-bb", "Woodwinds", "Contrabass Clarinet in B♭", "CB. Cl.", "treble", 71, T(-1, -2, -2)),

  // Woodwinds — complete modern saxophone range
  make("sopranino-sax", "Woodwinds", "Sopranino Saxophone in E♭", "Sn. Sax.", "treble", 64, T(2, 3, 0)),
  make("soprano-sax", "Woodwinds", "Soprano Saxophone in B♭", "S. Sax.", "treble", 64, T(-1, -2, 0)),
  make("alto-sax", "Woodwinds", "Alto Saxophone in E♭", "A. Sax.", "treble", 65, T(-5, -9, 0)),
  make("tenor-sax", "Woodwinds", "Tenor Saxophone in B♭", "T. Sax.", "treble", 66, T(-1, -2, -1)),
  make("baritone-sax", "Woodwinds", "Baritone Saxophone in E♭", "Bar. Sax.", "treble", 67, T(-5, -9, -1)),
  make("bass-sax", "Woodwinds", "Bass Saxophone in B♭", "B. Sax.", "treble", 67, T(-1, -2, -2)),
  make("contrabass-sax", "Woodwinds", "Contrabass Saxophone in E♭", "CB. Sax.", "treble", 67, T(-5, -9, -2)),

  // Brass — horns, trumpets, and cornets
  make("horn-f", "Brass", "Horn in F", "Hn.", "treble", 60, T(-4, -7, 0), ["french horn"]),
  make("horn-eb", "Brass", "Horn in E♭", "E♭ Hn.", "treble", 60, T(-5, -9, 0)),
  make("mellophone-f", "Brass", "Mellophone in F", "Mell.", "treble", 60, T(-4, -7, 0)),
  make("trumpet-bb", "Brass", "Trumpet in B♭", "Tpt.", "treble", 56, T(-1, -2, 0)),
  make("trumpet-c", "Brass", "Trumpet in C", "Tpt.", "treble", 56),
  make("trumpet-d", "Brass", "Trumpet in D", "D Tpt.", "treble", 56, T(1, 2, 0)),
  make("trumpet-eb", "Brass", "Trumpet in E♭", "E♭ Tpt.", "treble", 56, T(2, 3, 0)),
  make("piccolo-trumpet-bb", "Brass", "Piccolo Trumpet in B♭", "Picc. Tpt.", "treble", 56, T(-1, -2, 1)),
  make("piccolo-trumpet-a", "Brass", "Piccolo Trumpet in A", "Picc. Tpt.", "treble", 56, T(-2, -3, 1)),
  make("bass-trumpet-c", "Brass", "Bass Trumpet in C", "B. Tpt.", "treble", 56, T(0, 0, -1)),
  make("bass-trumpet-bb", "Brass", "Bass Trumpet in B♭", "B. Tpt.", "treble", 56, T(-1, -2, -1)),
  make("cornet-bb", "Brass", "Cornet in B♭", "Cor.", "treble", 56, T(-1, -2, 0)),
  make("soprano-cornet-eb", "Brass", "Soprano Cornet in E♭", "S. Cor.", "treble", 56, T(2, 3, 0)),
  make("flugelhorn-bb", "Brass", "Flugelhorn in B♭", "Flghn.", "treble", 56, T(-1, -2, 0)),

  // Brass — brass-band and low-brass conventions are separate presets
  make("alto-horn-eb", "Brass", "Alto Horn in E♭ (treble clef)", "A. Hn.", "treble", 60, T(-5, -9, 0), ["tenor horn"]),
  make("baritone-horn-bass-clef", "Brass", "Baritone Horn (concert bass clef)", "Bar. Hn.", "bass", 58),
  make("baritone-horn-treble-bb", "Brass", "Baritone Horn in B♭ (treble clef)", "Bar. Hn.", "treble", 58, T(-1, -2, -1)),
  make("euphonium", "Brass", "Euphonium (concert bass clef)", "Euph.", "bass", 58),
  make("euphonium-treble-bb", "Brass", "Euphonium in B♭ (treble clef)", "Euph.", "treble", 58, T(-1, -2, -1)),
  make("alto-trombone", "Brass", "Alto Trombone (concert alto clef)", "A. Tbn.", "alto", 57),
  make("trombone", "Brass", "Tenor Trombone (concert bass clef)", "Tbn.", "bass", 57),
  make("tenor-trombone-treble-bb", "Brass", "Tenor Trombone in B♭ (treble clef)", "Tbn.", "treble", 57, T(-1, -2, -1)),
  make("bass-trombone", "Brass", "Bass Trombone", "B. Tbn.", "bass", 57),
  make("contrabass-trombone", "Brass", "Contrabass Trombone", "CB. Tbn.", "bass", 57),
  make("tuba", "Brass", "Tuba", "Tba.", "bass", 58),
  make("tuba-c", "Brass", "CC Tuba (concert bass clef)", "C Tba.", "bass", 58),
  make("tuba-bb", "Brass", "BB♭ Tuba (concert bass clef)", "BB♭ Tba.", "bass", 58),
  make("tuba-f", "Brass", "F Tuba (concert bass clef)", "F Tba.", "bass", 58),
  make("tuba-eb", "Brass", "E♭ Tuba (concert bass clef)", "E♭ Tba.", "bass", 58),
  make("tuba-bb-treble", "Brass", "BB♭ Tuba (treble-clef brass band)", "BB♭ Tba.", "treble", 58, T(-1, -2, -2)),
  make("tuba-eb-treble", "Brass", "E♭ Tuba (treble-clef brass band)", "E♭ Tba.", "treble", 58, T(-5, -9, -1)),
  make("cimbasso", "Brass", "Cimbasso", "Cimb.", "bass", 58),

  // Pitched percussion. Multi-staff instruments expose only their primary clef.
  make("timpani", "Percussion", "Timpani", "Timp.", "bass", 47),
  make("glockenspiel", "Percussion", "Glockenspiel", "Glock.", "treble", 9, T(0, 0, 2)),
  make("xylophone", "Percussion", "Xylophone", "Xyl.", "treble", 13, T(0, 0, 1)),
  make("vibraphone", "Percussion", "Vibraphone", "Vib.", "treble", 11),
  make("marimba", "Percussion", "Marimba", "Mar.", "treble", 12),
  make("tubular-bells", "Percussion", "Tubular Bells", "T. Bells", "treble", 14),
  make("crotales", "Percussion", "Crotales", "Crot.", "treble", 9, T(0, 0, 2)),
  make("bell-lyre", "Percussion", "Bell Lyre", "Bell Ly.", "treble", 9, T(0, 0, 2), ["marching glockenspiel"]),
  make("handbells", "Percussion", "Handbells", "Hndb.", "treble", 14),
  make("steel-drums", "Percussion", "Steel Drums", "St. Dr.", "treble", 114, T(), ["steelpan"]),
  make("agogo-bells", "Percussion", "Agogô Bells", "Agogô", "percussion", 113),

  // Unpitched percussion. Program numbers remain valid GM 0-based values;
  // a future percussion-map layer will own channel-10 note selection.
  make("snare-drum", "Percussion", "Snare Drum", "S.D.", "percussion", 0),
  make("bass-drum", "Percussion", "Bass Drum", "B.D.", "percussion", 0),
  make("cymbals", "Percussion", "Cymbals", "Cym.", "percussion", 0),
  make("crash-cymbals", "Percussion", "Crash Cymbals", "Cr. Cym.", "percussion", 0),
  make("suspended-cymbal", "Percussion", "Suspended Cymbal", "Sus. Cym.", "percussion", 0),
  make("tam-tam", "Percussion", "Tam-tam", "T-t.", "percussion", 0, T(), ["gong"]),
  make("triangle", "Percussion", "Triangle", "Tri.", "percussion", 0),
  make("tambourine", "Percussion", "Tambourine", "Tamb.", "percussion", 0),
  make("castanets", "Percussion", "Castanets", "Cast.", "percussion", 0),
  make("woodblock", "Percussion", "Woodblock", "W.B.", "percussion", 115),
  make("temple-blocks", "Percussion", "Temple Blocks", "Tmp. Bl.", "percussion", 115),
  make("claves", "Percussion", "Claves", "Clv.", "percussion", 115),
  make("maracas", "Percussion", "Maracas", "Marac.", "percussion", 0),
  make("guiro", "Percussion", "Güiro", "Güi.", "percussion", 0),
  make("bongos", "Percussion", "Bongos", "Bng.", "percussion", 117),
  make("congas", "Percussion", "Congas", "Cga.", "percussion", 117),
  make("timbales", "Percussion", "Timbales", "Timb.", "percussion", 117),
  make("tom-toms", "Percussion", "Tom-toms", "Toms", "percussion", 117),
  make("taiko-drum", "Percussion", "Taiko Drum", "Taiko", "percussion", 116),
  make("whip", "Percussion", "Whip", "Whip", "percussion", 0, T(), ["slapstick"]),
  make("drum-set", "Percussion", "Drum Set", "Dr. Set", "percussion", 0, T(), ["drum kit"]),
  make("percussion", "Percussion", "Percussion", "Perc.", "percussion", 0),

  // Keyboards. `clef` remains the primary preview clef for saved snapshots.
  make("piano", "Keyboards", "Piano", "Pno.", "treble", 0, T(), [], GRAND_STAFF),
  make("celesta", "Keyboards", "Celesta", "Cel.", "treble", 8, T(0, 0, 1), [], GRAND_STAFF),
  make("harpsichord", "Keyboards", "Harpsichord", "Hpsd.", "treble", 6, T(), [], GRAND_STAFF),
  make("organ", "Keyboards", "Organ", "Org.", "treble", 19, T(), [], ORGAN_STAVES),
  make("electric-piano-1", "Keyboards", "Electric Piano 1", "E. Pno. 1", "treble", 4),
  make("electric-piano-2", "Keyboards", "Electric Piano 2", "E. Pno. 2", "treble", 5),
  make("clavinet", "Keyboards", "Clavinet", "Clav.", "treble", 7),
  make("accordion", "Keyboards", "Accordion", "Acc.", "treble", 21, T(), [], GRAND_STAFF),
  make("harmonium", "Keyboards", "Harmonium", "Harm.", "treble", 20, T(), ["reed organ"], GRAND_STAFF),
  make("bandoneon", "Keyboards", "Bandoneon", "Band.", "treble", 23, T(), [], GRAND_STAFF),

  // Voices. Choir presets are explicitly single-staff until staff groups land.
  make("soprano", "Voices", "Soprano", "S.", "treble", 52),
  make("mezzo-soprano", "Voices", "Mezzo-soprano", "M.-S.", "treble", 52),
  make("alto", "Voices", "Alto", "A.", "treble", 52),
  make("contralto", "Voices", "Contralto", "Contr.", "treble", 52),
  make("countertenor", "Voices", "Countertenor", "C.T.", "treble", 52),
  make("tenor", "Voices", "Tenor", "T.", "treble", 52, T(0, 0, -1)),
  make("baritone", "Voices", "Baritone", "Bar.", "bass", 52),
  make("bass-baritone", "Voices", "Bass-baritone", "B.-Bar.", "bass", 52),
  make("bass-voice", "Voices", "Bass", "B.", "bass", 52),
  make("boy-soprano", "Voices", "Boy Soprano", "Boy S.", "treble", 52, T(), ["treble solo"]),
  make("treble-voice", "Voices", "Treble Voice", "Tr.", "treble", 52),
  make("choir", "Voices", "Choir (single staff)", "Ch.", "treble", 52),
  make("children-choir", "Voices", "Children's Choir (single staff)", "Chld. Ch.", "treble", 52),
  make("womens-choir", "Voices", "Women's Choir (single staff)", "W. Ch.", "treble", 52),
  make("mens-choir", "Voices", "Men's Choir (single staff)", "M. Ch.", "bass", 52),
  make("satb-choir-single-staff", "Voices", "SATB Choir (single staff)", "SATB", "treble", 52),

  // Bowed and plucked strings. Guitar-family octave displacement is explicit.
  make("violin", "Strings", "Violin", "Vln.", "treble", 40),
  make("viola", "Strings", "Viola", "Vla.", "alto", 41),
  make("cello", "Strings", "Violoncello", "Vc.", "bass", 42, T(), ["cello"]),
  make("double-bass", "Strings", "Double Bass", "Cb.", "bass", 43, T(0, 0, -1), ["contrabass"]),
  make("harp", "Strings", "Harp", "Hp.", "treble", 46, T(), [], GRAND_STAFF),
  make("guitar", "Strings", "Classical Guitar", "Gtr.", "treble", 24, T(0, 0, -1), ["nylon guitar"]),
  make("acoustic-guitar-steel", "Strings", "Acoustic Steel Guitar", "A. Gtr.", "treble", 25, T(0, 0, -1)),
  make("electric-guitar-clean", "Strings", "Electric Guitar (clean)", "E. Gtr.", "treble", 27, T(0, 0, -1)),
  make("electric-bass", "Strings", "Electric Bass", "E. Bs.", "bass", 33, T(0, 0, -1), ["bass guitar"]),
  make("mandolin", "Strings", "Mandolin", "Mdn.", "treble", 24),
  make("ukulele", "Strings", "Ukulele", "Uke.", "treble", 24),
  make("hammered-dulcimer", "Strings", "Hammered Dulcimer", "H. Dulc.", "treble", 15),
  make("sitar", "Strings", "Sitar", "Sit.", "treble", 104),
  make("banjo", "Strings", "Banjo", "Bjo.", "treble", 105),
  make("shamisen", "Strings", "Shamisen", "Sham.", "treble", 106),
  make("koto", "Strings", "Koto", "Koto", "treble", 107),
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
