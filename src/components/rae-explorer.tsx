"use client";

import { useState } from "react";

import type { DictionaryEntry, RaeAnalysisResult } from "@/types";

const DEFAULT_TEXT =
  "En la ciudad de cristal, un viejo ingeniero y una joven maga buscaban el sentido oculto del fuego, del vapor y del metal.";

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "La operacion fallo.");
  }

  return payload;
}

export function RaeExplorer() {
  const [sourceText, setSourceText] = useState(DEFAULT_TEXT);
  const [result, setResult] = useState<RaeAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  async function analyze() {
    setError(null);
    setMessage(null);
    setIsLoading(true);

    try {
      const payload = await readJson<{ analysis: RaeAnalysisResult }>("/api/rae", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: sourceText })
      });

      setResult(payload.analysis);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo analizar el texto.");
    } finally {
      setIsLoading(false);
    }
  }

  async function createOverride(token: string, canonicalToken: string) {
    setError(null);
    setMessage(null);
    setCreatingKey(`${token}::${canonicalToken}`);

    try {
      const payload = await readJson<{ analysis: RaeAnalysisResult; entry: DictionaryEntry }>("/api/rae", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: sourceText,
          token,
          canonicalToken,
          mode: "create-override"
        })
      });

      setResult(payload.analysis);
      setMessage(`Override creado para ${token} con la entrada ${payload.entry.spanish} => ${payload.entry.arcano}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo crear el override.");
    } finally {
      setCreatingKey(null);
    }
  }

  return (
    <main className="shell shell-wide page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">RAE Explorer</p>
          <h1>Sentido del texto con diccionario local y DLE.</h1>
          <p className="lede">
            Esta ruta cruza tus terminos del diccionario con consulta publica al DLE para detectar palabras clave,
            revisar definiciones y decidir mejor que conviene traducir, reutilizar o aprender.
          </p>
        </div>

        <div className="editor-panel">
          <label htmlFor="rae-source">Texto en espanol</label>
          <textarea
            id="rae-source"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="Escribe una frase o parrafo para analizar con contexto lexico"
          />

          <div className="actions">
            <button type="button" onClick={() => void analyze()} disabled={isLoading || !sourceText.trim()}>
              {isLoading ? "Analizando..." : "Analizar con RAE"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setSourceText(DEFAULT_TEXT)} disabled={isLoading}>
              Restaurar ejemplo
            </button>
          </div>
        </div>
      </section>

      {message ? <p className="success-banner">{message}</p> : null}
      {error ? <p className="error-banner">{error}</p> : null}

      {result ? (
        <section className="panel section-stack">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Analisis lexico</p>
              <h2>Terminos detectados</h2>
            </div>
            <p className="muted section-note">Consulta publica del DLE. No es una API oficial gratuita de la RAE.</p>
          </div>

          <div className="editor-card-list">
            {result.terms.map((term) => (
              <article className="editor-card" key={`${term.token}-${term.canonicalToken}`}>
                <div className="editor-card-header">
                  <div>
                    <h3>{term.token}</h3>
                    <div className="meta-badges">
                      <span className="badge badge-muted">canonico: {term.canonicalToken}</span>
                      <span className="badge badge-muted">local: {term.localEntries.length}</span>
                      <span className="badge badge-muted">rae: {term.rae?.definitions.length ?? 0}</span>
                      {term.override ? <span className="badge badge-success">override activo</span> : null}
                    </div>
                  </div>

                  <div className="editor-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void createOverride(term.token, term.canonicalToken)}
                      disabled={creatingKey === `${term.token}::${term.canonicalToken}` || isLoading}
                    >
                      {creatingKey === `${term.token}::${term.canonicalToken}` ? "Creando override..." : term.override ? "Regenerar override IA" : "Crear entrada IA"}
                    </button>
                    {term.rae ? (
                      <a className="ghost-link" href={term.rae.sourceUrl} target="_blank" rel="noreferrer">
                        Ver en DLE
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="rae-grid">
                  <section className="mini-panel">
                    <p className="section-kicker">Diccionario local</p>
                    {term.override ? (
                      <div className="override-note">
                        <strong>Override editorial activo</strong>
                        <p>{term.override.note}</p>
                      </div>
                    ) : null}
                    {term.localEntries.length > 0 ? (
                      <ul className="term-list term-list-rich compact-list">
                        {term.localEntries.map((entry) => (
                          <li key={`${entry.spanish}-${entry.arcano}-${entry.source}`}>
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
                    ) : (
                      <p className="muted">No hay coincidencias exactas en tu diccionario para este termino.</p>
                    )}
                  </section>

                  <section className="mini-panel">
                    <p className="section-kicker">DLE / RAE</p>
                    {term.override ? <p className="muted">La definicion publica queda como referencia, pero el override local tiene prioridad para este termino.</p> : null}
                    {term.rae ? (
                      <div className="rae-definition-list">
                        {term.rae.articleTitle ? <p className="rae-title">{term.rae.articleTitle}</p> : null}
                        {term.rae.definitions.length > 0 ? (
                          term.rae.definitions.map((definition) => (
                            <article className="rae-definition" key={`${term.token}-${definition.label}`}>
                              <strong>{definition.label}.</strong>
                              <p>{definition.text}</p>
                            </article>
                          ))
                        ) : (
                          <p className="muted">La consulta respondio, pero no se pudieron extraer definiciones breves.</p>
                        )}
                      </div>
                    ) : (
                      <p className="muted">No se encontro una respuesta util en la consulta publica del DLE.</p>
                    )}
                  </section>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
