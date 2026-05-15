import { describe, expect, it } from "vitest";
import { getSupportedCurrencies, getCandidateCurrencies, isStablecoin, getFiatCandidates } from "@/lib/currencies";

describe("currency utilities", () => {
  it("returns sorted unique currencies", () => {
    const currencies = getSupportedCurrencies();
    expect(currencies.length).toBeGreaterThan(0);

    const sorted = [...currencies].sort((a, b) => a.localeCompare(b));
    expect(currencies).toEqual(sorted);

    const unique = new Set(currencies);
    expect(currencies.length).toBe(unique.size);
  });

  it("includes all 7 major fiat currencies", () => {
    const currencies = getSupportedCurrencies();
    for (const fiat of ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"]) {
      expect(currencies).toContain(fiat);
    }
  });

  it("includes stablecoin codes from static providers", () => {
    const currencies = getSupportedCurrencies();
    expect(currencies).toContain("USDT");
    expect(currencies).toContain("USDC");
  });

  it("getCandidateCurrencies includes the requested source and target", () => {
    const candidates = getCandidateCurrencies("XYZ", "ABC");
    expect(candidates).toContain("XYZ");
    expect(candidates).toContain("ABC");
  });

  it("isStablecoin identifies USDT and USDC correctly", () => {
    expect(isStablecoin("USDT")).toBe(true);
    expect(isStablecoin("USDC")).toBe(true);
    expect(isStablecoin("USD")).toBe(false);
    expect(isStablecoin("EUR")).toBe(false);
  });

  it("getFiatCandidates excludes stablecoins", () => {
    const fiatOnly = getFiatCandidates("USD", "EUR");
    expect(fiatOnly).not.toContain("USDT");
    expect(fiatOnly).not.toContain("USDC");
    expect(fiatOnly).toContain("USD");
    expect(fiatOnly).toContain("EUR");
  });
});
