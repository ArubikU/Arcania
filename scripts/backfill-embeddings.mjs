import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
const apiKey = process.env.COHERE_EMBED_API_KEY ?? process.env.COHERE_API_KEY;
const model = process.env.COHERE_EMBED_MODEL ?? "embed-v4.0";
const outputDimension = Number.parseInt(process.env.COHERE_EMBED_OUTPUT_DIMENSION ?? "512", 10);
const batchSize = Math.max(1, Math.min(96, Number.parseInt(process.env.EMBED_BACKFILL_BATCH_SIZE ?? "72", 10)));
const limit = Math.max(1, Math.min(5000, Number.parseInt(process.env.EMBED_BACKFILL_LIMIT ?? "1000", 10)));

if (!connectionString) {
  console.error("DATABASE_URL no esta configurada.");
  process.exit(1);
}

if (!apiKey) {
  console.error("COHERE_EMBED_API_KEY o COHERE_API_KEY no esta configurada.");
  process.exit(1);
}

const sql = neon(connectionString);

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildEmbeddingDocument(entry) {
  return `${entry.spanish}. categoria: ${entry.category}. arcano: ${entry.arcano}. fuente: ${entry.source}.`;
}

async function requestEmbeddings(texts) {
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

  const payload = await response.json();
  return payload?.embeddings?.float ?? [];
}

const rows = await sql`
  SELECT entries.*
  FROM dictionary_entries AS entries
  LEFT JOIN dictionary_entry_embeddings AS embeddings
    ON embeddings.dictionary_entry_id = entries.id
  WHERE embeddings.dictionary_entry_id IS NULL
     OR embeddings.embedding_model <> ${model}
     OR embeddings.embedding_dimension <> ${outputDimension}
  ORDER BY entries.updated_at DESC
  LIMIT ${limit}
`;

if (rows.length === 0) {
  console.log("No hay embeddings faltantes para el modelo configurado.");
  process.exit(0);
}

let updated = 0;

for (const chunk of chunkArray(rows, batchSize)) {
  const documents = chunk.map((entry) => buildEmbeddingDocument(entry));
  const embeddings = await requestEmbeddings(documents);

  for (let index = 0; index < chunk.length; index += 1) {
    const entry = chunk[index];
    const embedding = embeddings[index] ?? [];

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
        ${entry.id},
        ${model},
        ${outputDimension},
        ${documents[index]},
        ${JSON.stringify(embedding)},
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

  updated += chunk.length;
  console.log(`Batch completado: +${chunk.length} (total ${updated}/${rows.length})`);
}

console.log(`Backfill completado. Scanned: ${rows.length}, Updated: ${updated}`);
