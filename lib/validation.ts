/**
 * Request validation for `POST /api/routes`.
 *
 * All external input passes through `parseRouteRequest` before reaching the
 * routing engine.  This module handles type coercion, normalization, and
 * business-rule checks so the rest of the codebase can assume valid data.
 */

import type { RouteRequest } from "@/lib/types";

/** Maximum source amount accepted by the quote tool. */
const MAX_AMOUNT = 1_000_000_000_000;

type ParseResult =
  | { ok: true; value: RouteRequest }
  | { ok: false; error: string };

/**
 * Validate and normalize a raw JSON payload into a `RouteRequest`.
 *
 * @param payload - Untrusted value parsed from the request body.
 * @returns A discriminated result: either a validated request or an error string.
 */
export function parseRouteRequest(payload: unknown): ParseResult {
  if (!isRecord(payload)) {
    return { ok: false, error: "Request body must be an object." };
  }

  const sourceCurrency = normalizeCurrency(payload.sourceCurrency);
  const targetCurrency = normalizeCurrency(payload.targetCurrency);
  const amount = payload.amount;

  if (payload.railMode !== undefined) {
    return { ok: false, error: "railMode is not supported by this quote tool." };
  }

  if (!sourceCurrency) {
    return { ok: false, error: "sourceCurrency must be a 3 to 5 character currency code." };
  }

  if (!targetCurrency) {
    return { ok: false, error: "targetCurrency must be a 3 to 5 character currency code." };
  }

  if (sourceCurrency === targetCurrency) {
    return { ok: false, error: "sourceCurrency and targetCurrency must be different." };
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "amount must be a positive number." };
  }

  if (amount > MAX_AMOUNT) {
    return { ok: false, error: "amount is too large for this quote tool." };
  }

  return {
    ok: true,
    value: { sourceCurrency, targetCurrency, amount },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a currency code to uppercase, or return `null` if invalid.
 *
 * Accepts 3–5 alphanumeric characters (covers ISO 4217 fiat codes and
 * common stablecoin tickers like USDT / USDC).
 */
function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,5}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

/** Type guard for plain objects (excludes arrays and null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
