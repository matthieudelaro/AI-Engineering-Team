import { logApiCall } from "./apiConsole.js";

export interface ClaimQueueStatsPayload {
  pending: number;
  inFlight: number;
  total: number;
  pendingRetries: number;
}

export interface ClaimQueueView {
  meta: string;
  emptyDisabled: boolean;
}

const GATEWAY_BASE = "/_gateway";

export async function fetchClaimQueueStats(): Promise<ClaimQueueStatsPayload> {
  const response = await fetch(`${GATEWAY_BASE}/ui-claim-queue`);
  if (!response.ok) {
    throw new Error(`claim queue stats unavailable (${response.status})`);
  }
  return response.json() as Promise<ClaimQueueStatsPayload>;
}

export async function clearClaimQueue(): Promise<void> {
  const response = await fetch(`${GATEWAY_BASE}/ui-claim-queue`, {
    method: "DELETE",
    headers: { "X-Source": "ui" },
  });
  if (!response.ok) {
    throw new Error(`clear claim queue failed (${response.status})`);
  }
}

export function buildClaimQueueView(stats: ClaimQueueStatsPayload): ClaimQueueView {
  if (stats.total <= 0) {
    return {
      meta: "Queue empty",
      emptyDisabled: true,
    };
  }

  return {
    meta: `${stats.pending} pending · ${stats.inFlight} in flight · ${stats.total} total`,
    emptyDisabled: false,
  };
}

function applyView(
  meta: HTMLElement,
  emptyButton: HTMLButtonElement,
  view: ClaimQueueView,
): void {
  meta.textContent = view.meta;
  emptyButton.disabled = view.emptyDisabled;
}

export interface ClaimQueuePanelOptions {
  pollMs?: number;
  fetchStats?: typeof fetchClaimQueueStats;
  clearQueue?: typeof clearClaimQueue;
  /** Called after the gateway queue is cleared successfully. */
  onCleared?: () => void;
}

export function initClaimQueuePanel(
  root: HTMLElement,
  options: ClaimQueuePanelOptions = {},
): () => void {
  const fetchStats = options.fetchStats ?? fetchClaimQueueStats;
  const clearQueue = options.clearQueue ?? clearClaimQueue;
  const onCleared = options.onCleared;
  const pollMs = options.pollMs ?? 1000;

  const title = document.createElement("div");
  title.className = "claim-queue-panel-title";
  title.textContent = "Claim queue";

  const meta = document.createElement("div");
  meta.className = "claim-queue-panel-meta";
  meta.textContent = "Loading…";

  const actions = document.createElement("div");
  actions.className = "claim-queue-panel-actions";

  const emptyButton = document.createElement("button");
  emptyButton.type = "button";
  emptyButton.className = "claim-queue-panel-empty";
  emptyButton.textContent = "Empty queue";
  emptyButton.disabled = true;

  actions.appendChild(emptyButton);
  root.append(title, meta, actions);

  let stopped = false;
  let clearing = false;
  let latestStats: ClaimQueueStatsPayload | null = null;

  function setEmptyDisabled(disabled: boolean): void {
    emptyButton.disabled = disabled || clearing;
  }

  function renderStats(stats: ClaimQueueStatsPayload): void {
    latestStats = stats;
    const view = buildClaimQueueView(stats);
    applyView(meta, emptyButton, view);
    root.classList.remove("claim-queue-panel-error");
  }

  async function refresh(): Promise<void> {
    if (stopped) {
      return;
    }
    try {
      const stats = await fetchStats();
      renderStats(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : "stats error";
      meta.textContent = message;
      setEmptyDisabled(true);
      root.classList.add("claim-queue-panel-error");
    }
  }

  async function handleEmpty(): Promise<void> {
    if (clearing || emptyButton.disabled) {
      return;
    }
    clearing = true;
    setEmptyDisabled(true);
    try {
      await clearQueue();
      onCleared?.();
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "clear failed";
      meta.textContent = message;
      root.classList.add("claim-queue-panel-error");
      logApiCall({
        method: "DELETE",
        path: "/_gateway/ui-claim-queue",
        status: 0,
        ok: false,
        body: null,
        error: message,
      });
      if (latestStats) {
        setEmptyDisabled(buildClaimQueueView(latestStats).emptyDisabled);
      }
    } finally {
      clearing = false;
    }
  }

  emptyButton.addEventListener("click", () => void handleEmpty());

  void refresh();
  const timer = window.setInterval(() => void refresh(), pollMs);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
