import type { ActionResponse } from "./types.js";

function formatNukeRejection(
  rejected: NonNullable<ActionResponse["rejected"]>,
): string {
  const reason = rejected.reason;
  if (
    reason === "REJECTION_REASON_COOLDOWN" ||
    reason === "REJECTION_REASON_RATE_LIMITED"
  ) {
    const wait = rejected.retry_after;
    if (wait !== undefined && wait > 0) {
      return `Nuke on cooldown — try again in ${wait}s`;
    }
    return "Nuke on cooldown";
  }
  if (reason === "REJECTION_REASON_GAME_ENDED") {
    return "Game ended";
  }
  if (reason === "REJECTION_REASON_INSUFFICIENT_POINTS") {
    return "Not enough points for nuke";
  }
  if (reason === "REJECTION_REASON_INVALID_TARGET") {
    return "Invalid nuke target";
  }
  if (reason.startsWith("REJECTION_REASON_")) {
    return reason
      .slice("REJECTION_REASON_".length)
      .replace(/_/g, " ")
      .toLowerCase();
  }
  return reason || "Nuke rejected";
}

export function formatNukeStatus(
  x: number,
  y: number,
  response: ActionResponse,
): string {
  if (response.accepted) {
    const effect = response.accepted.effect;
    const parts = [`Nuked (${x}, ${y})`];
    if (effect?.cost_charged !== undefined) {
      parts.push(`${effect.cost_charged} pts`);
    }
    if (effect?.effective_radius_tiles !== undefined) {
      parts.push(`radius ${effect.effective_radius_tiles}`);
    }
    return parts.join(" · ");
  }
  if (response.rejected) {
    return formatNukeRejection(response.rejected);
  }
  return "Nuke request returned no result";
}
