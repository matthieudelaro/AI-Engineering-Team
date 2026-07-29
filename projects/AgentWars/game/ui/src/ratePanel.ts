export interface EndpointRateRow {
  key: string;
  label: string;
  count: number;
  rps: number;
  maxRps: number | null;
  sources: Record<string, number>;
  sourceBreakdown?: string;
  pinned?: boolean;
}

export interface RateStatsPayload {
  windowSec: number;
  totalCalls: number;
  history: string;
  endpoints: EndpointRateRow[];
}

const GATEWAY_BASE = "/_gateway";

export async function fetchRateStats(windowSec = 10): Promise<RateStatsPayload> {
  const response = await fetch(
    `${GATEWAY_BASE}/rate-stats?window_sec=${encodeURIComponent(String(windowSec))}`,
  );
  if (!response.ok) {
    throw new Error(`rate stats unavailable (${response.status})`);
  }
  return response.json() as Promise<RateStatsPayload>;
}

function formatRps(value: number): string {
  if (value >= 10) {
    return value.toFixed(1);
  }
  if (value >= 1) {
    return value.toFixed(2);
  }
  return value.toFixed(3);
}

function usageClass(rps: number, maxRps: number | null): string {
  if (maxRps === null || maxRps <= 0) {
    return "";
  }
  const ratio = rps / maxRps;
  if (ratio >= 0.9) {
    return " hot";
  }
  if (ratio >= 0.6) {
    return " warm";
  }
  return "";
}

function renderRow(entry: EndpointRateRow): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `rate-panel-row${entry.pinned ? " pinned" : ""}${usageClass(entry.rps, entry.maxRps)}`;

  const label = document.createElement("span");
  label.className = "rate-panel-label";
  label.textContent = entry.label;

  const value = document.createElement("span");
  value.className = "rate-panel-value";
  const cap = entry.maxRps !== null ? ` / ${entry.maxRps} rps` : "";
  const breakdown = entry.sourceBreakdown ?? "";
  value.textContent = `${formatRps(entry.rps)} rps${cap}${breakdown}`;

  row.append(label, value);
  return row;
}

function renderRows(container: HTMLElement, stats: RateStatsPayload): void {
  container.replaceChildren();

  if (stats.endpoints.length === 0) {
    const empty = document.createElement("div");
    empty.className = "rate-panel-empty";
    empty.textContent = `No calls in last ${stats.windowSec}s`;
    container.appendChild(empty);
    return;
  }

  for (const entry of stats.endpoints) {
    container.appendChild(renderRow(entry));
  }
}

export function initRatePanel(root: HTMLElement, windowSec = 10): () => void {
  const title = document.createElement("div");
  title.className = "rate-panel-title";
  title.textContent = "API rate (gateway audit)";

  const meta = document.createElement("div");
  meta.className = "rate-panel-meta";
  meta.textContent = "Loading…";

  const rows = document.createElement("div");
  rows.className = "rate-panel-rows";

  const foot = document.createElement("div");
  foot.className = "rate-panel-foot";
  foot.textContent =
    "Pinned: claim + flag intel always shown · spawn/claim jobs = POST place-tile via job runner";

  root.append(title, meta, rows, foot);

  let stopped = false;

  async function refresh(): Promise<void> {
    if (stopped) {
      return;
    }
    try {
      const stats = await fetchRateStats(windowSec);
      meta.textContent = `${stats.totalCalls} calls / ${stats.windowSec}s · all sources`;
      renderRows(rows, stats);
      root.classList.remove("rate-panel-error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "stats error";
      meta.textContent = message;
      rows.replaceChildren();
      root.classList.add("rate-panel-error");
    }
  }

  void refresh();
  const timer = window.setInterval(() => void refresh(), 1000);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
