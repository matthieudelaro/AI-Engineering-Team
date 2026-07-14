/**
 * Gateway-side UI claim priority. Tracks the last time manual UI activity was
 * seen so background claim jobs can back off while a user is actively claiming
 * tiles. State is process-local to the gateway.
 */

let lastUiActivityAt: number | null = null;

/** Record that manual UI activity just happened. */
export function touchUiClaimActivity(now: number = Date.now()): void {
  lastUiActivityAt = now;
}

/** Whether UI activity was seen within the last `windowMs` milliseconds. */
export function isUiClaimActive(windowMs: number, now: number = Date.now()): boolean {
  if (lastUiActivityAt === null) {
    return false;
  }
  return now - lastUiActivityAt < windowMs;
}

export interface UiClaimActivity {
  active: boolean;
  lastActivityAt: number | null;
  windowMs: number;
}

/** Snapshot of the current UI claim priority state for a given window. */
export function getUiClaimActivity(
  windowMs: number,
  now: number = Date.now(),
): UiClaimActivity {
  return {
    active: isUiClaimActive(windowMs, now),
    lastActivityAt: lastUiActivityAt,
    windowMs,
  };
}

/** Reset the tracked activity. Intended for tests. */
export function resetUiClaimActivity(): void {
  lastUiActivityAt = null;
}
