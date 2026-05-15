import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithRetry } from "@/lib/http";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchJsonWithRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries transient 429 responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse({ rates: { EUR: 0.92 } }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry("https://example.test/latest", {
      timeoutMs: 1000,
      retries: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.json).toEqual({ rates: { EUR: 0.92 } });
  });

  it("does not retry non-transient 4xx responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "bad request" }, 400));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJsonWithRetry("https://example.test/latest", {
        timeoutMs: 1000,
        retries: 1,
      }),
    ).rejects.toThrow("HTTP 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and returns the last successful response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(jsonResponse({ result: "success" }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry("https://example.test/latest", {
      timeoutMs: 1000,
      retries: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.json).toEqual({ result: "success" });
  });

  it("aborts requests that exceed the per-attempt timeout", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = fetchJsonWithRetry("https://example.test/latest", {
      timeoutMs: 50,
      retries: 0,
    });
    const expectation = expect(result).rejects.toThrow("aborted");

    await vi.advanceTimersByTimeAsync(50);

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
