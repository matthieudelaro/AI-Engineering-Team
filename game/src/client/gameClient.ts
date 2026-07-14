import type { Env } from "../config.js";
import { getGatewayBaseUrl } from "../config.js";

export interface GameClientOptions {
  policyId?: string;
  runId?: number;
  source?: string;
}

export interface GameResponse {
  status: number;
  body: string;
  json: () => unknown;
}

export class GameClient {
  private readonly baseUrl: string;
  private readonly policyId?: string;
  private readonly runId?: number;
  private readonly source: string;

  constructor(env: Env, options: GameClientOptions = {}) {
    this.baseUrl = getGatewayBaseUrl(env);
    this.policyId = options.policyId;
    this.runId = options.runId;
    this.source = options.source ?? "policy";
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<GameResponse> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const headers: Record<string, string> = {
      "x-source": this.source,
    };

    if (this.policyId) {
      headers["x-policy-id"] = this.policyId;
    }
    if (this.runId !== undefined) {
      headers["x-run-id"] = String(this.runId);
    }

    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${normalizedPath}`, {
      method,
      headers,
      body: payload,
    });

    const text = await response.text();
    return {
      status: response.status,
      body: text,
      json: () => {
        if (text === "") {
          return null;
        }
        return JSON.parse(text) as unknown;
      },
    };
  }

  get(path: string): Promise<GameResponse> {
    return this.request("GET", path);
  }

  post(path: string, body?: unknown): Promise<GameResponse> {
    return this.request("POST", path, body);
  }

  put(path: string, body?: unknown): Promise<GameResponse> {
    return this.request("PUT", path, body);
  }

  delete(path: string): Promise<GameResponse> {
    return this.request("DELETE", path);
  }
}
