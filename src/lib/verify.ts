import { id, nowIso } from "./ids";
import type { DeliveryArtifact, Merchant, OutcomeContract, PlanStep, Verification } from "./types";

const API_KEY_RE = /^mp_live_[A-Za-z0-9]{24}$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.launch\.meshpal\.dev$/;

export function contractForStep(goalId: string, step: PlanStep): OutcomeContract {
  if (step.category === "api_credits") {
    return {
      contract_id: id("contract"),
      goal_id: goalId,
      step_id: step.step_id,
      deliverable: "Scoped API key with a successful test call and available quota",
      required_checks: ["api_key_format", "quota_available", "test_call_success"],
      refund_policy: "full_refund_if_failed",
      max_spend: step.amount,
    };
  }
  if (step.category === "domain") {
    return {
      contract_id: id("contract"),
      goal_id: goalId,
      step_id: step.step_id,
      deliverable: "Registered launch domain with a published DNS record",
      required_checks: ["domain_format", "dns_record_present"],
      refund_policy: "full_refund_if_failed",
      max_spend: step.amount,
    };
  }
  return {
    contract_id: id("contract"),
    goal_id: goalId,
    step_id: step.step_id,
    deliverable: step.action,
    required_checks: ["artifact_present"],
    refund_policy: "full_refund_if_failed",
    max_spend: step.amount,
  };
}

export function deliverArtifact(merchant: Merchant, step: PlanStep): DeliveryArtifact {
  const delivered_at = nowIso();
  if (step.category === "api_credits") {
    if (merchant.fail_delivery) {
      return {
        kind: "api_credits",
        delivered_at,
        payload: {
          api_key: "invalid-key",
          quota_available: 0,
          test_call_success: false,
          note: "Merchant was toggled to deliver a bad artifact (demo failure path).",
        },
      };
    }
    return {
      kind: "api_credits",
      delivered_at,
      payload: {
        api_key: "mp_live_a1b2c3d4e5f6g7h8i9j0k1l2",
        quota_available: 10000,
        test_call_success: true,
        endpoint: "https://api.devtools-ai.example/v1/health",
      },
    };
  }
  if (step.category === "domain") {
    if (merchant.fail_delivery) {
      return {
        kind: "domain",
        delivered_at,
        payload: {
          domain: "not a domain",
          dns_record_present: false,
          note: "Merchant was toggled to deliver a bad artifact (demo failure path).",
        },
      };
    }
    return {
      kind: "domain",
      delivered_at,
      payload: {
        domain: "launchpad.launch.meshpal.dev",
        dns_record_present: true,
        record: { type: "A", value: "203.0.113.10" },
      },
    };
  }
  return {
    kind: "generic",
    delivered_at,
    payload: { ok: !merchant.fail_delivery },
  };
}

export function verifyArtifact(
  contract: OutcomeContract,
  artifact: DeliveryArtifact | undefined,
): Verification {
  const checks: Verification["checks"] = [];
  const payload = artifact?.payload ?? {};

  for (const name of contract.required_checks) {
    if (name === "api_key_format") {
      const key = String(payload.api_key ?? "");
      const passed = API_KEY_RE.test(key);
      checks.push({
        name,
        passed,
        detail: passed
          ? "API key matches the expected mp_live_ format."
          : `API key "${key}" is not a valid mp_live_ key (24-char payload).`,
      });
    } else if (name === "quota_available") {
      const quota = Number(payload.quota_available ?? 0);
      const passed = quota > 0;
      checks.push({
        name,
        passed,
        detail: passed ? `Quota available: ${quota}.` : "No API quota was delivered.",
      });
    } else if (name === "test_call_success") {
      const passed = payload.test_call_success === true;
      checks.push({
        name,
        passed,
        detail: passed ? "Test call to the provider API succeeded." : "Test call failed or was not performed.",
      });
    } else if (name === "domain_format") {
      const domain = String(payload.domain ?? "");
      const passed = DOMAIN_RE.test(domain);
      checks.push({
        name,
        passed,
        detail: passed
          ? `Domain "${domain}" is well-formed.`
          : `Domain "${domain}" is missing or malformed.`,
      });
    } else if (name === "dns_record_present") {
      const passed = payload.dns_record_present === true;
      checks.push({
        name,
        passed,
        detail: passed ? "DNS record is present." : "No DNS record was published for the domain.",
      });
    } else if (name === "artifact_present") {
      const passed = Boolean(artifact) && payload.ok !== false;
      checks.push({
        name,
        passed,
        detail: passed ? "Delivery artifact is present." : "No usable artifact was delivered.",
      });
    } else {
      checks.push({ name, passed: false, detail: `Unknown check "${name}".` });
    }
  }

  return {
    verification_id: id("ver"),
    payment_id: "",
    contract_id: contract.contract_id,
    status: checks.every((c) => c.passed) ? "passed" : "failed",
    checks,
    created_at: nowIso(),
  };
}
