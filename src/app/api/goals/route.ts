import { fail, ok, readJson } from "@/lib/http";
import { appendEvent } from "@/lib/events";
import { id, nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";
import type { Currency, Goal } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const goals = await updateStore((s) => s.goals);
  return ok({ goals });
}

export async function POST(req: Request) {
  const body = await readJson<{ objective?: string; budget?: number; currency?: Currency; deadline?: string }>(req);
  if (!body.objective?.trim()) return fail("objective is required");
  const budget = Number(body.budget ?? 50);
  if (!Number.isFinite(budget) || budget <= 0) return fail("budget must be a positive number");

  const goal = await updateStore((store) => {
    const goal: Goal = {
      goal_id: id("goal"),
      user_id: "usr_001",
      objective: body.objective!.trim(),
      budget,
      currency: body.currency || "USD",
      deadline: body.deadline,
      created_at: nowIso(),
    };
    store.goals.push(goal);
    appendEvent(store, "goal.created", "Goal captured from natural language", {
      goal_id: goal.goal_id,
      objective: goal.objective,
      budget: goal.budget,
    });
    return goal;
  });
  return ok({ goal }, 201);
}
