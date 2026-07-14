export interface ApiLogEntry {
  id: number;
  ts: Date;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  summary: string;
  error?: string;
}

const MAX_ENTRIES = 50;
let nextId = 1;
const entries: ApiLogEntry[] = [];
let container: HTMLElement | null = null;

function summarizeBody(path: string, body: unknown): string {
  if (body === null || body === undefined) {
    return "";
  }
  if (typeof body !== "object") {
    return String(body);
  }

  const record = body as Record<string, unknown>;

  if (path.includes("/map")) {
    const tiles = Array.isArray(record.tiles) ? record.tiles.length : 0;
    const bounds = record.bounds as Record<string, number> | undefined;
    const b = bounds
      ? `(${bounds.min_x}…${bounds.max_x}, ${bounds.min_y}…${bounds.max_y})`
      : "?";
    return `{ bounds: ${b}, tiles: ${tiles} }`;
  }

  if (path.includes("/leaderboard")) {
    const list = Array.isArray(record.entries) ? record.entries : [];
    const top = list
      .slice(0, 3)
      .map((e) => {
        const entry = e as Record<string, unknown>;
        return `${entry.display_name}:${entry.tile_count}`;
      })
      .join(", ");
    return `{ entries: ${list.length}${top ? ` [${top}]` : ""} }`;
  }

  const text = JSON.stringify(body);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function render(): void {
  if (!container) {
    return;
  }
  container.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "api-console-empty";
    empty.textContent = "No API calls yet";
    container.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `api-console-entry${entry.ok ? "" : " error"}`;

    const head = document.createElement("div");
    head.className = "api-console-head";
    head.textContent = `${formatTime(entry.ts)} ${entry.method} ${entry.path} → ${entry.status || "ERR"}`;

    const body = document.createElement("pre");
    body.className = "api-console-body";
    body.textContent = entry.error ?? entry.summary;

    row.append(head, body);
    container.appendChild(row);
  }
}

export function initApiConsole(el: HTMLElement): void {
  container = el;
  render();
}

export function logApiCall(input: {
  method: string;
  path: string;
  status: number;
  ok: boolean;
  body: unknown;
  error?: string;
}): void {
  entries.unshift({
    id: nextId++,
    ts: new Date(),
    method: input.method,
    path: input.path,
    status: input.status,
    ok: input.ok,
    summary: summarizeBody(input.path, input.body),
    error: input.error,
  });
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }
  render();
}
