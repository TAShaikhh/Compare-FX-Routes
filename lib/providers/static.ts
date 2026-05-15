/**
 * Static venue provider adapter.
 *
 * Static providers (GammaCrypto, EpsilonChain, ZetaSwap) define their
 * currency pairs and rates directly in `providers.json`.  This adapter
 * reads those pairs and converts them into `QuoteEdge` objects using the
 * same shape as live provider edges, so the routing engine treats all
 * edges uniformly.
 *
 * Because static edges require no network calls, they are always
 * available and provide a reliability baseline during live API outages.
 */

import { staticProviders } from "@/lib/providers/config";
import type { ProviderDiagnostic, QuoteEdge } from "@/lib/types";

/**
 * Build quote edges and diagnostics from all static venue providers.
 *
 * This function is synchronous — no network calls are involved.
 */
export function getStaticEdges(): {
  edges: QuoteEdge[];
  diagnostics: ProviderDiagnostic[];
} {
  const edges: QuoteEdge[] = [];
  const diagnostics: ProviderDiagnostic[] = [];

  for (const provider of staticProviders) {
    const providerEdges: QuoteEdge[] = [];

    for (const pair of provider.pairs ?? []) {
      providerEdges.push({
        id: `${provider.name}:${pair.from}:${pair.to}`,
        provider: provider.name,
        providerType: provider.type,
        rateSource: provider.rate_source,
        from: pair.from.toUpperCase(),
        to: pair.to.toUpperCase(),
        rate: pair.rate,
        feeModel: provider.fee_model,
      });
    }

    edges.push(...providerEdges);

    diagnostics.push({
      provider: provider.name,
      status: providerEdges.length > 0 ? "quoted" : "missing_pair",
      reason:
        providerEdges.length > 0
          ? `Loaded ${providerEdges.length} static venue pairs from providers.json.`
          : "No static venue pairs were configured.",
      edgesQuoted: providerEdges.length,
    });
  }

  return { edges, diagnostics };
}
