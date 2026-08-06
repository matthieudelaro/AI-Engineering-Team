import type { NukeAcceptedEffect } from "./types.js";

export const NUKE_COOLDOWN_MS = 30_000;
const GATEWAY_BASE = "/_gateway";
const DEFAULT_POLL_MS = 1000;
const DEFAULT_LIMIT = 50;
const UI_POLL_DEDUPE_MS = 15_000;

export interface RecentNuke {
  id: number;
  ts: string;
  source: string;
  target_x: number;
  target_y: number;
  accepted: boolean;
  cost_charged?: number;
  effective_radius_tiles?: number;
  rejection_reason?: string;
  retry_after?: number;
}

export interface RecentNukesResponse {
  nukes: RecentNuke[];
}

export interface NukeToastMessageOptions {
  costCharged?: number;
  effectiveRadius?: number;
  source?: string;
}

export function formatNukeToastMessage(
  x: number,
  y: number,
  options?: NukeToastMessageOptions,
): string {
  const parts = [`Nuke sent (${x}, ${y})`];
  if (options?.costCharged !== undefined) {
    parts.push(`${options.costCharged} pts`);
  }
  if (options?.effectiveRadius !== undefined) {
    parts.push(`radius ${options.effectiveRadius}`);
  }
  let message = parts.join(" · ");
  if (options?.source === "job") {
    message += " · job";
  }
  return message;
}

export function computeCooldownEndsAtFromAccept(eventTimeMs: number): number {
  return eventTimeMs + NUKE_COOLDOWN_MS;
}

export function computeCooldownEndsAtFromRetryAfter(
  nowMs: number,
  retryAfterSec: number,
): number {
  return nowMs + retryAfterSec * 1000;
}

export function formatCooldownLabel(endsAtMs: number, nowMs: number): string {
  const remainingMs = endsAtMs - nowMs;
  if (remainingMs <= 0) {
    return "Ready";
  }
  const seconds = Math.ceil(remainingMs / 1000);
  return `Cooldown: ${seconds}s`;
}

export async function fetchRecentNukes(
  sinceId = 0,
  limit = DEFAULT_LIMIT,
): Promise<RecentNukesResponse> {
  const response = await fetch(
    `${GATEWAY_BASE}/recent-nukes?since_id=${encodeURIComponent(String(sinceId))}&limit=${encodeURIComponent(String(limit))}`,
  );
  if (!response.ok) {
    throw new Error(`recent nukes unavailable (${response.status})`);
  }
  return response.json() as Promise<RecentNukesResponse>;
}

export interface NukeToastHandle {
  notifyUiAccepted(x: number, y: number, effect?: NukeAcceptedEffect): void;
  notifyUiRejected(retryAfterSec: number): void;
  destroy(): void;
}

export interface NukeToastOptions {
  pollMs?: number;
  fetchRecent?: typeof fetchRecentNukes;
  limit?: number;
}

interface PendingUiNuke {
  x: number;
  y: number;
  atMs: number;
}

function messageOptionsFromNuke(nuke: RecentNuke): NukeToastMessageOptions {
  return {
    costCharged: nuke.cost_charged,
    effectiveRadius: nuke.effective_radius_tiles,
    source: nuke.source,
  };
}

function messageOptionsFromEffect(
  effect?: NukeAcceptedEffect,
): NukeToastMessageOptions | undefined {
  if (!effect) {
    return undefined;
  }
  return {
    costCharged: effect.cost_charged,
    effectiveRadius: effect.effective_radius_tiles,
    source: "ui",
  };
}

export function initNukeToast(
  root: HTMLElement,
  options: NukeToastOptions = {},
): NukeToastHandle {
  const fetchRecent = options.fetchRecent ?? fetchRecentNukes;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const messageEl = document.createElement("div");
  messageEl.className = "nuke-toast-message";

  const cooldownEl = document.createElement("div");
  cooldownEl.className = "nuke-toast-cooldown";
  cooldownEl.textContent = "Ready";

  root.append(messageEl, cooldownEl);

  let stopped = false;
  let lastSeenId = 0;
  let cooldownEndsAt: number | null = null;
  let pendingUiNuke: PendingUiNuke | null = null;

  function renderCooldown(nowMs = Date.now()): void {
    if (cooldownEndsAt === null) {
      cooldownEl.textContent = "Ready";
      return;
    }
    cooldownEl.textContent = formatCooldownLabel(cooldownEndsAt, nowMs);
  }

  function startCooldownFromAccept(eventTimeMs: number): void {
    cooldownEndsAt = computeCooldownEndsAtFromAccept(eventTimeMs);
    renderCooldown();
  }

  function extendCooldownFromRetryAfter(retryAfterSec: number): void {
    const endsAt = computeCooldownEndsAtFromRetryAfter(Date.now(), retryAfterSec);
    cooldownEndsAt =
      cooldownEndsAt === null ? endsAt : Math.max(cooldownEndsAt, endsAt);
    renderCooldown();
  }

  function showAccepted(
    x: number,
    y: number,
    opts?: NukeToastMessageOptions,
    eventTimeMs = Date.now(),
  ): void {
    messageEl.textContent = formatNukeToastMessage(x, y, opts);
    startCooldownFromAccept(eventTimeMs);
    root.classList.remove("nuke-toast-error");
  }

  function matchesPendingUiPoll(nuke: RecentNuke): boolean {
    if (!pendingUiNuke) {
      return false;
    }
    if (nuke.target_x !== pendingUiNuke.x || nuke.target_y !== pendingUiNuke.y) {
      return false;
    }
    const eventMs = Date.parse(nuke.ts);
    if (Number.isNaN(eventMs)) {
      return false;
    }
    return Math.abs(eventMs - pendingUiNuke.atMs) < UI_POLL_DEDUPE_MS;
  }

  function processPollNuke(nuke: RecentNuke): void {
    if (nuke.id > lastSeenId) {
      lastSeenId = nuke.id;
    }

    if (nuke.accepted) {
      const eventMs = Date.parse(nuke.ts);
      const endsAt = Number.isNaN(eventMs)
        ? computeCooldownEndsAtFromAccept(Date.now())
        : computeCooldownEndsAtFromAccept(eventMs);

      if (matchesPendingUiPoll(nuke)) {
        pendingUiNuke = null;
        cooldownEndsAt = endsAt;
        renderCooldown();
        return;
      }

      showAccepted(
        nuke.target_x,
        nuke.target_y,
        messageOptionsFromNuke(nuke),
        Number.isNaN(eventMs) ? Date.now() : eventMs,
      );
      return;
    }

    if (nuke.retry_after !== undefined && nuke.retry_after > 0) {
      extendCooldownFromRetryAfter(nuke.retry_after);
    }
  }

  async function refresh(): Promise<void> {
    if (stopped) {
      return;
    }
    try {
      const payload = await fetchRecent(lastSeenId, limit);
      for (const nuke of payload.nukes) {
        processPollNuke(nuke);
      }
      root.classList.remove("nuke-toast-error");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "poll error";
      cooldownEl.textContent = detail;
      root.classList.add("nuke-toast-error");
    }
  }

  void refresh();
  const pollTimer = window.setInterval(() => void refresh(), pollMs);
  const countdownTimer = window.setInterval(() => renderCooldown(), 1000);

  return {
    notifyUiAccepted(x: number, y: number, effect?: NukeAcceptedEffect): void {
      const atMs = Date.now();
      pendingUiNuke = { x, y, atMs };
      showAccepted(x, y, messageOptionsFromEffect(effect), atMs);
    },

    notifyUiRejected(retryAfterSec: number): void {
      if (retryAfterSec > 0) {
        extendCooldownFromRetryAfter(retryAfterSec);
      }
    },

    destroy(): void {
      stopped = true;
      window.clearInterval(pollTimer);
      window.clearInterval(countdownTimer);
    },
  };
}
