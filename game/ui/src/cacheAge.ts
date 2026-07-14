export function formatCacheAge(fetchedAt: string | null): string {
  if (!fetchedAt) {
    return "cache age unknown";
  }
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  if (ageMs < 1000) {
    return "just now";
  }
  if (ageMs < 60_000) {
    return `${Math.round(ageMs / 1000)}s ago`;
  }
  return `${Math.round(ageMs / 60_000)}m ago`;
}
