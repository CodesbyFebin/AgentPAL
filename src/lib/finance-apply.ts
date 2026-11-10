import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import { formatINR, roundMoney } from "./money";
import type { LedgerTxn, Payment, StoreData } from "./types";

/** Apply a captured INR purchase to seeded demo finances. Idempotent per payment_id. USD demo purchases are left off the INR ledger. */
export function applyCapturedPurchase(store: StoreData, payment: Payment): void {
  if (!store.finance) return;
  if (payment.currency !== "INR") return;
  if (store.finance.transactions.some((t) => t.payment_id === payment.payment_id)) return;

  const salary =
    store.finance.accounts.find((a) => a.type === "salary") ?? store.finance.accounts[0];
  if (!salary) return;
  if (salary.balance + 1e-9 < payment.amount) {
    // Dip into savings if the salary account cannot cover it alone.
    const savings = store.finance.accounts.find((a) => a.type === "savings");
    const short = roundMoney(payment.amount - salary.balance);
    if (savings && savings.balance >= short) {
      savings.balance = roundMoney(savings.balance - short);
      salary.balance = 0;
    } else {
      salary.balance = roundMoney(Math.max(0, salary.balance - payment.amount));
    }
  } else {
    salary.balance = roundMoney(salary.balance - payment.amount);
  }

  const txn: LedgerTxn = {
    txn_id: id("txn"),
    account_id: salary.account_id,
    posted_at: nowIso(),
    amount: -roundMoney(payment.amount),
    currency: "INR",
    category: "Electronics",
    merchant: payment.merchant_name,
    note: `PayPal ${payment.paypal?.mode ?? "sandbox"} purchase (verified + captured)`,
    demo: false,
    source: "paypal_purchase",
    payment_id: payment.payment_id,
  };
  store.finance.transactions.push(txn);

  if (payment.finance_impact?.contributions_paused?.length) {
    for (const pause of payment.finance_impact.contributions_paused) {
      const goal = store.finance.savings_goals.find((g) => g.savings_goal_id === pause.savings_goal_id);
      if (!goal) continue;
      goal.monthly_contribution = roundMoney(Math.max(0, goal.monthly_contribution - pause.contribution_paused));
    }
  }

  // Release reservation if any
  for (const r of store.reservations) {
    if (r.payment_id === payment.payment_id && r.status === "reserved") r.status = "captured";
  }

  appendEvent(
    store,
    "finance.updated",
    `Demo ledger updated: ${formatINR(payment.amount)} posted to ${salary.name}. Budgets and goals now reflect the purchase.`,
    {
      goal_id: payment.goal_id,
      payment_id: payment.payment_id,
      account_id: salary.account_id,
      amount: -payment.amount,
    },
  );
}
