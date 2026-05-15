/**
 * Currency utilities.
 *
 * Builds the set of candidate currencies used by the routing engine.
 * Candidates include the 7 major fiat currencies hard-coded below, plus
 * every currency that appears in static venue pairs from `providers.json`.
 *
 * The distinction between fiat and stablecoin matters because the live
 * API providers only quote fiat pairs — stablecoin rates come exclusively
 * from the static venues.  `getFiatCandidates` filters out stablecoins so
 * the live adapter loop does not make pointless API calls for USDT or USDC
 * base currencies.
 */

import { providers } from "@/lib/providers/config";

/** Fiat currencies always included in the candidate set. */
const MAJOR_FIAT_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];

/**
 * Return all supported currencies (fiat + stablecoins), sorted alphabetically.
 *
 * Used by the server component to populate the UI currency selectors.
 */
export function getSupportedCurrencies(): string[] {
  const currencies = new Set<string>(MAJOR_FIAT_CURRENCIES);

  for (const provider of providers) {
    for (const pair of provider.pairs ?? []) {
      currencies.add(pair.from.toUpperCase());
      currencies.add(pair.to.toUpperCase());
    }
  }

  return [...currencies].sort((left, right) => left.localeCompare(right));
}

/**
 * Return candidate currencies for a specific routing request.
 *
 * Ensures the source and target are included even if they are not in the
 * pre-configured set (future-proofing for custom currency inputs).
 */
export function getCandidateCurrencies(sourceCurrency: string, targetCurrency: string): string[] {
  const currencies = new Set(getSupportedCurrencies());
  currencies.add(sourceCurrency.toUpperCase());
  currencies.add(targetCurrency.toUpperCase());
  return [...currencies].sort((left, right) => left.localeCompare(right));
}

/** Check whether a currency code is a stablecoin (USDT or USDC). */
export function isStablecoin(currency: string): boolean {
  return currency === "USDT" || currency === "USDC";
}

/**
 * Return only fiat candidates (excludes stablecoins).
 *
 * Used by the live provider adapter to determine which base currencies
 * to fetch from public rate APIs.  Fetching stablecoin bases from fiat
 * APIs would return no useful data.
 */
export function getFiatCandidates(sourceCurrency: string, targetCurrency: string): string[] {
  return getCandidateCurrencies(sourceCurrency, targetCurrency).filter(
    (currency) => !isStablecoin(currency),
  );
}
