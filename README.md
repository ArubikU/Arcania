# Arcania Translator

Traductor de espanol a arcano con tres salidas:

- Texto legible por humanos en arcano romanizado
- Texto en escritura arcana usando glifos 5x5
- Texto formateado para pronunciacion por silabas

La app usa:

- Next.js para UI y API
- Neon Postgres para diccionario persistente y aprendizaje en runtime
- Cohere para sugerir traducciones, embeddings semanticos y ampliar el diccionario sin perder consistencia

## Variables de entorno

Copiar [.env.example](.env.example) a `.env.local` y completar:

```bash
DATABASE_URL=postgres://...
COHERE_API_KEY=...
COHERE_MODEL=command-r-plus
COHERE_EMBED_API_KEY=...
COHERE_EMBED_MODEL=embed-v4.0
```

`COHERE_EMBED_API_KEY` es opcional. Si no se define, la capa semantica reutiliza `COHERE_API_KEY`.

## Desarrollo

```bash
npm install
npm run dev
```

La app levanta:

- `/` para traducir y consultar un resumen del diccionario
- `/dictionary` para explorar el diccionario completo guardado en Neon

## Como aprende

1. Se inicializa con el vocabulario base de [language2.md](language2.md).
2. Cuando Cohere propone nuevos terminos, se guardan en Postgres con `source = runtime-ai`.
3. Las siguientes traducciones reutilizan esos terminos antes de volver a consultar al modelo.
4. Si hay embeddings configurados, la app agrega contexto semantico para mejorar recuperacion de conceptos cercanos aunque no haya coincidencia exacta.

## Nota sobre el alfabeto

La escritura arcana se genera a partir del silabario definido en [language.md](language.md). Cuando aparece una silaba fuera del chart actual, la app intenta una normalizacion fonetica simple para consonantes sonoras y, si aun asi no encuentra un glifo, muestra un marcador de placeholder.