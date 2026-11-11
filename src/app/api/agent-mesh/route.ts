import { ok } from "@/lib/http";
import { agentMeshView } from "@/lib/agent-mesh";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(await agentMeshView());
}
