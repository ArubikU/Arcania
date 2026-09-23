import { PreseedManager } from "@/components/preseed-manager";
import { bootstrapDictionary } from "@/lib/bootstrap";
import { getPreseedRules } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PreseedPage() {
  await bootstrapDictionary();
  const rules = await getPreseedRules();

  return <PreseedManager initialRules={rules} />;
}