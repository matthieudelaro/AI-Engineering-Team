import { describe, expect, it } from "vitest";
import { isNukedOwnership, isNukedTile } from "./api.js";

describe("isNukedOwnership", () => {
  it("is true for the nuked ownership string", () => {
    expect(isNukedOwnership("nuked")).toBe(true);
  });

  it("is false for other ownership strings", () => {
    expect(isNukedOwnership("neutral")).toBe(false);
    expect(isNukedOwnership("alice")).toBe(false);
    expect(isNukedOwnership("")).toBe(false);
  });

  it("is true when owned, display_name, or name is nuked", () => {
    expect(isNukedOwnership({ owned: "nuked" })).toBe(true);
    expect(isNukedOwnership({ display_name: "nuked" })).toBe(true);
    expect(isNukedOwnership({ name: "nuked" })).toBe(true);
  });

  it("ignores player_id and other owner fields", () => {
    expect(isNukedOwnership({ player_id: "nuked" })).toBe(false);
    expect(isNukedOwnership({ owned: "alice" })).toBe(false);
  });
});

describe("isNukedTile", () => {
  it("is false when ownership is undefined", () => {
    expect(isNukedTile(undefined)).toBe(false);
  });

  it("delegates to isNukedOwnership", () => {
    expect(isNukedTile("nuked")).toBe(true);
    expect(isNukedTile("neutral")).toBe(false);
  });
});
