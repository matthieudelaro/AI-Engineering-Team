import { describe, expect, it } from "vitest";

import { initialCriteriaVersion } from "../src/domain/criteria.js";

describe("initialCriteriaVersion", () => {
  it("prioritizes a sleepable van and treats standing height as preferred", () => {
    const criteria = initialCriteriaVersion();

    expect(criteria.version).toBe("criteria-v1");
    expect(criteria.constraints).toContainEqual({
      key: "sleeping_length_mm",
      kind: "hard",
      operator: "gte",
      value: 2000,
      weight: 100,
    });
    expect(criteria.constraints).toContainEqual({
      key: "interior_height_mm",
      kind: "preference",
      operator: "gte",
      value: 1900,
      weight: 30,
    });
  });

  it("preserves a small reliable resale-friendly car as a fallback", () => {
    const criteria = initialCriteriaVersion();

    expect(criteria.vehicleStrategies.map(({ key }) => key)).toEqual([
      "standing_van",
      "sleepable_awd_van",
      "sleepable_minivan",
      "small_reliable_car",
    ]);
  });
});
