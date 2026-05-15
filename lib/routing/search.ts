/**
 * Route search and ranking engine.
 *
 * The routing problem is modelled as a directed weighted graph where each
 * provider quote is an edge.  Unlike classic shortest-path problems, the
 * edge cost here is _amount-dependent_: each leg deducts fees from the
 * running amount before applying the conversion rate.  This rules out
 * Dijkstra or Bellman–Ford on static weights and requires simulating the
 * amount through every candidate path.
 *
 * The engine performs bounded depth-first search (max 3 legs), prevents
 * cycles through intermediate currencies, deduplicates routes by their
 * provider–pair sequence, and ranks by final delivered target-currency
 * amount.
 */

import { applySourceFee } from "@/lib/routing/fees";
import type { CurrencyCode, LegBreakdown, QuoteEdge, RouteResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type SearchOptions = {
  sourceCurrency: CurrencyCode;
  targetCurrency: CurrencyCode;
  amount: number;
  maxLegs: number;
};

/** Intermediate route representation used during search, before ranking. */
type WorkingRoute = {
  path: CurrencyCode[];
  legs: LegBreakdown[];
  finalAmount: number;
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Find all viable paths from `sourceCurrency` to `targetCurrency` within
 * `maxLegs` hops, simulating the amount through each leg.
 *
 * @param edges   - The full quote graph built by provider adapters.
 * @param options - Source/target currencies, initial amount, and leg cap.
 * @returns Every viable route found (unsorted, not yet deduplicated).
 */
export function searchRoutes(edges: QuoteEdge[], options: SearchOptions): WorkingRoute[] {
  const routes: WorkingRoute[] = [];

  // Pre-index edges by source currency for O(1) lookup during traversal.
  const edgesBySource = new Map<CurrencyCode, QuoteEdge[]>();
  for (const edge of edges) {
    const existing = edgesBySource.get(edge.from) ?? [];
    existing.push(edge);
    edgesBySource.set(edge.from, existing);
  }

  /**
   * Recursive DFS visitor.  At each node we try every outgoing edge,
   * simulate the fee + conversion, and either record a completed route
   * (if we reached the target) or recurse deeper (if legs remain).
   */
  function visit(
    currentCurrency: CurrencyCode,
    currentAmount: number,
    path: CurrencyCode[],
    legs: LegBreakdown[],
  ) {
    if (legs.length >= options.maxLegs) {
      return;
    }

    const nextEdges = edgesBySource.get(currentCurrency) ?? [];

    for (const edge of nextEdges) {
      // Block cycles through intermediate currencies, but allow the
      // target currency to appear (that is how we finish a route).
      if (path.includes(edge.to) && edge.to !== options.targetCurrency) {
        continue;
      }

      const fee = applySourceFee(currentAmount, edge.feeModel);
      if (!fee.ok) {
        continue;
      }

      // Amount-dependent cost: fee is deducted from the running amount
      // before the conversion rate is applied.  This is why we cannot
      // use a static shortest-path algorithm here.
      const outputAmount = fee.netSourceAmount * edge.rate;
      if (!Number.isFinite(outputAmount) || outputAmount <= 0) {
        continue;
      }

      const leg: LegBreakdown = {
        id: `${edge.id}:${legs.length + 1}`,
        provider: edge.provider,
        providerType: edge.providerType,
        from: edge.from,
        to: edge.to,
        rate: edge.rate,
        feePercent: edge.feeModel.fee_percent,
        feeFlat: edge.feeModel.fee_flat,
        inputAmount: currentAmount,
        feeAmount: fee.feeAmount,
        netSourceAmount: fee.netSourceAmount,
        outputAmount,
      };

      const nextPath = [...path, edge.to];
      const nextLegs = [...legs, leg];

      if (edge.to === options.targetCurrency) {
        routes.push({ path: nextPath, legs: nextLegs, finalAmount: outputAmount });
        continue;
      }

      visit(edge.to, outputAmount, nextPath, nextLegs);
    }
  }

  visit(options.sourceCurrency, options.amount, [options.sourceCurrency], []);
  return routes;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Deduplicate, sort, and rank routes.
 *
 * @param routes         - Raw candidate routes from `searchRoutes`.
 * @param initialAmount  - Original source amount (echoed into each result).
 * @param targetCurrency - Target currency code (used in labels and reasons).
 * @returns The top 3 routes by delivered amount and the best single-leg
 *          direct route (used as the comparison baseline).
 */
export function rankRoutes(
  routes: WorkingRoute[],
  initialAmount: number,
  targetCurrency: CurrencyCode,
): {
  rankedRoutes: RouteResult[];
  directRoute: RouteResult | null;
} {
  const uniqueRoutes = dedupeRoutes(routes);
  const sorted = uniqueRoutes.sort((left, right) => right.finalAmount - left.finalAmount);
  const bestDirect = sorted.find((route) => route.legs.length === 1) ?? null;
  const directRank = bestDirect === null ? null : sorted.indexOf(bestDirect) + 1;

  const directRoute = bestDirect
    ? toRouteResult(bestDirect, directRank ?? 1, initialAmount, targetCurrency, bestDirect.finalAmount)
    : null;

  const topThree = sorted.slice(0, 3).map((route, index) =>
    toRouteResult(route, index + 1, initialAmount, targetCurrency, bestDirect?.finalAmount ?? null),
  );

  return { rankedRoutes: topThree, directRoute };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collapse duplicate routes that follow the exact same provider–pair
 * sequence, keeping only the one with the highest final amount.
 */
function dedupeRoutes(routes: WorkingRoute[]): WorkingRoute[] {
  const bestBySignature = new Map<string, WorkingRoute>();

  for (const route of routes) {
    const signature = route.legs
      .map((leg) => `${leg.provider}:${leg.from}:${leg.to}`)
      .join("|");
    const existing = bestBySignature.get(signature);

    if (!existing || route.finalAmount > existing.finalAmount) {
      bestBySignature.set(signature, route);
    }
  }

  return [...bestBySignature.values()];
}

/** Convert a `WorkingRoute` into the public `RouteResult` shape. */
function toRouteResult(
  route: WorkingRoute,
  rank: number,
  initialAmount: number,
  targetCurrency: CurrencyCode,
  directAmount: number | null,
): RouteResult {
  const differenceVsDirect = directAmount === null ? null : route.finalAmount - directAmount;
  const id = route.legs.map((leg) => `${leg.provider}-${leg.from}-${leg.to}`).join("__");

  return {
    id,
    rank,
    path: route.path,
    pathLabel: buildPathLabel(route),
    initialAmount,
    finalAmount: route.finalAmount,
    differenceVsDirect,
    legs: route.legs,
    selectionReason: buildSelectionReason(route, targetCurrency, differenceVsDirect),
  };
}

/**
 * Build a human-readable path label like `"GBP [AlphaFX] USD [BetaBank] JPY"`.
 */
function buildPathLabel(route: WorkingRoute): string {
  const parts: string[] = [];

  for (const leg of route.legs) {
    if (parts.length === 0) {
      parts.push(leg.from);
    }
    parts.push(`[${leg.provider}]`);
    parts.push(leg.to);
  }

  return parts.join(" ");
}

/** Generate a plain-English selection reason for the UI. */
function buildSelectionReason(
  route: WorkingRoute,
  targetCurrency: CurrencyCode,
  differenceVsDirect: number | null,
): string {
  if (differenceVsDirect === null) {
    return `Selected because it delivers ${formatCompact(route.finalAmount)} ${targetCurrency}; no direct route baseline exists.`;
  }

  if (Math.abs(differenceVsDirect) < 0.000001) {
    return `Selected as the direct-route baseline delivering ${formatCompact(route.finalAmount)} ${targetCurrency}.`;
  }

  const direction = differenceVsDirect > 0 ? "more" : "less";
  return `Selected because it delivers ${formatCompact(Math.abs(differenceVsDirect))} ${targetCurrency} ${direction} than the best direct route.`;
}

/** Format a number compactly for selection-reason strings. */
function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 6,
  }).format(value);
}
