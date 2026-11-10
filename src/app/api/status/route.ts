import { ok } from "@/lib/http";
import { snapshot } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await snapshot();
  return ok(data);
}
