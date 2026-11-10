import { fail, ok, readJson } from "@/lib/http";
import { verifyReceiptSignature } from "@/lib/receipts";
import { updateStore } from "@/lib/store";
import type { Receipt } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ receipt?: Receipt; receipt_id?: string }>(req);
  try {
    const receipt =
      body.receipt ||
      (body.receipt_id
        ? await updateStore((s) => s.receipts.find((r) => r.receipt_id === body.receipt_id) ?? null)
        : null);
    if (!receipt) return fail("receipt or receipt_id is required", 400);
    const valid = verifyReceiptSignature(receipt);
    return ok({ valid, receipt_id: receipt.receipt_id, outcome: receipt.outcome, audit_hash: receipt.audit_hash });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "verify failed", 400);
  }
}
