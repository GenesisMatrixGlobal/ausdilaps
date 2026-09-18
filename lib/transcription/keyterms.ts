// Vocabulary Deepgram is prompted with (Nova-3 "keyterm" prompting). Pure.
//
// The Word Transcribe output the team lives with today mishears exactly these words: "yacht"
// for yard, "tile flows" for tile floors, "base station" for vegetation, "print inspection"
// for pre-inspection. Keyterms bias recognition towards them at the source, which is cheaper
// and more reliable than fixing them afterwards. Deepgram caps the whole list at 500 tokens,
// so this stays short and every entry has to earn its place — ordinary English that the model
// already gets right ("wall", "ceiling", "door") is left out.

/** Trade and site vocabulary an inspector actually says on a walk-through. */
export const DICTATION_KEYTERMS: readonly string[] = [
  "dilapidation",
  "pre-inspection",
  "post-inspection",
  "work order",
  "cover photo",
  "cornice",
  "soffit",
  "downpipe",
  "fascia",
  "eaves",
  "gutter",
  "weep holes",
  "render",
  "brickwork",
  "mortar",
  "crossover",
  "driveway",
  "footpath",
  "kerb",
  "boundary fence",
  "retaining wall",
  "hairline cracking",
  "fine cracking",
  "fine gap",
  "spalling",
  "efflorescence",
  "vegetation",
  "yard",
  "west yard",
  "east yard",
  "north yard",
  "south yard",
  "verandah",
  "carport",
  "garage",
  "ensuite",
  "laundry",
  "hallway",
  "entrance hallway",
  "storey",
  "tile floor",
  "carpet floor",
  "timber floor",
  "concrete floor",
  "bathtub",
  "vanity",
  "skirting",
  "architrave",
  "cabinetry",
  "pergola",
  "pool",
  "pit lid",
  "street sign",
  "power pole",
];

const STREET_TYPES: Record<string, string> = {
  st: "Street",
  rd: "Road",
  ave: "Avenue",
  av: "Avenue",
  cres: "Crescent",
  cr: "Crescent",
  ct: "Court",
  dr: "Drive",
  pl: "Place",
  pde: "Parade",
  tce: "Terrace",
  hwy: "Highway",
  cl: "Close",
  ln: "Lane",
  bvd: "Boulevard",
  blvd: "Boulevard",
  cct: "Circuit",
  esp: "Esplanade",
  gr: "Grove",
  wy: "Way",
};

/**
 * Extra keyterms read off the audio's FILE NAME. Inspectors name a recording after the job —
 * "11 Emeraldwood st.mp3", "13 Sunnywood st 2.mp3" — and the street name is the word the
 * transcriber is most likely to invent a homophone for ("Emerald Hood Street"). The house
 * number and a trailing part number are dropped; abbreviations are expanded so the keyterm
 * matches what is actually said.
 */
export function keytermsFor(filename: string): string[] {
  const stem = filename.replace(/\.[a-z0-9]+$/i, "").trim();
  if (!stem) return [];
  const words = stem
    .split(/[\s_\-,.]+/)
    .filter(Boolean)
    // house numbers, unit numbers ("1/48"), part numbers ("2")
    .filter((w) => !/^[\d/]+[a-z]?$/i.test(w));
  if (!words.length) return [];
  const expanded = words.map((w) => STREET_TYPES[w.toLowerCase()] ?? w[0].toUpperCase() + w.slice(1));
  return [expanded.join(" ")];
}

/** The full list for one file, deduplicated, in the order Deepgram will weigh them. */
export function keytermsForFile(filename: string): string[] {
  return Array.from(new Set([...keytermsFor(filename), ...DICTATION_KEYTERMS]));
}
