# FX Routing Tool

Internal routing console for the multi-leg FX case study. The app ranks the top 3 routes by the amount delivered to the recipient after provider fees, while keeping provider failures isolated so the tool can still return useful results when live APIs are unavailable.

Production URL: https://compare-fx-routes.vercel.app/

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

On Windows machines where PowerShell blocks `npm.ps1`, run the same commands through `npm.cmd`, for example `npm.cmd test`.

## Reviewer Onboarding

- `app/`: Next.js app router entrypoints. `app/page.tsx` renders the console, and `app/api/routes/route.ts` is the server-side quote API.
- `components/`: React UI components. The main operator console lives in `components/fx-routing-tool.tsx`.
- `lib/`: Core TypeScript business logic shared by the API and UI.
- `lib/routing/`: Fee calculation, bounded route search, route ranking, warnings, and audit response assembly.
- `lib/providers/`: Provider configuration plus live/static adapters that normalize external rates into internal quote edges.
- `tests/`: Vitest coverage for validation, routing, fees, providers, HTTP retry/timeout behavior, service degradation, and edge cases.
- `Diagrams/`: Architecture, data-flow, routing-algorithm, and reliability diagram images.
- `providers.json`: Assignment-provided provider definitions, fees, static pairs, and live API endpoints.

## Approach And Implementation

- The app is a Next.js TypeScript internal tool with a server-side routing API and a client-side operator console.
- Provider adapters normalize live fiat APIs and static stablecoin venues into one directed quote graph.
- The routing engine performs bounded graph search up to 3 legs and simulates fees leg by leg because route economics depend on the amount entering each leg.
- Routes are ranked by final recipient amount, not by nominal exchange rate.
- The UI shows top routes, per-leg economics, provider warnings, direct-route comparison, and audit metadata.
- Tests cover validation, fee logic, provider parsing, route ranking, edge cases, and degraded-provider behavior.

## How The Routing Model Works

The routing problem is modeled as a directed weighted graph. Each provider quote is an edge from one currency to another, and each route is a path through that graph with at most 3 edges. The edge weight is not a static cost, because fees depend on the amount entering that leg, so the engine simulates the amount through each candidate path and ranks routes by final target-currency amount. The best direct route is the highest-delivering one-leg path and is used as the comparison baseline when available.

## Reliability Decisions

- Provider calls happen server-side in `app/api/routes/route.ts`, not in the browser.
- Each live provider has an adapter that validates its response shape before rates enter the routing graph.
- Live calls use per-request timeouts, limited retry for transient failures, bounded concurrency, and short in-memory caching.
- Provider failures are captured as diagnostics and warnings instead of failing the whole quote.
- Static stablecoin venues are always available from `providers.json`, so they can still produce routes during live API outages.
- The response includes lightweight audit metadata: providers considered, edges quoted, routes evaluated, provider failure reasons, and route selection summary.

## Assumptions Made

- A direct route means the best available single-leg route from source currency to target currency.
- Live fiat providers are treated as fiat rails only; stablecoin venue routes come from explicit pairs in `providers.json`.
- Static provider pairs are directional. Reverse pairs are used only when explicitly listed.
- Fees are always charged in the leg source currency and are deducted before applying the conversion rate.
- Public provider APIs can timeout, rate-limit, omit pairs, or return malformed data, so unavailable providers degrade the quote instead of failing the whole request.
- Audit metadata is request-scoped operational context, not a persistent trade ledger.

## AI Tools Used

I used Codex primarily as an implementation assistant to speed up development of the Next.js application, provider adapters, routing logic, testing, and documentation. I was responsible for the overall system design, architecture decisions, debugging, validation, code review, and ensuring the final implementation aligned with the assignment requirements and engineering tradeoffs.

I also used AI tools to analyze providers.json, and accelerate repetitive implementation tasks, while I handled the decision making around routing strategy, caching behavior, provider selection logic, and application structure.

For frontend refinement and UI iteration, I used Gemini 3.1 Pro with UI skills to improve workflow clarity, responsiveness, and operational readability across desktop and mobile states.

I also used Opus 4.6 to assist with test coverage review, edge-case analysis, and validation of routing behavior under provider failures, malformed responses, retry conditions, and max-leg constraints.

One example where engineering judgment was important was around exchange-rate fetching strategy. An initial AI-generated approach leaned toward broad live-rate prefetching, which would introduce unnecessary latency and rate-limit risk. I revised the design to fetch only the candidate fiat bases relevant to the active request and added short-lived caching to reduce redundant external API calls while keeping quotes responsive.

## With More Time

I would add persistent quote history with a database-backed audit trail. The current audit metadata is intentionally lightweight and request-scoped, which is right for the assignment, but production trade tooling would need durable records for reconciliation, compliance review, and incident analysis.

## Project Notes

- `Diagrams/` contains architecture, data flow, routing algorithm, and reliability diagram images.
- The application is optimized for the core assignment scope: bounded route search, isolated provider calls, short-lived caching, and limited retries keep the tool responsive and resilient.
- The frontend UI was reviewed for both desktop and mobile readability, including loading, empty, error, warning, success, and audit states for an internal operations workflow.
- UI/UX decisions prioritize operational clarity by surfacing route economics, provider warnings, direct-route comparisons, and audit metadata directly in the workflow.
- Code quality is reinforced through strict TypeScript usage, separated business logic, typed provider normalization, defensive validation, and focused documentation.
- Automated tests cover fee calculations, route ranking, cycle prevention, max-leg enforcement, direct-route comparison, malformed provider responses, provider failures, retry/timeout behavior, and additional routing edge cases.
