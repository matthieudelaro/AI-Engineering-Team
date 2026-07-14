import type { Policy, PolicyContext } from "../game/src/policies/types.js";
import { inZone } from "../game/src/policies/zone.js";

const policy: Policy = {
  key: "001-init",

  async onStart(ctx: PolicyContext): Promise<void> {
    await ctx.logEvent("info", "discovery_start", "starting API discovery pass");
  },

  async tick(ctx: PolicyContext): Promise<void> {
    const state = await ctx.getLatestState("map");

    if (state === null) {
      await ctx.logEvent("info", "discovery_wait", "waiting for poller map snapshot");
      return;
    }

    await ctx.logEvent("info", "discovery_state_cached", "using cached map snapshot", {
      hasState: true,
    });

    if (ctx.dryRun) {
      await ctx.logEvent("info", "dry_run_skip", "skipping mutating actions in dry-run");
      return;
    }

    if (ctx.zone) {
      const probeCell = { x: ctx.zone.x, y: ctx.zone.y };
      if (inZone(probeCell, ctx.zone)) {
        await ctx.logEvent("info", "zone_probe", "zone guard active", {
          cell: probeCell,
          zone: ctx.zone,
        });
      }
    }
  },
};

export default policy;
