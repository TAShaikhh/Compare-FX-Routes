import { describe, expect, it } from "vitest";
import { parseBetaBankRates, parseDeltaMarketsRates, parseFrankfurterRates } from "@/lib/providers/live";
import { staticProviders } from "@/lib/providers/config";
import { getStaticEdges } from "@/lib/providers/static";

describe("provider parsing", () => {
  it("normalizes Frankfurter rates", () => {
    const rates = parseFrankfurterRates(
      {
        base: "USD",
        rates: {
          EUR: 0.92,
          GBP: 0.8,
        },
      },
      "USD",
    );

    expect(rates.get("EUR")).toBe(0.92);
    expect(rates.get("GBP")).toBe(0.8);
  });

  it("rejects malformed ExchangeRate-API responses", () => {
    expect(() =>
      parseBetaBankRates(
        {
          result: "error",
          "error-type": "unsupported-code",
        },
        "USD",
      ),
    ).toThrow("successful rates");
  });

  it("rejects malformed Frankfurter responses", () => {
    expect(() => parseFrankfurterRates({ amount: 1, base: "USD" }, "USD")).toThrow("rates object");
  });

  it("rejects provider responses with no usable rates", () => {
    expect(() =>
      parseBetaBankRates(
        {
          result: "success",
          rates: {
            USD: 1,
            EUR: 0,
            GBP: "0.8",
          },
        },
        "USD",
      ),
    ).toThrow("No usable rates");
  });

  it("normalizes fawazahmed0 lowercase currency keys", () => {
    const rates = parseDeltaMarketsRates(
      {
        date: "2026-05-13",
        usd: {
          eur: 0.92,
          jpy: 152.4,
        },
      },
      "usd",
    );

    expect(rates.get("EUR")).toBe(0.92);
    expect(rates.get("JPY")).toBe(152.4);
  });

  it("builds static provider edges from providers.json", () => {
    const result = getStaticEdges();

    expect(result.edges.some((edge) => edge.provider === "GammaCrypto" && edge.from === "USD")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.provider === "ZetaSwap")).toBe(true);
  });

  it("does not create static edges beyond explicitly configured pairs", () => {
    const result = getStaticEdges();
    const configuredPairCount = staticProviders.reduce(
      (total, provider) => total + (provider.pairs?.length ?? 0),
      0,
    );

    expect(result.edges).toHaveLength(configuredPairCount);

    for (const edge of result.edges) {
      const provider = staticProviders.find((candidate) => candidate.name === edge.provider);
      expect(provider?.pairs?.some((pair) => pair.from === edge.from && pair.to === edge.to)).toBe(true);
    }
  });
});
