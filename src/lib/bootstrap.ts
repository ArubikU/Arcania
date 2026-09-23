import { ensureSchema, seedDictionary } from "@/lib/db";
import { loadSeedDictionary } from "@/lib/seed-dictionary";

let bootstrapped = false;

export async function bootstrapDictionary() {
  if (bootstrapped) {
    return;
  }

  await ensureSchema();
  //const seedEntries = await loadSeedDictionary();
  //await seedDictionary(seedEntries);
  bootstrapped = true;
}