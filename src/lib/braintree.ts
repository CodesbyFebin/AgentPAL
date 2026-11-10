import braintree from "braintree";
import { redactSecrets } from "./ai-permissions";
import { braintreeEnvName, hasBraintreeCreds } from "./payment-mode";

export interface BraintreeTransactionView {
  id: string;
  status: string;
  amount: string;
  currencyIsoCode: string;
}

export interface BraintreeSaleRequest {
  amount: string;
  paymentMethodNonce: string;
  orderId?: string;
  options: { submitForSettlement: boolean };
}

export interface BraintreeSaleResult {
  success: boolean;
  message?: string;
  transaction?: BraintreeTransactionView;
}

export interface BraintreeGatewayLike {
  clientToken: {
    generate: (opts?: object) => Promise<{ clientToken?: string; success?: boolean }>;
  };
  transaction: {
    sale: (req: BraintreeSaleRequest) => Promise<BraintreeSaleResult>;
    submitForSettlement: (id: string) => Promise<BraintreeSaleResult>;
    void: (id: string) => Promise<BraintreeSaleResult>;
    refund: (id: string, amount?: string) => Promise<BraintreeSaleResult>;
    find: (id: string) => Promise<BraintreeTransactionView>;
  };
}

let testGateway: BraintreeGatewayLike | null = null;
let saleCount = 0;

/** Test-only hook. Never expose the real gateway (it holds the private key). */
export function _setBraintreeGatewayForTests(gateway: BraintreeGatewayLike | null) {
  testGateway = gateway;
}

export function braintreeSaleCallCount(): number {
  return saleCount;
}

export function resetBraintreeSaleCallCount() {
  saleCount = 0;
}

function failSafe(message: string): never {
  throw new Error(redactSecrets(message));
}

function getGateway(): BraintreeGatewayLike {
  if (testGateway) return testGateway;
  if (!hasBraintreeCreds()) failSafe("Braintree credentials are not configured");
  const environment =
    braintreeEnvName() === "production" ? braintree.Environment.Production : braintree.Environment.Sandbox;
  return new braintree.BraintreeGateway({
    environment,
    merchantId: process.env.BRAINTREE_MERCHANT_ID!,
    publicKey: process.env.BRAINTREE_PUBLIC_KEY!,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY!,
  }) as unknown as BraintreeGatewayLike;
}

export async function generateClientToken(): Promise<string> {
  try {
    const result = await getGateway().clientToken.generate({});
    if (!result.clientToken) failSafe("Braintree client token was not issued");
    return result.clientToken;
  } catch (err) {
    failSafe(err instanceof Error ? err.message : "Braintree client token failed");
  }
}

export async function authorizeSale(opts: {
  amount: number;
  currency: string;
  nonce: string;
  orderId: string;
}): Promise<BraintreeTransactionView> {
  if (opts.currency !== "USD") failSafe("Braintree sandbox checkout is USD only");
  saleCount += 1;
  let result: BraintreeSaleResult;
  try {
    result = await getGateway().transaction.sale({
      amount: opts.amount.toFixed(2),
      paymentMethodNonce: opts.nonce,
      orderId: opts.orderId,
      options: { submitForSettlement: false },
    });
  } catch (err) {
    failSafe(err instanceof Error ? err.message : "Braintree authorization failed");
  }
  if (!result.success || !result.transaction) {
    failSafe(result.message || "Braintree authorization failed");
  }
  return result.transaction;
}

export async function submitForSettlement(transactionId: string): Promise<BraintreeTransactionView> {
  let result: BraintreeSaleResult;
  try {
    result = await getGateway().transaction.submitForSettlement(transactionId);
  } catch (err) {
    failSafe(err instanceof Error ? err.message : "Braintree capture failed");
  }
  if (!result.success || !result.transaction) {
    failSafe(result.message || "Braintree capture failed");
  }
  return result.transaction;
}

export async function voidSale(transactionId: string): Promise<BraintreeTransactionView | undefined> {
  let result: BraintreeSaleResult;
  try {
    result = await getGateway().transaction.void(transactionId);
  } catch (err) {
    failSafe(err instanceof Error ? err.message : "Braintree void failed");
  }
  if (!result.success) failSafe(result.message || "Braintree void failed");
  return result.transaction;
}

export async function refundSale(
  transactionId: string,
  amount?: number,
): Promise<BraintreeTransactionView> {
  let result: BraintreeSaleResult;
  try {
    result = amount
      ? await getGateway().transaction.refund(transactionId, amount.toFixed(2))
      : await getGateway().transaction.refund(transactionId);
  } catch (err) {
    failSafe(err instanceof Error ? err.message : "Braintree refund failed");
  }
  if (!result.success || !result.transaction) {
    failSafe(result.message || "Braintree refund failed");
  }
  return result.transaction;
}

export async function findTransaction(transactionId: string): Promise<BraintreeTransactionView> {
  try {
    return await getGateway().transaction.find(transactionId);
  } catch (err) {
    failSafe(err instanceof Error ? err.message : "Braintree find failed");
  }
}
