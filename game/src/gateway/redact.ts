const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
]);

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const redacted: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function truncateBody(body: string | undefined, maxBytes: number): string | null {
  if (body === undefined || body === "") {
    return null;
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  if (bytes.length <= maxBytes) {
    return body;
  }
  const truncated = bytes.slice(0, maxBytes);
  return `${new TextDecoder().decode(truncated)}...[truncated]`;
}
