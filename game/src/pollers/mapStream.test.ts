import { describe, expect, it } from "vitest";
import {
  applyMapStreamEvent,
  mapResponseToState,
  mapStateToResponse,
  parseSseEvents,
  playerFromDetail,
} from "./mapStream.js";

describe("playerFromDetail", () => {
  it("reads string player_id", () => {
    expect(playerFromDetail({ player_id: "Alice" })).toBe("Alice");
  });

  it("reads wrapped player_id value", () => {
    expect(playerFromDetail({ player_id: { value: "Bob" } })).toBe("Bob");
  });
});

describe("parseSseEvents", () => {
  it("parses complete SSE data lines", () => {
    const input =
      'data: {"event_id":"1","event_type":"tile_captured","detail":{"x":1,"y":2}}\n\n' +
      'data: {"event_id":"2","event_type":"tile_captured","detail":{"x":3,"y":4}}\n\n';
    const { events, remainder } = parseSseEvents(input);
    expect(events).toHaveLength(2);
    expect(events[0]?.event_id).toBe("1");
    expect(remainder).toBe("");
  });

  it("keeps partial trailing line in remainder", () => {
    const input = 'data: {"event_id":"9"';
    const { events, remainder } = parseSseEvents(input);
    expect(events).toHaveLength(0);
    expect(remainder).toBe('data: {"event_id":"9"');
  });
});

describe("applyMapStreamEvent", () => {
  it("updates an existing tile owner", () => {
    const state = mapResponseToState({
      bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 1 },
      tiles: [{ x: 0, y: 0, ownership: { owned: "Old" }, has_flag: false }],
      fog_padding_tiles: 3,
    });

    const changed = applyMapStreamEvent(state, {
      event_id: "10",
      event_type: "tile_captured",
      detail: { player_id: "New", x: 0, y: 0 },
    });

    expect(changed).toBe(true);
    const tile = state.tiles.get("0,0");
    expect(tile?.ownership).toEqual({ owned: "New" });
  });

  it("adds a tile outside current bounds", () => {
    const state = mapResponseToState({
      bounds: { min_x: 0, min_y: 0, max_x: 0, max_y: 0 },
      tiles: [{ x: 0, y: 0, ownership: { owned: "Me" }, has_flag: false }],
      fog_padding_tiles: 3,
    });

    applyMapStreamEvent(state, {
      event_id: "11",
      event_type: "tile_captured",
      detail: { player_id: { value: "Other" }, x: 2, y: -1 },
    });

    const response = mapStateToResponse(state);
    expect(response.bounds).toEqual({ min_x: 0, min_y: -1, max_x: 2, max_y: 0 });
    expect(response.tiles).toHaveLength(2);
  });

  it("ignores events missing coordinates", () => {
    const state = mapResponseToState({
      bounds: { min_x: 0, min_y: 0, max_x: 0, max_y: 0 },
      tiles: [],
      fog_padding_tiles: 3,
    });

    const changed = applyMapStreamEvent(state, {
      event_id: "12",
      event_type: "tile_captured",
      detail: { player_id: "Other", x: 1 },
    });

    expect(changed).toBe(false);
    expect(state.tiles.size).toBe(0);
  });
});
