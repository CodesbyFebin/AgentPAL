import { DEMO_FX } from "./money";
import type {
  BankAccount,
  FinanceState,
  LedgerTxn,
  MonthlyBudget,
  SavingsGoalAccount,
  UpcomingBill,
} from "./types";

/** Frozen demo clock: 10 Nov 2026, noon IST (Asia/Calcutta, UTC+5:30). */
export const DEMO_AS_OF = "2026-11-10T06:30:00.000Z";
export const DEMO_MONTH = "2026-11";
export const DEMO_USER_ID = "usr_demo_priya";
export const DEMO_USER_NAME = "Priya Sharma (demo)";

export const SEED_BALANCES = {
  salary: 82400,
  savings: 125000,
} as const;

export const SEED_EMERGENCY_BUFFER = 80000;
export const SEED_NEXT_INCOME_AT = "2026-11-30T03:30:00.000Z"; // 30 Nov 2026, 09:00 IST
export const SEED_NEXT_INCOME_AMOUNT = 120000;

export { LAPTOP_INR, CHEAPER_LAPTOP_INR } from "./finance-constants";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoIst(y: number, m: number, d: number, hh = 12, mm = 0): string {
  // IST is UTC+5:30
  const utc = Date.UTC(y, m - 1, d, hh - 5, mm - 30);
  return new Date(utc).toISOString();
}

function rupees(n: number): number {
  return Math.round(n * 100) / 100;
}

export function seedAccounts(): BankAccount[] {
  return [
    {
      account_id: "acc_hdfc_salary",
      name: "HDFC Salary Account",
      institution: "HDFC Bank",
      type: "salary",
      balance: SEED_BALANCES.salary,
      currency: "INR",
      demo: true,
    },
    {
      account_id: "acc_sbi_savings",
      name: "SBI Savings",
      institution: "State Bank of India",
      type: "savings",
      balance: SEED_BALANCES.savings,
      currency: "INR",
      demo: true,
    },
  ];
}

export function seedBills(): UpcomingBill[] {
  return [
    {
      bill_id: "bill_rent",
      name: "House rent",
      amount: 28000,
      due_at: isoIst(2026, 11, 15, 9),
      category: "Housing",
      recurring: true,
      currency: "INR",
    },
    {
      bill_id: "bill_emi",
      name: "Car EMI",
      amount: 12500,
      due_at: isoIst(2026, 11, 12, 9),
      category: "Loans",
      recurring: true,
      currency: "INR",
    },
    {
      bill_id: "bill_power",
      name: "Electricity (BESCOM)",
      amount: 2400,
      due_at: isoIst(2026, 11, 18, 9),
      category: "Utilities",
      recurring: true,
      currency: "INR",
    },
    {
      bill_id: "bill_fiber",
      name: "Home fibre internet",
      amount: 999,
      due_at: isoIst(2026, 11, 20, 9),
      category: "Utilities",
      recurring: true,
      currency: "INR",
    },
    {
      bill_id: "bill_mobile",
      name: "Mobile postpaid",
      amount: 599,
      due_at: isoIst(2026, 11, 14, 9),
      category: "Utilities",
      recurring: true,
      currency: "INR",
    },
    {
      bill_id: "bill_health",
      name: "Health insurance premium",
      amount: 3200,
      due_at: isoIst(2026, 11, 22, 9),
      category: "Insurance",
      recurring: true,
      currency: "INR",
    },
  ];
}

export function seedGoals(): SavingsGoalAccount[] {
  return [
    {
      savings_goal_id: "goal_emergency",
      name: "Emergency fund top-up",
      target_amount: 200000,
      current_amount: 80000,
      monthly_contribution: 5000,
      currency: "INR",
      deadline: isoIst(2027, 6, 30),
      priority: 3,
    },
    {
      savings_goal_id: "goal_vacation",
      name: "Goa vacation",
      target_amount: 80000,
      current_amount: 22000,
      monthly_contribution: 8000,
      currency: "INR",
      deadline: isoIst(2026, 12, 20),
      priority: 1,
    },
    {
      savings_goal_id: "goal_home",
      name: "Home down payment",
      target_amount: 800000,
      current_amount: 145000,
      monthly_contribution: 12000,
      currency: "INR",
      deadline: isoIst(2028, 3, 31),
      priority: 2,
    },
  ];
}

export function seedBudgets(): MonthlyBudget[] {
  return [
    { budget_id: "bud_groceries", category: "Groceries", monthly_limit: 12000, currency: "INR", month: DEMO_MONTH },
    { budget_id: "bud_dining", category: "Dining", monthly_limit: 6000, currency: "INR", month: DEMO_MONTH },
    { budget_id: "bud_transport", category: "Transport", monthly_limit: 5000, currency: "INR", month: DEMO_MONTH },
    { budget_id: "bud_shopping", category: "Shopping", monthly_limit: 8000, currency: "INR", month: DEMO_MONTH },
    { budget_id: "bud_utilities", category: "Utilities", monthly_limit: 6000, currency: "INR", month: DEMO_MONTH },
    { budget_id: "bud_entertainment", category: "Entertainment", monthly_limit: 4000, currency: "INR", month: DEMO_MONTH },
    { budget_id: "bud_electronics", category: "Electronics", monthly_limit: 15000, currency: "INR", month: DEMO_MONTH },
  ];
}

const MERCHANTS: Record<string, string[]> = {
  Groceries: ["Nature's Basket", "DMart Koramangala", "More Supermarket", "Milkbasket"],
  Dining: ["Third Wave Coffee", "Toit Brewpub", "Meghana Foods", "Box8", "Starbucks Indiranagar"],
  Transport: ["Namma Metro", "Uber", "Rapido", "Indian Oil petrol"],
  Shopping: ["Myntra", "Ajio", "IKEA Bengaluru"],
  Entertainment: ["BookMyShow", "Netflix", "Spotify"],
  Utilities: ["BESCOM autopay", "Airtel Fibre", "Jio Postpaid"],
  Health: ["Apollo Pharmacy", "Practo consult"],
  Income: ["Acme Labs Pvt Ltd"],
  Housing: ["Landlord NEFT"],
  Loans: ["HDFC Car Loan"],
  Insurance: ["Star Health"],
  Transfers: ["Self transfer to SBI"],
};

export function seedTransactions(asOf = new Date(DEMO_AS_OF)): LedgerTxn[] {
  const rand = mulberry32(20261110);
  const txs: LedgerTxn[] = [];
  let n = 0;
  const add = (partial: Omit<LedgerTxn, "txn_id" | "currency" | "demo" | "source">) => {
    n += 1;
    txs.push({
      txn_id: `txn_seed_${String(n).padStart(3, "0")}`,
      currency: "INR",
      demo: true,
      source: "seed",
      ...partial,
    });
  };

  const start = new Date(asOf.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Recurring monthly items from Aug–Oct (Nov counterparts are still "upcoming bills")
  const months: Array<[number, number]> = [
    [2026, 8],
    [2026, 9],
    [2026, 10],
  ];
  for (const [y, m] of months) {
    add({
      account_id: "acc_hdfc_salary",
      posted_at: isoIst(y, m, 30, 9, 5),
      amount: 120000,
      category: "Income",
      merchant: "Acme Labs Pvt Ltd",
      note: "Monthly salary credit",
    });
    add({
      account_id: "acc_hdfc_salary",
      posted_at: isoIst(y, m, 15, 8, 10),
      amount: -28000,
      category: "Housing",
      merchant: "Landlord NEFT",
      note: "House rent",
    });
    add({
      account_id: "acc_hdfc_salary",
      posted_at: isoIst(y, m, 12, 8, 0),
      amount: -12500,
      category: "Loans",
      merchant: "HDFC Car Loan",
      note: "Car EMI",
    });
    add({
      account_id: "acc_hdfc_salary",
      posted_at: isoIst(y, m, 18, 10, 0),
      amount: -2400,
      category: "Utilities",
      merchant: "BESCOM autopay",
      note: "Electricity",
    });
    add({
      account_id: "acc_hdfc_salary",
      posted_at: isoIst(y, m, 20, 10, 0),
      amount: -999,
      category: "Utilities",
      merchant: "Airtel Fibre",
      note: "Home internet",
    });
    add({
      account_id: "acc_hdfc_salary",
      posted_at: isoIst(y, m, 14, 10, 0),
      amount: -599,
      category: "Utilities",
      merchant: "Jio Postpaid",
      note: "Mobile postpaid",
    });
    add({
      account_id: "acc_sbi_savings",
      posted_at: isoIst(y, m, 28, 11, 0),
      amount: 15000,
      category: "Transfers",
      merchant: "Self transfer to SBI",
      note: "Monthly sweep to savings",
    });
    add({
      account_id: "acc_hdfc_salary",
      posted_at: isoIst(y, m, 28, 11, 0),
      amount: -15000,
      category: "Transfers",
      merchant: "Self transfer to SBI",
      note: "Monthly sweep to savings",
    });
  }

  // Discretionary daily-ish spend across 90 days
  const categories: Array<{ cat: string; account: string; min: number; max: number; everyDays: number }> = [
    { cat: "Groceries", account: "acc_hdfc_salary", min: 650, max: 2800, everyDays: 5 },
    { cat: "Dining", account: "acc_hdfc_salary", min: 280, max: 1600, everyDays: 6 },
    { cat: "Transport", account: "acc_hdfc_salary", min: 80, max: 650, everyDays: 3 },
    { cat: "Shopping", account: "acc_hdfc_salary", min: 899, max: 3499, everyDays: 18 },
    { cat: "Entertainment", account: "acc_hdfc_salary", min: 199, max: 899, everyDays: 14 },
    { cat: "Health", account: "acc_hdfc_salary", min: 250, max: 1200, everyDays: 20 },
  ];

  for (const rule of categories) {
    for (let t = start.getTime(); t < asOf.getTime(); t += rule.everyDays * 24 * 60 * 60 * 1000) {
      const jitter = Math.floor(rand() * 36 * 60 * 60 * 1000);
      const when = new Date(t + jitter);
      if (when >= asOf) continue;
      // Skip November recurring-bill days already covered; discretionary is fine
      const names = MERCHANTS[rule.cat];
      const merchant = names[Math.floor(rand() * names.length)];
      const amount = -rupees(rule.min + rand() * (rule.max - rule.min));
      add({
        account_id: rule.account,
        posted_at: when.toISOString(),
        amount,
        category: rule.cat,
        merchant,
        note: "Seeded demo spend",
      });
    }
  }

  txs.sort((a, b) => a.posted_at.localeCompare(b.posted_at) || a.txn_id.localeCompare(b.txn_id));
  return txs.filter((tx) => new Date(tx.posted_at) >= start && new Date(tx.posted_at) <= asOf);
}

export function seedFinance(): FinanceState {
  return {
    profile: {
      user_id: DEMO_USER_ID,
      display_name: DEMO_USER_NAME,
      as_of: DEMO_AS_OF,
      timezone: "Asia/Calcutta",
      currency: "INR",
      emergency_buffer: SEED_EMERGENCY_BUFFER,
      next_income_at: SEED_NEXT_INCOME_AT,
      next_income_amount: SEED_NEXT_INCOME_AMOUNT,
      fx: {
        paypal_currency: "USD",
        inr_per_usd: DEMO_FX.inrPerUsd,
        label: DEMO_FX.label,
        source: "demo fixed rate",
      },
      demo: true,
    },
    accounts: seedAccounts(),
    transactions: seedTransactions(),
    budgets: seedBudgets(),
    savings_goals: seedGoals(),
    bills: seedBills(),
  };
}

export function billsBeforeNextIncomeTotal(bills = seedBills(), nextIncomeAt = SEED_NEXT_INCOME_AT): number {
  const next = new Date(nextIncomeAt).getTime();
  return rupees(bills.filter((b) => !b.paid && new Date(b.due_at).getTime() <= next).reduce((s, b) => s + b.amount, 0));
}

export function goalContributionsTotal(goals = seedGoals()): number {
  return rupees(goals.reduce((s, g) => s + g.monthly_contribution, 0));
}
