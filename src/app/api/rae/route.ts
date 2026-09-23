import { NextResponse } from "next/server";

import { bootstrapDictionary } from "@/lib/bootstrap";
import { analyzeSpanishWithRae, createRaeOverrideEntry } from "@/lib/rae";

export async function POST(request: Request) {
  try {
    await bootstrapDictionary();

    const payload = (await request.json()) as {
      text?: string;
      token?: string;
      canonicalToken?: string;
      mode?: "analyze" | "create-override";
    };
    const text = payload.text?.trim();

    if (!text) {
      return NextResponse.json({ error: "Debes enviar un texto para analizar." }, { status: 400 });
    }

    if (payload.mode === "create-override") {
      const token = payload.token?.trim();
      const canonicalToken = payload.canonicalToken?.trim();

      if (!token || !canonicalToken) {
        return NextResponse.json({ error: "Debes enviar token y canonicalToken para crear el override." }, { status: 400 });
      }

      const created = await createRaeOverrideEntry(text, token, canonicalToken);
      return NextResponse.json(created, { status: 201 });
    }

    const analysis = await analyzeSpanishWithRae(text);
    return NextResponse.json({ analysis });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo consultar el analisis lexico con RAE.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
