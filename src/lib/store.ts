import fs from "fs";
import path from "path";
import { generateEd25519Pem } from "./crypto";
import { SEED_MERCHANTS } from "./catalog";
import { seedFinance } from "./finance-seed";
import { monthlyCashFlow } from "./finance-engine";
import { seedCategories, seedMerchantDirectory } from "./merchant-directory";
import { id } from "./ids";
import type { StoreData } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "moneymate.json");

function emptyStore(): StoreData {
  const store: StoreData = {
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
    finance: seedFinance(),
    idempotency: [],
    webhook_receipts: [],
    subscriptions: [],
    renewal_reviews: [],
    reservations: [],
    payment_links: [],
    ai_calls: [],
    subscription_price_history: [],
    recurring_rules: [],
    merchant_directory: [],
    categories: [],
    ai_tool_logs: [],
    financial_snapshots: [],
    paypal_tool_calls: [],
    settings: {
      kill_switch: false,
      signing: generateEd25519Pem(),
    },
  };
  hydrateStore(store);
  return store;
}

let memory: StoreData | null = null;
let writing = Promise.resolve();

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hydrateStore(store: StoreData) {
  if (!store.finance) store.finance = seedFinance();
  store.idempotency ??= [];
  store.webhook_receipts ??= [];
  store.subscriptions ??= [];
  store.renewal_reviews ??= [];
  store.reservations ??= [];
  store.payment_links ??= [];
  store.ai_calls ??= [];
  store.subscription_price_history ??= [];
  store.recurring_rules ??= [];
  store.merchant_directory ??= [];
  store.categories ??= [];
  store.ai_tool_logs ??= store.ai_calls;
  store.financial_snapshots ??= [];
  store.paypal_tool_calls ??= [];
  for (const m of store.mandates) {
    m.per_tx_limit ??= m.auto_approve_limit;
    m.approval_threshold ??= m.per_tx_limit;
    m.allow_recurring ??= false;
    m.minimum_balance ??= 0;
    m.currency ??= "USD";
  }
  // Render disks are ephemeral: if collections are empty on first boot, seed demo data automatically.
  if (!store.categories.length) store.categories = seedCategories();
  if (!store.merchant_directory.length) {
    const names = (store.finance.transactions || []).map((txn) => txn.merchant);
    store.merchant_directory = seedMerchantDirectory(store.merchants || [], names);
  }
  if (!store.financial_snapshots.length && store.finance) {
    const flow = monthlyCashFlow(store.finance);
    store.financial_snapshots.push({
      snapshot_id: id("snap"),
      date: store.finance.profile.as_of,
      month: flow.month,
      balances: flow.net_worth,
      income: flow.income,
      expenses: flow.expenses,
      transfers: flow.transfers,
      net_worth: flow.net_worth,
      currency: "INR",
    });
  }
  for (const sub of store.subscriptions) {
    for (const change of sub.price_history || []) {
      if (!store.subscription_price_history.some((h) => h.history_id === change.change_id)) {
        store.subscription_price_history.push({
          history_id: change.change_id,
          subscription_id: sub.subscription_id,
          old_price: change.previous,
          new_price: change.next,
          changed_at: change.effective_at,
          source: change.source,
          material: change.material,
          currency: sub.currency,
        });
      }
    }
  }
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
    hydrateStore(memory);
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
    const tmp = `${DATA_FILE}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
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
