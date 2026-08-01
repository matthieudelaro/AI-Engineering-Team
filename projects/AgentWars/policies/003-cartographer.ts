import type { Policy, PolicyContext } from "../game/src/policies/types.js";
import { loadMap } from "../game/src/jobs/shared.js";
import { planOneStep } from "../game/src/agents/cartographer/claimPlanner.js";

/**
 * Policy wrapper for the cartographer agent.
 *
 * Live play at ~20 RPS uses the standalone runner: `npm run agent cartographer`.
 * This policy module supports dry-run planning via `npm run policy test 003-cartographer`.
 * Do not enable in ab-test.json alongside `npm run jobs` — they compete for place-tile RPS.
 */
const policy: Policy = {
  key: "003-cartographer",

  async onStart(ctx: PolicyContext): Promise<void> {
    await ctx.logEvent(
      "info",
      "cartographer_start",
      "cartographer: map belief, scout (~1/s), band lasso, flag hunter — use npm run agent cartographer for live play",
    );
  },

  async tick(ctx: PolicyContext): Promise<void> {
    const map = await loadMap(ctx.db);
    if (!map) {
      await ctx.logEvent("info", "cartographer_wait", "waiting for map snapshot");
      return;
    }

    let selfName: string | null = null;
    const lb = await ctx.getLatestState("leaderboard");
    if (
      lb &&
      typeof lb === "object" &&
      "entries" in lb &&
      Array.isArray((lb as { entries: unknown[] }).entries)
    ) {
      const self = (
        lb as { entries: Array<{ is_self?: boolean; display_name?: string }> }
      ).entries.find((e) => e.is_self);
      selfName = self?.display_name ?? null;
    }

    const plan = planOneStep(map, selfName, Date.now());
    await ctx.logEvent("info", "cartographer_plan", "planning step", {
      scout: plan.scout,
      claim: plan.claim,
      dryRun: ctx.dryRun,
    });

    if (ctx.dryRun) {
      return;
    }

    await ctx.logEvent(
      "warn",
      "cartographer_noop",
      "policy tick is planning-only; start npm run agent cartographer for saturated claiming",
    );
  },

  async onStop(ctx: PolicyContext): Promise<void> {
    await ctx.logEvent("info", "cartographer_stop", "cartographer policy stopped");
  },
};

export default policy;
