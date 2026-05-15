/**
 * Shared type definitions for the FX routing system.
 *
 * These types define the full data model: provider configuration read from
 * `providers.json`, the internal quote graph (edges and legs), the ranked
 * route results returned to the client, and the audit metadata attached to
 * every quote response for operational transparency.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** ISO 4217 currency code or stablecoin ticker (e.g. "USD", "USDT"). */
export type CurrencyCode = string;

/** Discriminator for the two provider categories in `providers.json`. */
export type ProviderType = "fiat_broker" | "stablecoin_venue";

/** How the provider's conversion rates are obtained. */
export type RateSource = "live_api" | "static";

// ---------------------------------------------------------------------------
// Provider configuration (mirrors `providers.json`)
// ---------------------------------------------------------------------------

/**
 * Fee schedule applied to each conversion leg.
 *
 * Fee is calculated as `sourceAmount * fee_percent + fee_flat` and deducted
 * from the source amount _before_ applying the conversion rate.
 */
export type FeeModel = {
  /** Proportional fee as a decimal (e.g. 0.0015 = 0.15%). */
  fee_percent: number;
  /** Fixed fee in the source currency (e.g. 25 USD). */
  fee_flat: number;
  /** Fee is always charged in the leg's source currency. */
  fee_currency: "source";
};

/** Connection details for a live-rate provider's public API. */
export type LiveApiConfig = {
  /** Base URL used to fetch rates (query params added per adapter). */
  endpoint: string;
  /** Human-readable documentation link for the API. */
  docs: string;
};

/** A single hard-coded currency pair from a static venue provider. */
export type StaticPair = {
  from: CurrencyCode;
  to: CurrencyCode;
  /** Conversion rate: 1 unit of `from` buys `rate` units of `to`. */
  rate: number;
};

/** Top-level shape of `providers.json`. */
export type ProvidersFile = {
  providers: ProviderConfig[];
};

/** Configuration for one provider as declared in `providers.json`. */
export type ProviderConfig = {
  name: string;
  type: ProviderType;
  rate_source: RateSource;
  /** Present only for `live_api` providers. */
  api?: LiveApiConfig;
  fee_model: FeeModel;
  /** Present only for `static` providers. */
  pairs?: StaticPair[];
};

// ---------------------------------------------------------------------------
// Route request
// ---------------------------------------------------------------------------

/** Validated input from the client for a single quote calculation. */
export type RouteRequest = {
  sourceCurrency: CurrencyCode;
  targetCurrency: CurrencyCode;
  /** Positive source amount to convert. */
  amount: number;
};

// ---------------------------------------------------------------------------
// Internal quote graph
// ---------------------------------------------------------------------------

/**
 * A directed edge in the quote graph.
 *
 * Each edge represents "provider X can convert `from` → `to` at `rate`,
 * with `feeModel` applied." Edges are built by provider adapters and fed
 * into the routing engine.
 */
export type QuoteEdge = {
  /** Unique key: `${provider}:${from}:${to}`. */
  id: string;
  provider: string;
  providerType: ProviderType;
  rateSource: RateSource;
  from: CurrencyCode;
  to: CurrencyCode;
  /** 1 unit of `from` buys `rate` units of `to`. */
  rate: number;
  feeModel: FeeModel;
};

// ---------------------------------------------------------------------------
// Route results
// ---------------------------------------------------------------------------

/**
 * Detailed breakdown of a single conversion step within a route.
 *
 * The economic flow is:
 * `inputAmount` → deduct `feeAmount` → `netSourceAmount` → multiply by `rate` → `outputAmount`
 */
export type LegBreakdown = {
  /** Unique key: `${edgeId}:${legIndex}`. */
  id: string;
  provider: string;
  providerType: ProviderType;
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  feePercent: number;
  feeFlat: number;
  /** Amount entering this leg (output of the previous leg, or the initial order amount). */
  inputAmount: number;
  /** Total fee deducted: `inputAmount * feePercent + feeFlat`. */
  feeAmount: number;
  /** Amount after fee deduction: `inputAmount - feeAmount`. */
  netSourceAmount: number;
  /** Amount delivered to the next leg: `netSourceAmount * rate`. */
  outputAmount: number;
};

/**
 * A fully ranked route returned to the client.
 *
 * Routes are ordered by `finalAmount` descending — the route that delivers
 * the most target currency after all fees wins rank 1.
 */
export type RouteResult = {
  /** Deterministic key derived from the provider–pair sequence. */
  id: string;
  /** 1-indexed rank by final delivered amount (best = 1). */
  rank: number;
  /** Ordered list of currencies visited: `[source, …intermediates, target]`. */
  path: CurrencyCode[];
  /** Human-readable path: `"GBP [AlphaFX] USD [BetaBank] JPY"`. */
  pathLabel: string;
  /** Original source amount from the request. */
  initialAmount: number;
  /** Amount delivered in the target currency after all leg fees. */
  finalAmount: number;
  /** `finalAmount - bestDirectRoute.finalAmount`, or `null` if no direct route exists. */
  differenceVsDirect: number | null;
  legs: LegBreakdown[];
  /** Plain-English explanation of why this route was selected. */
  selectionReason: string;
};

// ---------------------------------------------------------------------------
// Audit and diagnostics
// ---------------------------------------------------------------------------

/** Outcome of a single provider fetch attempt for one base currency. */
export type ProviderDiagnosticStatus =
  | "quoted"
  | "cached"
  | "missing_pair"
  | "failed"
  | "skipped";

/** Diagnostic entry recorded for each provider–base-currency fetch. */
export type ProviderDiagnostic = {
  provider: string;
  /** The base currency requested from a live provider (absent for static venues). */
  baseCurrency?: CurrencyCode;
  status: ProviderDiagnosticStatus;
  /** Human-readable explanation of what happened (success or failure). */
  reason: string;
  /** Wall-clock time for this fetch, including retries (milliseconds). */
  latencyMs?: number;
  /** Number of usable edges this fetch produced. */
  edgesQuoted: number;
};

/** Operational metadata attached to every quote response. */
export type RouteAudit = {
  /** UUID v4 identifying this request for tracing. */
  requestId: string;
  startedAt: string;
  completedAt: string;
  /** Distinct provider names that participated (live + static). */
  providersConsidered: number;
  /** Total directed edges built across all providers. */
  edgesQuoted: number;
  /** Total candidate paths evaluated by the search engine. */
  routesEvaluated: number;
  providerDiagnostics: ProviderDiagnostic[];
  /** Plain-English summary of how the returned routes were selected. */
  selectionSummary: string;
};

// ---------------------------------------------------------------------------
// API response
// ---------------------------------------------------------------------------

/** Complete response returned by `POST /api/routes`. */
export type QuoteResponse = {
  /** Echo of the validated request input. */
  input: RouteRequest;
  /** ISO 8601 timestamp when the response was finalized. */
  generatedAt: string;
  /** Top routes ranked by delivered target-currency amount (max 3). */
  routes: RouteResult[];
  /** Best single-leg route used as the comparison baseline, or `null`. */
  directRoute: RouteResult | null;
  /** Human-readable warnings about degraded provider coverage. */
  warnings: string[];
  /** Operational metadata for audit and debugging. */
  audit: RouteAudit;
};
