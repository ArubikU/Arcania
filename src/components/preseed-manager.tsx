"use client";

import { useState, useTransition } from "react";

import type { PreseedRule } from "@/types";

type Props = {
  initialRules: PreseedRule[];
};

const EMPTY_RULE: PreseedRule = {
  name: "",
  description: "",
  content: "",
  isActive: true,
  source: "manual-preseed"
};

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "La operacion fallo.");
  }

  return payload;
}

export function PreseedManager({ initialRules }: Props) {
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState<PreseedRule>(EMPTY_RULE);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      !normalizedSearch ||
      [rule.name, rule.description, rule.content, rule.source].join(" ").toLowerCase().includes(normalizedSearch);
    const matchesStatus =
      statusFilter === "all" || (statusFilter === "active" ? rule.isActive : !rule.isActive);

    return matchesSearch && matchesStatus;
  });
  const activeCount = rules.filter((rule) => rule.isActive).length;
  const inactiveCount = rules.length - activeCount;
  const manualCount = rules.filter((rule) => rule.source === "manual-preseed").length;

  function updateDraft(field: keyof PreseedRule, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateRule(id: number, field: keyof PreseedRule, value: string | boolean) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, [field]: value } : rule)));
  }

  function createRule() {
    setError(null);
    setMessage(null);

    startTransition(() => {
      readJson<{ rule: PreseedRule }>("/api/preseed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(draft)
      })
        .then((payload) => {
          setRules((current) => [payload.rule, ...current]);
          setDraft(EMPTY_RULE);
          setMessage(`Regla ${payload.rule.name} creada.`);
        })
        .catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo crear la regla.");
        });
    });
  }

  function saveRule(rule: PreseedRule) {
    setError(null);
    setMessage(null);

    startTransition(() => {
      readJson<{ rule: PreseedRule }>("/api/preseed", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(rule)
      })
        .then((payload) => {
          setRules((current) => current.map((item) => (item.id === payload.rule.id ? payload.rule : item)));
          setMessage(`Regla ${payload.rule.name} actualizada.`);
        })
        .catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la regla.");
        });
    });
  }

  return (
    <main className="shell shell-wide page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Contexto editorial</p>
          <h1>Reglas preseed claras, filtrables y faciles de mantener.</h1>
          <p className="lede">
            Usa estas reglas para fijar estilo, restricciones, equivalencias y tono del idioma antes de que el
            modelo improvise. La vista separa creacion, revision y activacion para que el flujo sea mas controlado.
          </p>
        </div>

        <div className="stat-grid stat-grid-compact">
          <article className="stat-card">
            <span>Total</span>
            <strong>{rules.length}</strong>
            <small>Reglas registradas</small>
          </article>
          <article className="stat-card">
            <span>Activas</span>
            <strong>{activeCount}</strong>
            <small>Incluidas en el prompt</small>
          </article>
          <article className="stat-card">
            <span>Inactivas</span>
            <strong>{inactiveCount}</strong>
            <small>Disponibles pero pausadas</small>
          </article>
          <article className="stat-card">
            <span>Manual</span>
            <strong>{manualCount}</strong>
            <small>Creadas desde la UI</small>
          </article>
        </div>
      </section>

      {message ? <p className="success-banner">{message}</p> : null}
      {error ? <p className="error-banner">{error}</p> : null}

      <section className="panel section-stack">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Nueva regla</p>
            <h2>Agregar contexto editorial</h2>
          </div>
          <p className="muted section-note">Escribe reglas concretas y accionables. Si esta activa, entrara al prompt en la siguiente traduccion.</p>
        </div>

        <div className="editor-card editor-card-create">
          <div className="editor-grid editor-grid-preseed">
            <label className="form-field">
              <span>Nombre</span>
              <input placeholder="ej. tono ceremonial" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} />
            </label>
            <label className="form-field">
              <span>Descripcion</span>
              <input
                placeholder="Resumen corto para identificar la regla"
                value={draft.description}
                onChange={(event) => updateDraft("description", event.target.value)}
              />
            </label>
            <label className="form-field form-field-span-full">
              <span>Contenido</span>
              <textarea
                className="compact-textarea"
                placeholder="Restricciones, equivalencias, tono, excepciones, estilo permitido"
                value={draft.content}
                onChange={(event) => updateDraft("content", event.target.value)}
              />
            </label>
            <label className="toggle-row toggle-card">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => updateDraft("isActive", event.target.checked)}
              />
              <span>Activar esta regla inmediatamente</span>
            </label>
          </div>

          <div className="editor-footer">
            <div className="meta-badges">
              <span className="badge">Prompt contextual</span>
              <span className="badge">Control de estilo</span>
            </div>
            <button type="button" onClick={createRule} disabled={isPending}>
              {isPending ? "Guardando..." : "Crear regla"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel section-stack">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Revisar y mantener</p>
            <h2>Reglas actuales</h2>
          </div>
          <p className="muted section-note">Busca por nombre o contenido y alterna entre activas e inactivas.</p>
        </div>

        <div className="toolbar-card">
          <label className="search-field search-field-wide">
            <span>Busqueda</span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por nombre, descripcion, contenido u origen"
            />
          </label>

          <label className="search-field">
            <span>Estado</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todas</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
          </label>

          <div className="toolbar-meta">
            <strong>{filteredRules.length}</strong>
            <span>reglas visibles</span>
            {(searchTerm || statusFilter !== "all") && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        <div className="editor-card-list">
          {filteredRules.map((rule) => (
            <article className="editor-card" key={`${rule.id}-${rule.name}`}>
              <div className="editor-card-header">
                <div>
                  <h3>{rule.name}</h3>
                  <div className="meta-badges">
                    <span className={`badge ${rule.isActive ? "badge-success" : "badge-muted"}`}>
                      {rule.isActive ? "Activa" : "Inactiva"}
                    </span>
                    <span className="badge badge-muted">{rule.source}</span>
                  </div>
                </div>

                <div className="editor-actions">
                  <button type="button" onClick={() => saveRule(rule)} disabled={isPending}>
                    Guardar regla
                  </button>
                </div>
              </div>

              <div className="editor-grid editor-grid-preseed">
                <label className="form-field">
                  <span>Nombre</span>
                  <input value={rule.name} onChange={(event) => updateRule(rule.id ?? 0, "name", event.target.value)} />
                </label>
                <label className="form-field">
                  <span>Descripcion</span>
                  <input
                    value={rule.description}
                    onChange={(event) => updateRule(rule.id ?? 0, "description", event.target.value)}
                  />
                </label>
                <label className="form-field form-field-span-full">
                  <span>Contenido</span>
                  <textarea
                    className="compact-textarea"
                    value={rule.content}
                    onChange={(event) => updateRule(rule.id ?? 0, "content", event.target.value)}
                  />
                </label>
                <label className="toggle-row toggle-card">
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    onChange={(event) => updateRule(rule.id ?? 0, "isActive", event.target.checked)}
                  />
                  <span>Incluir esta regla en el prompt</span>
                </label>
              </div>
            </article>
          ))}
        </div>

        {filteredRules.length === 0 ? (
          <div className="empty-state">
            <h3>No hay reglas para esa vista</h3>
            <p>Cambia la busqueda o el estado para volver a ver el conjunto completo.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}