import { ok } from "@/lib/http";
import { guardedRead } from "@/lib/paypal-tool-route";

export const dynamic = "force-dynamic";

/** Disputes via the agent toolkit when live; clearly labelled seeded demo disputes in mock mode. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const call = id ? await guardedRead("get_dispute", { dispute_id: id }) : await guardedRead("list_disputes", { page_size: 20, page: 1 });
  return ok({ call });
}
