import { getDictionaryEmbeddings, getPreseedRules, getSimilarityContext, upsertDictionaryEmbeddings } from "@/lib/db";
import { buildArcanoSyllabaryPrompt } from "@/lib/arcano-script";
import { loadSeedDictionary } from "@/lib/seed-dictionary";
import type { DictionaryEntry, RaeLookup, SemanticDictionaryMatch, SimilarDictionaryMatch } from "@/types";

type CohereSuggestion = {
  _reasoning?: string;
  readableText: string;
  pronunciationText?: string;
  glossary?: Array<{
    spanish: string;
    arcano: string;
    category?: string;
    confidence?: number;
  }>;
};

type GlossaryExtractionResponse = {
  _reasoning?: string;
  glossary?: Array<{
    spanish?: string;
    arcano?: string;
    category?: string;
    confidence?: number;
  }>;
};

type CanonicalizationSuggestion = {
  normalizedText: string;
  rationale?: string;
};

type DictionaryOverrideSuggestion = {
  _reasoning?: string;
  spanish: string;
  arcano: string;
  category?: string;
  confidence?: number;
  note?: string;
};

let seedLexiconReferencePromise: Promise<string> | null = null;
let seedLexiconEntriesPromise: Promise<DictionaryEntry[]> | null = null;
const documentEmbeddingCache = new Map<string, number[]>();
// Simple in-memory rate limiter for Qwen: max 60 requests per rolling minute
let qwenRequestTimestamps: number[] = [];

type CohereEmbedResponse = {
  embeddings?: {
    float?: number[][];
  };
};

function getCohereConfig() {
  const apiKey = process.env.COHERE_API_KEY;
  const configuredTemperature = Number.parseFloat(process.env.COHERE_TEMPERATURE ?? "0.3");

  return {
    apiKey,
    model: process.env.COHERE_MODEL ?? "command-r-plus",
    temperature: Number.isFinite(configuredTemperature) ? configuredTemperature : 0.3
  };
}

function getCohereEmbeddingConfig() {
  const configuredOutputDimension = Number.parseInt(process.env.COHERE_EMBED_OUTPUT_DIMENSION ?? "512", 10);

  return {
    apiKey: process.env.COHERE_EMBED_API_KEY ?? process.env.COHERE_API_KEY,
    model: process.env.COHERE_EMBED_MODEL ?? "embed-v4.0",
    outputDimension: Number.isFinite(configuredOutputDimension) ? configuredOutputDimension : 512
  };
}

async function requestCohereJson<T>(prompt: string): Promise<T | null> {
  const { apiKey, model, temperature } = getCohereConfig();

  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Cohere devolvio ${response.status}.`);
  }

  const payload = (await response.json()) as {
    message?: {
      content?: Array<{ type?: string; text?: string }>;
    };
    text?: string;
  };

  const text =
    payload.message?.content?.find((item) => item.type === "text")?.text ??
    payload.message?.content?.[0]?.text ??
    payload.text ??
    "";

  if (!text) {
    return null;
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  return JSON.parse(jsonMatch[0]) as T;
}

function normalizeLooseText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePromptText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeSpanishLookup(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z\s]/g, " ")
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

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function dedupeEntries(entries: DictionaryEntry[]) {
  const seen = new Map<string, DictionaryEntry>();

  for (const entry of entries) {
    const key = `${normalizeSpanishLookup(entry.spanish)}::${entry.arcano}`;

    if (!seen.has(key)) {
      seen.set(key, entry);
    }
  }

  return [...seen.values()];
}

function buildEntryEmbeddingCacheKey(entryId: number, documentText: string) {
  return `entry::${entryId}::${documentText}`;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function computeLexicalRelevance(token: string, entry: DictionaryEntry) {
  const normalizedToken = normalizeSpanishLookup(token);
  const singularToken = singularizeSpanishToken(normalizedToken);
  const entryTerms = normalizeSpanishLookup(entry.spanish)
    .split(/\s+/)
    .filter(Boolean);

  if (entryTerms.length === 0 || !normalizedToken) {
    return 0;
  }

  if (entryTerms.includes(normalizedToken)) {
    return 1;
  }

  if (entryTerms.includes(singularToken)) {
    return 0.96;
  }

  if (entryTerms.some((term) => term.startsWith(singularToken) || singularToken.startsWith(term))) {
    return 0.72;
  }

  return 0;
}

function computeHybridSemanticScore(token: string, entry: DictionaryEntry, embeddingScore: number) {
  const lexicalRelevance = computeLexicalRelevance(token, entry);
  const confidenceBoost = Math.min(0.08, (entry.confidence || 0) * 0.08);

  return embeddingScore * 0.72 + lexicalRelevance * 0.22 + confidenceBoost;
}

function buildEmbeddingDocument(entry: DictionaryEntry) {
  return `${entry.spanish}. categoria: ${entry.category}. arcano: ${entry.arcano}. fuente: ${entry.source}.`;
}

async function requestCohereEmbeddings(texts: string[], inputType: "search_document" | "search_query") {
  const { apiKey, model, outputDimension } = getCohereEmbeddingConfig();

  if (!apiKey || texts.length === 0) {
    return [];
  }

  const response = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Client-Name": "arcania-translator"
    },
    body: JSON.stringify({
      model,
      input_type: inputType,
      texts,
      embedding_types: ["float"],
      output_dimension: outputDimension,
      truncate: "END"
    })
  });

  if (!response.ok) {
    throw new Error(`Cohere embed devolvio ${response.status}.`);
  }

  const payload = (await response.json()) as CohereEmbedResponse;
  return payload.embeddings?.float ?? [];
}

async function getDocumentEmbeddings(texts: string[]) {
  const embeddings: number[][] = new Array(texts.length);
  const missingTexts: string[] = [];
  const missingIndexes: number[] = [];

  texts.forEach((text, index) => {
    const cacheKey = `doc::${text}`;
    const cached = documentEmbeddingCache.get(cacheKey);

    if (cached) {
      embeddings[index] = cached;
      return;
    }

    missingTexts.push(text);
    missingIndexes.push(index);
  });

  if (missingTexts.length > 0) {
    const chunks = chunkArray(missingTexts, 96);
    let consumed = 0;

    for (const chunk of chunks) {
      const chunkEmbeddings = await requestCohereEmbeddings(chunk, "search_document");

      chunk.forEach((text, chunkIndex) => {
        const embedding = chunkEmbeddings[chunkIndex] ?? [];
        const originalIndex = missingIndexes[consumed + chunkIndex];
        documentEmbeddingCache.set(`doc::${text}`, embedding);
        embeddings[originalIndex] = embedding;
      });

      consumed += chunk.length;
    }
  }

  return embeddings.map((embedding) => embedding ?? []);
}

async function getPersistedDocumentEmbeddings(entries: DictionaryEntry[], documentTexts: string[]) {
  const entriesWithIds = entries.filter((entry): entry is DictionaryEntry & { id: number } => typeof entry.id === "number");
  const persistedRows = await getDictionaryEmbeddings(entriesWithIds.map((entry) => entry.id)).catch(() => []);
  const persistedMap = new Map(
    persistedRows.map((row) => [row.dictionaryEntryId, row] as const)
  );
  const { model, outputDimension } = getCohereEmbeddingConfig();
  const resolvedEmbeddings: number[][] = new Array(entries.length);
  const missingTexts: string[] = [];
  const missingIndexes: number[] = [];

  entries.forEach((entry, index) => {
    const documentText = documentTexts[index];

    if (typeof entry.id === "number") {
      const persisted = persistedMap.get(entry.id);

      if (
        persisted &&
        persisted.documentText === documentText &&
        persisted.embeddingModel === model &&
        persisted.embeddingDimension === outputDimension &&
        persisted.embedding.length > 0
      ) {
        const cacheKey = buildEntryEmbeddingCacheKey(entry.id, documentText);
        documentEmbeddingCache.set(cacheKey, persisted.embedding);
        resolvedEmbeddings[index] = persisted.embedding;
        return;
      }

      const cacheKey = buildEntryEmbeddingCacheKey(entry.id, documentText);
      const cached = documentEmbeddingCache.get(cacheKey);

      if (cached && cached.length > 0) {
        resolvedEmbeddings[index] = cached;
        return;
      }
    }

    missingTexts.push(documentText);
    missingIndexes.push(index);
  });

  if (missingTexts.length > 0) {
    const missingEmbeddings = await getDocumentEmbeddings(missingTexts);
    const recordsToPersist: Array<{
      dictionaryEntryId: number;
      embeddingModel: string;
      embeddingDimension: number;
      documentText: string;
      embedding: number[];
    }> = [];

    missingIndexes.forEach((originalIndex, batchIndex) => {
      const entry = entries[originalIndex];
      const documentText = documentTexts[originalIndex];
      const embedding = missingEmbeddings[batchIndex] ?? [];
      resolvedEmbeddings[originalIndex] = embedding;

      if (typeof entry.id === "number" && embedding.length > 0) {
        const cacheKey = buildEntryEmbeddingCacheKey(entry.id, documentText);
        documentEmbeddingCache.set(cacheKey, embedding);
        recordsToPersist.push({
          dictionaryEntryId: entry.id,
          embeddingModel: model,
          embeddingDimension: outputDimension,
          documentText,
          embedding
        });
      }
    });

    if (recordsToPersist.length > 0) {
      await upsertDictionaryEmbeddings(recordsToPersist).catch(() => undefined);
    }
  }

  return resolvedEmbeddings.map((embedding) => embedding ?? []);
}

function heuristicCanonicalizeSpanish(sourceText: string) {
  return normalizeLooseText(sourceText)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/([aeiou])\1+\b/gu, "$1")
    .replace(/([^aeioulr])\1{2,}/gu, "$1")
    .replace(/[!?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGlossary(entries: DictionaryEntry[]) {
  return entries
    .slice(0, 150)
    .map((entry) => `${entry.spanish} => ${entry.arcano}`)
    .join("\n");
}

function buildCategorizedGlossary(entries: DictionaryEntry[]) {
  const grouped = new Map<string, DictionaryEntry[]>();

  for (const entry of entries) {
    const existing = grouped.get(entry.category) ?? [];
    existing.push(entry);
    grouped.set(entry.category, existing);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, categoryEntries]) => {
      const lines = categoryEntries
        .sort((left, right) => left.spanish.localeCompare(right.spanish))
        .map((entry) => `- ${entry.spanish} => ${entry.arcano}`)
        .join("\n");

      return `[${category}]\n${lines}`;
    })
    .join("\n\n");
}

async function getSeedLexiconReference() {
  if (!seedLexiconReferencePromise) {
    seedLexiconReferencePromise = getSeedLexiconEntries()
      .then((entries) => buildCategorizedGlossary(entries))
      .catch(() => "");
  }

  return seedLexiconReferencePromise;
}

async function getSeedLexiconEntries() {
  if (!seedLexiconEntriesPromise) {
    seedLexiconEntriesPromise = loadSeedDictionary().catch(() => []);
  }

  return seedLexiconEntriesPromise;
}

function buildPreseedReference(rules: Array<{ name: string; description: string; content: string }>) {
  if (rules.length === 0) {
    return "No hay reglas preseed activas.";
  }

  return rules
    .map((rule) => `# ${rule.name}\n${rule.description}\n${rule.content}`.trim())
    .join("\n\n");
}

function buildSimilarityReference(matches: SimilarDictionaryMatch[]) {
  if (matches.length === 0) {
    return "No hay coincidencias por similitud >= 60%.";
  }

  return matches
    .map(
      (match) =>
        `- token: ${match.token} | espanol: ${match.spanish} | arcano: ${match.arcano} | similitud: ${match.similarityScore.toFixed(2)} | confianza: ${match.confidence.toFixed(2)}`
    )
    .join("\n");
}

function buildSemanticReference(matches: SemanticDictionaryMatch[]) {
  if (matches.length === 0) {
    return "No hay coincidencias semanticas por embeddings.";
  }

  return matches
    .map(
      (match) =>
        `- token: ${match.token} | espanol: ${match.spanish} | arcano: ${match.arcano} | categoria: ${match.category} | score: ${match.similarityScore.toFixed(2)} | fuente: ${match.source}`
    )
    .join("\n");
}

function buildRaeReference(lookup: RaeLookup | null) {
  if (!lookup) {
    return "No hay definicion publica del DLE para este termino.";
  }

  const definitions = lookup.definitions.length > 0
    ? lookup.definitions.map((definition) => `- ${definition.label}. ${definition.text}`).join("\n")
    : "Sin definiciones breves extraidas.";

  return [lookup.articleTitle ? `Articulo: ${lookup.articleTitle}` : null, definitions].filter(Boolean).join("\n");
}

function buildCandidateSourceTerms(sourceText: string, dictionary: DictionaryEntry[]) {
  const knownSpanish = new Set(dictionary.map((entry) => normalizeSpanishLookup(entry.spanish)).filter(Boolean));
  const unresolved = new Map<string, string>();

  for (const token of normalizeSpanishLookup(sourceText).split(/\s+/).filter(Boolean)) {
    if (token.length < 3) {
      continue;
    }

    const singular = singularizeSpanishToken(token);
    const hasKnownVariant = knownSpanish.has(token) || knownSpanish.has(singular);

    if (hasKnownVariant) {
      continue;
    }

    unresolved.set(token, singular !== token ? `${token} | singular sugerido: ${singular}` : token);
  }

  if (unresolved.size === 0) {
    return "No hay terminos fuente obvios fuera del diccionario exacto.";
  }

  return [...unresolved.values()].map((value) => `- ${value}`).join("\n");
}

async function getSemanticDictionaryContext(sourceText: string, dictionary: DictionaryEntry[]) {
  const { apiKey } = getCohereEmbeddingConfig();

  if (!apiKey) {
    return [] as SemanticDictionaryMatch[];
  }

  const seedEntries = await getSeedLexiconEntries();
  const corpus = dedupeEntries([...dictionary, ...seedEntries]).slice(0, 400);

  if (corpus.length === 0) {
    return [] as SemanticDictionaryMatch[];
  }

  const candidateTerms = [...new Set(normalizeSpanishLookup(sourceText).split(/\s+/).filter(Boolean))]
    .filter((token) => token.length >= 3)
    .flatMap((token) => {
      const singular = singularizeSpanishToken(token);
      return singular !== token ? [token, singular] : [token];
    });
  const uniqueCandidateTerms = [...new Set(candidateTerms)];

  if (uniqueCandidateTerms.length === 0) {
    return [] as SemanticDictionaryMatch[];
  }

  const documentTexts = corpus.map((entry) => buildEmbeddingDocument(entry));
  const [documentEmbeddings, queryEmbeddings] = await Promise.all([
    getPersistedDocumentEmbeddings(corpus, documentTexts),
    requestCohereEmbeddings(uniqueCandidateTerms, "search_query")
  ]);

  const semanticMatches: SemanticDictionaryMatch[] = [];

  uniqueCandidateTerms.forEach((token, tokenIndex) => {
    const queryEmbedding = queryEmbeddings[tokenIndex] ?? [];

    if (queryEmbedding.length === 0) {
      return;
    }

    const rankedMatches = corpus
      .map((entry, entryIndex) => ({
        entry,
        similarityScore: cosineSimilarity(queryEmbedding, documentEmbeddings[entryIndex] ?? []),
        hybridScore: computeHybridSemanticScore(
          token,
          entry,
          cosineSimilarity(queryEmbedding, documentEmbeddings[entryIndex] ?? [])
        )
      }))
      .filter((match) => match.hybridScore >= 0.3 || match.similarityScore >= 0.34)
      .sort((left, right) => right.hybridScore - left.hybridScore)
      .slice(0, 2);

    rankedMatches.forEach((match) => {
      semanticMatches.push({
        token,
        spanish: match.entry.spanish,
        arcano: match.entry.arcano,
        category: match.entry.category,
        source: match.entry.source,
        confidence: match.entry.confidence,
        similarityScore: match.similarityScore
      });
    });
  });

  return semanticMatches;
}

export async function requestCohereTranslation(
  sourceText: string,
  dictionary: DictionaryEntry[]
): Promise<CohereSuggestion | null> {
  const seedLexiconReference = await getSeedLexiconReference();
  const activePreseedRules = await getPreseedRules(true);
  const [similarityContext, semanticContext] = await Promise.all([
    getSimilarityContext(sourceText, 0.6, 3).catch(() => []),
    getSemanticDictionaryContext(sourceText, dictionary).catch(() => [])
  ]);

  const prompt = [
    "Eres un lingüista y traductor experto que traduce español a un idioma ficticio llamado arcano.",
    "Tu referencia principal del idioma es el lexico base curado del proyecto; tratalo como la autoridad semantica y estilistica.",
    buildArcanoSyllabaryPrompt(),
    "DEBES aplicar estrictamente las reglas 'preseed' indicadas abajo, son la máxima autoridad gramatical, sintáctica y ortográfica. Analiza paso a paso si el texto incide sobre ellas.",
    "Si hay tension entre el diccionario runtime y el lexico base, prioriza el lexico base y las reglas preseed.",
    "Responde unicamente con JSON valido, SIN markdown alrededor.",
    "Campos requeridos: '_reasoning' (string: piensa paso a paso considerando preseeds), 'readableText' (string), 'pronunciationText' (string), y 'glossary' (array). Genera _reasoning primero para forzar la reflexión.",
    "Para cada nueva palabra acuñada, en el 'glossary' debes incluir su 'category' (ej. sustantivo, verbo, adjetivo, preposición, etc., como en la RAE).",
    "Si la palabra nueva es directamente influenciada por un preseed o por el lexico, asigna confidence alta (>0.8).",
    "Si propones una palabra nueva fuera del contexto explicito, incluyela en glossary con su confidence estimada y asignale una categoria morfológica util.",
    "glossary debe contener solo terminos realmente nuevos u opciones que ayuden a futuras traducciones. Los terminos en glossary deben venir en espanol canonico.",
    "Prioriza sustantivos, verbos, adjetivos. El plural en arcano u otras construcciones sintacticas deben guiarse estrictamente por las Reglas Custom.",
    "Contexto fuzzy desde Neon con similitud >= 60%:",
    buildSimilarityReference(similarityContext),
    "Contexto semantico por embeddings:",
    buildSemanticReference(semanticContext),
    "Lexico base curado del proyecto:",
    seedLexiconReference || "No disponible.",
    "Diccionario conocido:",
    buildGlossary(dictionary),
    "REGLAS CUSTOM ACTIVAS (PRESEED) - ESTO ES LEY:",
    buildPreseedReference(activePreseedRules),
    "Texto de entrada a traducir:",
    sourceText
  ].join("\n\n");

  return requestCohereJson<CohereSuggestion>(prompt);
}

  export async function requestCohereReverseTranslation(
    sourceText: string,
    dictionary: DictionaryEntry[]
  ): Promise<CohereSuggestion | null> {
    const seedLexiconReference = await getSeedLexiconReference();
    const activePreseedRules = await getPreseedRules(true);
    // Para contexto, usamos arcano como input y español como output
    const prompt = [
      "Eres un lingüista y traductor experto que traduce arcano a español.",
      "Tu referencia principal es el diccionario curado y las reglas preseed. Prioriza la equivalencia exacta, pero si no existe, razona paso a paso para proponer la mejor traducción posible.",
      buildArcanoSyllabaryPrompt(),
      "DEBES aplicar estrictamente las reglas 'preseed' indicadas abajo, son la máxima autoridad gramatical, sintáctica y ortográfica. Analiza paso a paso si el texto incide sobre ellas.",
      "Responde unicamente con JSON valido, SIN markdown alrededor.",
      "Campos requeridos: '_reasoning' (string: piensa paso a paso considerando preseeds), 'readableText' (string: español), 'pronunciationText' (string: español silábico), y 'glossary' (array: nuevas equivalencias arcano→español). Genera _reasoning primero para forzar la reflexión.",
      "Si la palabra arcana no tiene equivalencia exacta, razona y busca la mejor aproximación en español, usando contexto semántico y reglas.",
      "glossary debe contener solo terminos realmente nuevos u opciones que ayuden a futuras traducciones. Los terminos en glossary deben venir en arcano canonico.",
      "Prioriza sustantivos, verbos, adjetivos. El plural u otras construcciones sintácticas deben guiarse estrictamente por las Reglas Custom.",
      "Lexico base curado del proyecto:",
      seedLexiconReference || "No disponible.",
      "Diccionario conocido:",
      buildGlossary(dictionary),
      "REGLAS CUSTOM ACTIVAS (PRESEED) - ESTO ES LEY:",
      buildPreseedReference(activePreseedRules),
      "Texto de entrada arcano a traducir:",
      sourceText
    ].join("\n\n");
    return requestCohereJson<CohereSuggestion>(prompt);
  }

export async function requestCohereGlossaryExtraction(
  sourceText: string,
  translatedText: string,
  dictionary: DictionaryEntry[]
) {
  const seedLexiconReference = await getSeedLexiconReference();
  const activePreseedRules = await getPreseedRules(true);
  const candidateSourceTerms = buildCandidateSourceTerms(sourceText, dictionary);
  const semanticContext = await getSemanticDictionaryContext(sourceText, dictionary).catch(() => []);

  const prompt = [
    "Extrae un glosario util para aprendizaje de un traductor espanol a arcano.",
    buildArcanoSyllabaryPrompt(),
    "Recibes el texto original en espanol y su version traducida al arcano romanizado.",
    "Devuelve solo equivalencias nuevas o realmente utiles que no existan de forma exacta en el diccionario conocido.",
    "Normaliza el espanol: minusculas, sin tildes, sin ruido informal, usualmente singular.",
    "Clasifica cada palabra en 'category' usando las categorías de la RAE (ej. sustantivo, adjetivo, verbo, preposición, pronombre, etc.).",
    "Responde solo JSON valido con el formato {\"_reasoning\":string, \"glossary\":[{\"spanish\":string,\"arcano\":string,\"category\":string,\"confidence\":number}] }.",
    "Genera primero el campo '_reasoning' reflexionando paso a paso sobre qué raíces extraer.",
    "Terminos fuente probablemente no resueltos que conviene cubrir:",
    candidateSourceTerms,
    "Contexto semantico por embeddings:",
    buildSemanticReference(semanticContext),
    "Lexico base curado del proyecto:",
    seedLexiconReference || "No disponible.",
    "Diccionario conocido:",
    buildGlossary(dictionary),
    "Reglas custom activas del proyecto dales peso si afectan formación de palabras:",
    buildPreseedReference(activePreseedRules),
    "Texto original:",
    normalizePromptText(sourceText),
    "Texto traducido:",
    normalizePromptText(translatedText)
  ].join("\n\n");

  const result = await requestCohereJson<GlossaryExtractionResponse>(prompt);
  return result?.glossary ?? [];
}

export async function requestCohereDictionaryOverrideSuggestion(params: {
  sourceText: string;
  token: string;
  canonicalToken: string;
  localEntries: DictionaryEntry[];
  rae: RaeLookup | null;
  dictionary: DictionaryEntry[];
}) {
  const seedLexiconReference = await getSeedLexiconReference();
  const activePreseedRules = await getPreseedRules(true);
  const semanticContext = await getSemanticDictionaryContext(params.sourceText, params.dictionary).catch(() => []);

  const prompt = [
    "Diseña una entrada custom para el diccionario de un idioma ficticio llamado arcano.",
    buildArcanoSyllabaryPrompt(),
    "Esta entrada se usara como override editorial local y debe tener prioridad sobre la referencia publica del DLE para este termino.",
    "Debes proponer una sola entrada reusable, clara y consistente con el lexico base del proyecto.",
    "No expliques en prosa fuera del JSON. Responde solo JSON valido con el formato {\"_reasoning\":string, \"spanish\":string,\"arcano\":string,\"category\":string,\"confidence\":number,\"note\":string }.",
    "Genera primero el campo '_reasoning' detallando por qué eliges esa traducción y categoría.",
    "Usa en 'category' las categorías gramaticales estándar de la RAE (sustantivo, verbo, adjetivo, pronombre, etc.).",
    "Usa como spanish el canonico mas reutilizable, normalmente singular y sin ruido.",
    "Termino observado:",
    `token: ${params.token}`,
    `canonico: ${params.canonicalToken}`,
    "Contexto original:",
    params.sourceText,
    "Entradas locales relacionadas:",
    buildGlossary(params.localEntries),
    "Referencia DLE / RAE:",
    buildRaeReference(params.rae),
    "Contexto semantico por embeddings:",
    buildSemanticReference(semanticContext),
    "Lexico base curado del proyecto:",
    seedLexiconReference || "No disponible.",
    "Diccionario conocido:",
    buildGlossary(params.dictionary),
    "Reglas custom activas del proyecto:",
    buildPreseedReference(activePreseedRules)
  ].join("\n\n");

  return requestCohereJson<DictionaryOverrideSuggestion>(prompt);
}

export async function canonicalizeSpanishInput(sourceText: string) {
  const heuristicText = heuristicCanonicalizeSpanish(sourceText);
  const prompt = [
    "Normaliza una entrada de usuario en espanol antes de traducirla.",
    "Corrige repeticiones expresivas, alargamientos y ruido informal.",
    "Ejemplo: holaa => hola, graaaacias => gracias.",
    "No traduzcas. No resumas. Solo devuelve espanol canonico y legible.",
    "Responde unicamente con JSON valido con el campo normalizedText.",
    "Texto original:",
    sourceText,
    "Normalizacion heuristica inicial:",
    heuristicText
  ].join("\n\n");

  const result = await requestCohereJson<CanonicalizationSuggestion>(prompt).catch(() => null);
  const normalizedCandidate = normalizeLooseText(result?.normalizedText);
  return normalizedCandidate ? heuristicCanonicalizeSpanish(normalizedCandidate) : heuristicText;
}