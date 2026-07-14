import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config.js";
import { requeueUiClaims, retryUiClaim, takeUiClaimQueue } from "./shared.js";

const env = {
  GATEWAY_HOST: "127.0.0.1",
  GATEWAY_PORT: 3100,
} as Env;

const takeUrl = "http://127.0.0.1:3100/_gateway/ui-claim-queue/take";
const retryUrl = "http://127.0.0.1:3100/_gateway/ui-claim-queue/retry";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("takeUiClaimQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts to the gateway take endpoint with the limit", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ tiles: [{ x: 1, y: 2, isRetry: false }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await takeUiClaimQueue(env, 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(takeUrl);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 5 }),
    });
  });

  it("returns parsed tiles from the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          tiles: [
            { x: 3, y: 4, isRetry: false },
            { x: 5, y: 6, isRetry: true },
          ],
        }),
      ),
    );

    await expect(takeUiClaimQueue(env)).resolves.toEqual([
      { x: 3, y: 4, isRetry: false },
      { x: 5, y: 6, isRetry: true },
    ]);
  });

  it("filters malformed tile entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          tiles: [{ x: 1, y: 2, isRetry: false }, { x: "bad", y: 3 }],
        }),
      ),
    );

    await expect(takeUiClaimQueue(env)).resolves.toEqual([
      { x: 1, y: 2, isRetry: false },
    ]);
  });

  it("fails open to an empty list on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false)));

    await expect(takeUiClaimQueue(env)).resolves.toEqual([]);
  });

  it("fails open to an empty list when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    await expect(takeUiClaimQueue(env)).resolves.toEqual([]);
  });

  it("passes an abort signal for the timeout", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ tiles: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await takeUiClaimQueue(env);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("retryUiClaim", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts to the gateway retry endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await retryUiClaim(env, 7, 8);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(retryUrl);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: 7, y: 8 }),
    });
  });

  it("does not throw when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    await expect(retryUiClaim(env, 1, 2)).resolves.toBeUndefined();
  });

  it("does not throw on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));

    await expect(retryUiClaim(env, 1, 2)).resolves.toBeUndefined();
  });
});

describe("requeueUiClaims", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts tiles back to the enqueue endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await requeueUiClaims(env, [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:3100/_gateway/ui-claim-queue/requeue",
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        tiles: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      }),
    });
  });

  it("no-ops for an empty tile list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await requeueUiClaims(env, []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
