import { getDictionary, getDictionaryEmbeddings } from "@/lib/db";
import type { DictionaryEntry, DictionaryGraph, DictionaryGraphEdge, DictionaryGraphNode } from "@/types";

function normalizeRange(values: number[]) {
  if (values.length === 0) {
    return [] as number[];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return values.map(() => 0.5);
  }

  return values.map((value) => (value - min) / (max - min));
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

function vectorNorm(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  let sum = 0;

  for (const value of values) {
    sum += value * value;
  }

  return Math.sqrt(sum);
}

function fallbackCoordinate(seed: string, offset: number) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index) + offset) % 1000003;
  }

  return (hash % 1000) / 1000;
}

function pickRepresentativeIds(entries: DictionaryEntry[]) {
  const representatives = new Map<string, number>();

  for (const entry of [...entries].sort((left, right) => (right.usageCount ?? 0) - (left.usageCount ?? 0))) {
    if (!entry.id || representatives.has(entry.category)) {
      continue;
    }

    representatives.set(entry.category, entry.id);
  }

  return representatives;
}

export async function buildDictionaryGraph(params?: { search?: string; category?: string; source?: string; limit?: number }) {
  const allEntries = await getDictionary(params?.search);
  const filteredEntries = allEntries
    .filter((entry) => (params?.category && params.category !== "all" ? entry.category === params.category : true))
    .filter((entry) => (params?.source && params.source !== "all" ? entry.source === params.source : true))
    .slice(0, params?.limit ?? 140);

  const entries = filteredEntries.filter((entry): entry is DictionaryEntry & { id: number } => typeof entry.id === "number");
  const embeddingRows = await getDictionaryEmbeddings(entries.map((entry) => entry.id));
  const embeddingMap = new Map(embeddingRows.map((row) => [row.dictionaryEntryId, row.embedding] as const));

  const xSource = normalizeRange(
    entries.map((entry) => {
      const embedding = embeddingMap.get(entry.id) ?? [];
      return embedding[0] ?? fallbackCoordinate(entry.spanish, 1);
    })
  );
  const ySource = normalizeRange(
    entries.map((entry) => {
      const embedding = embeddingMap.get(entry.id) ?? [];
      return (embedding[7] ?? 0) + (embedding[1] ?? fallbackCoordinate(entry.arcano, 7));
    })
  );
  const zSource = normalizeRange(
    entries.map((entry) => {
      const embedding = embeddingMap.get(entry.id) ?? [];
      return (embedding[15] ?? 0) + (embedding[2] ?? fallbackCoordinate(entry.category, 15));
    })
  );

  const nodes: DictionaryGraphNode[] = entries.map((entry, index) => {
    const embedding = embeddingMap.get(entry.id) ?? [];

    return {
      id: entry.id,
      spanish: entry.spanish,
      arcano: entry.arcano,
      category: entry.category,
      source: entry.source,
      confidence: entry.confidence,
      usageCount: entry.usageCount ?? 0,
      x: xSource[index] ?? 0.5,
      y: ySource[index] ?? 0.5,
      z: zSource[index] ?? 0.5,
      cluster: entry.category || "general",
      hasEmbedding: embedding.length > 0,
      embeddingNorm: Number(vectorNorm(embedding).toFixed(4)),
      embeddingPreview: embedding.slice(0, 12).map((value) => Number(value.toFixed(4)))
    };
  });

  const edges: DictionaryGraphEdge[] = [];
  const seenEdges = new Set<string>();
  const representatives = pickRepresentativeIds(entries);

  for (const entry of entries) {
    const representativeId = representatives.get(entry.category);

    if (representativeId && representativeId !== entry.id) {
      const key = `${Math.min(representativeId, entry.id)}:${Math.max(representativeId, entry.id)}:category`;

      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push({
          sourceId: representativeId,
          targetId: entry.id,
          weight: 0.55,
          kind: "category"
        });
      }
    }
  }

  for (const leftEntry of entries) {
    const leftEmbedding = embeddingMap.get(leftEntry.id) ?? [];

    if (leftEmbedding.length === 0) {
      continue;
    }

    const neighbors = entries
      .filter((entry) => entry.id !== leftEntry.id)
      .map((rightEntry) => ({
        id: rightEntry.id,
        similarity: cosineSimilarity(leftEmbedding, embeddingMap.get(rightEntry.id) ?? [])
      }))
      .filter((item) => item.similarity >= 0.45)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 2);

    for (const neighbor of neighbors) {
      const key = `${Math.min(leftEntry.id, neighbor.id)}:${Math.max(leftEntry.id, neighbor.id)}:semantic`;

      if (seenEdges.has(key)) {
        continue;
      }

      seenEdges.add(key);
      edges.push({
        sourceId: leftEntry.id,
        targetId: neighbor.id,
        weight: neighbor.similarity,
        kind: "semantic"
      });
    }
  }

  return {
    nodes,
    edges
  } satisfies DictionaryGraph;
}