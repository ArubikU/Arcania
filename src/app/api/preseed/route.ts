import { NextResponse } from "next/server";

import { bootstrapDictionary } from "@/lib/bootstrap";
import { createPreseedRule, getPreseedRules, updatePreseedRule } from "@/lib/db";

function cleanFreeText(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function cleanShortText(value: string) {
  return cleanFreeText(value).replace(/\s+/g, " ");
}

export async function GET() {
  try {
    await bootstrapDictionary();
    const rules = await getPreseedRules();
    return NextResponse.json({ rules });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron leer las reglas preseed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await bootstrapDictionary();
    const payload = (await request.json()) as {
      name?: string;
      description?: string;
      content?: string;
      isActive?: boolean;
      source?: string;
    };

    const name = cleanShortText(payload.name ?? "");
    const content = cleanFreeText(payload.content ?? "");

    if (!name || !content) {
      return NextResponse.json({ error: "Nombre y contenido son obligatorios." }, { status: 400 });
    }

    const rule = await createPreseedRule({
      name,
      description: cleanFreeText(payload.description ?? ""),
      content,
      isActive: payload.isActive ?? true,
      source: cleanShortText(payload.source ?? "manual-preseed") || "manual-preseed"
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la regla preseed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await bootstrapDictionary();
    const payload = (await request.json()) as {
      id?: number;
      name?: string;
      description?: string;
      content?: string;
      isActive?: boolean;
      source?: string;
    };

    if (!payload.id) {
      return NextResponse.json({ error: "Debes enviar el id de la regla." }, { status: 400 });
    }

    const name = cleanShortText(payload.name ?? "");
    const content = cleanFreeText(payload.content ?? "");

    if (!name || !content) {
      return NextResponse.json({ error: "Nombre y contenido son obligatorios." }, { status: 400 });
    }

    const rule = await updatePreseedRule({
      id: payload.id,
      name,
      description: cleanFreeText(payload.description ?? ""),
      content,
      isActive: payload.isActive ?? true,
      source: cleanShortText(payload.source ?? "manual-preseed") || "manual-preseed"
    });

    return NextResponse.json({ rule });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar la regla preseed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}