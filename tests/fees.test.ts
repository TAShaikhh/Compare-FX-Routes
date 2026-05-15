import { describe, expect, it } from "vitest";
import { applySourceFee } from "@/lib/routing/fees";

describe("applySourceFee", () => {
  it("applies percentage and flat fees in the leg source currency", () => {
    const result = applySourceFee(10_000, {
      fee_percent: 0.0015,
      fee_flat: 25,
      fee_currency: "source",
    });

    expect(result.ok).toBe(true);
    expect(result.feeAmount).toBe(40);
    expect(result.netSourceAmount).toBe(9_960);
  });

  it("rejects legs where fees consume the whole source amount", () => {
    const result = applySourceFee(1, {
      fee_percent: 0.001,
      fee_flat: 1,
      fee_currency: "source",
    });

    expect(result.ok).toBe(false);
    expect(result.netSourceAmount).toBeLessThanOrEqual(0);
  });
});
