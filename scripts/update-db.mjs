import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL no esta configurada.");
  process.exit(1);
}

const sql = neon(connectionString);

const statements = [
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
];

for (const statement of statements) {
  await sql(statement);
}

console.log("Base de datos actualizada.");