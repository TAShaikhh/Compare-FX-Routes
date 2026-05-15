import { describe, expect, it } from "vitest";
import { rankRoutes, searchRoutes } from "@/lib/routing/search";
import type { FeeModel, QuoteEdge } from "@/lib/types";

const noFlatFee: FeeModel = {
  fee_percent: 0,
  fee_flat: 0,
  fee_currency: "source",
};

const smallFlatFee: FeeModel = {
  fee_percent: 0,
  fee_flat: 1,
  fee_currency: "source",
};

function edge(provider: string, from: string, to: string, rate: number, feeModel = noFlatFee): QuoteEdge {
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

describe("route search", () => {
  it("propagates amount through multiple legs after fees", () => {
    const routes = searchRoutes(
      [
        edge("Direct", "GBP", "JPY", 180, smallFlatFee),
        edge("LegA", "GBP", "USD", 1.25, smallFlatFee),
        edge("LegB", "USD", "JPY", 150, smallFlatFee),
      ],
      {
        sourceCurrency: "GBP",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    const multiLeg = routes.find((route) => route.legs.length === 2);

    expect(multiLeg?.finalAmount).toBe(18_412.5);
    expect(multiLeg?.legs[0].feeAmount).toBe(1);
    expect(multiLeg?.legs[1].feeAmount).toBe(1);
  });

  it("ranks routes by final recipient amount and calculates direct delta", () => {
    const routes = searchRoutes(
      [
        edge("Direct", "GBP", "JPY", 180),
        edge("LegA", "GBP", "USD", 1.25),
        edge("LegB", "USD", "JPY", 150),
      ],
      {
        sourceCurrency: "GBP",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    const ranked = rankRoutes(routes, 100, "JPY");

    expect(ranked.rankedRoutes[0].finalAmount).toBe(18_750);
    expect(ranked.rankedRoutes[0].differenceVsDirect).toBe(750);
    expect(ranked.directRoute?.finalAmount).toBe(18_000);
    expect(ranked.directRoute?.rank).toBe(2);
  });

  it("enforces the maximum leg count", () => {
    const routes = searchRoutes(
      [
        edge("A", "GBP", "USD", 1),
        edge("B", "USD", "EUR", 1),
        edge("C", "EUR", "CAD", 1),
        edge("D", "CAD", "JPY", 1),
      ],
      {
        sourceCurrency: "GBP",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(0);
  });

  it("does not expand a route after it reaches the target", () => {
    const routes = searchRoutes(
      [
        edge("Direct", "USD", "JPY", 150),
        edge("LeaveTarget", "JPY", "EUR", 0.006),
        edge("ReturnTarget", "EUR", "JPY", 160),
      ],
      {
        sourceCurrency: "USD",
        targetCurrency: "JPY",
        amount: 100,
        maxLegs: 3,
      },
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toEqual(["USD", "JPY"]);
  });

  it("allows flat-fee providers to rank differently by transfer size", () => {
    const lowPercentWithFlatFee: FeeModel = {
      fee_percent: 0.001,
      fee_flat: 25,
      fee_currency: "source",
    };
    const highPercentNoFlatFee: FeeModel = {
      fee_percent: 0.01,
      fee_flat: 0,
      fee_currency: "source",
    };

    const candidateEdges = [
      edge("LowPercentFlat", "USD", "EUR", 1, lowPercentWithFlatFee),
      edge("HighPercentNoFlat", "USD", "EUR", 1, highPercentNoFlatFee),
    ];

    const smallRoutes = searchRoutes(candidateEdges, {
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 100,
      maxLegs: 3,
    });
    const mediumRoutes = searchRoutes(candidateEdges, {
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 10_000,
      maxLegs: 3,
    });
    const largeRoutes = searchRoutes(candidateEdges, {
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 1_000_000,
      maxLegs: 3,
    });

    expect(rankRoutes(smallRoutes, 100, "EUR").rankedRoutes[0].legs[0].provider).toBe(
      "HighPercentNoFlat",
    );
    expect(rankRoutes(mediumRoutes, 10_000, "EUR").rankedRoutes[0].legs[0].provider).toBe(
      "LowPercentFlat",
    );
    expect(rankRoutes(largeRoutes, 1_000_000, "EUR").rankedRoutes[0].legs[0].provider).toBe(
      "LowPercentFlat",
    );
  });
});
