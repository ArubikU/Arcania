import { isValidArcanoWord, normalizeArcanoRomanizedWord, toPronunciation } from "@/lib/arcano-script";
import { requestCohereDictionaryOverrideSuggestion } from "@/lib/cohere";
import { ensureEmbeddingsForEntries } from "@/lib/dictionary-embeddings";
import { getDictionary, getRaeOverrides, upsertDictionaryEntries, upsertRaeOverride } from "@/lib/db";
import type { DictionaryEntry, RaeAnalysisResult, RaeDefinition, RaeLookup, RaeTermAnalysis } from "@/types";

const SPANISH_STOPWORDS = new Set([
  "a",
  "al",
  "algo",
  "algun",
  "alguna",
  "algunas",
  "algunos",
  "ante",
  "bajo",
  "cada",
  "como",
  "con",
  "contra",
  "cual",
  "cuales",
  "cuando",
  "de",
  "del",
  "desde",
  "donde",
  "dos",
  "el",
  "ella",
  "ellas",
  "ellos",
  "en",
  "entre",
  "era",
  "erais",
  "eran",
  "eras",
  "eres",
  "es",
  "esa",
  "esas",
  "ese",
  "eso",
  "esos",
  "esta",
  "estaba",
  "estado",
  "estan",
  "estar",
  "este",
  "esto",
  "estos",
  "fue",
  "fueron",
  "ha",
  "han",
  "hasta",
  "hay",
  "la",
  "las",
  "le",
  "les",
  "lo",
  "los",
  "mas",
  "me",
  "mi",
  "mis",
  "muy",
  "no",
  "nos",
  "nuestra",
  "nuestro",
  "o",
  "otra",
  "otro",
  "para",
  "pero",
  "por",
  "que",
  "quien",
  "se",
  "ser",
  "si",
  "sin",
  "sobre",
  "su",
  "sus",
  "te",
  "tiene",
  "tienen",
  "tu",
  "un",
  "una",
  "uno",
  "unos",
  "y",
  "ya"
]);

function normalizeSpanish(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpanishDisplay(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeSpanishToken(token: string) {
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&uuml;/g, "ü")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&iexcl;/g, "¡")
    .replace(/&iquest;/g, "¿")
    .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hexCodePoint) => String.fromCodePoint(Number.parseInt(hexCodePoint, 16)));
}

function toPlainText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDefinitions(text: string) {
  const flattened = text.replace(/\s+/g, " ").trim();
  const definitionAnchor = flattened.match(/Definici[oó]n\s+(.*)/i);
  const definitionText = definitionAnchor ? definitionAnchor[1] : flattened;
  const definitions: RaeDefinition[] = [];
  const matches = definitionText.matchAll(/(\d+)\.\s+(.+?)(?=\s+\d+\.\s+|\s+Sinonimos|\s+Sin[oó]nimos|\s+Ant[oó]nimos|\s+Informaci[oó]n|$)/g);

  for (const match of matches) {
    const label = match[1];
    const textValue = match[2]?.trim();

    if (!textValue) {
      continue;
    }

    definitions.push({
      label,
      text: textValue.slice(0, 320)
    });

    if (definitions.length >= 3) {
      break;
    }
  }

  return definitions;
}

async function fetchRaeLookup(term: string): Promise<RaeLookup | null> {
  const url = `https://dle.rae.es/${encodeURIComponent(term)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ArcaniaTranslator/1.0"
    },
    cache: "no-store"
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const html = await response.text();
  const plainText = toPlainText(html);
  const titleMatch = plainText.match(/^(.*?)\s+Definici[oó]n/i);
  const articleTitle = titleMatch?.[1]?.trim() || null;
  const definitions = extractDefinitions(plainText);

  return {
    query: term,
    resolvedTerm: term,
    articleTitle,
    definitions,
    sourceUrl: url
  };
}

function getCandidateTerms(sourceText: string) {
  const tokens = normalizeSpanishDisplay(sourceText).split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const candidates: Array<{ token: string; canonicalToken: string }> = [];

  for (const token of tokens) {
    const canonicalToken = singularizeSpanishToken(normalizeSpanish(token));

    if (canonicalToken.length < 3 || SPANISH_STOPWORDS.has(canonicalToken)) {
      continue;
    }

    const dedupeKey = canonicalToken;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    candidates.push({ token, canonicalToken });
  }

  return candidates.slice(0, 12);
}

function getLocalEntries(token: string, canonicalToken: string, dictionary: DictionaryEntry[]) {
  return dictionary
    .filter((entry) => {
      const normalizedSpanish = normalizeSpanish(entry.spanish);
      return normalizedSpanish === token || normalizedSpanish === canonicalToken;
    })
    .sort((left, right) => {
      const leftPriority = left.source.includes("override") ? 1 : 0;
      const rightPriority = right.source.includes("override") ? 1 : 0;
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }

      const usageDelta = (right.usageCount ?? 0) - (left.usageCount ?? 0);
      if (usageDelta !== 0) {
        return usageDelta;
      }

      return right.confidence - left.confidence;
    })
    .slice(0, 8);
}

export async function analyzeSpanishWithRae(sourceText: string): Promise<RaeAnalysisResult> {
  const dictionary = await getDictionary();
  const candidates = getCandidateTerms(sourceText);
  const overrides = await getRaeOverrides(candidates.flatMap((candidate) => [candidate.token, candidate.canonicalToken]));
  const overrideMap = new Map<string, (typeof overrides)[number]>();

  for (const override of overrides) {
    overrideMap.set(override.token, override);
    overrideMap.set(override.canonicalToken, override);
  }

  const terms: RaeTermAnalysis[] = [];

  for (const candidate of candidates) {
    const localEntries = getLocalEntries(candidate.token, candidate.canonicalToken, dictionary);
    const override = overrideMap.get(candidate.token) ?? overrideMap.get(candidate.canonicalToken) ?? null;
    const rae =
      (await fetchRaeLookup(candidate.token)) ??
      (candidate.canonicalToken !== candidate.token ? await fetchRaeLookup(candidate.canonicalToken) : null);

    terms.push({
      token: candidate.token,
      canonicalToken: candidate.canonicalToken,
      localEntries,
      rae,
      override
    });
  }

  return {
    sourceText,
    terms
  };
}

export async function createRaeOverrideEntry(sourceText: string, token: string, canonicalToken: string) {
  const dictionary = await getDictionary();
  const localEntries = getLocalEntries(token, canonicalToken, dictionary);
  const rae = (await fetchRaeLookup(token)) ?? (canonicalToken !== token ? await fetchRaeLookup(canonicalToken) : null);
  const suggestion = await requestCohereDictionaryOverrideSuggestion({
    sourceText,
    token,
    canonicalToken,
    localEntries,
    rae,
    dictionary
  });

  const spanish = normalizeSpanish(suggestion?.spanish || canonicalToken || token);
  const arcano = normalizeArcanoRomanizedWord(normalizeSpanish(suggestion?.arcano || ""));

  if (!spanish || !arcano || !arcano.split(/\s+/).every((word) => isValidArcanoWord(word))) {
    throw new Error("La IA no devolvio una entrada override valida.");
  }

  const [entry] = await upsertDictionaryEntries([
    {
      spanish,
      arcano,
      pronunciation: toPronunciation(arcano),
      category: normalizeSpanish(suggestion?.category || "concepto") || "concepto",
      source: "rae-override-ai",
      confidence: Math.max(0.7, Math.min(1, Number(suggestion?.confidence ?? 0.95)))
    }
  ]);

  if (!entry?.id) {
    throw new Error("No se pudo persistir la entrada override.");
  }

  await ensureEmbeddingsForEntries([entry]).catch(() => undefined);

  await upsertRaeOverride(token, canonicalToken, entry.id, String(suggestion?.note ?? "Override editorial generado con IA."));

  return {
    entry,
    analysis: await analyzeSpanishWithRae(sourceText)
  };
}
