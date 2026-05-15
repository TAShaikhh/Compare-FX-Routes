/**
 * FX Routing Tool — client-side operator console.
 *
 * This is the sole page component for the app.  It renders the order form,
 * submits requests to `/api/routes`, and displays ranked route results with
 * per-leg economics, warnings, and audit metadata.
 *
 * Key design decisions:
 *   - The form uses a custom dropdown (`CustomSelect`) instead of native
 *     `<select>` elements for a modern, accessible look with keyboard
 *     and blur-dismiss support.
 *   - The results section uses `aria-live="polite"` so screen readers
 *     announce new results without interrupting the user.
 *   - Client-side validation catches obvious errors (empty/negative amounts)
 *     before hitting the API, reducing unnecessary round-trips.
 *   - All financial numbers use tabular-nums via the `.number` CSS class
 *     for clean column alignment.
 */

"use client";

import {
  ArrowClockwise,
  ArrowsLeftRight,
  CaretDown,
  ChartLineUp,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Path,
  WarningCircle,
  ArrowRight,
  ArrowDown,
} from "@phosphor-icons/react";
import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import type { QuoteResponse, RouteResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Component types
// ---------------------------------------------------------------------------

type Props = {
  /** Pre-sorted list of supported currency codes from the server. */
  currencies: string[];
};

type FormState = {
  sourceCurrency: string;
  targetCurrency: string;
  /** Stored as a string to allow intermediate input states (e.g. empty field). */
  amount: string;
};

/**
 * Discriminated union for the results panel state machine.
 *
 * Transitions: idle → loading → success | error
 * The user can re-submit from any state to restart the cycle.
 */
type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: QuoteResponse }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

/** Human-readable names for supported currencies. */
const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  CHF: "Swiss Franc",
  USDT: "Tether USD",
  USDC: "USD Coin",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FxRoutingTool({ currencies }: Props) {
  const [form, setForm] = useState<FormState>({
    sourceCurrency: "GBP",
    targetCurrency: "JPY",
    amount: "10000",
  });
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });

  const sourceOptions = useMemo(() => currencies.filter(Boolean), [currencies]);
  const targetOptions = sourceOptions;

  /** Submit the order form to the routing API. */
  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      // Client-side guard: catch empty or non-positive amounts early.
      const amount = Number(form.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setLoadState({ status: "error", message: "Enter a positive source amount." });
        return;
      }

      setLoadState({ status: "loading" });

      try {
        const response = await fetch("/api/routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceCurrency: form.sourceCurrency,
            targetCurrency: form.targetCurrency,
            amount,
          }),
        });

        const payload: unknown = await response.json();

        if (!response.ok) {
          const message =
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Route calculation failed.";
          setLoadState({ status: "error", message });
          return;
        }

        setLoadState({ status: "success", data: payload as QuoteResponse });
      } catch {
        setLoadState({
          status: "error",
          message: "The routing service could not be reached. Check the local server and try again.",
        });
      }
    },
    [form],
  );

  /** Swap source ↔ target currencies. */
  function swapCurrencies() {
    setForm((current) => ({
      ...current,
      sourceCurrency: current.targetCurrency,
      targetCurrency: current.sourceCurrency,
    }));
  }

  return (
    <main className="min-h-[100dvh] px-4 py-8 text-[var(--foreground)] sm:px-6 sm:py-10 md:px-8 md:py-16">
      <div className="mx-auto grid max-w-7xl gap-10 lg:gap-16">
        {/* ---- Order form section ---- */}
        <section className="rounded-[2rem] border border-[rgba(217,222,211,0.5)] bg-[rgba(255,255,255,0.85)] p-6 shadow-[0_32px_80px_-40px_rgba(32,35,31,0.25)] backdrop-blur sm:p-8 md:p-10 lg:p-14">
          <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between md:mb-12">
            <div className="max-w-3xl">
              <p className="mb-2 text-sm font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                Compare routes before execution
              </p>
              <h1 className="text-balance text-3xl font-semibold leading-none tracking-tight sm:text-4xl md:text-5xl">
                Compare FX Routes
              </h1>
            </div>
            <div className="hidden items-center gap-4 self-start rounded-xl border border-[rgba(217,222,211,0.5)] bg-white px-6 py-4 sm:flex">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Max legs</p>
              <p className="text-3xl font-bold tabular-nums tracking-tight text-[var(--accent-dark)]">3</p>
            </div>
          </div>

          <form className="grid gap-6" onSubmit={handleSubmit}>
            {/* Currency selectors + swap button */}
            <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
              <CustomSelect
                label="Source currency"
                value={form.sourceCurrency}
                options={sourceOptions}
                onChange={(val) => setForm((current) => ({ ...current, sourceCurrency: val }))}
              />

              <button
                aria-label="Swap currencies"
                className="mx-auto grid size-12 place-items-center rounded-full border border-[var(--line)] bg-white text-[var(--accent)] shadow-sm transition-all hover:scale-105 hover:border-[var(--accent)] hover:shadow-md active:scale-95"
                type="button"
                onClick={swapCurrencies}
              >
                <ArrowsLeftRight size={20} weight="bold" />
              </button>

              <CustomSelect
                label="Target currency"
                value={form.targetCurrency}
                options={targetOptions}
                onChange={(val) => setForm((current) => ({ ...current, targetCurrency: val }))}
              />
            </div>

            {/* Amount input + submit */}
            <div className="mt-2 grid gap-4 md:mt-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <div>
                <label className="mb-2 block pl-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] sm:text-xs">
                  Source amount
                </label>
                <input
                  className="number h-16 w-full rounded-xl border border-[var(--line)] bg-white px-4 text-lg font-medium shadow-sm outline-none transition-all focus:border-[var(--accent)] focus:ring-4 focus:ring-[rgba(47,111,94,0.1)]"
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, amount: event.target.value }))
                  }
                />
                <span className="mt-2 block pl-1 text-xs text-[var(--muted)] sm:text-[13px] lg:text-sm">
                  Fees are deducted in each leg source currency before conversion.
                </span>
              </div>

              <button
                className="inline-flex h-16 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-8 font-semibold text-white shadow-md transition-all hover:bg-[var(--accent-dark)] hover:shadow-lg active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100 md:mt-[22px] md:self-start"
                disabled={loadState.status === "loading"}
                type="submit"
              >
                {loadState.status === "loading" ? (
                  <ArrowClockwise className="animate-spin" size={20} weight="bold" />
                ) : (
                  <ChartLineUp size={20} weight="bold" />
                )}
                Calculate routes
              </button>
            </div>
          </form>

          {/* Feature bullets */}
          <div className="mt-10 grid gap-5 border-t border-[rgba(217,222,211,0.5)] pt-8 text-[15px] leading-relaxed text-[var(--muted)] md:grid-cols-2 md:gap-6 xl:grid-cols-3 xl:gap-8">
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="mt-0.5 shrink-0 text-[var(--accent)]" weight="fill" />
              Ranks routes by recipient amount after every fee.
            </div>
            <div className="flex items-start gap-3">
              <ClockCounterClockwise size={20} className="mt-0.5 shrink-0 text-[var(--accent)]" weight="fill" />
              Live providers use timeouts, retries, and short server cache.
            </div>
            <div className="flex items-start gap-3">
              <Path size={20} className="mt-0.5 shrink-0 text-[var(--accent)]" weight="fill" />
              Audit metadata explains provider failures and selection logic.
            </div>
          </div>
        </section>

        {/* ---- Results section ---- */}
        <section
          aria-live="polite"
          className="min-h-[500px] rounded-[2rem] border border-[rgba(217,222,211,0.5)] bg-[rgba(255,255,255,0.92)] p-6 shadow-[0_32px_80px_-40px_rgba(32,35,31,0.25)] backdrop-blur sm:p-8 md:p-10 lg:p-14"
        >
          {loadState.status === "idle" && <EmptyState />}
          {loadState.status === "loading" && <LoadingState />}
          {loadState.status === "error" && <ErrorState message={loadState.message} />}
          {loadState.status === "success" && <ResultsPanel data={loadState.data} />}
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// State panels
// ---------------------------------------------------------------------------

/** Placeholder shown before the first calculation. */
function EmptyState() {
  return (
    <div className="grid h-full min-h-[300px] place-items-center rounded-md border border-dashed border-[var(--line)] bg-[rgba(246,247,244,0.62)] p-6 text-center sm:min-h-[540px] sm:p-8">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-md border border-[var(--line)] bg-white text-[var(--accent)]">
          <Path size={24} weight="bold" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">No route calculated yet</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Enter an order above to compare direct fiat execution, multi-leg fiat paths, and
          stablecoin venue routes.
        </p>
      </div>
    </div>
  );
}

/** Skeleton shimmer shown while the API call is in flight. */
function LoadingState() {
  return (
    <div className="grid gap-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-md border border-[var(--line)] bg-white p-4">
          <div className="route-skeleton h-5 w-36 rounded bg-[#e5e9df]" />
          <div className="mt-4 grid gap-3">
            <div className="route-skeleton h-4 rounded bg-[#e5e9df]" />
            <div className="route-skeleton h-4 w-4/5 rounded bg-[#e5e9df]" />
            <div className="route-skeleton h-20 rounded bg-[#e5e9df]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Error banner displayed when the API returns an error or is unreachable. */
function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-[rgba(159,58,56,0.32)] bg-[rgba(159,58,56,0.06)] p-5 text-[var(--danger)]">
      <div className="flex items-center gap-2 font-semibold">
        <WarningCircle size={19} weight="bold" />
        Route request rejected
      </div>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

/** Full results display: header, warnings, ranked route cards, and audit. */
function ResultsPanel({ data }: { data: QuoteResponse }) {
  return (
    <div className="grid gap-10">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-sm uppercase tracking-[0.15em] text-[var(--muted)]">Quote result</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
            {data.input.sourceCurrency} to {data.input.targetCurrency}
          </h2>
        </div>
        <div className="number rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--muted)]">
          Ref {data.audit.requestId.slice(0, 8)}
        </div>
      </div>

      {/* Provider warnings */}
      {data.warnings.length > 0 && (
        <div className="rounded-md border border-[rgba(138,98,29,0.34)] bg-[rgba(138,98,29,0.07)] p-4 text-sm text-[var(--warning)]">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <WarningCircle size={18} weight="bold" />
            Provider warnings
          </div>
          <ul className="grid gap-1">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Route cards or empty message */}
      {data.routes.length === 0 ? (
        <div className="rounded-md border border-[var(--line)] bg-white p-5">
          <h3 className="font-semibold">No viable route found</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Providers were queried where possible, but no route within three legs could deliver a
            positive target amount.
          </p>
        </div>
      ) : (
        <div className="grid gap-8">
          {data.routes.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              targetCurrency={data.input.targetCurrency}
              sourceCurrency={data.input.sourceCurrency}
            />
          ))}
        </div>
      )}

      <AuditPanel data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route card
// ---------------------------------------------------------------------------

/** Detailed card for a single ranked route, including per-leg economics. */
function RouteCard({
  route,
  sourceCurrency,
  targetCurrency,
}: {
  route: RouteResult;
  sourceCurrency: string;
  targetCurrency: string;
}) {
  const directDelta = route.differenceVsDirect;

  return (
    <article className="rounded-2xl border border-[rgba(217,222,211,0.6)] bg-white p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6 md:p-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-3">
            <span className="rounded-lg bg-[rgba(47,111,94,0.1)] px-3 py-1 text-sm font-bold tabular-nums text-[var(--accent)]">
              Rank {route.rank}
            </span>
            <span className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
              {route.legs.length} {route.legs.length === 1 ? "leg" : "legs"}
            </span>
          </div>
          <div className="hidden xl:flex xl:flex-nowrap xl:items-center xl:gap-5 xl:text-2xl xl:font-bold xl:tracking-tight">
            <span>{route.legs[0].from}</span>
            {route.legs.map((leg) => (
              <div key={leg.id} className="flex items-center gap-5">
                <div className="flex flex-col items-center justify-center">
                  <span className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    {leg.provider}
                  </span>
                  <ArrowRight size={18} weight="bold" className="text-[var(--line)]" />
                </div>
                <span>{leg.to}</span>
              </div>
            ))}
          </div>
          <div className="grid gap-3 xl:hidden">
            <div className="text-2xl font-bold tracking-tight">{route.legs[0].from}</div>
            {route.legs.map((leg) => (
              <div
                key={leg.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-[var(--line)] bg-[#fbfcfa] px-4 py-3"
              >
                <ArrowDown size={16} weight="bold" className="text-[var(--line)]" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                    {leg.provider}
                  </p>
                  <p className="mt-1 text-xl font-bold tracking-tight text-[var(--foreground)]">
                    {leg.to}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1 flex flex-col rounded-xl border border-[var(--line)] bg-[#fbfcfa] p-4 text-left xl:mt-0 xl:min-w-[220px] xl:items-end xl:border-0 xl:bg-transparent xl:p-0 xl:text-right">
          <div className="mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Delivered</p>
            <p className="mt-1 text-2xl font-bold leading-none tracking-tight text-[var(--foreground)] tabular-nums md:text-3xl">
              {formatNumber(route.finalAmount)}{" "}
              <span className="text-base font-medium text-[var(--muted)] sm:text-lg md:text-xl">
                {targetCurrency}
              </span>
            </p>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)] tabular-nums">
            From {formatNumber(route.initialAmount)}{" "}
            <span className="text-xs font-medium opacity-80">{sourceCurrency}</span>
          </p>
        </div>
      </div>

      {/* Per-leg economics — card layout on mobile/tablet, table on lg+ */}
      <div className="mt-8 grid gap-4 xl:hidden">
        {route.legs.map((leg) => (
          <div key={leg.id} className="rounded-xl border border-[var(--line)] bg-[#fbfcfa] p-5 shadow-sm">
            <div className="mb-4 border-b border-[var(--line)] pb-3">
              <p className="font-semibold">{leg.provider}</p>
              <p className="text-sm text-[var(--muted)]">{leg.from} → {leg.to}</p>
            </div>
            <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px] sm:grid-cols-2 sm:gap-x-4 sm:text-sm">
              <span className="text-[var(--muted)]">Rate</span>
              <span className="min-w-0 break-all text-right tabular-nums">{formatRate(leg.rate)}</span>
              <span className="text-[var(--muted)]">Input</span>
              <span className="min-w-0 text-right tabular-nums">
                {formatNumber(leg.inputAmount)}
                <span className="ml-1 block text-[11px] font-medium text-[var(--muted)] sm:inline sm:text-xs">{leg.from}</span>
              </span>
              <span className="text-[var(--muted)]">Fee</span>
              <span className="min-w-0 text-right tabular-nums">
                {formatNumber(leg.feeAmount)}
                <span className="ml-1 block text-[11px] font-medium text-[var(--muted)] sm:inline sm:text-xs">{leg.from}</span>
              </span>
              <span className="text-[var(--muted)]">Net</span>
              <span className="min-w-0 text-right tabular-nums">
                {formatNumber(leg.netSourceAmount)}
                <span className="ml-1 block text-[11px] font-medium text-[var(--muted)] sm:inline sm:text-xs">{leg.from}</span>
              </span>
              <span className="text-[var(--muted)]">Output</span>
              <span className="min-w-0 text-right font-semibold tabular-nums">
                {formatNumber(leg.outputAmount)}
                <span className="ml-1 block text-[11px] font-medium text-[var(--muted)] sm:inline sm:text-xs">{leg.to}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 hidden overflow-hidden rounded-xl border border-[var(--line)] shadow-sm xl:block">
        <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.7fr)_minmax(0,0.95fr)_minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,1fr)] gap-4 border-b border-[var(--line)] bg-[#fbfcfa] px-6 py-4 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
          <span>Leg</span>
          <span className="text-right">Rate</span>
          <span className="text-right">Input</span>
          <span className="text-right">Fee</span>
          <span className="text-right">Net</span>
          <span className="text-right">Output</span>
        </div>
        {route.legs.map((leg) => (
          <div
            className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.7fr)_minmax(0,0.95fr)_minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,1fr)] gap-4 border-b border-[var(--line)] px-6 py-5 text-[14px] last:border-b-0"
            key={leg.id}
          >
            <div className="min-w-0">
              <p className="font-semibold">{leg.provider}</p>
              <p className="text-[var(--muted)]">{leg.from} → {leg.to}</p>
            </div>
            <p className="whitespace-nowrap text-right tabular-nums">{formatRate(leg.rate)}</p>
            <p className="whitespace-nowrap text-right tabular-nums">
              {formatNumber(leg.inputAmount)} <span className="text-[13px] font-medium text-[var(--muted)]">{leg.from}</span>
            </p>
            <p className="whitespace-nowrap text-right tabular-nums">
              {formatNumber(leg.feeAmount)} <span className="text-[13px] font-medium text-[var(--muted)]">{leg.from}</span>
            </p>
            <p className="whitespace-nowrap text-right tabular-nums">
              {formatNumber(leg.netSourceAmount)} <span className="text-[13px] font-medium text-[var(--muted)]">{leg.from}</span>
            </p>
            <p className="whitespace-nowrap text-right tabular-nums">
              {formatNumber(leg.outputAmount)} <span className="text-[13px] font-medium text-[var(--muted)]">{leg.to}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Direct-route delta */}
      <div className="mt-6 flex items-center gap-2 text-[14px]">
        {directDelta === null ? (
          <span className="text-[var(--muted)]">No direct single-leg baseline was available.</span>
        ) : (
          <>
            <ChartLineUp size={16} weight="bold" className="text-[var(--accent)]" />
            <span>
              <span className="font-bold tabular-nums text-[var(--accent-dark)]">
                {directDelta >= 0 ? "+" : ""}
                {formatNumber(directDelta)} {targetCurrency}
              </span>{" "}
              <span className="text-[var(--muted)]">versus best direct route</span>
            </span>
          </>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Audit panel
// ---------------------------------------------------------------------------

/** Expandable panel showing operational metadata for the quote. */
function AuditPanel({ data }: { data: QuoteResponse }) {
  return (
    <details className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm transition-all md:p-8">
      <summary className="cursor-pointer text-lg font-bold tracking-tight">Audit metadata</summary>
      <div className="mt-8 grid gap-8 text-[15px] leading-relaxed">
        <div className="grid gap-4 md:grid-cols-3">
          <AuditMetric label="Providers considered" value={String(data.audit.providersConsidered)} />
          <AuditMetric label="Edges quoted" value={String(data.audit.edgesQuoted)} />
          <AuditMetric label="Routes evaluated" value={String(data.audit.routesEvaluated)} />
        </div>
        <div>
          <p className="mb-2 font-medium">Selection summary</p>
          <p className="text-[var(--muted)]">{data.audit.selectionSummary}</p>
        </div>
        <div>
          <p className="mb-2 font-medium">Provider diagnostics</p>
          <div className="grid gap-3">
            {data.audit.providerDiagnostics.map((diagnostic) => (
              <div
                className="grid gap-2 rounded-xl border border-[var(--line)] bg-[#fbfcfa] p-4 sm:gap-3 lg:grid-cols-[1fr_1fr_2fr]"
                key={`${diagnostic.provider}-${diagnostic.baseCurrency ?? "static"}`}
              >
                <span className="font-semibold">{diagnostic.provider}</span>
                <span className="number text-[var(--muted)]">
                  {diagnostic.baseCurrency ?? "static"}: {diagnostic.status}
                </span>
                <span className="text-[var(--muted)]">{diagnostic.reason}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

/** Single metric card inside the audit panel. */
function AuditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[#fbfcfa] p-5">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--muted)]">{label}</p>
      <p className="number mt-2 text-3xl font-bold tracking-tight text-[var(--foreground)]">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom select dropdown
// ---------------------------------------------------------------------------

/**
 * Custom-styled dropdown replacing the native `<select>` element.
 *
 * Uses a button trigger with an absolutely positioned option list.
 * The dropdown dismisses on blur (with a 150ms delay to allow option
 * clicks to register) and on option selection.
 */
function CustomSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  label: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  /** Toggle the dropdown.  Clears any pending blur-dismiss. */
  function handleToggle() {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    setIsOpen((prev) => !prev);
  }

  /** Delayed close on blur — gives option `onClick` time to fire. */
  function handleBlur() {
    blurTimeoutRef.current = setTimeout(() => setIsOpen(false), 150);
  }

  /** Select an option and close the dropdown. */
  function handleSelect(currency: string) {
    onChange(currency);
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-16 w-full items-center justify-between rounded-xl border border-[var(--line)] bg-white px-4 text-left shadow-sm transition-all hover:border-[var(--accent)] focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[rgba(47,111,94,0.1)]"
        onClick={handleToggle}
        onBlur={handleBlur}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {label}
          </span>
          <span className="font-medium text-[var(--foreground)]">
            {value}{" "}
            <span className="ml-1 font-normal text-[var(--muted)]">
              — {CURRENCY_NAMES[value] ?? "Currency"}
            </span>
          </span>
        </div>
        <CaretDown
          size={16}
          weight="bold"
          className={`text-[var(--muted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""
            }`}
        />
      </button>

      {isOpen && (
        <div className="dropdown-enter absolute top-[calc(100%+8px)] z-10 max-h-60 w-full overflow-auto rounded-xl border border-[var(--line)] bg-white p-1 shadow-xl outline-none">
          {options.map((currency) => (
            <button
              key={currency}
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[rgba(47,111,94,0.05)] ${value === currency
                  ? "bg-[rgba(47,111,94,0.08)] text-[var(--accent)]"
                  : "text-[var(--foreground)]"
                }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(currency)}
            >
              <span>
                <span className="font-medium">{currency}</span>
                <span className="ml-2 text-sm text-[var(--muted)]">
                  {CURRENCY_NAMES[currency] ?? "Currency"}
                </span>
              </span>
              {value === currency && (
                <Check size={16} weight="bold" className="text-[var(--accent)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/**
 * Format a financial number for display.
 *
 * Large values (≥100) use 2 decimal places; small values use up to 6
 * to preserve precision for micro-amounts and fractional rates.
 */
function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 6,
    minimumFractionDigits: Math.abs(value) >= 100 ? 2 : 0,
  }).format(value);
}

/** Format an exchange rate with up to 8 decimal places. */
function formatRate(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Type guard for plain objects (excludes arrays and null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
