/**
 * Fee calculation for a single conversion leg.
 *
 * Fees are always deducted in the leg's source currency _before_ the
 * conversion rate is applied.  This module is intentionally pure and
 * synchronous so it can be unit-tested without mocking network calls.
 *
 * Formula:
 *   feeAmount       = sourceAmount × fee_percent + fee_flat
 *   netSourceAmount = sourceAmount − feeAmount
 *   outputAmount    = netSourceAmount × rate          (computed by caller)
 *
 * A leg is rejected (`ok: false`) when the fee consumes the entire source
 * amount, which prevents the routing engine from following dead-end paths.
 */

import type { FeeModel } from "@/lib/types";

/** Discriminated result of a fee calculation. */
export type FeeResult =
  | { ok: true; feeAmount: number; netSourceAmount: number }
  | { ok: false; feeAmount: number; netSourceAmount: number };

/**
 * Apply the provider's fee model to a source amount.
 *
 * @param sourceAmount - The amount entering this leg (always positive).
 * @param feeModel     - Percent + flat fee schedule from the provider config.
 * @returns `ok: true` with the deducted amounts, or `ok: false` if the fee
 *          consumes the full source amount (making the leg non-viable).
 */
export function applySourceFee(sourceAmount: number, feeModel: FeeModel): FeeResult {
  const feeAmount = sourceAmount * feeModel.fee_percent + feeModel.fee_flat;
  const netSourceAmount = sourceAmount - feeAmount;

  if (!Number.isFinite(feeAmount) || !Number.isFinite(netSourceAmount) || netSourceAmount <= 0) {
    return { ok: false, feeAmount, netSourceAmount };
  }

  return { ok: true, feeAmount, netSourceAmount };
}
