import { fail, ok, readJson } from "@/lib/http";
import { signMandateTemplate, type MandateTemplate } from "@/lib/user-mandates";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** User-only: sign a mandate template with an explicit click (owner role enforced in middleware). */
export async function POST(req: Request) {
  const body = await readJson<{ template?: string }>(req);
  const templates: MandateTemplate[] = ["personal_inr", "coach_paypal_tools"];
  if (!templates.includes(body.template as MandateTemplate)) return fail("template must be personal_inr or coach_paypal_tools");
  const mandate = await updateStore((store) => signMandateTemplate(store, body.template as MandateTemplate));
  return ok({ mandate }, 201);
}
