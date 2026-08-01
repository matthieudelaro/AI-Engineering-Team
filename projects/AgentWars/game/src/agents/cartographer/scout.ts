import { MapBelief } from "./mapBelief.js";
import type { Point } from "./types.js";

/** Re-export scout target selection from map belief. */
export function pickScoutTarget(
  belief: MapBelief,
  nowMs: number,
): Point | null {
  return belief.pickScoutTarget(nowMs);
}
