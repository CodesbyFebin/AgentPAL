import { appendEvent } from "@/lib/events";
import { ok, readJson } from "@/lib/http";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ active?: boolean }>(req);
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
    return store.settings;
  });
  return ok({ kill_switch: settings.kill_switch, kill_switch_at: settings.kill_switch_at });
}
