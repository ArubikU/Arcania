import { bootstrapDictionary } from "@/lib/bootstrap";
import { TranslatorWorkbench } from "@/components/translator-workbench";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await bootstrapDictionary();
  return <TranslatorWorkbench />;
}