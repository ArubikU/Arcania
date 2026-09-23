import { neon } from "@neondatabase/serverless";

import type { DictionaryEntry, PreseedRule, RaeOverrideRecord, SimilarDictionaryMatch } from "@/types";

type DictionaryEmbeddingRecord = {
  dictionaryEntryId: number;
  embeddingModel: string;
  embeddingDimension: number;
  documentText: string;
  embedding: number[];
  updatedAt?: string;
};

type RaeOverrideRow = {
  token: string;
  canonicalToken: string;
  note: string;
  createdAt?: string;
  updatedAt?: string;
  entry: DictionaryEntry;
};

let schemaReady = false;

const SCHEMA_STATEMENTS = [
  "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  `
    CREATE TABLE IF NOT EXISTS dictionary_entries (
      id SERIAL PRIMARY KEY,
      spanish TEXT NOT NULL,
      arcano TEXT NOT NULL,
      pronunciation TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      source TEXT NOT NULL DEFAULT 'runtime',
      confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.5,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (spanish, arcano)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_dictionary_entries_spanish ON dictionary_entries (spanish)",
  "CREATE INDEX IF NOT EXISTS idx_dictionary_entries_arcano ON dictionary_entries (arcano)",
  `
    CREATE TABLE IF NOT EXISTS preseed_rules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      source TEXT NOT NULL DEFAULT 'custom',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_preseed_rules_active ON preseed_rules (is_active)",
  "CREATE INDEX IF NOT EXISTS idx_preseed_rules_name ON preseed_rules (name)",
  `
    CREATE TABLE IF NOT EXISTS dictionary_entry_embeddings (
      dictionary_entry_id INTEGER PRIMARY KEY REFERENCES dictionary_entries(id) ON DELETE CASCADE,
      embedding_model TEXT NOT NULL,
      embedding_dimension INTEGER NOT NULL,
      document_text TEXT NOT NULL,
      embedding_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_dictionary_entry_embeddings_model ON dictionary_entry_embeddings (embedding_model)",
  `
    CREATE TABLE IF NOT EXISTS rae_term_overrides (
      token TEXT PRIMARY KEY,
      canonical_token TEXT NOT NULL,
      dictionary_entry_id INTEGER NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_rae_term_overrides_canonical ON rae_term_overrides (canonical_token)",
  `
    CREATE OR REPLACE FUNCTION normalize_search_text(input_text TEXT)
    RETURNS TEXT
    LANGUAGE SQL
    IMMUTABLE
    AS $$
      SELECT trim(regexp_replace(lower(COALESCE(input_text, '')), '[^[:alnum:][:space:]]+', ' ', 'g'))
    $$
  `,
  `
    CREATE OR REPLACE FUNCTION find_dictionary_context(
      input_text TEXT,
      threshold REAL DEFAULT 0.6,
      max_matches INTEGER DEFAULT 3
    )
    RETURNS TABLE (
      token TEXT,
      entry_id INTEGER,
      spanish TEXT,
      arcano TEXT,
      category TEXT,
      source TEXT,
      confidence NUMERIC,
      similarity_score REAL
    )
    LANGUAGE SQL
    STABLE
    AS $$
      WITH tokens AS (
        SELECT DISTINCT split_token AS token
        FROM regexp_split_to_table(normalize_search_text(input_text), '\\s+') AS split_token
        WHERE split_token <> ''
          AND char_length(split_token) >= 2
      )
      SELECT
        tokens.token,
        candidate.id AS entry_id,
        candidate.spanish,
        candidate.arcano,
        candidate.category,
        candidate.source,
        candidate.confidence,
        similarity(tokens.token, candidate.spanish) AS similarity_score
      FROM tokens
      JOIN LATERAL (
        SELECT *
        FROM dictionary_entries
        WHERE similarity(tokens.token, spanish) >= threshold
        ORDER BY similarity(tokens.token, spanish) DESC, usage_count DESC, confidence DESC
        LIMIT max_matches
      ) AS candidate ON TRUE
      ORDER BY tokens.token ASC, similarity_score DESC
    $$
  `,
  `
    CREATE OR REPLACE FUNCTION find_similar_dictionary_entries(
      candidate_text TEXT,
      threshold REAL DEFAULT 0.8,
      max_matches INTEGER DEFAULT 3
    )
    RETURNS TABLE (
      token TEXT,
      entry_id INTEGER,
      spanish TEXT,
      arcano TEXT,
      category TEXT,
      source TEXT,
      confidence NUMERIC,
      similarity_score REAL
    )
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT
        normalize_search_text(candidate_text) AS token,
        entry.id AS entry_id,
        entry.spanish,
        entry.arcano,
        entry.category,
        entry.source,
        entry.confidence,
        similarity(normalize_search_text(candidate_text), entry.spanish) AS similarity_score
      FROM dictionary_entries AS entry
      WHERE similarity(normalize_search_text(candidate_text), entry.spanish) >= threshold
      ORDER BY similarity_score DESC, usage_count DESC, confidence DESC
      LIMIT max_matches
    $$
  `
] as const;

function getSql() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL no esta configurada.");
  }

  return neon(connectionString);
}

function mapEntry(row: Record<string, unknown>): DictionaryEntry {
  return {
    id: Number(row.id),
    spanish: String(row.spanish ?? ""),
    arcano: String(row.arcano ?? ""),
    pronunciation: String(row.pronunciation ?? ""),
    category: String(row.category ?? "general"),
    source: String(row.source ?? "runtime"),
    confidence: Number(row.confidence ?? 0),
    usageCount: Number(row.usage_count ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function mapPreseedRule(row: Record<string, unknown>): PreseedRule {
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    content: String(row.content ?? ""),
    isActive: Boolean(row.is_active),
    source: String(row.source ?? "custom"),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function mapSimilarityMatch(row: Record<string, unknown>): SimilarDictionaryMatch {
  return {
    token: String(row.token ?? ""),
    entryId: Number(row.entry_id ?? 0),
    spanish: String(row.spanish ?? ""),
    arcano: String(row.arcano ?? ""),
    category: String(row.category ?? "general"),
    source: String(row.source ?? "runtime"),
    confidence: Number(row.confidence ?? 0),
    similarityScore: Number(row.similarity_score ?? 0)
  };
}

function mapEmbeddingRecord(row: Record<string, unknown>): DictionaryEmbeddingRecord {
  return {
    dictionaryEntryId: Number(row.dictionary_entry_id ?? 0),
    embeddingModel: String(row.embedding_model ?? ""),
    embeddingDimension: Number(row.embedding_dimension ?? 0),
    documentText: String(row.document_text ?? ""),
    embedding: Array.isArray(row.embedding_json) ? row.embedding_json.map((value) => Number(value)) : [],
    updatedAt: String(row.updated_at ?? "")
  };
}

function mapRaeOverrideRow(row: Record<string, unknown>): RaeOverrideRow {
  return {
    token: String(row.token ?? ""),
    canonicalToken: String(row.canonical_token ?? ""),
    note: String(row.note ?? ""),
    createdAt: String(row.override_created_at ?? row.created_at ?? ""),
    updatedAt: String(row.override_updated_at ?? row.updated_at ?? ""),
    entry: mapEntry(row)
  };
}

export async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  const sql = getSql();

  for (const statement of SCHEMA_STATEMENTS) {
    await sql(statement);
  }

  schemaReady = true;
}

export async function seedDictionary(entries: DictionaryEntry[]) {
  const sql = getSql();

  for (const entry of entries) {
    await sql`
      INSERT INTO dictionary_entries (spanish, arcano, pronunciation, category, source, confidence)
      VALUES (
        ${entry.spanish},
        ${entry.arcano},
        ${entry.pronunciation},
        ${entry.category},
        ${entry.source},
        ${entry.confidence}
      )
      ON CONFLICT (spanish, arcano)
      DO NOTHING
    `;
  }
}

export async function getDictionary(search?: string) {
  const sql = getSql();

  if (search?.trim()) {
    const query = `%${search.trim().toLowerCase()}%`;
    const rows = await sql`
      SELECT *
      FROM dictionary_entries
      WHERE LOWER(spanish) LIKE ${query}
         OR LOWER(arcano) LIKE ${query}
      ORDER BY usage_count DESC, spanish ASC
      LIMIT 200
    `;

    return rows.map(mapEntry);
  }

  const rows = await sql`
    SELECT *
    FROM dictionary_entries
    ORDER BY usage_count DESC, spanish ASC
    LIMIT 500
  `;

  return rows.map(mapEntry);
}

export async function getDictionaryByIds(ids: number[]) {
  const normalizedIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];

  if (normalizedIds.length === 0) {
    return [] as DictionaryEntry[];
  }

  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM dictionary_entries
    WHERE id = ANY(${normalizedIds})
  `;

  return rows.map((row) => mapEntry(row as Record<string, unknown>));
}

export async function getDictionaryEntriesMissingEmbeddings(embeddingModel: string, embeddingDimension: number, limit = 500) {
  const sql = getSql();
  const rows = await sql`
    SELECT entries.*
    FROM dictionary_entries AS entries
    LEFT JOIN dictionary_entry_embeddings AS embeddings
      ON embeddings.dictionary_entry_id = entries.id
    WHERE embeddings.dictionary_entry_id IS NULL
       OR embeddings.embedding_model <> ${embeddingModel}
       OR embeddings.embedding_dimension <> ${embeddingDimension}
    ORDER BY entries.updated_at DESC
    LIMIT ${Math.max(1, Math.min(2000, limit))}
  `;

  return rows.map((row) => mapEntry(row as Record<string, unknown>));
}

export async function upsertDictionaryEntries(entries: DictionaryEntry[]) {
  const sql = getSql();
  const inserted: DictionaryEntry[] = [];

  for (const entry of entries) {
    const rows = await sql`
      INSERT INTO dictionary_entries (spanish, arcano, pronunciation, category, source, confidence, usage_count, updated_at)
      VALUES (
        ${entry.spanish},
        ${entry.arcano},
        ${entry.pronunciation},
        ${entry.category},
        ${entry.source},
        ${entry.confidence},
        0,
        NOW()
      )
      ON CONFLICT (spanish, arcano)
      DO UPDATE SET
        pronunciation = EXCLUDED.pronunciation,
        category = EXCLUDED.category,
        source = EXCLUDED.source,
        confidence = GREATEST(dictionary_entries.confidence, EXCLUDED.confidence),
        updated_at = NOW()
      RETURNING *
    `;

    if (rows[0]) {
      inserted.push(mapEntry(rows[0] as Record<string, unknown>));
    }
  }

  return inserted;
}

export async function createDictionaryEntry(entry: DictionaryEntry) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO dictionary_entries (spanish, arcano, pronunciation, category, source, confidence, usage_count, updated_at)
    VALUES (
      ${entry.spanish},
      ${entry.arcano},
      ${entry.pronunciation},
      ${entry.category},
      ${entry.source},
      ${entry.confidence},
      0,
      NOW()
    )
    RETURNING *
  `;

  return mapEntry(rows[0] as Record<string, unknown>);
}

async function deleteDictionaryEmbeddingByEntryId(id: number) {
  const sql = getSql();
  await sql`
    DELETE FROM dictionary_entry_embeddings
    WHERE dictionary_entry_id = ${id}
  `;
}

export async function updateDictionaryEntry(entry: DictionaryEntry) {
  const sql = getSql();

  if (!entry.id) {
    throw new Error("La entrada del diccionario requiere id.");
  }

  const rows = await sql`
    UPDATE dictionary_entries
    SET spanish = ${entry.spanish},
        arcano = ${entry.arcano},
        pronunciation = ${entry.pronunciation},
        category = ${entry.category},
        source = ${entry.source},
        confidence = ${entry.confidence},
        updated_at = NOW()
    WHERE id = ${entry.id}
    RETURNING *
  `;

  if (!rows[0]) {
    throw new Error("No se encontro la entrada del diccionario.");
  }

  await deleteDictionaryEmbeddingByEntryId(entry.id);

  return mapEntry(rows[0] as Record<string, unknown>);
}

export async function deleteDictionaryEntry(id: number) {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM dictionary_entries
    WHERE id = ${id}
    RETURNING *
  `;

  if (!rows[0]) {
    throw new Error("No se encontro la entrada del diccionario.");
  }

  return mapEntry(rows[0] as Record<string, unknown>);
}

export async function getDictionaryEmbeddings(entryIds: number[]) {
  if (entryIds.length === 0) {
    return [] as DictionaryEmbeddingRecord[];
  }

  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM dictionary_entry_embeddings
    WHERE dictionary_entry_id = ANY(${entryIds})
  `;

  return rows.map((row) => mapEmbeddingRecord(row as Record<string, unknown>));
}

export async function upsertDictionaryEmbeddings(records: DictionaryEmbeddingRecord[]) {
  const sql = getSql();

  for (const record of records) {
    await sql`
      INSERT INTO dictionary_entry_embeddings (
        dictionary_entry_id,
        embedding_model,
        embedding_dimension,
        document_text,
        embedding_json,
        updated_at
      )
      VALUES (
        ${record.dictionaryEntryId},
        ${record.embeddingModel},
        ${record.embeddingDimension},
        ${record.documentText},
        ${JSON.stringify(record.embedding)},
        NOW()
      )
      ON CONFLICT (dictionary_entry_id)
      DO UPDATE SET
        embedding_model = EXCLUDED.embedding_model,
        embedding_dimension = EXCLUDED.embedding_dimension,
        document_text = EXCLUDED.document_text,
        embedding_json = EXCLUDED.embedding_json,
        updated_at = NOW()
    `;
  }
}

export async function getRaeOverrides(tokens: string[]) {
  const normalizedTokens = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))];

  if (normalizedTokens.length === 0) {
    return [] as RaeOverrideRecord[];
  }

  const sql = getSql();
  const rows = await sql`
    SELECT
      overrides.token,
      overrides.canonical_token,
      overrides.note,
      overrides.created_at AS override_created_at,
      overrides.updated_at AS override_updated_at,
      entries.*
    FROM rae_term_overrides AS overrides
    JOIN dictionary_entries AS entries
      ON entries.id = overrides.dictionary_entry_id
    WHERE overrides.token = ANY(${normalizedTokens})
       OR overrides.canonical_token = ANY(${normalizedTokens})
    ORDER BY overrides.updated_at DESC
  `;

  return rows.map((row) => {
    const mapped = mapRaeOverrideRow(row as Record<string, unknown>);
    return {
      token: mapped.token,
      canonicalToken: mapped.canonicalToken,
      note: mapped.note,
      entry: mapped.entry,
      createdAt: mapped.createdAt,
      updatedAt: mapped.updatedAt
    };
  });
}

export async function upsertRaeOverride(token: string, canonicalToken: string, dictionaryEntryId: number, note: string) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO rae_term_overrides (token, canonical_token, dictionary_entry_id, note, updated_at)
    VALUES (${token}, ${canonicalToken}, ${dictionaryEntryId}, ${note}, NOW())
    ON CONFLICT (token)
    DO UPDATE SET
      canonical_token = EXCLUDED.canonical_token,
      dictionary_entry_id = EXCLUDED.dictionary_entry_id,
      note = EXCLUDED.note,
      updated_at = NOW()
    RETURNING *
  `;

  return rows[0] as Record<string, unknown>;
}

export async function getPreseedRules(activeOnly = false) {
  const sql = getSql();

  const rows = activeOnly
    ? await sql`
        SELECT *
        FROM preseed_rules
        WHERE is_active = TRUE
        ORDER BY updated_at DESC, name ASC
      `
    : await sql`
        SELECT *
        FROM preseed_rules
        ORDER BY updated_at DESC, name ASC
      `;

  return rows.map((row) => mapPreseedRule(row as Record<string, unknown>));
}

export async function createPreseedRule(rule: PreseedRule) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO preseed_rules (name, description, content, is_active, source, updated_at)
    VALUES (
      ${rule.name},
      ${rule.description},
      ${rule.content},
      ${rule.isActive},
      ${rule.source},
      NOW()
    )
    RETURNING *
  `;

  return mapPreseedRule(rows[0] as Record<string, unknown>);
}

export async function updatePreseedRule(rule: PreseedRule) {
  const sql = getSql();

  if (!rule.id) {
    throw new Error("La regla preseed requiere id.");
  }

  const rows = await sql`
    UPDATE preseed_rules
    SET name = ${rule.name},
        description = ${rule.description},
        content = ${rule.content},
        is_active = ${rule.isActive},
        source = ${rule.source},
        updated_at = NOW()
    WHERE id = ${rule.id}
    RETURNING *
  `;

  if (!rows[0]) {
    throw new Error("No se encontro la regla preseed.");
  }

  return mapPreseedRule(rows[0] as Record<string, unknown>);
}

export async function getSimilarityContext(sourceText: string, threshold = 0.6, maxMatches = 3) {
  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM find_dictionary_context(${sourceText}, ${threshold}, ${maxMatches})
  `;

  return rows.map((row) => mapSimilarityMatch(row as Record<string, unknown>));
}

export async function getSimilarExistingEntries(spanish: string, threshold = 0.8, maxMatches = 3) {
  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM find_similar_dictionary_entries(${spanish}, ${threshold}, ${maxMatches})
  `;

  return rows.map((row) => mapSimilarityMatch(row as Record<string, unknown>));
}

export async function incrementUsage(entries: DictionaryEntry[]) {
  const sql = getSql();

  for (const entry of entries) {
    await sql`
      UPDATE dictionary_entries
      SET usage_count = usage_count + 1,
          updated_at = NOW()
      WHERE spanish = ${entry.spanish}
        AND arcano = ${entry.arcano}
    `;
  }
}