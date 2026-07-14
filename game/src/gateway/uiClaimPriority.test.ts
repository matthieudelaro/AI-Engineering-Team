import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUiClaimActivity,
  isUiClaimActive,
  resetUiClaimActivity,
  touchUiClaimActivity,
} from "./uiClaimPriority.js";

const WINDOW_MS = 1000;

describe("uiClaimPriority", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetUiClaimActivity();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is inactive before any activity", () => {
    expect(isUiClaimActive(WINDOW_MS)).toBe(false);
    expect(getUiClaimActivity(WINDOW_MS)).toEqual({
      active: false,
      lastActivityAt: null,
      windowMs: WINDOW_MS,
    });
  });

  it("is active immediately after activity", () => {
    touchUiClaimActivity();
    expect(isUiClaimActive(WINDOW_MS)).toBe(true);
  });

  it("stays active within the 1s window", () => {
    touchUiClaimActivity();
    vi.advanceTimersByTime(WINDOW_MS - 1);
    expect(isUiClaimActive(WINDOW_MS)).toBe(true);
  });

  it("becomes inactive once the window elapses", () => {
    touchUiClaimActivity();
    vi.advanceTimersByTime(WINDOW_MS);
    expect(isUiClaimActive(WINDOW_MS)).toBe(false);
  });

  it("becomes inactive after the window elapses", () => {
    touchUiClaimActivity();
    vi.advanceTimersByTime(WINDOW_MS + 500);
    expect(isUiClaimActive(WINDOW_MS)).toBe(false);
  });

  it("re-activates when activity is touched again", () => {
    touchUiClaimActivity();
    vi.advanceTimersByTime(WINDOW_MS + 500);
    expect(isUiClaimActive(WINDOW_MS)).toBe(false);
    touchUiClaimActivity();
    expect(isUiClaimActive(WINDOW_MS)).toBe(true);
  });

  it("reports the snapshot with the recorded timestamp", () => {
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    const touchedAt = Date.now();
    touchUiClaimActivity();
    vi.advanceTimersByTime(250);

    expect(getUiClaimActivity(WINDOW_MS)).toEqual({
      active: true,
      lastActivityAt: touchedAt,
      windowMs: WINDOW_MS,
    });
  });

  it("reports inactive in the snapshot once the window elapses", () => {
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    const touchedAt = Date.now();
    touchUiClaimActivity();
    vi.advanceTimersByTime(WINDOW_MS);

    expect(getUiClaimActivity(WINDOW_MS)).toEqual({
      active: false,
      lastActivityAt: touchedAt,
      windowMs: WINDOW_MS,
    });
  });

  it("resets tracked activity for tests", () => {
    touchUiClaimActivity();
    resetUiClaimActivity();
    expect(getUiClaimActivity(WINDOW_MS)).toEqual({
      active: false,
      lastActivityAt: null,
      windowMs: WINDOW_MS,
    });
  });
});
