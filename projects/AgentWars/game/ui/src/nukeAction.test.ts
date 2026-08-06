import { describe, expect, it } from "vitest";
import { formatNukeStatus } from "./nukeAction.js";
import type { ActionResponse } from "./types.js";

describe("formatNukeStatus", () => {
  it("formats accepted nuke with cost and radius", () => {
    const response: ActionResponse = {
      accepted: {
        action_id: "n1",
        effect: { cost_charged: 12, effective_radius_tiles: 1 },
      },
    };
    expect(formatNukeStatus(3, 7, response)).toBe("Nuked (3, 7) · 12 pts · radius 1");
  });

  it("formats accepted nuke with coords only when effect is missing", () => {
    const response: ActionResponse = {
      accepted: { action_id: "n1" },
    };
    expect(formatNukeStatus(0, -2, response)).toBe("Nuked (0, -2)");
  });

  it("formats cooldown rejection with retry_after", () => {
    const response: ActionResponse = {
      rejected: { reason: "REJECTION_REASON_COOLDOWN", retry_after: 28 },
    };
    expect(formatNukeStatus(1, 1, response)).toBe("Nuke on cooldown — try again in 28s");
  });

  it("formats rate-limited rejection", () => {
    const response: ActionResponse = {
      rejected: { reason: "REJECTION_REASON_RATE_LIMITED", retry_after: 5 },
    };
    expect(formatNukeStatus(1, 1, response)).toBe("Nuke on cooldown — try again in 5s");
  });

  it("formats insufficient points rejection", () => {
    const response: ActionResponse = {
      rejected: { reason: "REJECTION_REASON_INSUFFICIENT_POINTS" },
    };
    expect(formatNukeStatus(4, 5, response)).toBe("Not enough points for nuke");
  });

  it("formats invalid target rejection", () => {
    const response: ActionResponse = {
      rejected: { reason: "REJECTION_REASON_INVALID_TARGET" },
    };
    expect(formatNukeStatus(4, 5, response)).toBe("Invalid nuke target");
  });

  it("falls back for unknown rejection reasons", () => {
    const response: ActionResponse = {
      rejected: { reason: "REJECTION_REASON_GAME_ENDED" },
    };
    expect(formatNukeStatus(1, 1, response)).toBe("Game ended");
  });

  it("handles empty response", () => {
    expect(formatNukeStatus(1, 1, {})).toBe("Nuke request returned no result");
  });
});
