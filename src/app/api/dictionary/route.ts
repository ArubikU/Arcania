import { NextResponse } from "next/server";

import { bootstrapDictionary } from "@/lib/bootstrap";
import { createDictionaryEntry, deleteDictionaryEntry, getDictionary, updateDictionaryEntry } from "@/lib/db";
import { ensureEmbeddingsForEntries } from "@/lib/dictionary-embeddings";
import { toPronunciation } from "@/lib/arcano-script";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCategory(value: string) {
  return normalizeText(value).replace(/[^a-z0-9\s-]/g, "");
}

export async function GET(request: Request) {
  try {
    await bootstrapDictionary();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? undefined;
    const entries = await getDictionary(search);

    return NextResponse.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer el diccionario.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await bootstrapDictionary();

    const payload = (await request.json()) as {
      id?: number;
      spanish?: string;
      arcano?: string;
      pronunciation?: string;
      category?: string;
      source?: string;
      confidence?: number;
    };

    if (!payload.id) {
      return NextResponse.json({ error: "Debes enviar el id de la entrada." }, { status: 400 });
    }

    const spanish = normalizeText(payload.spanish ?? "");
    const arcano = normalizeText(payload.arcano ?? "");

    if (!spanish || !arcano) {
      return NextResponse.json({ error: "Espanol y arcano son obligatorios." }, { status: 400 });
    }

    const entry = await updateDictionaryEntry({
      id: payload.id,
      spanish,
      arcano,
      pronunciation: normalizeText(payload.pronunciation ?? "") || toPronunciation(arcano),
      category: normalizeCategory(payload.category ?? "general") || "general",
      source: normalizeCategory(payload.source ?? "manual") || "manual",
      confidence: Math.max(0, Math.min(1, Number(payload.confidence ?? 1)))
    });

    await ensureEmbeddingsForEntries([entry]).catch(() => undefined);

    return NextResponse.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el diccionario.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await bootstrapDictionary();

    const payload = (await request.json()) as {
      spanish?: string;
      arcano?: string;
      pronunciation?: string;
      category?: string;
      source?: string;
      confidence?: number;
    };

    const spanish = normalizeText(payload.spanish ?? "");
    const arcano = normalizeText(payload.arcano ?? "");

    if (!spanish || !arcano) {
      return NextResponse.json({ error: "Espanol y arcano son obligatorios." }, { status: 400 });
    }

    const entry = await createDictionaryEntry({
      spanish,
      arcano,
      pronunciation: normalizeText(payload.pronunciation ?? "") || toPronunciation(arcano),
      category: normalizeCategory(payload.category ?? "general") || "general",
      source: normalizeCategory(payload.source ?? "manual") || "manual",
      confidence: Math.max(0, Math.min(1, Number(payload.confidence ?? 1)))
    });

    await ensureEmbeddingsForEntries([entry]).catch(() => undefined);

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la entrada del diccionario.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await bootstrapDictionary();

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get("id");
    const id = Number(rawId);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Debes enviar un id valido." }, { status: 400 });
    }

    const entry = await deleteDictionaryEntry(id);
    return NextResponse.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo borrar la entrada del diccionario.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}