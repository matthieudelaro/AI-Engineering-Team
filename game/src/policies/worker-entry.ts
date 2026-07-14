import {
  loadEnvConfig,
  loadAbTestConfig,
  loadApiEndpointsConfig,
} from "../config.js";
import { runPolicyLoop } from "./worker.js";

const policyKey = process.argv[2];
const zoneArg = process.argv[3];

if (!policyKey) {
  console.error("usage: worker-entry.ts <policyKey> [zoneJson]");
  process.exit(1);
}

const env = loadEnvConfig();
const zone = zoneArg && zoneArg !== "" ? (JSON.parse(zoneArg) as import("../config.js").Zone) : undefined;

runPolicyLoop({ policyKey, zone }, env).catch((error: unknown) => {
  console.error("policy worker failed:", error);
  process.exit(1);
});
