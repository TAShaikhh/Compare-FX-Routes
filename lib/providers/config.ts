/**
 * Provider configuration loaded from `providers.json`.
 *
 * This module reads the JSON file once at import time and exposes typed,
 * pre-filtered arrays so other modules can import `liveProviders` or
 * `staticProviders` directly without re-filtering on every request.
 */

import providersJson from "@/providers.json";
import type { ProviderConfig, ProvidersFile } from "@/lib/types";

const providersFile = providersJson as ProvidersFile;

/** All providers declared in `providers.json`. */
export const providers: ProviderConfig[] = providersFile.providers;

/** Providers that fetch rates from live public APIs (e.g. AlphaFX, BetaBank, DeltaMarkets). */
export const liveProviders = providers.filter((provider) => provider.rate_source === "live_api");

/** Providers with hard-coded pairs in `providers.json` (e.g. GammaCrypto, EpsilonChain, ZetaSwap). */
export const staticProviders = providers.filter((provider) => provider.rate_source === "static");
