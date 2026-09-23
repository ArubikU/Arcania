import {
  canonicalizeSpanishInput,
  requestCohereGlossaryExtraction,
  requestCohereTranslation,
  requestCohereReverseTranslation,
  requestCohereRationale,
  requestQwenBuild,
  buildGlossary
} from "@/lib/cohere";
import { getDictionary, getSimilarExistingEntries, incrementUsage, upsertDictionaryEntries } from "@/lib/db";
import { ensureEmbeddingsForEntries } from "@/lib/dictionary-embeddings";
import { isValidArcanoWord, normalizeArcanoRomanizedWord, toArcanoBlocks, toPronunciation } from "@/lib/arcano-script";
import type { DictionaryEntry, TranslationIndexingResult, TranslationResult } from "@/types";

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizeSpanishText(value: string) {
  return normalize(value)
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenizeArcanoText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeArcanoText(value: string) {
  return String(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => normalizeArcanoRomanizedWord(word))
    .filter(Boolean)
    .join(" ");
}

function isValidArcanoText(value: string) {
  const words = String(value ?? "")
    .split(/\s+/)
    .filter(Boolean);

  return words.length > 0 && words.every((word) => isValidArcanoWord(word));
}

function getEntryPriority(entry: DictionaryEntry) {
  if (entry.source.includes("override")) {
    return 3;
  }

  if (entry.source === "manual") {
    return 2;
  }

  if (entry.source === "runtime-ai") {
    return 1;
  }

  return 0;
}

function pickBestExactEntry(dictionary: DictionaryEntry[], spanish: string) {
  return [...dictionary]
    .filter((entry) => entry.spanish === spanish)
    .sort((left, right) => {
      const priorityDelta = getEntryPriority(right) - getEntryPriority(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const usageDelta = (right.usageCount ?? 0) - (left.usageCount ?? 0);
      if (usageDelta !== 0) {
        return usageDelta;
      }

      return right.confidence - left.confidence;
    })[0];
}

function pickBestExactArcanoEntry(dictionary: DictionaryEntry[], arcano: string) {
  return [...dictionary]
    .filter((entry) => tokenizeArcanoText(entry.arcano).join(" ") === arcano)
    .sort((left, right) => {
      const priorityDelta = getEntryPriority(right) - getEntryPriority(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const usageDelta = (right.usageCount ?? 0) - (left.usageCount ?? 0);
      if (usageDelta !== 0) {
        return usageDelta;
      }

      return right.confidence - left.confidence;
    })[0];
}

function tryDirectDictionaryTranslation(sourceText: string, dictionary: DictionaryEntry[]) {
  const normalizedText = normalize(sourceText);
  const directPhraseEntry = pickBestExactEntry(dictionary, normalizedText);

  if (directPhraseEntry) {
    return {
      readableText: directPhraseEntry.arcano,
      usedEntries: [directPhraseEntry]
    };
  }

  const words = tokenizeSpanishText(normalizedText);

  if (words.length === 0 || words.length > 3) {
    return null;
  }

  const usedEntries: DictionaryEntry[] = [];
  const translatedWords: string[] = [];

  for (const word of words) {
    const entry = pickBestExactEntry(dictionary, word);

    if (!entry) {
      return null;
    }

    usedEntries.push(entry);
    translatedWords.push(entry.arcano);
  }

  return {
    readableText: translatedWords.join(" "),
    usedEntries
  };
}

function buildFallbackTranslation(sourceText: string, dictionary: DictionaryEntry[]) {
  const normalizedText = normalize(sourceText);
  const sortedEntries = [...dictionary].sort((left, right) => right.spanish.length - left.spanish.length);

  let readableText = ` ${normalizedText} `;
  const usedEntries: DictionaryEntry[] = [];

  for (const entry of sortedEntries) {
    const pattern = new RegExp(`(^|[^a-z])${escapeRegex(entry.spanish)}(?=[^a-z]|$)`, "g");
    const replaced = readableText.replace(pattern, (_match, prefix) => {
      usedEntries.push(entry);
      return `${prefix}${entry.arcano}`;
    });

    readableText = replaced;
  }

  readableText = readableText.replace(/\s+/g, " ").trim();
  return { readableText, usedEntries };
}

function tryDirectDictionaryReverseTranslation(sourceText: string, dictionary: DictionaryEntry[]) {
  const normalizedArcanoText = normalizeArcanoText(sourceText);
  const directPhraseEntry = pickBestExactArcanoEntry(dictionary, normalizedArcanoText);

  if (directPhraseEntry) {
    return {
      readableText: directPhraseEntry.spanish,
      usedEntries: [directPhraseEntry]
    };
  }

  const words = tokenizeArcanoText(normalizedArcanoText);

  if (words.length === 0 || words.length > 4) {
    return null;
  }

  const usedEntries: DictionaryEntry[] = [];
  const translatedWords: string[] = [];

  for (const word of words) {
    const entry = pickBestExactArcanoEntry(dictionary, word);

    if (!entry) {
      return null;
    }

    usedEntries.push(entry);
    translatedWords.push(entry.spanish);
  }

  return {
    readableText: translatedWords.join(" "),
    usedEntries
  };
}

function buildFallbackReverseTranslation(sourceText: string, dictionary: DictionaryEntry[]) {
  const normalizedArcanoText = normalizeArcanoText(sourceText);
  const sortedEntries = [...dictionary].sort((left, right) => right.arcano.length - left.arcano.length);

  let readableText = ` ${normalizedArcanoText} `;
  const usedEntries: DictionaryEntry[] = [];

  for (const entry of sortedEntries) {
    const normalizedArcanoEntry = normalizeArcanoText(entry.arcano);

    if (!normalizedArcanoEntry) {
      continue;
    }

    const pattern = new RegExp(`(^|[^a-z])${escapeRegex(normalizedArcanoEntry)}(?=[^a-z]|$)`, "g");
    const replaced = readableText.replace(pattern, (_match, prefix) => {
      usedEntries.push(entry);
      return `${prefix}${entry.spanish}`;
    });

    readableText = replaced;
  }

  readableText = readableText.replace(/\s+/g, " ").trim();
  return { readableText, usedEntries };
}

function sanitizeLearnedEntries(glossary: TranslationResult["learnedTerms"]) {
  const seen = new Map<string, DictionaryEntry>();

  for (const entry of glossary) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const spanish = normalize(entry.spanish);
    const arcano = normalizeArcanoRomanizedWord(normalize(entry.arcano));

    if (!spanish || !arcano || !arcano.split(/\s+/).every((word) => isValidArcanoWord(word))) {
      continue;
    }

    seen.set(`${spanish}::${arcano}`, {
      spanish,
      arcano,
      pronunciation: toPronunciation(arcano),
      category: entry.category || "runtime",
      source: entry.source || "runtime-ai",
      confidence: Math.max(0.1, Math.min(1, entry.confidence || 0.65))
    });
  }

  return [...seen.values()];
}

function hasExactSpanishEntry(dictionary: DictionaryEntry[], spanish: string) {
  return dictionary.some((entry) => entry.spanish === spanish);
}

function getUsedEntriesForReadableText(readableText: string, dictionary: DictionaryEntry[]) {
  const readableTokens = tokenizeArcanoText(readableText);
  const sortedDictionary = [...dictionary].sort((left, right) => {
    const lengthDelta = tokenizeArcanoText(right.arcano).length - tokenizeArcanoText(left.arcano).length;

    if (lengthDelta !== 0) {
      return lengthDelta;
    }

    return right.arcano.length - left.arcano.length;
  });
  const seen = new Set<string>();
  const matchedEntries: DictionaryEntry[] = [];

  for (const entry of sortedDictionary) {
    const arcanoTokens = tokenizeArcanoText(entry.arcano);

    if (arcanoTokens.length === 0 || arcanoTokens.length > readableTokens.length) {
      continue;
    }

    for (let index = 0; index <= readableTokens.length - arcanoTokens.length; index += 1) {
      const isMatch = arcanoTokens.every((token, tokenIndex) => readableTokens[index + tokenIndex] === token);

      if (!isMatch) {
        continue;
      }

      const key = `${entry.id ?? "no-id"}::${entry.spanish}::${entry.arcano}`;

      if (!seen.has(key)) {
        seen.add(key);
        matchedEntries.push(entry);
      }

      break;
    }
  }

  return matchedEntries;
}

async function applySimilarityPenalty(glossary: DictionaryEntry[]) {
  const adjustedEntries: DictionaryEntry[] = [];

  for (const entry of glossary) {
    const similarEntries = await getSimilarExistingEntries(entry.spanish, 0.8, 3).catch(() => []);
    const hasSimilarExistingEntry = similarEntries.some((similarEntry) => similarEntry.spanish !== entry.spanish);

    adjustedEntries.push({
      ...entry,
      confidence: hasSimilarExistingEntry ? Math.max(0.1, entry.confidence - 0.05) : entry.confidence
    });
  }

  return adjustedEntries;
}

export async function translateSpanishToArcano(sourceText: string): Promise<TranslationResult> {
  const immediateSourceText = String(sourceText ?? "").trim();
  const dictionary = await getDictionary();
  const directDictionaryTranslation = tryDirectDictionaryTranslation(immediateSourceText, dictionary);

  if (directDictionaryTranslation) {
    await incrementUsage(directDictionaryTranslation.usedEntries);

    const pronunciationText = toPronunciation(directDictionaryTranslation.readableText);
    const arcanoText = toArcanoBlocks(directDictionaryTranslation.readableText);

    return {
      sourceText,
      normalizedSourceText: immediateSourceText,
      readableText: directDictionaryTranslation.readableText,
      pronunciationText,
      arcanoText,
      learnedTerms: [],
      usedEntries: directDictionaryTranslation.usedEntries,
      model: "dictionary"
    };
  }

  const fallback = buildFallbackTranslation(immediateSourceText, dictionary);

  let readableText = fallback.readableText;
  let usedEntries = fallback.usedEntries;
  let model: TranslationResult["model"] = usedEntries.length > 0 ? "dictionary" : "fallback";

  // Get short rationale and then prefer Qwen builder if configured; otherwise use Cohere
  const rationale = await requestCohereRationale(immediateSourceText, "es-to-arc", dictionary, 0.6).catch(() => "");

  // Try Qwen builder first (allows more context, accepts lower similarity)
  try {
    const qwenResult: any = await requestQwenBuild(
      `Rationale: ${rationale}\n\nContext dictionary: ${buildGlossary(dictionary).slice(0, 2000)}\n\nFallback: ${fallback.readableText}\n\nInput: ${immediateSourceText}`
    ).catch(() => null);

    if (qwenResult) {
      const text = typeof qwenResult === "string" ? qwenResult : qwenResult.text ?? qwenResult.readableText ?? null;
      if (text) {
        const candidateReadableText = normalizeArcanoText(normalize(String(text)).replace(/\s+/g, " ").trim());
        if (isValidArcanoText(candidateReadableText)) {
          readableText = candidateReadableText;
          usedEntries = getUsedEntriesForReadableText(readableText, dictionary);
          model = "cohere"; // mark as AI-generated; builder-specific label not required
        }
      }
    }
  } catch (err) {
    // Qwen failed (rate limit or other). Fallback to Cohere builder.
  }

  if (model !== "cohere" && usedEntries.length === 0) {
    const cohereResponse = await requestCohereTranslation(immediateSourceText, dictionary, { rationale }).catch(() => null);

    if (cohereResponse?.readableText) {
      const candidateReadableText = normalizeArcanoText(normalize(cohereResponse.readableText).replace(/\s+/g, " ").trim());

      if (isValidArcanoText(candidateReadableText)) {
        readableText = candidateReadableText;
        usedEntries = getUsedEntriesForReadableText(readableText, dictionary);
        model = "cohere";
      }
    }
  }

  if (usedEntries.length > 0) {
    await incrementUsage(usedEntries);
  }

  const pronunciationText = toPronunciation(readableText);
  const arcanoText = toArcanoBlocks(readableText);

  return {
    sourceText,
    normalizedSourceText: immediateSourceText,
    readableText,
    pronunciationText,
    arcanoText,
    learnedTerms: [],
    usedEntries,
    model
  };
}

export async function translateArcanoToSpanish(sourceText: string): Promise<TranslationResult> {
  const immediateSourceText = String(sourceText ?? "").trim();
  const dictionary = await getDictionary();
  const directDictionaryTranslation = tryDirectDictionaryReverseTranslation(immediateSourceText, dictionary);

  if (directDictionaryTranslation) {
    await incrementUsage(directDictionaryTranslation.usedEntries);

    return {
      sourceText,
      normalizedSourceText: normalizeArcanoText(immediateSourceText),
      readableText: directDictionaryTranslation.readableText,
      pronunciationText: directDictionaryTranslation.readableText,
      arcanoText: immediateSourceText,
      learnedTerms: [],
      usedEntries: directDictionaryTranslation.usedEntries,
      model: "dictionary"
    };
  }

  const fallback = buildFallbackReverseTranslation(immediateSourceText, dictionary);

  if (fallback.usedEntries.length > 0) {
    await incrementUsage(fallback.usedEntries);
  }

  let readableText = fallback.readableText;
  let usedEntries = fallback.usedEntries;
  let model: TranslationResult["model"] = usedEntries.length > 0 ? "dictionary" : "fallback";

  // If no entries, run rationale + builder (Qwen preferred) then Cohere fallback
  if (usedEntries.length === 0) {
    const rationale = await requestCohereRationale(immediateSourceText, "arc-to-es", dictionary, 0.5).catch(() => "");

    try {
      const qwenResult: any = await requestQwenBuild(
        `Rationale: ${rationale}\n\nContext dictionary: ${buildGlossary(dictionary).slice(0,2000)}\n\nFallback: ${fallback.readableText}\n\nInput arcano: ${immediateSourceText}`
      ).catch(() => null);

      if (qwenResult) {
        const text = typeof qwenResult === "string" ? qwenResult : qwenResult.text ?? qwenResult.readableText ?? null;
        if (text) {
          readableText = String(text).trim();
          usedEntries = [];
          model = "cohere";
        }
      }
    } catch (err) {
      // qwen failed or rate limited
    }

    if (model !== "cohere") {
      const cohereResponse = await requestCohereReverseTranslation(immediateSourceText, dictionary, { rationale, similarityThreshold: 0.6 }).catch(() => null);
      if (cohereResponse?.readableText) {
        readableText = cohereResponse.readableText;
        usedEntries = [];
        model = "cohere";
      }
    }
  }

  return {
    sourceText,
    normalizedSourceText: normalizeArcanoText(immediateSourceText),
    readableText,
    pronunciationText: readableText,
    arcanoText: immediateSourceText,
    learnedTerms: [],
    usedEntries,
    model
  };
}

export async function indexTranslationArtifacts(
  sourceText: string,
  readableText: string
): Promise<TranslationIndexingResult> {
  const normalizedSourceText = await canonicalizeSpanishInput(sourceText).catch(() => normalize(sourceText));
  const dictionary = await getDictionary();
  const extractedGlossary = await requestCohereGlossaryExtraction(normalizedSourceText, readableText, dictionary).catch(() => []);

  const glossary = sanitizeLearnedEntries(
    extractedGlossary
      .map((entry) => ({
        spanish: normalize(entry?.spanish),
        arcano: normalize(entry?.arcano),
        pronunciation: normalize(entry?.arcano),
        category: normalize(entry?.category ?? "runtime") || "runtime",
        source: "runtime-ai",
        confidence: typeof entry?.confidence === "number" ? entry.confidence : 0.6
      }))
      .filter((entry) => entry.spanish && entry.arcano && !hasExactSpanishEntry(dictionary, entry.spanish))
  );

  const learnedTerms =
    glossary.length > 0 ? await upsertDictionaryEntries(await applySimilarityPenalty(glossary)) : [];

  if (learnedTerms.length > 0) {
    await ensureEmbeddingsForEntries(learnedTerms).catch(() => undefined);
  }

  if (learnedTerms.length > 0) {
    await incrementUsage(learnedTerms);
  }

  const updatedDictionary = learnedTerms.length > 0 ? [...dictionary, ...learnedTerms] : dictionary;

  return {
    normalizedSourceText,
    learnedTerms,
    usedEntries: getUsedEntriesForReadableText(readableText, updatedDictionary)
  };
}