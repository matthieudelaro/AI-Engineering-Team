import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { getPoliciesDir } from "../config.js";
import type { Policy } from "./types.js";

export async function loadPolicy(policyKey: string): Promise<Policy> {
  const policiesDir = getPoliciesDir();
  const modulePath = resolve(policiesDir, `${policyKey}.ts`);
  const moduleUrl = pathToFileURL(modulePath).href;
  const imported = (await import(moduleUrl)) as { default?: Policy; policy?: Policy };
  const policy = imported.default ?? imported.policy;
  if (!policy) {
    throw new Error(`policy module ${policyKey} must export default or policy`);
  }
  if (policy.key !== policyKey) {
    throw new Error(`policy key mismatch: expected ${policyKey}, got ${policy.key}`);
  }
  return policy;
}
