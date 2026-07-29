import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config.js";
import { isUiClaimActive } from "./shared.js";

const env = {
  GATEWAY_HOST: "127.0.0.1",
  GATEWAY_PORT: 3100,
} as Env;

const expectedUrl = "http://127.0.0.1:3100/_gateway/ui-claim-active";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("isUiClaimActive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hits the gateway ui-claim-active endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ active: true }));
    vi.stubGlobal("fetch", fetchMock);

    await isUiClaimActive(env);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(expectedUrl);
  });

  it("returns true when body.active === true", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ active: true })));

    await expect(isUiClaimActive(env)).resolves.toBe(true);
  });

  it("returns false when body.active is false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ active: false })));

    await expect(isUiClaimActive(env)).resolves.toBe(false);
  });

  it("returns false when body.active is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));

    await expect(isUiClaimActive(env)).resolves.toBe(false);
  });

  it("returns false when active is a truthy non-boolean value", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ active: "yes" })));

    await expect(isUiClaimActive(env)).resolves.toBe(false);
  });

  it("fails open to false on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ active: true }, false)),
    );

    await expect(isUiClaimActive(env)).resolves.toBe(false);
  });

  it("fails open to false when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    await expect(isUiClaimActive(env)).resolves.toBe(false);
  });

  it("fails open to false when the request aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );

    await expect(isUiClaimActive(env)).resolves.toBe(false);
  });

  it("passes an abort signal for the timeout", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ active: true }));
    vi.stubGlobal("fetch", fetchMock);

    await isUiClaimActive(env);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
