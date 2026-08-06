/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { launchNuke } from "./api.js";
import { GAME_ID, GATEWAY_BASE_URL } from "./config.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response;
}

describe("launchNuke", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs minimal launch-nuke body to the game API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accepted: {
          action_id: "nuke-1",
          effect: { cost_charged: 5, effective_radius_tiles: 1 },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await launchNuke(10, -3);

    expect(result.accepted?.action_id).toBe("nuke-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${GATEWAY_BASE_URL}/api/v1/launch-nuke`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Source": "ui",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      game_id: GAME_ID,
      target_x: 10,
      target_y: -3,
    });
  });

  it("returns rejected payloads without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          rejected: { reason: "REJECTION_REASON_COOLDOWN", retry_after: 30 },
        }),
      ),
    );

    const result = await launchNuke(0, 0);
    expect(result.rejected?.reason).toBe("REJECTION_REASON_COOLDOWN");
  });

  it("returns rejected payloads on HTTP 409 without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { rejected: { reason: "REJECTION_REASON_COOLDOWN", retry_after: 15 } },
          false,
          409,
        ),
      ),
    );

    const result = await launchNuke(0, 0);
    expect(result.rejected?.reason).toBe("REJECTION_REASON_COOLDOWN");
    expect(result.rejected?.retry_after).toBe(15);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ details: "bad request" }, false, 400)),
    );

    await expect(launchNuke(1, 2)).rejects.toThrow("bad request");
  });
});
