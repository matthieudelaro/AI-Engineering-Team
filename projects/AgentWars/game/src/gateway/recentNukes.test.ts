import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RECENT_NUKES_LIMIT,
  mapApiCallToRecentNuke,
  normalizeRecentNukesQuery,
  parseNukeResponse,
  parseNukeTargetCoords,
  queryRecentNukes,
} from "./recentNukes.js";

describe("normalizeRecentNukesQuery", () => {
  it("defaults limit to 10", () => {
    expect(normalizeRecentNukesQuery({})).toEqual({ limit: DEFAULT_RECENT_NUKES_LIMIT });
  });

  it("caps limit at 50", () => {
    expect(normalizeRecentNukesQuery({ limit: "100" })).toEqual({ limit: 50 });
  });

  it("parses since_id when finite", () => {
    expect(normalizeRecentNukesQuery({ since_id: "42", limit: "5" })).toEqual({
      sinceId: 42,
      limit: 5,
    });
  });

  it("ignores invalid since_id and limit", () => {
    expect(normalizeRecentNukesQuery({ since_id: "nope", limit: "0" })).toEqual({
      limit: DEFAULT_RECENT_NUKES_LIMIT,
    });
  });
});

describe("parseNukeTargetCoords", () => {
  it("reads target_x and target_y from request JSON", () => {
    expect(
      parseNukeTargetCoords(
        JSON.stringify({ game_id: "g1", target_x: 10, target_y: -3 }),
      ),
    ).toEqual({ target_x: 10, target_y: -3 });
  });

  it("returns null for missing or non-numeric coords", () => {
    expect(parseNukeTargetCoords(null)).toBeNull();
    expect(parseNukeTargetCoords("{}")).toBeNull();
    expect(parseNukeTargetCoords('{"target_x":"1","target_y":2}')).toBeNull();
    expect(parseNukeTargetCoords("not-json")).toBeNull();
  });
});

describe("parseNukeResponse", () => {
  it("marks accepted when response has accepted object", () => {
    expect(
      parseNukeResponse(
        JSON.stringify({
          accepted: {
            action_id: "n1",
            effect: { cost_charged: 5, effective_radius_tiles: 2 },
          },
        }),
        200,
      ),
    ).toEqual({
      accepted: true,
      cost_charged: 5,
      effective_radius_tiles: 2,
    });
  });

  it("marks rejected with reason and retry_after", () => {
    expect(
      parseNukeResponse(
        JSON.stringify({
          rejected: { reason: "REJECTION_REASON_COOLDOWN", retry_after: 28 },
        }),
        409,
      ),
    ).toEqual({
      accepted: false,
      rejection_reason: "REJECTION_REASON_COOLDOWN",
      retry_after: 28,
    });
  });

  it("treats empty or invalid body as not accepted", () => {
    expect(parseNukeResponse(null, 200)).toEqual({ accepted: false });
    expect(parseNukeResponse("{}", 200)).toEqual({ accepted: false });
    expect(parseNukeResponse("not-json", 502)).toEqual({ accepted: false });
  });
});

describe("mapApiCallToRecentNuke", () => {
  const baseRow = {
    id: 7,
    ts: new Date("2026-08-01T12:00:00.000Z"),
    source: "ui",
    requestBody: JSON.stringify({ game_id: "g1", target_x: 1, target_y: 2 }),
    responseBody: JSON.stringify({
      accepted: { action_id: "a1", effect: { cost_charged: 3 } },
    }),
    responseStatus: 200,
  };

  it("maps a full api_calls row", () => {
    expect(mapApiCallToRecentNuke(baseRow)).toEqual({
      id: 7,
      ts: "2026-08-01T12:00:00.000Z",
      source: "ui",
      target_x: 1,
      target_y: 2,
      accepted: true,
      cost_charged: 3,
    });
  });

  it("returns null when coords cannot be parsed", () => {
    expect(
      mapApiCallToRecentNuke({
        ...baseRow,
        requestBody: JSON.stringify({ game_id: "g1" }),
      }),
    ).toBeNull();
  });

  it("defaults source to gateway", () => {
    expect(
      mapApiCallToRecentNuke({ ...baseRow, source: null })?.source,
    ).toBe("gateway");
  });
});

describe("queryRecentNukes", () => {
  it("orders by id DESC without since_id", async () => {
    const orderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as never;

    await queryRecentNukes(db, { limit: 5 });

    expect(select).toHaveBeenCalled();
    expect(from).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalledWith(expect.anything());
    expect(orderBy().limit).toHaveBeenCalledWith(5);
  });

  it("filters id > since_id and orders ASC when since_id is set", async () => {
    const orderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as never;

    await queryRecentNukes(db, { sinceId: 10, limit: 3 });

    expect(where).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalled();
    expect(orderBy().limit).toHaveBeenCalledWith(3);
  });
});
