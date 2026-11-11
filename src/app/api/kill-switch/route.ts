import { appendEvent } from "@/lib/events";
import { disablePaymentLinksForKillSwitch, reenablePaymentLinksAfterKillSwitch } from "@/lib/pay-links";
import { ok, readJson } from "@/lib/http";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";
import { roleFromCookieHeader } from "@/lib/security";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ active?: boolean }>(req);
  // Anyone may stop the agent; only the owner may resume it.
  if (roleFromCookieHeader(req.headers.get("cookie")) === "viewer" && body.active !== true) {
    return NextResponse.json({ error: "Viewer role can engage the kill switch but only the owner can release it." }, { status: 403 });
  }
  const settings = await updateStore((store) => {
    const active = body.active ?? !store.settings.kill_switch;
    store.settings.kill_switch = active;
    store.settings.kill_switch_at = active ? nowIso() : undefined;
    appendEvent(
      store,
      active ? "kill_switch.on" : "kill_switch.off",
      active
        ? "Kill switch engaged. All agent financial activity is frozen."
        : "Kill switch released. Agent activity may resume under the mandate.",
      { kill_switch: active },
    );
    if (active) disablePaymentLinksForKillSwitch(store);
    else reenablePaymentLinksAfterKillSwitch(store);
    return store.settings;
  });
  return ok({ kill_switch: settings.kill_switch, kill_switch_at: settings.kill_switch_at });
}
