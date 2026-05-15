import { describe, expect, it } from "vitest";
import { parseRouteRequest } from "@/lib/validation";

describe("parseRouteRequest", () => {
  it("accepts a valid payload", () => {
    const result = parseRouteRequest({
      sourceCurrency: "GBP",
      targetCurrency: "JPY",
      amount: 10_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceCurrency).toBe("GBP");
      expect(result.value.targetCurrency).toBe("JPY");
      expect(result.value.amount).toBe(10_000);
    }
  });

  it("normalizes currency codes to uppercase", () => {
    const result = parseRouteRequest({
      sourceCurrency: "gbp",
      targetCurrency: "jpy",
      amount: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceCurrency).toBe("GBP");
      expect(result.value.targetCurrency).toBe("JPY");
    }
  });

  it("accepts 4-5 character stablecoin codes", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USDT",
      targetCurrency: "USDC",
      amount: 500,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceCurrency).toBe("USDT");
      expect(result.value.targetCurrency).toBe("USDC");
    }
  });

  it("rejects when sourceCurrency and targetCurrency are the same", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "USD",
      amount: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("different");
    }
  });

  it("rejects same currency after normalization", () => {
    const result = parseRouteRequest({
      sourceCurrency: "usd",
      targetCurrency: "USD",
      amount: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("different");
    }
  });

  it("rejects zero amount", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("positive");
    }
  });

  it("rejects negative amount", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: -100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("positive");
    }
  });

  it("rejects NaN amount", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: NaN,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects Infinity amount", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: Infinity,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects amounts exceeding the trillion cap", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 1_000_000_000_001,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("too large");
    }
  });

  it("accepts amount at the trillion boundary", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 1_000_000_000_000,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects non-object payloads", () => {
    expect(parseRouteRequest(null).ok).toBe(false);
    expect(parseRouteRequest("string").ok).toBe(false);
    expect(parseRouteRequest(42).ok).toBe(false);
    expect(parseRouteRequest([]).ok).toBe(false);
    expect(parseRouteRequest(undefined).ok).toBe(false);
  });

  it("rejects missing sourceCurrency", () => {
    const result = parseRouteRequest({
      targetCurrency: "EUR",
      amount: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("sourceCurrency");
    }
  });

  it("rejects missing targetCurrency", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      amount: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("targetCurrency");
    }
  });

  it("rejects currency codes shorter than 3 characters", () => {
    const result = parseRouteRequest({
      sourceCurrency: "US",
      targetCurrency: "EUR",
      amount: 100,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects currency codes longer than 5 characters", () => {
    const result = parseRouteRequest({
      sourceCurrency: "ABCDEF",
      targetCurrency: "EUR",
      amount: 100,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects currency codes with special characters", () => {
    const result = parseRouteRequest({
      sourceCurrency: "US$",
      targetCurrency: "EUR",
      amount: 100,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects amount passed as a string", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: "100",
    });

    expect(result.ok).toBe(false);
  });

  it("rejects unsupported railMode values", () => {
    const result = parseRouteRequest({
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      amount: 100,
      railMode: "fiat_only",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("railMode");
    }
  });

  it("accepts a very small fractional amount", () => {
    const result = parseRouteRequest({
      sourceCurrency: "GBP",
      targetCurrency: "JPY",
      amount: 0.01,
    });

    expect(result.ok).toBe(true);
  });
});
