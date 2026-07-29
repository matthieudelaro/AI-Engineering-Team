import { describe, expect, it } from "vitest";
import { redactHeaders, truncateBody } from "./redact.js";

describe("redactHeaders", () => {
  it("redacts sensitive headers", () => {
    const result = redactHeaders({
      Authorization: "Bearer secret",
      "X-API-Key": "abc",
      "content-type": "application/json",
    });
    expect(result.Authorization).toBe("[REDACTED]");
    expect(result["X-API-Key"]).toBe("[REDACTED]");
    expect(result["content-type"]).toBe("application/json");
  });
});

describe("truncateBody", () => {
  it("returns null for empty body", () => {
    expect(truncateBody("", 10)).toBeNull();
  });

  it("truncates oversized bodies", () => {
    const body = "a".repeat(20);
    const result = truncateBody(body, 10);
    expect(result).toContain("[truncated]");
    expect(result?.startsWith("a".repeat(10))).toBe(true);
  });
});
