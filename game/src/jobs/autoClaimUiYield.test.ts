import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config.js";
import {
  AUTO_CLAIM_UI_YIELD_CACHE_MS,
  createAutoClaimUiYieldProbe,
  hasUiClaimQueueWork,
  shouldYieldAutoClaimToUi,
} from "./shared.js";

const env = {
  GATEWAY_HOST: "127.0.0.1",
  GATEWAY_PORT: 3100,
} as Env;

const activeUrl = "http://127.0.0.1:3100/_gateway/ui-claim-active";
const queueUrl = "http://127.0.0.1:3100/_gateway/ui-claim-queue";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("hasUiClaimQueueWork", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hits the gateway ui-claim-queue stats endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ pending: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await hasUiClaimQueueWork(env);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(queueUrl);
  });

  it("returns true when pending > 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ pending: 3 })));

    await expect(hasUiClaimQueueWork(env)).resolves.toBe(true);
  });

  it("returns false when pending is 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ pending: 0 })));

    await expect(hasUiClaimQueueWork(env)).resolves.toBe(false);
  });

  it("returns false when pending is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));

    await expect(hasUiClaimQueueWork(env)).resolves.toBe(false);
  });

  it("fails open to false on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ pending: 5 }, false)),
    );

    await expect(hasUiClaimQueueWork(env)).resolves.toBe(false);
  });

  it("fails open to false when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    await expect(hasUiClaimQueueWork(env)).resolves.toBe(false);
  });
});

describe("shouldYieldAutoClaimToUi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns true when UI claim activity is active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === activeUrl) {
          return jsonResponse({ active: true });
        }
        return jsonResponse({ pending: 0 });
      }),
    );

    await expect(shouldYieldAutoClaimToUi(env)).resolves.toBe(true);
  });

  it("returns true when queue has pending work even if activity is idle", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === activeUrl) {
        return jsonResponse({ active: false });
      }
      return jsonResponse({ pending: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(shouldYieldAutoClaimToUi(env)).resolves.toBe(true);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([activeUrl, queueUrl]);
  });

  it("returns false when activity is idle and queue is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === activeUrl) {
          return jsonResponse({ active: false });
        }
        return jsonResponse({ pending: 0 });
      }),
    );

    await expect(shouldYieldAutoClaimToUi(env)).resolves.toBe(false);
  });

  it("skips the queue peek when activity is already active", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ active: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(shouldYieldAutoClaimToUi(env)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(activeUrl);
  });
});

describe("createAutoClaimUiYieldProbe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("caches the yield decision within the cache window", async () => {
    let now = 1_000;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === activeUrl) {
        return jsonResponse({ active: false });
      }
      return jsonResponse({ pending: 2 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = createAutoClaimUiYieldProbe(
      env,
      AUTO_CLAIM_UI_YIELD_CACHE_MS,
      () => now,
    );

    await expect(probe()).resolves.toBe(true);
    await expect(probe()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // active + queue once

    now += AUTO_CLAIM_UI_YIELD_CACHE_MS - 1;
    await expect(probe()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now += 1;
    await expect(probe()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
