"use client";

import { useEffect, useRef, useState } from "react";

import { ArcanoGlyphRenderer } from "@/components/arcano-glyph-renderer";
import type { DictionaryEntry, TranslationIndexingResult, TranslationResult } from "@/types";

const DEFAULT_TEXT = "crear un mundo de vapor y cristal";
const QUICK_PROMPTS = [
  "crear un mundo de vapor y cristal",
  "un consejo de magos protege la ciudad",
  "quiero un idioma solemne para rituales",
  "las maquinas cantan con luz antigua"
];

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "La operacion fallo.");
  }

  return payload;
}

export function TranslatorWorkbench() {
  const [direction, setDirection] = useState<"es-to-arc" | "arc-to-es">("es-to-arc");
  const [sourceText, setSourceText] = useState(DEFAULT_TEXT);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Listo para traducir.");
  const latestRequestId = useRef(0);

  async function refreshDictionary() {
    const payload = await readJson<{ entries: DictionaryEntry[] }>("/api/dictionary");
    setDictionary(payload.entries);
  }

  async function translate(text: string) {
    return readJson<TranslationResult>("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text, mode: "translate", direction })
    });
  }

  async function indexTranslation(text: string, readableText: string) {
    const payload = await readJson<{ indexing: TranslationIndexingResult }>("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text, readableText, mode: "index" })
    });

    return payload.indexing;
  }

  useEffect(() => {
    refreshDictionary().catch((caughtError) => {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el diccionario.");
    });
  }, []);

  async function handleTranslate() {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;

    setError(null);
    setIsTranslating(true);
    setIsIndexing(false);
    setStatusMessage(
      direction === "es-to-arc"
        ? "Analizando el texto y consultando el diccionario..."
        : "Analizando arcano y buscando equivalencias en el diccionario..."
    );

    try {
      const translation = await translate(sourceText);

      if (latestRequestId.current !== requestId) {
        return;
      }

      setResult(translation);

      if (direction === "arc-to-es") {
        setStatusMessage("Traduccion inversa lista.");
        setIsTranslating(false);
        setIsIndexing(false);
        return;
      }

      setIsTranslating(false);
      setIsIndexing(true);
      setStatusMessage("Traduccion lista. Ahora normalizando e indexando palabras nuevas...");

      void indexTranslation(sourceText, translation.readableText)
        .then(async (indexing) => {
          if (latestRequestId.current !== requestId) {
            return;
          }

          setResult((current) =>
            current
              ? {
                  ...current,
                  normalizedSourceText: indexing.normalizedSourceText,
                  learnedTerms: indexing.learnedTerms,
                  usedEntries: indexing.usedEntries
                }
              : current
          );
          await refreshDictionary();
          setStatusMessage("Traduccion lista e indexacion completada.");
        })
        .catch(() => {
          if (latestRequestId.current !== requestId) {
            return;
          }

          setStatusMessage("La traduccion se mostro, pero la normalizacion o indexacion no pudo completarse.");
        })
        .finally(() => {
          if (latestRequestId.current === requestId) {
            setIsIndexing(false);
          }
        });
    } catch (caughtError) {
      if (latestRequestId.current !== requestId) {
        return;
      }

      setError(caughtError instanceof Error ? caughtError.message : "No se pudo traducir el texto.");
      setStatusMessage("La traduccion fallo. Revisa el mensaje y vuelve a intentar.");
      setIsTranslating(false);
      setIsIndexing(false);
    }
  }

  const visibleTerms = result?.learnedTerms.length ? result.learnedTerms : dictionary.slice(0, 6);
  const usedEntries = result?.usedEntries ?? [];
  const isBusy = isTranslating || isIndexing;

  return (
    <main className="shell shell-wide page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Arcania Translator</p>
          <h1>Traductor espanol a arcano con contexto vivo.</h1>
          <p className="lede">
            Cohere propone traducciones, Neon guarda el diccionario y el sistema renderiza texto legible,
            pronunciacion y glifos. Ahora la home comparte la misma jerarquia y espacio de trabajo de los editores.
          </p>
        </div>

        <div className="stat-grid stat-grid-compact">
          <article className="stat-card">
            <span>Diccionario</span>
            <strong>{dictionary.length}</strong>
            <small>Entradas cargadas desde Neon</small>
          </article>
          <article className="stat-card">
            <span>Modelo</span>
            <strong>{result?.model ?? "listo"}</strong>
            <small>Motor de la ultima traduccion</small>
          </article>
          <article className="stat-card">
            <span>Terminos usados</span>
            <strong>{usedEntries.length}</strong>
            <small>Entradas detectadas en la salida</small>
          </article>
          <article className="stat-card">
            <span>Entrada</span>
            <strong>{sourceText.trim().length}</strong>
            <small>Caracteres en el texto actual</small>
          </article>
        </div>

        <div className="translator-composer">
          <div className="editor-panel">
            <div className="view-toggle-row" style={{ marginBottom: "1rem" }}>
              <button
                type="button"
                className={`view-chip ${direction === "es-to-arc" ? "is-active" : ""}`}
                onClick={() => { setDirection("es-to-arc"); setSourceText(DEFAULT_TEXT); setResult(null); }}
                disabled={isBusy}
              >
                Espanol a Arcano
              </button>
              <button
                type="button"
                className={`view-chip ${direction === "arc-to-es" ? "is-active" : ""}`}
                onClick={() => { setDirection("arc-to-es"); setSourceText(""); setResult(null); }}
                disabled={isBusy}
              >
                Arcano a Espanol
              </button>
            </div>

            <label htmlFor="sourceText">
              {direction === "es-to-arc" ? "Texto en espanol" : "Texto en arcano"}
            </label>
            <textarea
              id="sourceText"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder={direction === "es-to-arc" ? "Escribe una frase para convertirla al arcano" : "Escribe una frase en arcano para traducirla al espanol"}
            />

            <div className="actions">
              <button type="button" onClick={() => void handleTranslate()} disabled={isBusy || !sourceText.trim()}>
                {isTranslating ? "Traduciendo..." : isIndexing ? "Indexando..." : "Traducir"}
              </button>
              <button type="button" className="secondary-button" onClick={() => setSourceText(direction === "es-to-arc" ? DEFAULT_TEXT : "")} disabled={isBusy}>
                Restaurar ejemplo
              </button>
              <button type="button" className="ghost-button" onClick={() => setSourceText("")} disabled={isBusy}>
                Limpiar
              </button>
            </div>

            <div className={`status-card ${isBusy ? "status-card-loading" : ""}`} aria-live="polite">
              <div className="status-card-head">
                <span className={`status-dot ${isBusy ? "status-dot-live" : ""}`} aria-hidden="true" />
                <strong>{isTranslating ? "Traduciendo" : isIndexing ? "Indexando" : "Estado"}</strong>
              </div>
              <p>{statusMessage}</p>
              {isTranslating ? <small>Primera fase: generar el resultado visible para que aparezca cuanto antes.</small> : null}
              {isIndexing ? <small>Segunda fase: normalizar la entrada e indexar terminos nuevos sin retrasar la vista inicial.</small> : null}
            </div>
          </div>

          <aside className="composer-sidecard">
            <div>
              <p className="section-kicker">Prompts rapidos</p>
              <div className="chip-grid">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="chip-button"
                    onClick={() => setSourceText(prompt)}
                    disabled={isBusy}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="section-kicker">Notas</p>
              <ul className="feature-list">
                <li>Usa frases cortas para revisar decisiones lexicas con mas precision.</li>
                <li>Si quieres fijar tono o restricciones, define primero reglas en preseed.</li>
                <li>El diccionario se refresca despues de cada traduccion.</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className={`results-grid results-grid-wide ${isBusy ? "results-grid-processing" : ""}`}>
        <article className="output-card">
          <h2>Entrada entendida</h2>
          <p>{result?.normalizedSourceText || "La interpretacion canonica del texto aparecera aqui."}</p>
        </article>

        <article className="output-card">
          <h2>Texto legible</h2>
          <p>{result?.readableText || "La traduccion legible aparecera aqui."}</p>
        </article>

        <article className="output-card">
          <h2>Pronunciacion</h2>
          <p>{result?.pronunciationText || "La pronunciacion silabica aparecera aqui."}</p>
        </article>

        <article className="output-card arcano-card output-card-featured">
          <h2>Escritura arcana</h2>
          <ArcanoGlyphRenderer text={result?.readableText || ""} />
        </article>
      </section>

      <section className="meta-grid meta-grid-wide">
        <article className="panel panel-with-list">
          <div className="section-heading section-heading-compact">
            <div>
              <p className="section-kicker">Aprendizaje</p>
              <h2>Runtime y reutilizacion</h2>
            </div>
            <span className="badge badge-muted">motor {result?.model || "pendiente"}</span>
          </div>

          <ul className="term-list term-list-rich">
            {visibleTerms.map((entry) => (
              <li key={`${entry.spanish}-${entry.arcano}`}>
                <div>
                  <strong>{entry.spanish}</strong>
                  <p>{entry.category}</p>
                </div>
                <div className="term-list-meta">
                  <span>{entry.arcano}</span>
                  <small>{entry.source}</small>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel panel-with-list">
          <div className="section-heading section-heading-compact">
            <div>
              <p className="section-kicker">Referencias</p>
              <h2>Entradas usadas</h2>
            </div>
            <span className="badge badge-muted">{usedEntries.length} detectadas</span>
          </div>

          {usedEntries.length > 0 ? (
            <div className="dictionary-table compact">
              <div className="dictionary-row head">
                <span>Espanol</span>
                <span>Arcano</span>
                <span>Origen</span>
              </div>
              {usedEntries.slice(0, 8).map((entry) => (
                <div className="dictionary-row" key={`${entry.spanish}-${entry.arcano}-${entry.source}`}>
                  <span>{entry.spanish}</span>
                  <span>{entry.arcano}</span>
                  <span>{entry.source}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state-compact">
              <h3>Sin entradas usadas aun</h3>
              <p>Cuando haya una traduccion, aqui veras el material del diccionario que participo en el resultado.</p>
            </div>
          )}
        </article>

        <article className="panel panel-with-list">
          <div className="section-heading section-heading-compact">
            <div>
              <p className="section-kicker">Snapshot</p>
              <h2>Diccionario reciente</h2>
            </div>
            <span className="badge badge-muted">top 10</span>
          </div>

          <div className="dictionary-table compact">
            <div className="dictionary-row head">
              <span>Espanol</span>
              <span>Arcano</span>
              <span>Origen</span>
            </div>
            {dictionary.slice(0, 10).map((entry) => (
              <div className="dictionary-row" key={`${entry.spanish}-${entry.arcano}`}>
                <span>{entry.spanish}</span>
                <span>{entry.arcano}</span>
                <span>{entry.source}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}