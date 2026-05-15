/**
 * Live fiat provider adapters.
 *
 * Each adapter fetches rates from a public API, validates the response
 * shape, and normalises the result into a `RatesMap` (currency → rate).
 * If the primary endpoint fails, providers with documented mirrors fall
 * back automatically before reporting failure.
 *
 * Supported providers:
 *   - **AlphaFX**       → Frankfurter API (v1 primary, v2 fallback)
 *   - **BetaBank**      → ExchangeRate-API `/v6/latest/{base}`
 *   - **DeltaMarkets**  → fawazahmed0 currency-api (jsDelivr primary, Cloudflare mirror fallback)
 *
 * Results are cached in-memory for `CACHE_TTL_MS` to avoid hitting
 * rate-limited public endpoints on repeated requests.
 */

import { getFiatCandidates } from "@/lib/currencies";
import { fetchJsonWithRetry } from "@/lib/http";
import { liveProviders } from "@/lib/providers/config";
import type { ProviderConfig, ProviderDiagnostic, QuoteEdge } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Normalised map of uppercase currency code → conversion rate. */
type RatesMap = Map<string, number>;

type CacheEntry = {
  expiresAt: number;
  rates: RatesMap;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** In-memory rate cache keyed by `${providerName}:${baseCurrency}`. */
const cache = new Map<string, CacheEntry>();

/** How long cached rates are considered fresh (10 minutes). */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Per-attempt timeout for live API calls (milliseconds). */
const TIMEOUT_MS = 3500;

/** Number of retry attempts after the initial request. */
const RETRIES = 1;

/** Maximum simultaneous live-provider fetches per quote request. */
const LIVE_FETCH_CONCURRENCY = 6;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch fiat quote edges from all configured live providers.
 *
 * For each provider × fiat base currency combination, rates are fetched
 * (or served from cache) and converted into `QuoteEdge` objects.
 * Individual fetch failures are captured as diagnostics rather than
 * propagated, so healthy providers still contribute edges.
 */
export async function getLiveFiatEdges(
  sourceCurrency: string,
  targetCurrency: string,
): Promise<{
  edges: QuoteEdge[];
  diagnostics: ProviderDiagnostic[];
}> {
  const fiatCurrencies = getFiatCandidates(sourceCurrency, targetCurrency);

  const tasks: (() => Promise<{
    edges: QuoteEdge[];
    diagnostics: ProviderDiagnostic[];
  }>)[] = [];

  for (const provider of liveProviders) {
    for (const baseCurrency of fiatCurrencies) {
      tasks.push(() => fetchProviderBaseEdges(provider, baseCurrency, fiatCurrencies));
    }
  }

  const settled = await runWithConcurrency(tasks, LIVE_FETCH_CONCURRENCY);

  return {
    edges: settled.flatMap((result) => result.edges),
    diagnostics: settled.flatMap((result) => result.diagnostics),
  };
}

/** Clear the in-memory live-rate cache. Intended for deterministic tests. */
export function clearLiveRateCacheForTests(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Per-provider fetch with caching
// ---------------------------------------------------------------------------

/**
 * Fetch or cache-serve rates for one provider + base currency, then
 * convert matching pairs into directed `QuoteEdge` objects.
 */
async function fetchProviderBaseEdges(
  provider: ProviderConfig,
  baseCurrency: string,
  fiatCurrencies: string[],
): Promise<{
  edges: QuoteEdge[];
  diagnostics: ProviderDiagnostic[];
}> {
  const startedAt = Date.now();
  const cacheKey = `${provider.name}:${baseCurrency}`;
  const cached = cache.get(cacheKey);

  // Serve from cache if the entry is still fresh.
  if (cached && cached.expiresAt > Date.now()) {
    const edges = ratesToEdges(provider, baseCurrency, cached.rates, fiatCurrencies);
    return {
      edges,
      diagnostics: [
        {
          provider: provider.name,
          baseCurrency,
          status: edges.length > 0 ? "cached" : "missing_pair",
          reason: `Used cached rates for ${baseCurrency}.`,
          latencyMs: Date.now() - startedAt,
          edgesQuoted: edges.length,
        },
      ],
    };
  }

  // Fetch fresh rates from the provider's API.
  try {
    const rates = await fetchRates(provider, baseCurrency);

    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      rates,
    });

    const edges = ratesToEdges(provider, baseCurrency, rates, fiatCurrencies);

    return {
      edges,
      diagnostics: [
        {
          provider: provider.name,
          baseCurrency,
          status: edges.length > 0 ? "quoted" : "missing_pair",
          reason:
            edges.length > 0
              ? `Quoted ${edges.length} fiat edges for ${baseCurrency}.`
              : `Provider returned rates for ${baseCurrency}, but none matched candidate currencies.`,
          latencyMs: Date.now() - startedAt,
          edgesQuoted: edges.length,
        },
      ],
    };
  } catch (error) {
    return {
      edges: [],
      diagnostics: [
        {
          provider: provider.name,
          baseCurrency,
          status: "failed",
          reason: error instanceof Error ? error.message : "Unknown provider failure.",
          latencyMs: Date.now() - startedAt,
          edgesQuoted: 0,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Provider adapter dispatch
// ---------------------------------------------------------------------------

/** Route to the correct provider-specific adapter based on the provider name. */
async function fetchRates(provider: ProviderConfig, baseCurrency: string): Promise<RatesMap> {
  if (!provider.api) {
    throw new Error(`${provider.name} does not have an API configuration.`);
  }

  if (provider.name === "AlphaFX") {
    return fetchAlphaFxRates(provider.api.endpoint, baseCurrency);
  }

  if (provider.name === "BetaBank") {
    return fetchBetaBankRates(provider.api.endpoint, baseCurrency);
  }

  if (provider.name === "DeltaMarkets") {
    return fetchDeltaMarketsRates(provider.api.endpoint, baseCurrency);
  }

  throw new Error(`No live adapter exists for ${provider.name}.`);
}

// ---------------------------------------------------------------------------
// AlphaFX — Frankfurter API
// ---------------------------------------------------------------------------

/**
 * Fetch rates from AlphaFX (Frankfurter).
 *
 * Primary: configured v1 endpoint (`/v1/latest?base=XXX`).
 * Fallback: hard-coded v2 endpoint (`/v2/rates?base=XXX`).
 */
async function fetchAlphaFxRates(endpoint: string, baseCurrency: string): Promise<RatesMap> {
  const primaryUrl = `${endpoint}?base=${encodeURIComponent(baseCurrency)}`;

  try {
    const result = await fetchJsonWithRetry(primaryUrl, { timeoutMs: TIMEOUT_MS, retries: RETRIES });
    return parseFrankfurterRates(result.json, baseCurrency);
  } catch (primaryError) {
    const v2Url = `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(baseCurrency)}`;

    try {
      const result = await fetchJsonWithRetry(v2Url, { timeoutMs: TIMEOUT_MS, retries: RETRIES });
      return parseFrankfurterRates(result.json, baseCurrency);
    } catch (fallbackError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : "primary failed";
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "fallback failed";
      throw new Error(`AlphaFX failed via v1 and v2 endpoints: ${primaryMessage}; ${fallbackMessage}`);
    }
  }
}

// ---------------------------------------------------------------------------
// BetaBank — ExchangeRate-API
// ---------------------------------------------------------------------------

/** Fetch rates from BetaBank (ExchangeRate-API open access). */
async function fetchBetaBankRates(endpoint: string, baseCurrency: string): Promise<RatesMap> {
  const url = `${endpoint}/${encodeURIComponent(baseCurrency)}`;
  const result = await fetchJsonWithRetry(url, { timeoutMs: TIMEOUT_MS, retries: RETRIES });
  return parseBetaBankRates(result.json, baseCurrency);
}

// ---------------------------------------------------------------------------
// DeltaMarkets — fawazahmed0 currency-api
// ---------------------------------------------------------------------------

/**
 * Fetch rates from DeltaMarkets (fawazahmed0 currency-api).
 *
 * Primary: jsDelivr CDN endpoint.
 * Fallback: Cloudflare Pages mirror.
 */
async function fetchDeltaMarketsRates(endpoint: string, baseCurrency: string): Promise<RatesMap> {
  const lowercaseBase = baseCurrency.toLowerCase();
  const primaryUrl = `${endpoint}/${encodeURIComponent(lowercaseBase)}.json`;

  try {
    const result = await fetchJsonWithRetry(primaryUrl, { timeoutMs: TIMEOUT_MS, retries: RETRIES });
    return parseDeltaMarketsRates(result.json, lowercaseBase);
  } catch (primaryError) {
    const fallbackUrl = `https://latest.currency-api.pages.dev/v1/currencies/${encodeURIComponent(
      lowercaseBase,
    )}.json`;

    try {
      const result = await fetchJsonWithRetry(fallbackUrl, { timeoutMs: TIMEOUT_MS, retries: RETRIES });
      return parseDeltaMarketsRates(result.json, lowercaseBase);
    } catch (fallbackError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : "primary failed";
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "fallback failed";
      throw new Error(`DeltaMarkets failed via primary and fallback URLs: ${primaryMessage}; ${fallbackMessage}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Edge construction
// ---------------------------------------------------------------------------

/**
 * Convert a `RatesMap` into `QuoteEdge` objects for the routing graph.
 *
 * Only rates for currencies in `fiatCurrencies` are included (avoids
 * injecting hundreds of irrelevant currencies into the search space).
 */
function ratesToEdges(
  provider: ProviderConfig,
  baseCurrency: string,
  rates: RatesMap,
  fiatCurrencies: string[],
): QuoteEdge[] {
  const edges: QuoteEdge[] = [];

  for (const quoteCurrency of fiatCurrencies) {
    if (quoteCurrency === baseCurrency) {
      continue;
    }

    const rate = rates.get(quoteCurrency);
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      continue;
    }

    edges.push({
      id: `${provider.name}:${baseCurrency}:${quoteCurrency}`,
      provider: provider.name,
      providerType: provider.type,
      rateSource: provider.rate_source,
      from: baseCurrency,
      to: quoteCurrency,
      rate,
      feeModel: provider.fee_model,
    });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Concurrency control
// ---------------------------------------------------------------------------

/** Run async work with a fixed concurrency cap while preserving result order. */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const taskIndex = nextIndex;
      nextIndex += 1;
      results[taskIndex] = await tasks[taskIndex]();
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

// ---------------------------------------------------------------------------
// Response parsers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Parse Frankfurter API response shape: `{ rates: { EUR: 0.92, … } }`.
 * @throws {Error} If the payload does not contain a `rates` object.
 */
export function parseFrankfurterRates(payload: unknown, baseCurrency: string): RatesMap {
  if (!isRecord(payload) || !isRecord(payload.rates)) {
    throw new Error("Frankfurter response did not contain a rates object.");
  }

  return parseRatesObject(payload.rates, baseCurrency);
}

/**
 * Parse ExchangeRate-API response shape: `{ result: "success", rates: { … } }`.
 * @throws {Error} If the response indicates failure or is malformed.
 */
export function parseBetaBankRates(payload: unknown, baseCurrency: string): RatesMap {
  if (!isRecord(payload) || payload.result !== "success" || !isRecord(payload.rates)) {
    throw new Error("ExchangeRate-API response did not contain successful rates.");
  }

  return parseRatesObject(payload.rates, baseCurrency);
}

/**
 * Parse fawazahmed0 currency-api response shape: `{ usd: { eur: 0.92, … } }`.
 *
 * Keys in this API are lowercase, so they are normalised to uppercase
 * before entering the routing graph.
 *
 * @throws {Error} If the payload does not contain the base currency object.
 */
export function parseDeltaMarketsRates(payload: unknown, lowercaseBase: string): RatesMap {
  if (!isRecord(payload) || !isRecord(payload[lowercaseBase])) {
    throw new Error("fawazahmed0 currency response did not contain the base currency object.");
  }

  const rawRates = payload[lowercaseBase];
  const normalizedRates: Record<string, unknown> = {};

  for (const [currency, value] of Object.entries(rawRates)) {
    normalizedRates[currency.toUpperCase()] = value;
  }

  return parseRatesObject(normalizedRates, lowercaseBase.toUpperCase());
}

// ---------------------------------------------------------------------------
// Shared parsing helpers
// ---------------------------------------------------------------------------

/**
 * Convert a raw `{ CURRENCY: rate }` object into a validated `RatesMap`.
 *
 * Filters out the base currency itself, non-numeric values, non-finite
 * values, and zero or negative rates.
 *
 * @throws {Error} If no usable rates remain after filtering.
 */
function parseRatesObject(ratesObject: Record<string, unknown>, baseCurrency: string): RatesMap {
  const rates = new Map<string, number>();

  for (const [currency, value] of Object.entries(ratesObject)) {
    if (currency.toUpperCase() === baseCurrency.toUpperCase()) {
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      rates.set(currency.toUpperCase(), value);
    }
  }

  if (rates.size === 0) {
    throw new Error(`No usable rates were returned for ${baseCurrency}.`);
  }

  return rates;
}

/** Type guard for plain objects (excludes arrays and null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
