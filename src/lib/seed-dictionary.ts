import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DictionaryEntry } from "@/types";

const HEADER_TO_CATEGORY: Record<string, string> = {
  conectores: "connector",
  articulos: "article",
  pronombres: "pronoun",
  verbos: "verb",
  palabras: "noun"
};

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function isDividerRow(value: string) {
  return /^-+$/.test(value);
}

function buildPronunciation(word: string) {
  return word
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/([aeiou])/g, "$1-")
    .replace(/-\s/g, " ")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function loadSeedDictionary(): Promise<DictionaryEntry[]> {
  const filePath = path.join(process.cwd(), "language2.md");
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const entries: DictionaryEntry[] = [];

  let currentCategory = "general";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (!line.startsWith("|")) {
      const normalized = normalizeLabel(line);
      if (HEADER_TO_CATEGORY[normalized]) {
        currentCategory = HEADER_TO_CATEGORY[normalized];
      }
      continue;
    }

    const cells = line
      .split("|")
      .map((cell: string) => cell.trim())
      .filter(Boolean);

    if (cells.length < 2) {
      continue;
    }

    const left = normalizeLabel(cells[0]);
    const right = normalizeLabel(cells[1]);

    if (!left || !right) {
      continue;
    }

    if (
      left.includes("funcion") ||
      left.includes("espanol") ||
      left.includes("idioma") ||
      left.includes("palabra") ||
      isDividerRow(left) ||
      isDividerRow(right)
    ) {
      continue;
    }

    entries.push({
      spanish: left,
      arcano: right,
      pronunciation: buildPronunciation(right),
      category: currentCategory,
      source: "seed-markdown",
      confidence: 1
    });
  }

  const deduped = new Map<string, DictionaryEntry>();

  for (const entry of entries) {
    const key = `${entry.spanish}::${entry.arcano}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()];
}