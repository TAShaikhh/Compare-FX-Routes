import { describe, expect, it } from "vitest";
import { applySourceFee } from "@/lib/routing/fees";
import { searchRoutes, rankRoutes } from "@/lib/routing/search";
import type { FeeModel, QuoteEdge } from "@/lib/types";

const zeroFee: FeeModel = { fee_percent: 0, fee_flat: 0, fee_currency: "source" };

function edge(
  provider: string,
  from: string,
  to: string,
  rate: number,
  feeModel: FeeModel = zeroFee,
): QuoteEdge {
  return {
    id: `${provider}:${from}:${to}`,
    provider,
    providerType: "fiat_broker",
    rateSource: "static",
    from,
    to,
    rate,
    feeModel,
  };
}

describe("fee edge cases", () => {
  it("computes zero fee correctly", () => {
    const result = applySourceFee(1_000, zeroFee);
    expect(result.ok).toBe(true);
    expect(result.feeAmount).toBe(0);
    expect(result.netSourceAmount).toBe(1_000);
  });

  it("rejects when flat fee equals the source amount", () => {
    const result = applySourceFee(10, { fee_percent: 0, fee_flat: 10, fee_currency: "source" });
    expect(result.ok).toBe(false);
    expect(result.netSourceAmount).toBe(0);
  });

  it("rejects when flat fee exceeds the source amount", () => {
    const result = applySourceFee(5, { fee_percent: 0, fee_flat: 10, fee_currency: "source" });
    expect(result.ok).toBe(false);
    expect(result.netSourceAmount).toBeLessThan(0);
  });

  it("handles combined percent and flat fee correctly", () => {
    const result = applySourceFee(10_000, { fee_percent: 0.01, fee_flat: 50, fee_currency: "source" });
    expect(result.ok).toBe(true);
    expect(result.feeAmount).toBe(150);
    expect(result.netSourceAmount).toBe(9_850);
  });

  it("handles very large source amount with very small fee", () => {
    const result = applySourceFee(1_000_000_000, { fee_percent: 0.0001, fee_flat: 0, fee_currency: "source" });
    expect(result.ok).toBe(true);
    expect(result.feeAmount).toBe(100_000);
    expect(result.netSourceAmount).toBe(999_900_000);
  });

  it("handles very small source amount where percentage fee rounds to zero", () => {
    const result = applySourceFee(0.001, { fee_percent: 0.001, fee_flat: 0, fee_currency: "source" });
    expect(result.ok).toBe(true);
    expect(result.netSourceAmount).toBeGreaterThan(0);
  });
});

describe("route search edge cases", () => {
  it("finds no routes when no edges exist", () => {
    const routes = searchRoutes([], {
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 100,
      maxLegs: 3,
    });

    expect(routes).toHaveLength(0);
  });

  it("finds no routes when the source has no outgoing edges", () => {
    const routes = searchRoutes(
      [edge("P", "EUR", "JPY", 160)],
      {
        sourceCurrency: "USD",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(0);
  });

  it("finds no routes when no path reaches the target", () => {
    const routes = searchRoutes(
      [
        edge("P", "USD", "EUR", 0.92),
        edge("P", "EUR", "GBP", 0.85),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(0);
  });

  it("finds a single direct route", () => {
    const routes = searchRoutes(
      [edge("P", "USD", "EUR", 0.92)],
      {
        sourceCurrency: "USD",
        targetCurrency: "EUR",
        amount: 100,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].legs).toHaveLength(1);
    expect(routes[0].finalAmount).toBe(92);
  });

  it("prevents cycles through intermediate currencies", () => {
    const routes = searchRoutes(
      [
        edge("P", "USD", "EUR", 0.92),
        edge("P", "EUR", "USD", 1.08),
        edge("P", "USD", "JPY", 150),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    const loopingRoute = routes.find(
      (r) => r.path.filter((c) => c === "USD").length > 1 && r.path.at(-1) !== "USD",
    );
    expect(loopingRoute).toBeUndefined();
  });

  it("skips legs where fees consume the entire input", () => {
    const routes = searchRoutes(
      [edge("P", "USD", "EUR", 0.92, { fee_percent: 0, fee_flat: 100, fee_currency: "source" })],
      {
        sourceCurrency: "USD",
        targetCurrency: "EUR",
        amount: 50,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(0);
  });

  it("correctly chains amounts through multi-leg routes with fees", () => {
    const routes = searchRoutes(
      [
        edge("A", "USD", "EUR", 0.9, { fee_percent: 0.01, fee_flat: 0, fee_currency: "source" }),
        edge("B", "EUR", "JPY", 160, { fee_percent: 0.01, fee_flat: 0, fee_currency: "source" }),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "JPY",
        amount: 1_000,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(1);

    const route = routes[0];
    expect(route.legs).toHaveLength(2);

    const leg1 = route.legs[0];
    expect(leg1.feeAmount).toBe(10);
    expect(leg1.netSourceAmount).toBe(990);
    expect(leg1.outputAmount).toBeCloseTo(891, 0);

    const leg2 = route.legs[1];
    expect(leg2.inputAmount).toBeCloseTo(891, 0);
    expect(leg2.outputAmount).toBeGreaterThan(0);
  });

  it("handles exactly maxLegs correctly (3 legs should work, 4 should not)", () => {
    const edges = [
      edge("A", "USD", "EUR", 1),
      edge("B", "EUR", "GBP", 1),
      edge("C", "GBP", "JPY", 1),
      edge("D", "JPY", "CAD", 1),
    ];

    const threeLegs = searchRoutes(edges, {
      sourceCurrency: "USD",
      targetCurrency: "JPY",
      amount: 100,
      maxLegs: 3,
    });

    expect(threeLegs.some((r) => r.legs.length === 3)).toBe(true);

    const fourLegsNeeded = searchRoutes(edges, {
      sourceCurrency: "USD",
      targetCurrency: "CAD",
      amount: 100,
      maxLegs: 3,
    });

    expect(fourLegsNeeded).toHaveLength(0);
  });

  it("selects route with highest final amount when multiple exist", () => {
    const routes = searchRoutes(
      [
        edge("Cheap", "USD", "EUR", 0.90),
        edge("Expensive", "USD", "EUR", 0.95),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "EUR",
        amount: 100,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(2);

    const ranked = rankRoutes(routes, 100, "EUR");
    expect(ranked.rankedRoutes[0].finalAmount).toBe(95);
    expect(ranked.rankedRoutes[0].rank).toBe(1);
    expect(ranked.rankedRoutes[1].finalAmount).toBe(90);
  });
});

describe("ranking edge cases", () => {
  it("returns at most 3 ranked routes", () => {
    const edges = [
      edge("A", "USD", "EUR", 0.90),
      edge("B", "USD", "EUR", 0.91),
      edge("C", "USD", "EUR", 0.92),
      edge("D", "USD", "EUR", 0.93),
      edge("E", "USD", "EUR", 0.94),
    ];

    const routes = searchRoutes(edges, {
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 100,
      maxLegs: 3,
    });

    const ranked = rankRoutes(routes, 100, "EUR");
    expect(ranked.rankedRoutes.length).toBeLessThanOrEqual(3);
    expect(ranked.rankedRoutes[0].finalAmount).toBe(94);
  });

  it("computes differenceVsDirect as null when no direct route exists", () => {
    const routes = searchRoutes(
      [
        edge("A", "USD", "GBP", 0.80),
        edge("B", "GBP", "JPY", 190),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    const ranked = rankRoutes(routes, 100, "JPY");
    expect(ranked.directRoute).toBeNull();
    expect(ranked.rankedRoutes[0].differenceVsDirect).toBeNull();
  });

  it("computes positive differenceVsDirect for multi-leg routes beating direct", () => {
    const routes = searchRoutes(
      [
        edge("Direct", "USD", "JPY", 150),
        edge("A", "USD", "GBP", 0.80),
        edge("B", "GBP", "JPY", 200),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    const ranked = rankRoutes(routes, 100, "JPY");
    expect(ranked.directRoute).not.toBeNull();
    expect(ranked.directRoute!.finalAmount).toBe(15_000);

    const multiLeg = ranked.rankedRoutes.find((r) => r.legs.length === 2);
    expect(multiLeg).toBeDefined();
    expect(multiLeg!.differenceVsDirect).toBe(1_000);
  });

  it("handles empty route list gracefully", () => {
    const ranked = rankRoutes([], 100, "EUR");
    expect(ranked.rankedRoutes).toHaveLength(0);
    expect(ranked.directRoute).toBeNull();
  });

  it("deduplicates routes with the same provider-pair sequence, keeping the best", () => {
    const routes = searchRoutes(
      [
        edge("P", "USD", "EUR", 0.90),
        edge("P", "USD", "EUR", 0.92),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "EUR",
        amount: 100,
        maxLegs: 3,
      },
    );

    const ranked = rankRoutes(routes, 100, "EUR");
    expect(ranked.rankedRoutes).toHaveLength(1);
    expect(ranked.rankedRoutes[0].finalAmount).toBe(92);
  });
});
