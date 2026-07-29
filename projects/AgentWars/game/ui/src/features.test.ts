import { describe, expect, it } from "vitest";
import { resolveUiFeatures, resolveUiLightMode } from "./features.js";

describe("resolveUiLightMode", () => {
  it("is off when env is unset or not a light value", () => {
    expect(resolveUiLightMode("", undefined)).toBe(false);
    expect(resolveUiLightMode("", "")).toBe(false);
    expect(resolveUiLightMode("", "0")).toBe(false);
    expect(resolveUiLightMode("", "false")).toBe(false);
  });

  it("is on when env is 1 or true", () => {
    expect(resolveUiLightMode("", "1")).toBe(true);
    expect(resolveUiLightMode("", "true")).toBe(true);
  });

  it("uses the light query param when present", () => {
    expect(resolveUiLightMode("?light=1", undefined)).toBe(true);
    expect(resolveUiLightMode("?light=true", undefined)).toBe(true);
    expect(resolveUiLightMode("?light=0", "1")).toBe(false);
    expect(resolveUiLightMode("?light=false", "1")).toBe(false);
    expect(resolveUiLightMode("?light=", "1")).toBe(true);
  });

  it("query wins over env when both are set", () => {
    expect(resolveUiLightMode("?light=0", "1")).toBe(false);
    expect(resolveUiLightMode("?light=1", "0")).toBe(true);
  });
});

describe("resolveUiFeatures", () => {
  it("enables all heavy UI when not in light mode", () => {
    expect(resolveUiFeatures("", undefined)).toEqual({
      mapStream: true,
      ratePanel: true,
      claimQueuePanel: true,
      apiConsole: true,
    });
  });

  it("disables heavy UI in light mode", () => {
    expect(resolveUiFeatures("?light=1", undefined)).toEqual({
      mapStream: false,
      ratePanel: false,
      claimQueuePanel: false,
      apiConsole: false,
    });
  });
});
