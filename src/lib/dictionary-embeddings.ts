import {
  getDictionaryByIds,
  getDictionaryEntriesMissingEmbeddings,
  upsertDictionaryEmbeddings
} from "@/lib/db";
import type { DictionaryEntry } from "@/types";

function getEmbeddingConfig() {
  const configuredOutputDimension = Number.parseInt(process.env.COHERE_EMBED_OUTPUT_DIMENSION ?? "512", 10);

  return {
    apiKey: process.env.COHERE_EMBED_API_KEY ?? process.env.COHERE_API_KEY,
    model: process.env.COHERE_EMBED_MODEL ?? "embed-v4.0",
    outputDimension: Number.isFinite(configuredOutputDimension) ? configuredOutputDimension : 512
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildEmbeddingDocument(entry: DictionaryEntry) {
  return `${entry.spanish}. categoria: ${entry.category}. arcano: ${entry.arcano}. fuente: ${entry.source}.`;
}

async function requestEmbeddings(texts: string[]) {
  const { apiKey, model, outputDimension } = getEmbeddingConfig();

  if (!apiKey || texts.length === 0) {
    return [] as number[][];
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
      input_type: "search_document",
      texts,
      embedding_types: ["float"],
      output_dimension: outputDimension,
      truncate: "END"
    })
  });

  if (!response.ok) {
    throw new Error(`Cohere embed devolvio ${response.status}.`);
  }

  const payload = (await response.json()) as {
    embeddings?: {
      float?: number[][];
    };
  };

  return payload.embeddings?.float ?? [];
}

export async function ensureEmbeddingsForEntries(entries: DictionaryEntry[]) {
  const { apiKey, model, outputDimension } = getEmbeddingConfig();

  if (!apiKey) {
    return { updated: 0 };
  }

  const withIds = entries.filter((entry): entry is DictionaryEntry & { id: number } => typeof entry.id === "number");

  if (withIds.length === 0) {
    return { updated: 0 };
  }

  const dbEntries = await getDictionaryByIds(withIds.map((entry) => entry.id));
  const validEntries = dbEntries.filter((entry): entry is DictionaryEntry & { id: number } => typeof entry.id === "number");

  if (validEntries.length === 0) {
    return { updated: 0 };
  }

  const documents = validEntries.map((entry) => buildEmbeddingDocument(entry));
  const chunks = chunkArray(validEntries.map((entry, index) => ({ entry, document: documents[index] })), 96);
  let updated = 0;

  for (const chunk of chunks) {
    const embeddings = await requestEmbeddings(chunk.map((item) => item.document));

    await upsertDictionaryEmbeddings(
      chunk.map((item, index) => ({
        dictionaryEntryId: item.entry.id,
        embeddingModel: model,
        embeddingDimension: outputDimension,
        documentText: item.document,
        embedding: embeddings[index] ?? []
      }))
    );

    updated += chunk.length;
  }

  return { updated };
}

export async function backfillMissingDictionaryEmbeddings(limit = 1000) {
  const { model, outputDimension } = getEmbeddingConfig();
  const missing = await getDictionaryEntriesMissingEmbeddings(model, outputDimension, limit);

  if (missing.length === 0) {
    return { scanned: 0, updated: 0 };
  }

  const result = await ensureEmbeddingsForEntries(missing);
  return {
    scanned: missing.length,
    updated: result.updated
  };
 }
