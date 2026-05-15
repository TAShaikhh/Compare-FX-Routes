/**
 * API route handler for `POST /api/routes`.
 *
 * This is the single server-side entry point for quote calculations.
 * It validates the request body, delegates to the routing service, and
 * returns structured JSON responses with appropriate HTTP status codes.
 *
 * All provider calls happen here on the server — the browser never
 * contacts external rate APIs directly.
 */

import { NextResponse } from "next/server";
import { quoteRoutes } from "@/lib/routing/service";
import { parseRouteRequest } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = parseRouteRequest(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await quoteRoutes(parsed.value);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown routing error.";
    return NextResponse.json(
      { error: "Unable to calculate routes.", detail: message },
      { status: 500 },
    );
  }
}
