import { NextResponse } from "next/server";

import { bootstrapDictionary } from "@/lib/bootstrap";
import { buildDictionaryGraph } from "@/lib/dictionary-graph";

export async function GET(request: Request) {
  try {
    await bootstrapDictionary();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? undefined;
    const category = searchParams.get("category") ?? undefined;
    const source = searchParams.get("source") ?? undefined;
    const rawLimit = Number(searchParams.get("limit") ?? "140");
    const limit = Number.isFinite(rawLimit) ? Math.max(20, Math.min(180, rawLimit)) : 140;
    const graph = await buildDictionaryGraph({
      search,
      category,
      source,
      limit
    });

    return NextResponse.json({ graph });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo construir el grafo del diccionario.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}