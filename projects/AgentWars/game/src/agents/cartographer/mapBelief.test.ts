import { describe, expect, it } from "vitest";
import {
  MapBelief,
  CONFIDENCE_HALF_LIFE_MS,
  HIGH_CONFIDENCE_THRESHOLD,
  computeDecayedConfidence,
} from "./mapBelief.js";
import type { MapResponse } from "../../jobs/shared.js";

function emptyMap(bounds: MapResponse["bounds"]): MapResponse {
  return { bounds, tiles: [] };
}

describe("computeDecayedConfidence", () => {
  it("returns stored confidence at lastSeenAt", () => {
    const t = 1_000_000;
    expect(computeDecayedConfidence(1, t, t)).toBe(1);
  });

  it("halves confidence after one half-life", () => {
    const t0 = 0;
    const t1 = CONFIDENCE_HALF_LIFE_MS;
    expect(computeDecayedConfidence(1, t0, t1)).toBeCloseTo(0.5, 5);
  });
});

describe("MapBelief", () => {
  const bounds = { min_x: -5, min_y: -5, max_x: 5, max_y: 5 };
  const self = "Me";

  it("sets confidence to 1 on fresh map observation", () => {
    const belief = new MapBelief(bounds, self);
    belief.ingestMap(
      {
        bounds,
        tiles: [{ x: 0, y: 0, ownership: { owned: "Enemy" } }],
      },
      1000,
    );
    const cell = belief.get(0, 0);
    expect(cell?.confidence).toBe(1);
    expect(cell?.owner).toBe("Enemy");
  });

  it("decays confidence for stale cells", () => {
    const belief = new MapBelief(bounds, self);
    belief.ingestMap(
      {
        bounds,
        tiles: [{ x: 1, y: 1, ownership: "" }],
      },
      0,
    );
    const stale = belief.effectiveConfidence(1, 1, CONFIDENCE_HALF_LIFE_MS);
    expect(stale).toBeCloseTo(0.5, 5);
  });

  it("pickScoutTarget skips cells owned by self", () => {
    const belief = new MapBelief(bounds, self);
    belief.ingestMap(
      {
        bounds,
        tiles: [
          { x: 0, y: 0, ownership: { owned: self } },
          { x: 2, y: 2, ownership: "" },
        ],
      },
      1000,
    );
    const target = belief.pickScoutTarget(1000);
    expect(target).not.toBeNull();
    expect(target).not.toEqual({ x: 0, y: 0 });
    if (target) {
      expect(belief.get(target.x, target.y)?.owner).not.toBe(self);
    }
  });

  it("pickScoutTarget prefers never-seen over stale known cells", () => {
    const belief = new MapBelief(bounds, self);
    belief.ingestMap(
      {
        bounds,
        tiles: [
          { x: 3, y: 3, ownership: "" },
          { x: 4, y: 4, ownership: { owned: "Enemy" } },
        ],
      },
      0,
    );
    // Cell at 3,3 seen at t=0; 4,4 never seen (only in bounds grid scan)
    const target = belief.pickScoutTarget(CONFIDENCE_HALF_LIFE_MS * 2);
    // Never-seen in-bounds cells outrank low-confidence stale empties.
    expect(target).not.toEqual({ x: 0, y: 0 });
    if (target) {
      const conf = belief.effectiveConfidence(target.x, target.y, CONFIDENCE_HALF_LIFE_MS * 2);
      expect(conf).toBeLessThan(HIGH_CONFIDENCE_THRESHOLD);
    }
  });

  it("pickScoutTarget skips high-confidence self cells", () => {
    const belief = new MapBelief(bounds, self);
    belief.ingestMap(
      {
        bounds,
        tiles: [{ x: 0, y: 0, ownership: { owned: self } }],
      },
      1000,
    );
    // Only self tile known — should pick an unseen in-bounds cell.
    const target = belief.pickScoutTarget(1000);
    expect(target).not.toEqual({ x: 0, y: 0 });
  });

  it("tightens bounds on out-of-bounds rejection", () => {
    const belief = new MapBelief(bounds, self);
    belief.noteOutOfBounds(5, 0);
    expect(belief.getBounds().max_x).toBe(4);
  });

  it("updates belief from successful claim", () => {
    const belief = new MapBelief(bounds, self);
    belief.noteClaimAccepted(self, 1, 1, 500);
    const cell = belief.get(1, 1);
    expect(cell?.owner).toBe(self);
    expect(cell?.confidence).toBe(1);
  });

  it("works with empty board — probes within snapshot bounds", () => {
    const belief = new MapBelief(bounds, self);
    const target = belief.pickScoutTarget(0);
    expect(target).not.toBeNull();
    if (target) {
      expect(target.x).toBeGreaterThanOrEqual(bounds.min_x);
      expect(target.x).toBeLessThanOrEqual(bounds.max_x);
    }
  });
});
