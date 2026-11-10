import { DEMO_AS_OF } from "./finance-seed";
import { formatINR, fxBreakdown, roundMoney } from "./money";
import type {
  AffordabilityAlternative,
  AffordabilityResult,
  AffordabilityVerdict,
  BankAccount,
  FinanceState,
  GoalContributionPause,
  MonthlyBudget,
  SavingsGoalAccount,
  UpcomingBill,
} from "./types";

export interface AffordabilityInput {
  asOf?: Date | string;
  accounts: Pick<BankAccount, "balance">[];
  bills: Pick<UpcomingBill, "amount" | "due_at" | "paid" | "name">[];
  emergencyBuffer: number;
  goals: Pick<
    SavingsGoalAccount,
    "savings_goal_id" | "name" | "monthly_contribution" | "current_amount" | "target_amount" | "priority" | "deadline"
  >[];
  nextIncomeAt: string;
  nextIncomeAmount: number;
  amount: number;
  requestLabel?: string;
  cheaperAlternativeAmount?: number;
  cheaperAlternativeSku?: string;
}

function asDate(value: Date | string | undefined, fallback = DEMO_AS_OF): Date {
  if (!value) return new Date(fallback);
  return value instanceof Date ? value : new Date(value);
}

export function totalBalances(accounts: Pick<BankAccount, "balance">[]): number {
  return roundMoney(accounts.reduce((s, a) => s + a.balance, 0));
}

export function upcomingBillsBeforeNextIncome(
  bills: Pick<UpcomingBill, "amount" | "due_at" | "paid">[],
  nextIncomeAt: string,
): number {
  const next = new Date(nextIncomeAt).getTime();
  return roundMoney(
    bills
      .filter((b) => !b.paid && Number.isFinite(new Date(b.due_at).getTime()) && new Date(b.due_at).getTime() <= next)
      .reduce((s, b) => s + b.amount, 0),
  );
}

export function remainingGoalContributions(
  goals: Pick<SavingsGoalAccount, "monthly_contribution">[],
): number {
  return roundMoney(goals.reduce((s, g) => s + Math.max(0, g.monthly_contribution), 0));
}

/**
 * Cash that can be spent without touching upcoming bills (due before the next
 * income credit), the emergency buffer, or this month's planned goal contributions.
 */
export function availableToSpend(input: {
  accounts: Pick<BankAccount, "balance">[];
  bills: Pick<UpcomingBill, "amount" | "due_at" | "paid">[];
  emergencyBuffer: number;
  goals: Pick<SavingsGoalAccount, "monthly_contribution">[];
  nextIncomeAt: string;
}): number {
  const raw =
    totalBalances(input.accounts) -
    upcomingBillsBeforeNextIncome(input.bills, input.nextIncomeAt) -
    input.emergencyBuffer -
    remainingGoalContributions(input.goals);
  return roundMoney(Math.max(0, raw));
}

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  // Demo clock is IST; bills/income instants are stored as UTC equivalents of IST civil dates.
  return `${y}-${String(m).padStart(2, "0")}`;
}

function endOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1);
}

export function projectedEndOfMonth(input: {
  asOf: Date;
  accounts: Pick<BankAccount, "balance">[];
  bills: Pick<UpcomingBill, "amount" | "due_at" | "paid">[];
  goals: Pick<SavingsGoalAccount, "monthly_contribution">[];
  nextIncomeAt: string;
  nextIncomeAmount: number;
  purchaseAmount?: number;
}): number {
  const asOf = input.asOf;
  const eom = endOfUtcMonth(asOf);
  const billsThisMonth = input.bills
    .filter((b) => {
      const due = new Date(b.due_at);
      return !b.paid && due >= asOf && due <= eom;
    })
    .reduce((s, b) => s + b.amount, 0);
  const income = new Date(input.nextIncomeAt);
  const incomeThisMonth = income >= asOf && income <= eom ? input.nextIncomeAmount : 0;
  return roundMoney(
    totalBalances(input.accounts) -
      billsThisMonth +
      incomeThisMonth -
      remainingGoalContributions(input.goals) -
      (input.purchaseAmount ?? 0),
  );
}

function weeksUntil(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (7 * 24 * 60 * 60 * 1000));
}

function delayWeeksForPause(goal: AffordabilityInput["goals"][number], paused: number): number {
  if (paused <= 0) return 0;
  const remaining = Math.max(0, goal.target_amount - goal.current_amount);
  if (remaining <= 0) return 0;
  const monthly = goal.monthly_contribution;
  if (monthly <= 0) return 0;
  // Pausing `paused` this month extends the plan by paused/monthly months, in weeks.
  return Math.max(1, Math.ceil((paused / monthly) * 4));
}

/**
 * Cover a shortfall by pausing contributions, lowest priority number first
 * (1 = most discretionary).
 */
export function planContributionPauses(
  goals: AffordabilityInput["goals"],
  shortfall: number,
): GoalContributionPause[] {
  if (shortfall <= 0) return [];
  const ordered = [...goals].sort((a, b) => a.priority - b.priority);
  const pauses: GoalContributionPause[] = [];
  let left = roundMoney(shortfall);
  for (const goal of ordered) {
    if (left <= 0) break;
    const usable = Math.max(0, goal.monthly_contribution);
    if (usable <= 0) continue;
    const paused = roundMoney(Math.min(usable, left));
    const weeks = delayWeeksForPause(goal, paused);
    pauses.push({
      savings_goal_id: goal.savings_goal_id,
      name: goal.name,
      contribution_paused: paused,
      delayed_weeks: weeks,
      detail:
        paused >= usable
          ? `Pause this month's ${formatINR(paused)} contribution to ${goal.name} (about ${weeks} week${weeks === 1 ? "" : "s"} later to the target).`
          : `Reduce this month's ${goal.name} contribution by ${formatINR(paused)} (about ${weeks} week${weeks === 1 ? "" : "s"} later to the target).`,
    });
    left = roundMoney(left - paused);
  }
  return pauses;
}

export function assessAffordability(input: AffordabilityInput): AffordabilityResult {
  const asOf = asDate(input.asOf);
  const amount = roundMoney(input.amount);
  const balances = totalBalances(input.accounts);
  const bills = upcomingBillsBeforeNextIncome(input.bills, input.nextIncomeAt);
  const buffer = roundMoney(input.emergencyBuffer);
  const goalsTotal = remainingGoalContributions(input.goals);
  const available = availableToSpend({
    accounts: input.accounts,
    bills: input.bills,
    emergencyBuffer: buffer,
    goals: input.goals,
    nextIncomeAt: input.nextIncomeAt,
  });
  const billSafe = roundMoney(Math.max(0, balances - bills));
  const bufferSafe = roundMoney(Math.max(0, balances - bills - buffer));

  const projectedWithout = projectedEndOfMonth({
    asOf,
    accounts: input.accounts,
    bills: input.bills,
    goals: input.goals,
    nextIncomeAt: input.nextIncomeAt,
    nextIncomeAmount: input.nextIncomeAmount,
  });
  const projectedWith = projectedEndOfMonth({
    asOf,
    accounts: input.accounts,
    bills: input.bills,
    goals: input.goals,
    nextIncomeAt: input.nextIncomeAt,
    nextIncomeAmount: input.nextIncomeAmount,
    purchaseAmount: Math.max(0, amount),
  });

  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  const alternatives: AffordabilityAlternative[] = [];
  let verdict: AffordabilityVerdict;
  let goalImpacts: GoalContributionPause[] = [];

  if (!Number.isFinite(amount) || amount <= 0) {
    verdict = "NOT_RECOMMENDED";
    reasons.push("The purchase amount must be a positive number. The engine will not recommend a zero or negative spend.");
  } else if (amount > billSafe) {
    verdict = "NOT_RECOMMENDED";
    reasons.push(
      `${formatINR(amount)} is more than the ${formatINR(billSafe)} left after setting aside upcoming bills due before the next income credit (${formatINR(bills)}). Paying it would risk missing those bills.`,
    );
  } else if (amount > bufferSafe) {
    verdict = "NOT_RECOMMENDED";
    const dip = roundMoney(amount - bufferSafe);
    reasons.push(
      `${formatINR(amount)} would draw ${formatINR(dip)} from the ${formatINR(buffer)} emergency buffer after bills are reserved. The engine does not recommend spending the emergency fund on a discretionary purchase.`,
    );
    goalImpacts = planContributionPauses(input.goals, goalsTotal);
  } else if (amount <= available && projectedWith >= buffer) {
    verdict = "AFFORDABLE";
    reasons.push(
      `${formatINR(amount)} fits in the ${formatINR(available)} available to spend after bills, the emergency buffer, and this month's goal contributions.`,
    );
    reasons.push(
      `Projected end-of-month balance after the purchase is ${formatINR(projectedWith)}, which stays at or above the ${formatINR(buffer)} emergency buffer.`,
    );
  } else {
    // Coverable without touching bills or the buffer, but only by pausing goal contributions
    // and/or accepting a tighter end-of-month picture.
    const shortfall = roundMoney(Math.max(0, amount - available));
    goalImpacts = planContributionPauses(input.goals, shortfall);
    const paused = roundMoney(goalImpacts.reduce((s, g) => s + g.contribution_paused, 0));
    if (shortfall > 0 && paused + 1e-9 < shortfall) {
      verdict = "NOT_RECOMMENDED";
      reasons.push(
        `${formatINR(amount)} is ${formatINR(shortfall)} above available-to-spend (${formatINR(available)}), and pausing this month's goal contributions only frees ${formatINR(paused)}.`,
      );
    } else {
      verdict = "AFFORDABLE_WITH_TRADEOFFS";
      if (shortfall > 0) {
        reasons.push(
          `${formatINR(amount)} is ${formatINR(shortfall)} above the ${formatINR(available)} safe available-to-spend figure, so it is only comfortable if this month's savings contributions are reduced.`,
        );
        for (const impact of goalImpacts) tradeoffs.push(impact.detail);
      }
      if (projectedWith < buffer) {
        reasons.push(
          `Projected end-of-month balance after the purchase is ${formatINR(projectedWith)}, which falls below the ${formatINR(buffer)} emergency buffer if contributions stay as planned.`,
        );
        tradeoffs.push(
          "Keep the emergency buffer intact by pausing discretionary goal contributions rather than dipping into reserves.",
        );
      }
    }
  }

  const nextIncome = new Date(input.nextIncomeAt);
  const waitWeeks = weeksUntil(asOf, nextIncome);
  if (waitWeeks > 0 && verdict !== "AFFORDABLE") {
    alternatives.push({
      kind: "wait",
      weeks: waitWeeks,
      detail: `Wait ${waitWeeks} week${waitWeeks === 1 ? "" : "s"} until the next salary credit of ${formatINR(input.nextIncomeAmount)} on ${nextIncome.toISOString().slice(0, 10)}. Available-to-spend rises after that income lands.`,
    });
  }
  if (input.cheaperAlternativeAmount && input.cheaperAlternativeAmount > 0 && input.cheaperAlternativeAmount < amount) {
    const cheaperFits = input.cheaperAlternativeAmount <= available;
    alternatives.push({
      kind: "cheaper",
      amount: input.cheaperAlternativeAmount,
      sku: input.cheaperAlternativeSku,
      detail: cheaperFits
        ? `A lower-priced option at ${formatINR(input.cheaperAlternativeAmount)} fits inside the ${formatINR(available)} safe spending limit with no goal changes.`
        : `A lower-priced option at ${formatINR(input.cheaperAlternativeAmount)} reduces the gap, but still review the trade-offs.`,
    });
  }
  if (goalImpacts.length > 0 && verdict === "AFFORDABLE_WITH_TRADEOFFS") {
    alternatives.push({
      kind: "reduce_goals",
      amount: roundMoney(goalImpacts.reduce((s, g) => s + g.contribution_paused, 0)),
      detail: `Pause or reduce this month's planned contributions as listed in the trade-offs, then buy.`,
    });
  }

  const safeLimit = available;

  return {
    as_of: asOf.toISOString(),
    currency: "INR",
    request_amount: amount,
    request_label: input.requestLabel,
    total_balances: balances,
    upcoming_bills_before_next_income: bills,
    emergency_buffer: buffer,
    goal_contributions: goalsTotal,
    available_to_spend: available,
    projected_eom_balance_without_purchase: projectedWithout,
    projected_eom_balance_with_purchase: projectedWith,
    safe_spending_limit: safeLimit,
    verdict,
    reasons,
    tradeoffs,
    alternatives,
    goal_impacts: goalImpacts,
    fx: fxBreakdown(Math.max(0, amount)),
  };
}

export function assessFromFinance(
  finance: FinanceState,
  amount: number,
  opts: { requestLabel?: string; cheaperAlternativeAmount?: number; cheaperAlternativeSku?: string; asOf?: Date | string } = {},
): AffordabilityResult {
  const result = assessAffordability({
    asOf: opts.asOf ?? finance.profile.as_of,
    accounts: finance.accounts,
    bills: finance.bills,
    emergencyBuffer: finance.profile.emergency_buffer,
    goals: finance.savings_goals,
    nextIncomeAt: finance.profile.next_income_at,
    nextIncomeAmount: finance.profile.next_income_amount,
    amount,
    requestLabel: opts.requestLabel,
    cheaperAlternativeAmount: opts.cheaperAlternativeAmount,
    cheaperAlternativeSku: opts.cheaperAlternativeSku,
  });
  return { ...result, cash_flow: monthlyCashFlow(finance) };
}

export function spentInMonth(
  finance: FinanceState,
  category: string,
  month = monthKey(asDate(finance.profile.as_of)),
): number {
  const spent = finance.transactions
    .filter((t) => t.category === category && t.amount < 0 && t.posted_at.slice(0, 7) === month)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  return roundMoney(spent);
}

export function budgetProgress(finance: FinanceState): Array<MonthlyBudget & { spent: number; remaining: number }> {
  return finance.budgets.map((b) => {
    const spent = spentInMonth(finance, b.category, b.month);
    return { ...b, spent, remaining: roundMoney(b.monthly_limit - spent) };
  });
}


export interface MonthlyCashFlow {
  month: string;
  income: number;
  expenses: number;
  transfers: number;
  net: number;
  net_worth: number;
}

export function netWorth(accounts: Pick<BankAccount, "balance">[]): number {
  return roundMoney(accounts.reduce((s, a) => s + a.balance, 0));
}

/** Income vs expense for a calendar month. Transfers are excluded from both income and expenses. */
export function monthlyCashFlow(finance: FinanceState, month?: string): MonthlyCashFlow {
  const m = month || (finance.profile.as_of || "").slice(0, 7);
  let income = 0;
  let expenses = 0;
  let transfers = 0;
  for (const t of finance.transactions) {
    if (t.posted_at.slice(0, 7) !== m) continue;
    if (t.category === "Transfers") {
      transfers = roundMoney(transfers + Math.abs(t.amount));
      continue;
    }
    if (t.amount > 0) income = roundMoney(income + t.amount);
    else expenses = roundMoney(expenses + Math.abs(t.amount));
  }
  return {
    month: m,
    income,
    expenses,
    transfers,
    net: roundMoney(income - expenses),
    net_worth: netWorth(finance.accounts),
  };
}
