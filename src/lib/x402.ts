import { id } from "./ids";

/** Simulated x402/USDC micro-payment rail. Not a live facilitator or on-chain transfer. */
export function settleSimulatedX402(amount: number): {
  simulated: true;
  transfer_id: string;
  rail: "x402_usdc";
  amount: number;
  currency: "USDC";
  note: string;
} {
  return {
    simulated: true,
    transfer_id: `sim_x402_${id("xfer")}`,
    rail: "x402_usdc",
    amount,
    currency: "USDC",
    note: "Simulated x402/USDC micro-payment. No on-chain funds moved.",
  };
}
