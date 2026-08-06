create schema if not exists autoge_private;

revoke all on schema autoge_private from public, anon, authenticated;

create table public.autoge_artifacts (
  artifact_id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  media_type text not null check (length(trim(media_type)) > 0),
  byte_size bigint not null check (byte_size >= 0),
  relative_path text not null,
  source_url text,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.autoge_events (
  event_id uuid primary key,
  event_type text not null check (length(trim(event_type)) > 0),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  subject_type text not null check (length(trim(subject_type)) > 0),
  subject_id text not null check (length(trim(subject_id)) > 0),
  causation_id uuid references public.autoge_events (event_id),
  correlation_id uuid,
  source text not null check (length(trim(source)) > 0),
  payload jsonb not null,
  raw_artifact_id uuid references public.autoge_artifacts (artifact_id),
  schema_version integer not null check (schema_version > 0),
  created_at timestamptz not null default now()
);

create index autoge_events_subject_idx
  on public.autoge_events (subject_type, subject_id, occurred_at, event_id);

create index autoge_events_correlation_idx
  on public.autoge_events (correlation_id)
  where correlation_id is not null;

create table public.autoge_criteria_versions (
  criteria_version text primary key,
  definition jsonb not null,
  source_event_id uuid not null references public.autoge_events (event_id),
  created_at timestamptz not null default now()
);

create table public.autoge_listing_projections (
  listing_id text primary key,
  canonical_url text not null unique,
  title text not null,
  make text,
  model text,
  year integer,
  mileage bigint,
  mileage_unit text check (mileage_unit in ('km', 'miles')),
  price_amount numeric,
  price_currency text check (price_currency in ('GEL', 'USD')),
  customs_status text,
  drivetrain text,
  location text,
  observed_at timestamptz not null,
  source_event_id uuid not null references public.autoge_events (event_id),
  projection_version integer not null check (projection_version > 0),
  rebuilt_at timestamptz not null default now()
);

create table public.autoge_facts (
  fact_id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id text not null,
  fact_name text not null,
  value jsonb not null,
  confidence numeric not null check (confidence between 0 and 1),
  provenance jsonb not null,
  extractor text not null,
  extractor_version text not null,
  source_event_id uuid not null references public.autoge_events (event_id),
  created_at timestamptz not null default now()
);

create index autoge_facts_subject_idx
  on public.autoge_facts (subject_type, subject_id, fact_name, created_at);

create table public.autoge_evaluations (
  evaluation_id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.autoge_listing_projections (listing_id),
  criteria_version text not null references public.autoge_criteria_versions (criteria_version),
  status text not null check (status in ('qualified', 'rejected', 'incomplete', 'review')),
  score numeric,
  explanation jsonb not null,
  source_event_id uuid not null references public.autoge_events (event_id),
  computed_at timestamptz not null default now(),
  unique (listing_id, criteria_version, source_event_id)
);

alter table public.autoge_artifacts enable row level security;
alter table public.autoge_events enable row level security;
alter table public.autoge_criteria_versions enable row level security;
alter table public.autoge_listing_projections enable row level security;
alter table public.autoge_facts enable row level security;
alter table public.autoge_evaluations enable row level security;

revoke all on table public.autoge_artifacts from anon, authenticated;
revoke all on table public.autoge_events from anon, authenticated;
revoke all on table public.autoge_criteria_versions from anon, authenticated;
revoke all on table public.autoge_listing_projections from anon, authenticated;
revoke all on table public.autoge_facts from anon, authenticated;
revoke all on table public.autoge_evaluations from anon, authenticated;

grant select, insert on table public.autoge_artifacts to service_role;
grant select, insert on table public.autoge_events to service_role;
grant select, insert on table public.autoge_criteria_versions to service_role;
grant select, insert, update on table public.autoge_listing_projections to service_role;
grant select, insert on table public.autoge_facts to service_role;
grant select, insert on table public.autoge_evaluations to service_role;

create function autoge_private.reject_mutation_of_immutable_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

revoke all on function autoge_private.reject_mutation_of_immutable_row() from public;

create trigger autoge_events_are_append_only
before update or delete on public.autoge_events
for each row execute function autoge_private.reject_mutation_of_immutable_row();

create trigger autoge_artifacts_are_append_only
before update or delete on public.autoge_artifacts
for each row execute function autoge_private.reject_mutation_of_immutable_row();

create trigger autoge_criteria_versions_are_append_only
before update or delete on public.autoge_criteria_versions
for each row execute function autoge_private.reject_mutation_of_immutable_row();

create trigger autoge_facts_are_append_only
before update or delete on public.autoge_facts
for each row execute function autoge_private.reject_mutation_of_immutable_row();

create trigger autoge_evaluations_are_append_only
before update or delete on public.autoge_evaluations
for each row execute function autoge_private.reject_mutation_of_immutable_row();
