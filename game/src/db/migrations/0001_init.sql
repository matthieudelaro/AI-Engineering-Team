-- api_calls: every proxied request/response
CREATE TABLE IF NOT EXISTS api_calls (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method VARCHAR(16) NOT NULL,
  path TEXT NOT NULL,
  query TEXT,
  request_headers_redacted JSONB,
  request_body TEXT,
  response_status INTEGER,
  response_body TEXT,
  latency_ms INTEGER,
  policy_id VARCHAR(64),
  run_id INTEGER,
  error TEXT,
  source VARCHAR(32) DEFAULT 'gateway'
);

CREATE INDEX IF NOT EXISTS idx_api_calls_ts ON api_calls (ts DESC);
CREATE INDEX IF NOT EXISTS idx_api_calls_policy_id ON api_calls (policy_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_run_id ON api_calls (run_id);

-- game_states: snapshots from pollers
CREATE TABLE IF NOT EXISTS game_states (
  id SERIAL PRIMARY KEY,
  endpoint_key VARCHAR(64) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_json JSONB,
  etag_or_hash VARCHAR(128)
);

CREATE INDEX IF NOT EXISTS idx_game_states_endpoint_key ON game_states (endpoint_key, fetched_at DESC);

-- policy_runs: lifecycle of a policy instance
CREATE TABLE IF NOT EXISTS policy_runs (
  id SERIAL PRIMARY KEY,
  policy_key VARCHAR(64) NOT NULL,
  zone_json JSONB,
  status VARCHAR(32) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  config_json JSONB,
  pid INTEGER
);

CREATE INDEX IF NOT EXISTS idx_policy_runs_policy_key ON policy_runs (policy_key, started_at DESC);

-- policy_events: structured log from policies and pollers
CREATE TABLE IF NOT EXISTS policy_events (
  id SERIAL PRIMARY KEY,
  run_id INTEGER,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level VARCHAR(16) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  data_json JSONB,
  source VARCHAR(32) DEFAULT 'policy'
);

CREATE INDEX IF NOT EXISTS idx_policy_events_run_id ON policy_events (run_id, ts DESC);
