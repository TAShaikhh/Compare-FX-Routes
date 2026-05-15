import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLiveRateCacheForTests } from "@/lib/providers/live";
import { quoteRoutes } from "@/lib/routing/service";

function mockFailedFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "service unavailable" }),
    })),
  );
}

describe("quoteRoutes integration behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearLiveRateCacheForTests();
  });

  it("still returns useful static routes when live providers fail", async () => {
    mockFailedFetch();

    const result = await quoteRoutes({
      sourceCurrency: "USD",
      targetCurrency: "CAD",
      amount: 10_000,
    });

    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes[0].path[0]).toBe("USD");
    expect(result.routes[0].path.at(-1)).toBe("CAD");
    expect(result.warnings.some((warning) => warning.includes("unavailable"))).toBe(true);
  });

  it("records provider diagnostics for failed live calls and route selection", async () => {
    mockFailedFetch();

    const result = await quoteRoutes({
      sourceCurrency: "EUR",
      targetCurrency: "USDT",
      amount: 5_000,
    });

    expect(result.audit.providerDiagnostics.some((diagnostic) => diagnostic.status === "failed")).toBe(true);
    expect(result.audit.routesEvaluated).toBeGreaterThan(0);
    expect(result.audit.selectionSummary).toContain("Evaluated");
  });
});
