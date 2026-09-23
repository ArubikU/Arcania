export type DictionaryEntry = {
  id?: number;
  spanish: string;
  arcano: string;
  pronunciation: string;
  category: string;
  source: string;
  confidence: number;
  usageCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PreseedRule = {
  id?: number;
  name: string;
  description: string;
  content: string;
  isActive: boolean;
  source: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SimilarDictionaryMatch = {
  token: string;
  entryId: number;
  spanish: string;
  arcano: string;
  category: string;
  source: string;
  confidence: number;
  similarityScore: number;
};

export type SemanticDictionaryMatch = {
  token: string;
  spanish: string;
  arcano: string;
  category: string;
  source: string;
  confidence: number;
  similarityScore: number;
};

export type TranslationResult = {
  sourceText: string;
  normalizedSourceText: string;
  readableText: string;
  pronunciationText: string;
  arcanoText: string;
  learnedTerms: DictionaryEntry[];
  usedEntries: DictionaryEntry[];
  model: "dictionary" | "cohere" | "fallback";
};

export type TranslationIndexingResult = {
  normalizedSourceText: string;
  learnedTerms: DictionaryEntry[];
  usedEntries: DictionaryEntry[];
};

export type RaeDefinition = {
  label: string;
  text: string;
};

export type RaeLookup = {
  query: string;
  resolvedTerm: string;
  articleTitle: string | null;
  definitions: RaeDefinition[];
  sourceUrl: string;
};

export type RaeOverrideRecord = {
  token: string;
  canonicalToken: string;
  note: string;
  entry: DictionaryEntry;
  createdAt?: string;
  updatedAt?: string;
};

export type RaeTermAnalysis = {
  token: string;
  canonicalToken: string;
  localEntries: DictionaryEntry[];
  rae: RaeLookup | null;
  override: RaeOverrideRecord | null;
};

export type RaeAnalysisResult = {
  sourceText: string;
  terms: RaeTermAnalysis[];
};

export type DictionaryGraphNode = {
  id: number;
  spanish: string;
  arcano: string;
  category: string;
  source: string;
  confidence: number;
  usageCount: number;
  x: number;
  y: number;
  z: number;
  cluster: string;
  hasEmbedding: boolean;
  embeddingNorm: number;
  embeddingPreview: number[];
};

export type DictionaryGraphEdge = {
  sourceId: number;
  targetId: number;
  weight: number;
  kind: "semantic" | "category";
};

export type DictionaryGraph = {
  nodes: DictionaryGraphNode[];
  edges: DictionaryGraphEdge[];
};