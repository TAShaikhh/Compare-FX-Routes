/**
 * Top-level routing service.
 *
 * Orchestrates the full quote lifecycle:
 *   1. Fetch edges from static venue providers and live fiat API providers
 *      in parallel.
 *   2. Feed the combined edge graph into the bounded DFS route search.
 *   3. Rank routes by final delivered amount and identify the direct
 *      baseline.
 *   4. Build warnings and audit metadata for operational visibility.
 *
 * This is the single entry point called by `POST /api/routes`.
 */

import { getLiveFiatEdges } from "@/lib/providers/live";
import { getStaticEdges } from "@/lib/providers/static";
import { searchRoutes, rankRoutes } from "@/lib/routing/search";
import type { ProviderDiagnostic, QuoteResponse, RouteRequest } from "@/lib/types";

/** Maximum number of conversion legs allowed in any single route. */
const MAX_LEGS = 3;

/**
 * Calculate and rank multi-leg FX routes for a validated request.
 *
 * @param input - Validated route request (source, target, amount).
 * @returns Full quote response including ranked routes, warnings, and audit.
 */
export async function quoteRoutes(input: RouteRequest): Promise<QuoteResponse> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  // Fetch static and live edges concurrently.  Static edges are
  // synchronous but wrapped in Promise.resolve for uniform handling.
  const [staticResult, liveResult] = await Promise.all([
    Promise.resolve(getStaticEdges()),
    getLiveFiatEdges(input.sourceCurrency, input.targetCurrency),
  ]);

  const edges = [...staticResult.edges, ...liveResult.edges];
  const diagnostics = [...staticResult.diagnostics, ...liveResult.diagnostics];

  const candidateRoutes = searchRoutes(edges, {
    sourceCurrency: input.sourceCurrency,
    targetCurrency: input.targetCurrency,
    amount: input.amount,
    maxLegs: MAX_LEGS,
  });

  const ranked = rankRoutes(candidateRoutes, input.amount, input.targetCurrency);
  const warnings = buildWarnings(diagnostics, edges.length, candidateRoutes.length);
  const completedAt = new Date();

  return {
    input,
    generatedAt: completedAt.toISOString(),
    routes: ranked.rankedRoutes,
    directRoute: ranked.directRoute,
    warnings,
    audit: {
      requestId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      providersConsidered: new Set(diagnostics.map((d) => d.provider)).size,
      edgesQuoted: edges.length,
      routesEvaluated: candidateRoutes.length,
      providerDiagnostics: diagnostics,
      selectionSummary: buildSelectionSummary(
        candidateRoutes.length,
        ranked.rankedRoutes.length,
        ranked.directRoute !== null,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Warning and summary builders
// ---------------------------------------------------------------------------

/**
 * Build user-facing warning strings from provider diagnostics.
 *
 * Warnings inform the operator that results may be degraded without
 * hiding the routes that _were_ successfully computed.
 */
function buildWarnings(
  diagnostics: ProviderDiagnostic[],
  edgeCount: number,
  routeCount: number,
): string[] {
  const warnings: string[] = [];

  const failedProviders = new Set(
    diagnostics
      .filter((d) => d.status === "failed")
      .map((d) => d.provider),
  );

  for (const provider of failedProviders) {
    warnings.push(
      `${provider} was unavailable or returned invalid data; other providers were still evaluated.`,
    );
  }

  if (edgeCount === 0) {
    warnings.push("No provider returned usable quotes for the candidate currency graph.");
  } else if (routeCount === 0) {
    warnings.push("Providers returned quotes, but none formed a viable route within three legs.");
  }

  return warnings;
}

/** Build a plain-English summary of the route selection outcome. */
function buildSelectionSummary(
  routeCount: number,
  returnedCount: number,
  hasDirectRoute: boolean,
): string {
  if (routeCount === 0) {
    return "No viable routes were selected because every candidate route failed pair availability, fee, or leg-count constraints.";
  }

  const directText = hasDirectRoute
    ? "A single-leg direct baseline was available for comparison."
    : "No single-leg direct baseline was available.";

  return `Evaluated ${routeCount} viable routes and returned the best ${returnedCount} by final recipient amount. ${directText}`;
}
