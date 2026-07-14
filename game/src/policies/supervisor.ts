import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import type { Env, AbTestConfig } from "../config.js";
import { createDb } from "../db/index.js";
import { policyRuns } from "../db/schema.js";
import { runPolicyLoop } from "./worker.js";
import type { PolicyRunOptions } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerScript = resolve(__dirname, "worker-entry.ts");

export interface ManagedPolicy {
  policyKey: string;
  process: ChildProcess;
  zone?: AbTestConfig["policies"][number]["zone"];
}

export class PolicySupervisor {
  private readonly children = new Map<string, ManagedPolicy>();

  constructor(
    private readonly env: Env,
    private readonly abConfig: AbTestConfig,
  ) {}

  async startAll(): Promise<void> {
    for (const entry of this.abConfig.policies) {
      await this.startPolicy(entry.key, entry.zone);
    }
  }

  async startPolicy(
    policyKey: string,
    zone?: AbTestConfig["policies"][number]["zone"],
  ): Promise<void> {
    if (this.children.has(policyKey)) {
      throw new Error(`policy ${policyKey} is already running`);
    }

    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        workerScript,
        policyKey,
        zone ? JSON.stringify(zone) : "",
      ],
      {
        stdio: "inherit",
        env: process.env,
      },
    );

    this.children.set(policyKey, { policyKey, process: child, zone });

    child.on("exit", (code) => {
      this.children.delete(policyKey);
      if (code !== 0) {
        console.error(`policy ${policyKey} exited with code ${code}`);
      }
    });
  }

  async restartPolicy(policyKey: string): Promise<void> {
    await this.stopPolicy(policyKey);
    const entry = this.abConfig.policies.find((p) => p.key === policyKey);
    if (!entry) {
      throw new Error(`policy ${policyKey} not found in ab-test config`);
    }
    await this.startPolicy(policyKey, entry.zone);
  }

  async stopPolicy(policyKey: string): Promise<void> {
    const managed = this.children.get(policyKey);
    if (!managed) {
      return;
    }
    managed.process.kill("SIGTERM");
    this.children.delete(policyKey);

    const { db, pool } = createDb(this.env);
    try {
      const runs = await db
        .select()
        .from(policyRuns)
        .where(eq(policyRuns.policyKey, policyKey))
        .orderBy(desc(policyRuns.startedAt))
        .limit(1);
      const run = runs[0];
      if (run && run.status === "running") {
        await db
          .update(policyRuns)
          .set({ status: "stopped", stoppedAt: new Date() })
          .where(eq(policyRuns.id, run.id));
      }
    } finally {
      await pool.end();
    }
  }

  async stopAll(): Promise<void> {
    const keys = [...this.children.keys()];
    for (const key of keys) {
      await this.stopPolicy(key);
    }
  }

  listRunning(): string[] {
    return [...this.children.keys()];
  }
}

export async function runPolicyTest(
  policyKey: string,
  env: Env,
  abConfig: AbTestConfig,
): Promise<void> {
  const entry = abConfig.policies.find((p) => p.key === policyKey);
  await runPolicyLoop(
    {
      policyKey,
      zone: entry?.zone,
      dryRun: true,
      maxTicks: 1,
    },
    env,
  );
}

export async function runPolicyDirect(
  policyKey: string,
  env: Env,
  abConfig: AbTestConfig,
): Promise<void> {
  const entry = abConfig.policies.find((p) => p.key === policyKey);
  await runPolicyLoop(
    {
      policyKey,
      zone: entry?.zone,
      dryRun: env.DRY_RUN,
    },
    env,
  );
}
