import { RaeExplorer } from "@/components/rae-explorer";
import { bootstrapDictionary } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function RaePage() {
  await bootstrapDictionary();
  return <RaeExplorer />;
}
