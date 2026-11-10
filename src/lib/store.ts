import fs from "fs";
import path from "path";
import { generateEd25519Pem } from "./crypto";
import { SEED_MERCHANTS } from "./catalog";
import type { StoreData } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "meshpal.json");

function emptyStore(): StoreData {
  return {
    goals: [],
    mandates: [],
    plans: [],
    payments: [],
    verifications: [],
    receipts: [],
    events: [],
    approvals: [],
    merchants: structuredClone(SEED_MERCHANTS),
    contracts: [],
    evidence: [],
    settings: {
      kill_switch: false,
      signing: generateEd25519Pem(),
    },
  };
}

let memory: StoreData | null = null;
let writing = Promise.resolve();

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readStore(): StoreData {
  if (memory) return memory;
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) {
    memory = emptyStore();
    fs.writeFileSync(DATA_FILE, JSON.stringify(memory, null, 2));
    return memory;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    memory = JSON.parse(raw) as StoreData;
    return memory;
  } catch {
    memory = emptyStore();
    fs.writeFileSync(DATA_FILE, JSON.stringify(memory, null, 2));
    return memory;
  }
}

export async function updateStore<T>(mutator: (store: StoreData) => T | Promise<T>): Promise<T> {
  const run = writing.then(async () => {
    const store = readStore();
    const result = await mutator(store);
    ensureDir();
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    memory = store;
    return result;
  });
  writing = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resetStore(): StoreData {
  const signing = memory?.settings.signing ?? generateEd25519Pem();
  memory = { ...emptyStore(), settings: { kill_switch: false, signing } };
  ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(memory, null, 2));
  return memory;
}

export function paypalMode(): "sandbox" | "mock" {
  return process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
    ? "sandbox"
    : "mock";
}

export function plannerMode(): { planner: "offline" | "ai"; model?: string } {
  if (process.env.AI_API_KEY) {
    return { planner: "ai", model: process.env.AI_MODEL || "gpt-4o-mini" };
  }
  return { planner: "offline" };
}

export function spentAgainstMandate(store: StoreData, mandateId: string): number {
  return store.payments
    .filter(
      (p) =>
        p.mandate_id === mandateId &&
        ["authorized", "captured", "settled", "awaiting_buyer", "awaiting_approval"].includes(
          p.status,
        ),
    )
    .reduce((sum, p) => sum + p.amount, 0);
}

export function remainingBudget(store: StoreData, mandateId: string): number {
  const mandate = store.mandates.find((m) => m.mandate_id === mandateId);
  if (!mandate) return 0;
  const committed = store.payments
    .filter(
      (p) =>
        p.mandate_id === mandateId &&
        !["voided", "refunded", "denied", "failed"].includes(p.status),
    )
    .reduce((sum, p) => sum + p.amount, 0);
  return Math.max(0, Number((mandate.max_total_spend - committed).toFixed(2)));
}

export function capturedSpend(store: StoreData, mandateId: string): number {
  return store.payments
    .filter(
      (p) =>
        p.mandate_id === mandateId &&
        (p.status === "captured" || p.status === "settled"),
    )
    .reduce((sum, p) => sum + p.amount, 0);
}
