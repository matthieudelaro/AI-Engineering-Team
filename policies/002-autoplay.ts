import type { Policy, PolicyContext } from "../game/src/policies/types.js";

interface MapTile {
  x: number;
  y: number;
  ownership: string | Record<string, unknown>;
}

interface MapResponse {
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  tiles: MapTile[];
}

interface LeaderboardResponse {
  entries: Array<{ display_name: string; is_self: boolean; color: string }>;
}

const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** Last known owned cell (map may hide our tiles behind fog). */
let anchor: { x: number; y: number } | null = { x: 0, y: 0 };

function ownerName(ownership: string | Record<string, unknown>): string | null {
  if (typeof ownership === "string") {
    return ownership === "" ? null : ownership;
  }
  if (typeof ownership === "object" && ownership !== null) {
    const n = ownership["display_name"];
    return typeof n === "string" && n !== "" ? n : null;
  }
  return null;
}

function buildOwnershipMap(
  tiles: MapTile[],
  selfName: string | null,
): { owned: Set<string>; occupied: Map<string, string | null> } {
  const owned = new Set<string>();
  const occupied = new Map<string, string | null>();
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    const owner = ownerName(tile.ownership);
    occupied.set(key, owner);
    if (owner === selfName) {
      owned.add(key);
    }
  }
  return { owned, occupied };
}

/** Candidates: orthogonally adjacent to our tiles, unowned or not ours. */
function frontierCandidates(
  owned: Set<string>,
  occupied: Map<string, string | null>,
  selfName: string | null,
  bounds: MapResponse["bounds"],
): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();

  for (const key of owned) {
    const [xs, ys] = key.split(",");
    const x0 = Number(xs);
    const y0 = Number(ys);
    for (const { dx, dy } of NEIGHBORS) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (
        x < bounds.min_x ||
        x > bounds.max_x ||
        y < bounds.min_y ||
        y > bounds.max_y
      ) {
        continue;
      }
      const k = `${x},${y}`;
      if (seen.has(k) || owned.has(k)) {
        continue;
      }
      const owner = occupied.get(k);
      if (owner === selfName) {
        continue;
      }
      seen.add(k);
      candidates.push({ x, y });
    }
  }

  return candidates;
}

const policy: Policy = {
  key: "002-autoplay",

  async onStart(ctx: PolicyContext): Promise<void> {
    await ctx.logEvent("info", "autoplay_start", `playing game ${ctx.gameId}`);
  },

  async tick(ctx: PolicyContext): Promise<void> {
    const gid = encodeURIComponent(ctx.gameId);
    const lbRes = await ctx.client.get(`/api/v1/leaderboard?game_id=${gid}`);
    if (lbRes.status !== 200) {
      await ctx.logEvent("warn", "leaderboard_error", lbRes.body.slice(0, 200));
      return;
    }

    const leaderboard = lbRes.json() as LeaderboardResponse;
    const self = leaderboard.entries.find((e) => e.is_self);
    const selfName = self?.display_name ?? null;

    const mapRes = await ctx.client.get(`/api/v1/map?game_id=${gid}`);
    if (mapRes.status !== 200) {
      await ctx.logEvent("warn", "map_error", mapRes.body.slice(0, 200));
      return;
    }

    const map = mapRes.json() as MapResponse;
    const { owned, occupied } = buildOwnershipMap(map.tiles, selfName);

    // Sync anchor from visible owned tiles
    if (owned.size > 0) {
      const first = [...owned][0]!;
      const [xs, ys] = first.split(",");
      anchor = { x: Number(xs), y: Number(ys) };
    }

    let candidates = frontierCandidates(owned, occupied, selfName, map.bounds);

    // Fog hides our tiles — expand from anchor when leaderboard shows tiles
    if (candidates.length === 0 && anchor && (self?.tile_count ?? 0) > 0) {
      const synthetic = new Set([`${anchor.x},${anchor.y}`]);
      candidates = frontierCandidates(synthetic, occupied, selfName, map.bounds);
    }

    if (candidates.length === 0 && owned.size === 0 && (self?.tile_count ?? 0) === 0) {
      const cx = Math.floor((map.bounds.min_x + map.bounds.max_x) / 2);
      const cy = Math.floor((map.bounds.min_y + map.bounds.max_y) / 2);
      candidates = [{ x: cx, y: cy }];
    }

    for (const { x, y } of candidates) {
      if (ctx.dryRun) {
        await ctx.logEvent("info", "dry_run_claim", `would claim ${x},${y}`);
        return;
      }

      const placeRes = await ctx.client.post("/api/v1/place-tile", {
        x,
        y,
        game_id: ctx.gameId,
      });
      const result = placeRes.json() as {
        accepted?: unknown;
        rejected?: { reason: string; retry_after?: number };
      };

      if (result.rejected) {
        await ctx.logEvent("warn", "claim_rejected", result.rejected.reason, { x, y });
        if (result.rejected.retry_after) {
          await new Promise((r) => setTimeout(r, result.rejected!.retry_after! * 1000));
        }
        continue;
      }

      await ctx.logEvent("info", "claim_ok", `claimed ${x},${y}`, { x, y });
      anchor = { x, y };
      return;
    }

    await ctx.logEvent("info", "no_candidates", "no valid frontier tile this tick");
  },
};

export default policy;
