"use client";

import { useDeferredValue, useEffect, useState, useTransition } from "react";

import { DictionaryMap2D, DictionaryTree3D } from "@/components/dictionary-graph-views";
import type { DictionaryEntry, DictionaryGraph } from "@/types";

type Props = {
  initialEntries: DictionaryEntry[];
};

const EMPTY_ENTRY: DictionaryEntry = {
  spanish: "",
  arcano: "",
  pronunciation: "",
  category: "general",
  source: "manual",
  confidence: 1
};

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "La operacion fallo.");
  }

  return payload;
}

export function DictionaryManager({ initialEntries }: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [viewMode, setViewMode] = useState<"editor" | "map" | "tree">("editor");
  const [graph, setGraph] = useState<DictionaryGraph | null>(null);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DictionaryEntry>(EMPTY_ENTRY);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortBy, setSortBy] = useState("usage");
  const [isPending, startTransition] = useTransition();
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const categories = [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
  const sources = [...new Set(entries.map((entry) => entry.source).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
  const filteredEntries = [...entries]
    .filter((entry) => {
    const matchesCategory = categoryFilter === "all" || entry.category === categoryFilter;
    const matchesSource = sourceFilter === "all" || entry.source === sourceFilter;

      return matchesCategory && matchesSource;
    })
    .sort((left, right) => {
      if (sortBy === "spanish") {
        return left.spanish.localeCompare(right.spanish);
      }

      if (sortBy === "arcano") {
        return left.arcano.localeCompare(right.arcano);
      }

      if (sortBy === "confidence") {
        return right.confidence - left.confidence;
      }

      if (sortBy === "recent") {
        return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
      }

      return (right.usageCount ?? 0) - (left.usageCount ?? 0);
    });
  const manualEntries = entries.filter((entry) => entry.source === "manual").length;
  const runtimeEntries = entries.filter((entry) => entry.source === "runtime-ai").length;
  const highConfidenceEntries = entries.filter((entry) => entry.confidence >= 0.9).length;
  const selectedGraphNode = graph?.nodes.find((node) => node.id === selectedGraphNodeId) ?? null;
  const selectedGraphEdges =
    graph && selectedGraphNodeId !== null
      ? graph.edges
          .filter((edge) => edge.sourceId === selectedGraphNodeId || edge.targetId === selectedGraphNodeId)
          .sort((left, right) => right.weight - left.weight)
      : [];
  const highlightedNodeIds = new Set<number>(
    selectedGraphNodeId === null || !graph
      ? graph?.nodes.map((node) => node.id) ?? []
      : [
          selectedGraphNodeId,
          ...graph.edges
            .filter((edge) => edge.sourceId === selectedGraphNodeId || edge.targetId === selectedGraphNodeId)
            .flatMap((edge) => [edge.sourceId, edge.targetId])
        ]
  );

  async function fetchEntries(search?: string) {
    const query = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
    const payload = await readJson<{ entries: DictionaryEntry[] }>(`/api/dictionary${query}`);
    setEntries(payload.entries);
  }

  async function fetchGraph(search?: string, category?: string, source?: string) {
    const params = new URLSearchParams();

    if (search?.trim()) {
      params.set("search", search.trim());
    }

    if (category && category !== "all") {
      params.set("category", category);
    }

    if (source && source !== "all") {
      params.set("source", source);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    const payload = await readJson<{ graph: DictionaryGraph }>(`/api/dictionary/graph${suffix}`);
    setGraph(payload.graph);
  }

  function refreshCurrentEntries(nextMessage?: string) {
    startTransition(() => {
      fetchEntries(deferredSearchTerm)
        .then(() => {
          if (nextMessage) {
            setMessage(nextMessage);
          }
        })
        .catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo refrescar el diccionario.");
        });
    });
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchEntries(deferredSearchTerm).catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el diccionario.");
      });
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [deferredSearchTerm]);

  useEffect(() => {
    if (viewMode === "editor") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      fetchGraph(deferredSearchTerm, categoryFilter, sourceFilter).catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el grafo del diccionario.");
      });
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [viewMode, deferredSearchTerm, categoryFilter, sourceFilter]);

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) {
      setSelectedGraphNodeId(null);
      return;
    }

    if (selectedGraphNodeId === null || !graph.nodes.some((node) => node.id === selectedGraphNodeId)) {
      setSelectedGraphNodeId(graph.nodes[0].id);
    }
  }, [graph, selectedGraphNodeId]);

  function updateDraft(field: keyof DictionaryEntry, value: string) {
    setDraft((current) => ({ ...current, [field]: field === "confidence" ? Number(value) : value }));
  }

  function updateLocalEntry(id: number, field: keyof DictionaryEntry, value: string) {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, [field]: field === "confidence" ? Number(value) : value } : entry))
    );
  }

  function createEntry() {
    setError(null);
    setMessage(null);

    startTransition(() => {
      readJson<{ entry: DictionaryEntry }>("/api/dictionary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(draft)
      })
        .then((payload) => {
          setDraft(EMPTY_ENTRY);
          refreshCurrentEntries(`Entrada ${payload.entry.spanish} creada.`);
        })
        .catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo crear la entrada.");
        });
    });
  }

  function saveEntry(entry: DictionaryEntry) {
    setError(null);
    setMessage(null);

    startTransition(() => {
      readJson<{ entry: DictionaryEntry }>("/api/dictionary", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(entry)
      })
        .then((payload) => {
          refreshCurrentEntries(`Entrada ${payload.entry.spanish} actualizada.`);
        })
        .catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la entrada.");
        });
    });
  }

  function removeEntry(entry: DictionaryEntry) {
    setError(null);
    setMessage(null);

    if (!entry.id) {
      setError("La entrada no tiene id.");
      return;
    }

    startTransition(() => {
      readJson<{ entry: DictionaryEntry }>(`/api/dictionary?id=${entry.id}`, {
        method: "DELETE"
      })
        .then((payload) => {
          refreshCurrentEntries(`Entrada ${payload.entry.spanish} borrada.`);
        })
        .catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo borrar la entrada.");
        });
    });
  }

  return (
    <main className="shell shell-wide page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Workspace del idioma</p>
          <h1>Diccionario con edicion amplia, rapida y util.</h1>
          <p className="lede">
            Busca por termino, filtra por categoria u origen y edita cada entrada en una tarjeta mas comoda. Los
            cambios siguen persistiendo en Neon y se reutilizan en las siguientes traducciones.
          </p>
        </div>

          <div className="stat-grid">
            <article className="stat-card">
              <span>Total</span>
              <strong>{entries.length}</strong>
              <small>Entradas disponibles</small>
            </article>
            <article className="stat-card">
              <span>Manual</span>
              <strong>{manualEntries}</strong>
              <small>Creadas o ajustadas a mano</small>
            </article>
            <article className="stat-card">
              <span>Runtime AI</span>
              <strong>{runtimeEntries}</strong>
              <small>Aprendidas durante traduccion</small>
            </article>
            <article className="stat-card">
              <span>Alta confianza</span>
              <strong>{highConfidenceEntries}</strong>
              <small>Confidence mayor o igual a 0.9</small>
            </article>
          </div>
        </section>

        <datalist id="categories-list">
          <option value="sustantivo" />
          <option value="adjetivo" />
          <option value="verbo" />
          <option value="preposición" />
          <option value="adverbio" />
          <option value="pronombre" />
          <option value="conjunción" />
          <option value="interjección" />
          <option value="expresión" />
          <option value="general" />
        </datalist>

        {message ? <p className="success-banner">{message}</p> : null}
      {error ? <p className="error-banner">{error}</p> : null}

      <section className="panel section-stack">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Nueva entrada</p>
            <h2>Agregar termino manual</h2>
          </div>
          <p className="muted section-note">Completa lo minimo necesario y ajusta el resto si quieres fijar mejor el tono.</p>
        </div>

        <div className="editor-card editor-card-create">
          <div className="editor-grid editor-grid-dictionary">
            <label className="form-field form-field-span-2">
              <span>Espanol</span>
              <input
                placeholder="ej. guardian del humo"
                value={draft.spanish}
                onChange={(event) => updateDraft("spanish", event.target.value)}
              />
            </label>

            <label className="form-field form-field-span-2">
              <span>Arcano</span>
              <input
                placeholder="ej. vekh tal"
                value={draft.arcano}
                onChange={(event) => updateDraft("arcano", event.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Pronunciacion</span>
              <input
                placeholder="vekh tal"
                value={draft.pronunciation}
                onChange={(event) => updateDraft("pronunciation", event.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Categoria</span>
              <input list="categories-list" value={draft.category} onChange={(event) => updateDraft("category", event.target.value)} />
            </label>

            <label className="form-field">
              <span>Origen</span>
              <input value={draft.source} onChange={(event) => updateDraft("source", event.target.value)} />
            </label>

            <label className="form-field">
              <span>Confianza</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={draft.confidence}
                onChange={(event) => updateDraft("confidence", event.target.value)}
              />
            </label>
          </div>

          <div className="editor-footer">
            <div className="meta-badges">
              <span className="badge">Persistencia inmediata</span>
              <span className="badge">Lista para traducciones futuras</span>
            </div>
            <button type="button" onClick={createEntry} disabled={isPending}>
              {isPending ? "Guardando..." : "Crear entrada"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel section-stack">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Explorar y editar</p>
            <h2>Entradas actuales</h2>
          </div>
          <p className="muted section-note">La busqueda consulta la API con debounce y luego puedes filtrar y ordenar el resultado visible.</p>
        </div>

        <div className="view-toggle-row">
          <button type="button" className={viewMode === "editor" ? "view-chip is-active" : "view-chip"} onClick={() => setViewMode("editor")}>
            Editor
          </button>
          <button type="button" className={viewMode === "map" ? "view-chip is-active" : "view-chip"} onClick={() => setViewMode("map")}>
            Mapa 2D
          </button>
          <button type="button" className={viewMode === "tree" ? "view-chip is-active" : "view-chip"} onClick={() => setViewMode("tree")}>
            Espacio 3D
          </button>
        </div>

        <div className="toolbar-card">
          <label className="search-field search-field-wide">
            <span>Busqueda</span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar en la API por espanol o arcano"
            />
          </label>

          <label className="search-field">
            <span>Categoria</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">Todas</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="search-field">
            <span>Origen</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">Todos</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>

          <label className="search-field">
            <span>Orden</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="usage">Uso</option>
              <option value="recent">Actualizadas recientemente</option>
              <option value="confidence">Mayor confianza</option>
              <option value="spanish">Espanol A-Z</option>
              <option value="arcano">Arcano A-Z</option>
            </select>
          </label>

          <div className="toolbar-meta">
            <strong>{viewMode === "editor" ? filteredEntries.length : graph?.nodes.length ?? 0}</strong>
            <span>{viewMode === "editor" ? "resultados visibles" : "nodos visibles"}</span>
            {(searchTerm || categoryFilter !== "all" || sourceFilter !== "all" || sortBy !== "usage") && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setSearchTerm("");
                  setCategoryFilter("all");
                  setSourceFilter("all");
                  setSortBy("usage");
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {viewMode === "editor" ? (
          <>
            <div className="editor-card-list">
              {filteredEntries.map((entry) => (
                <article className="editor-card" key={`${entry.id}-${entry.spanish}-${entry.arcano}`}>
                  <div className="editor-card-header">
                    <div>
                      <h3>{entry.spanish}</h3>
                      <div className="meta-badges">
                        <span className="badge">{entry.category}</span>
                        <span className="badge badge-muted">{entry.source}</span>
                        <span className="badge badge-muted">conf. {entry.confidence.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="editor-actions">
                      <button type="button" onClick={() => saveEntry(entry)} disabled={isPending}>
                        Guardar
                      </button>
                      <button type="button" className="secondary-button" onClick={() => removeEntry(entry)} disabled={isPending}>
                        Borrar
                      </button>
                    </div>
                  </div>

                  <div className="editor-grid editor-grid-dictionary">
                    <label className="form-field form-field-span-2">
                      <span>Espanol</span>
                      <input value={entry.spanish} onChange={(event) => updateLocalEntry(entry.id ?? 0, "spanish", event.target.value)} />
                    </label>
                    <label className="form-field form-field-span-2">
                      <span>Arcano</span>
                      <input value={entry.arcano} onChange={(event) => updateLocalEntry(entry.id ?? 0, "arcano", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>Pronunciacion</span>
                      <input
                        value={entry.pronunciation}
                        onChange={(event) => updateLocalEntry(entry.id ?? 0, "pronunciation", event.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>Categoria</span>
                      <input list="categories-list" value={entry.category} onChange={(event) => updateLocalEntry(entry.id ?? 0, "category", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>Origen</span>
                      <input value={entry.source} onChange={(event) => updateLocalEntry(entry.id ?? 0, "source", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>Confianza</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={entry.confidence}
                        onChange={(event) => updateLocalEntry(entry.id ?? 0, "confidence", event.target.value)}
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>

            {filteredEntries.length === 0 ? (
              <div className="empty-state">
                <h3>No hay coincidencias</h3>
                <p>Ajusta la busqueda o limpia los filtros para volver a ver todas las entradas.</p>
              </div>
            ) : null}
          </>
        ) : graph && graph.nodes.length > 0 ? (
          <div className="graph-panel">
            <div className="section-heading section-heading-compact">
              <div>
                <p className="section-kicker">Conexiones vectoriales</p>
                <h2>{viewMode === "map" ? "Mapa 2D" : "Espacio 3D"}</h2>
              </div>
              <span className="badge badge-muted">{graph.edges.length} conexiones</span>
            </div>

              {selectedGraphNode ? (
                <div className="graph-inspector">
                  <div>
                    <p className="section-kicker">Nodo activo</p>
                    <h3>{selectedGraphNode.spanish}</h3>
                    <p className="muted">
                      {selectedGraphNode.arcano} · {selectedGraphNode.category} · {selectedGraphNode.source}
                    </p>
                  </div>

                  <div className="meta-badges">
                    <span className="badge badge-muted">uso {selectedGraphNode.usageCount}</span>
                    <span className="badge badge-muted">conf. {selectedGraphNode.confidence.toFixed(2)}</span>
                    <span className="badge badge-muted">vecinos {Math.max(0, highlightedNodeIds.size - 1)}</span>
                    <span className="badge badge-muted">norma {selectedGraphNode.embeddingNorm.toFixed(4)}</span>
                    <span className="badge badge-muted">embed {selectedGraphNode.hasEmbedding ? "si" : "fallback"}</span>
                  </div>

                  <div className="graph-metrics">
                    <p className="section-kicker">Preview embedding (12 dims)</p>
                    <pre>{selectedGraphNode.embeddingPreview.join(", ") || "sin embedding persistido"}</pre>
                  </div>

                  <div className="graph-metrics">
                    <p className="section-kicker">Conexiones y peso</p>
                    {selectedGraphEdges.length > 0 ? (
                      <ul className="graph-weight-list">
                        {selectedGraphEdges.slice(0, 8).map((edge) => {
                          const neighborId = edge.sourceId === selectedGraphNodeId ? edge.targetId : edge.sourceId;
                          const neighborNode = graph.nodes.find((node) => node.id === neighborId);

                          return (
                            <li key={`${edge.kind}-${edge.sourceId}-${edge.targetId}`}>
                              <span>{neighborNode?.spanish ?? `nodo ${neighborId}`}</span>
                              <small>{edge.kind} · peso {edge.weight.toFixed(4)}</small>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="muted">Sin conexiones directas para este nodo.</p>
                    )}
                  </div>

                  <div className="editor-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm(selectedGraphNode.spanish);
                        setViewMode("editor");
                      }}
                    >
                      Abrir en editor
                    </button>
                  </div>
                </div>
              ) : null}

              {viewMode === "map" ? (
                <DictionaryMap2D
                  graph={graph}
                  selectedNodeId={selectedGraphNodeId}
                  highlightedNodeIds={highlightedNodeIds}
                  onSelectNode={setSelectedGraphNodeId}
                />
              ) : (
                <DictionaryTree3D
                  graph={graph}
                  selectedNodeId={selectedGraphNodeId}
                  highlightedNodeIds={highlightedNodeIds}
                  onSelectNode={setSelectedGraphNodeId}
                />
              )}
          </div>
        ) : (
          <div className="empty-state">
            <h3>Grafo no disponible</h3>
            <p>Prueba con menos filtros o espera a que existan mas embeddings persistidos para estas entradas.</p>
          </div>
        )}
      </section>
    </main>
  );
}