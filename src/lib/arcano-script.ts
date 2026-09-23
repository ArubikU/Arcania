const GLYPH_HEX: Record<string, string> = {
  a: "4E4E4",
  i: "4F4F4",
  u: "55522",
  e: "F4E4F",
  o: "75557",
  ka: "4FE44",
  ki: "2BEB2",
  ku: "55F55",
  ke: "BFBFA",
  ko: "64E46",
  sa: "74647",
  si: "22F22",
  su: "55711",
  se: "11755",
  so: "71747",
  ta: "44EAA",
  ti: "44E44",
  tu: "A444A",
  te: "A4E4A",
  to: "EE4EE",
  na: "9D579",
  ni: "9D5D9",
  nu: "95759",
  ne: "97579",
  no: "95D59",
  ma: "BB0BB",
  mi: "BBFBB",
  mu: "52525",
  me: "DF0DF",
  mo: "75757",
  ra: "74647",
  ri: "71617",
  ru: "55744",
  re: "44755",
  ro: "71717",
  ya: "F999F",
  yu: "55557",
  yo: "75744",
  wa: "5555F"
};

export const ARCANO_ALLOWED_SYLLABLES = [
  "a",
  "i",
  "u",
  "e",
  "o",
  "ka",
  "ki",
  "ku",
  "ke",
  "ko",
  "sa",
  "si",
  "su",
  "se",
  "so",
  "ta",
  "ti",
  "tu",
  "te",
  "to",
  "na",
  "ni",
  "nu",
  "ne",
  "no",
  "ma",
  "mi",
  "mu",
  "me",
  "mo",
  "ra",
  "ri",
  "ru",
  "re",
  "ro",
  "ya",
  "yu",
  "yo",
  "wa",
  "n"
] as const;

const ARCANO_MATCH_ORDER = [...ARCANO_ALLOWED_SYLLABLES].sort((left, right) => right.length - left.length);

const PLACEHOLDER_HEX = "F999F";
const VOICED_FALLBACKS: Record<string, string> = {
  ga: "ka",
  gi: "ki",
  gu: "ku",
  ge: "ke",
  go: "ko",
  za: "sa",
  zi: "si",
  zu: "su",
  ze: "se",
  zo: "so",
  da: "ta",
  di: "ti",
  du: "tu",
  de: "te",
  do: "to",
  ba: "wa",
  bi: "i",
  bu: "u",
  be: "e",
  bo: "o",
  pa: "wa",
  pi: "i",
  pu: "u",
  pe: "e",
  po: "o"
};

const BLOCK = "█";
const EMPTY = " ";

export type ArcanoGlyph = {
  syllable: string;
  rows: string[];
  missing: boolean;
};

export type ArcanoWord = {
  raw: string;
  glyphs: ArcanoGlyph[];
};

function hexToRows(hex: string) {
  return hex
    .toUpperCase()
    .split("")
    .map((char) => {
      const bits = Number.parseInt(char, 16).toString(2).padStart(4, "0");
      return bits.slice(-4).padStart(5, "0").replaceAll("0", EMPTY).replaceAll("1", BLOCK);
    });
}

function sanitizeWord(word: string) {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z]/g, "");
}

function normalizeArcanoChunk(value: string) {
  return value
    .replace(/shi/g, "si")
    .replace(/chi/g, "ti")
    .replace(/tsu/g, "tu")
    .replace(/ji/g, "si")
    .replace(/ja/g, "ya")
    .replace(/ju/g, "yu")
    .replace(/jo/g, "yo");
}

export function buildArcanoSyllabaryPrompt() {
  return [
    "Silabario permitido del arcano romanizado:",
    "A, I, U, E, O",
    "Ka, Ki, Ku, Ke, Ko",
    "Sa, Si, Su, Se, So",
    "Ta, Ti, Tu, Te, To",
    "Na, Ni, Nu, Ne, No",
    "Ma, Mi, Mu, Me, Mo",
    "Ra, Ri, Ru, Re, Ro",
    "Ya, Yu, Yo",
    "Wa",
    "N",
    "Toda palabra arcana debe poder segmentarse solo con esas silabas. Evita ga, ji, sha, cho y cualquier romanizacion fuera de ese inventario."
  ].join("\n");
}

export function normalizeArcanoRomanizedWord(word: string) {
  return normalizeArcanoChunk(sanitizeWord(word))
    .replace(/ga/g, "ka")
    .replace(/gi/g, "ki")
    .replace(/gu/g, "ku")
    .replace(/ge/g, "ke")
    .replace(/go/g, "ko")
    .replace(/za/g, "sa")
    .replace(/zi/g, "si")
    .replace(/zu/g, "su")
    .replace(/ze/g, "se")
    .replace(/zo/g, "so")
    .replace(/da/g, "ta")
    .replace(/di/g, "ti")
    .replace(/du/g, "tu")
    .replace(/de/g, "te")
    .replace(/do/g, "to")
    .replace(/ba/g, "wa")
    .replace(/be/g, "e")
    .replace(/bi/g, "i")
    .replace(/bo/g, "o")
    .replace(/bu/g, "u")
    .replace(/pa/g, "wa")
    .replace(/pe/g, "e")
    .replace(/pi/g, "i")
    .replace(/po/g, "o")
    .replace(/pu/g, "u");
}

export function isValidArcanoWord(word: string) {
  const normalized = normalizeArcanoRomanizedWord(word);

  if (!normalized) {
    return false;
  }

  let index = 0;

  while (index < normalized.length) {
    const nextSyllable = ARCANO_MATCH_ORDER.find((syllable) => normalized.startsWith(syllable, index));

    if (!nextSyllable) {
      return false;
    }

    index += nextSyllable.length;
  }

  return true;
}

export function splitArcanoSyllables(word: string) {
  const normalized = normalizeArcanoRomanizedWord(word);
  const syllables: string[] = [];
  let index = 0;

  while (index < normalized.length) {
    const nextSyllable = ARCANO_MATCH_ORDER.find((syllable) => normalized.startsWith(syllable, index));

    if (nextSyllable) {
      syllables.push(nextSyllable);
      index += nextSyllable.length;
      continue;
    }

    syllables.push(normalized[index]);
    index += 1;
  }

  return syllables;
}

function syllableToRows(syllable: string) {
  const resolved = GLYPH_HEX[syllable] ?? GLYPH_HEX[VOICED_FALLBACKS[syllable]] ?? PLACEHOLDER_HEX;
  return hexToRows(resolved);
}

export function toArcanoGlyphWords(text: string): ArcanoWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({
      raw: word,
      glyphs: splitArcanoSyllables(word).map((syllable) => ({
        syllable,
        rows: syllableToRows(syllable),
        missing: !GLYPH_HEX[syllable] && !VOICED_FALLBACKS[syllable]
      }))
    }));
}

export function toPronunciation(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => splitArcanoSyllables(word).join("-"))
    .join(" ");
}

export function toArcanoBlocks(text: string) {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "";
  }

  const renderedWords = words.map((word) => {
    const syllables = splitArcanoSyllables(word);
    const rows = Array.from({ length: 5 }, () => "");

    for (const syllable of syllables) {
      const glyphRows = syllableToRows(syllable);
      for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
        rows[rowIndex] += `${glyphRows[rowIndex]} `;
      }
    }

    return rows.map((row) => row.trimEnd());
  });

  const outputRows = Array.from({ length: 5 }, () => "");

  for (const wordRows of renderedWords) {
    for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
      outputRows[rowIndex] += `${wordRows[rowIndex]}   `;
    }
  }

  return outputRows.map((row) => row.trimEnd()).join("\n");
}