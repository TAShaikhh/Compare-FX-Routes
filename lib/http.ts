/**
 * HTTP fetch utility with timeout and retry support.
 *
 * All outbound HTTP calls to live rate providers go through
 * `fetchJsonWithRetry`.  This centralises timeout enforcement,
 * transient-failure retry (HTTP 429 and 5xx), and latency tracking so
 * individual provider adapters stay focused on response parsing.
 */

type FetchJsonOptions = {
  /** Maximum wall-clock time per attempt (milliseconds). */
  timeoutMs: number;
  /** Number of retry attempts after the initial request (0 = no retries). */
  retries: number;
};

export type FetchJsonResult = {
  /** Parsed JSON body from the response. */
  json: unknown;
  /** Total wall-clock time across all attempts (milliseconds). */
  latencyMs: number;
  /** Number of attempts made (1 = first attempt succeeded). */
  attempts: number;
};

class NonRetryableHttpError extends Error {}

/**
 * Fetch JSON from a URL with per-attempt timeouts and automatic retry
 * for transient server errors.
 *
 * @param url     - The URL to fetch.
 * @param options - Timeout and retry configuration.
 * @throws {Error} If all attempts fail or a non-retryable HTTP status is received.
 */
export async function fetchJsonWithRetry(
  url: string,
  options: FetchJsonOptions,
): Promise<FetchJsonResult> {
  const startedAt = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "fx-routing-case-study/1.0",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = `HTTP ${response.status} from ${url}`;

        // Retry on rate-limit or server errors; fail immediately on 4xx.
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(message);
          continue;
        }

        throw new NonRetryableHttpError(message);
      }

      return {
        json: await response.json(),
        latencyMs: Date.now() - startedAt,
        attempts: attempt + 1,
      };
    } catch (error) {
      if (error instanceof NonRetryableHttpError) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error("Unknown fetch failure.");
      if (attempt === options.retries) {
        break;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}
