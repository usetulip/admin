-- Operator Taste Dashboard (admin.usetulip.co): review and publishing pipeline.
--
-- The admin app reads and writes these tables server-side through Drizzle on a
-- direct Postgres connection. Browsers never query them: RLS is on with no
-- policies, and anon/authenticated have no grants. The only browser-facing
-- piece is a contentless Realtime broadcast ("something changed") on the
-- public `operator-queue` topic, which tells the dashboard to refetch.
--
-- Contract with the MCP server (mcp.usetulip.co), which reads with the
-- service role:
--   tulip://tokens/{client_id}  -> client_token_sets.tokens where client_id = $1
--   approved blocks             -> component_blocks where client_id = $1
--                                  and published_at is not null, serving
--                                  published_source / published_version / published_hash

-- --- Client token sets (what tulip://tokens/{client_id} serves) ---

create table public.client_token_sets (
  client_id text primary key
    check (client_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- Validated against lib/token-schema.ts (ThemeTokensSchema) before every write.
  tokens jsonb not null,
  version integer not null default 1 check (version > 0),
  published_at timestamptz not null default now(),
  published_by text not null,
  updated_at timestamptz not null default now()
);

-- --- Generated component blocks under review ---

create table public.component_blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  client_id text not null check (client_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (char_length(name) between 1 and 120),
  -- Archetype or component type, e.g. saas-dashboard, form-wizard, button.
  archetype text not null check (archetype ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  source text not null check (char_length(source) between 1 and 200000),
  -- sha256 of source + tokens; reviews and publishes pin to it.
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  tokens jsonb not null,
  figma_url text check (figma_url ~ '^https://(www\.)?figma\.com/'),
  status text not null default 'in_review'
    check (status in ('in_review', 'changes_requested', 'approved', 'published')),
  -- Last published snapshot. Editing a published block sends it back to
  -- review but keeps serving this snapshot until the next publish.
  published_source text,
  published_hash text check (published_hash ~ '^[0-9a-f]{64}$'),
  published_version integer not null default 0 check (published_version >= 0),
  published_at timestamptz,
  published_by text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint component_blocks_published_snapshot check (
    (published_at is null) = (published_source is null)
    and (published_at is null) = (published_hash is null)
  )
);

create index component_blocks_project_id_idx on public.component_blocks (project_id);
create index component_blocks_client_published_idx
  on public.component_blocks (client_id)
  where published_at is not null;

-- --- Manual taste reviews (append-only; the latest row for a hash counts) ---

create table public.taste_reviews (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.component_blocks (id) on delete cascade,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  -- { icon_sizing, font_hierarchy, padding_density, wcag_contrast }: booleans.
  checks jsonb not null,
  notes text check (char_length(notes) <= 4000),
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

create index taste_reviews_block_created_idx
  on public.taste_reviews (block_id, created_at desc);

-- --- Layout / spacing / typography regression flags ---

create table public.layout_flags (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.component_blocks (id) on delete cascade,
  category text not null check (category in (
    'layout_regression', 'spacing', 'typography', 'icon_sizing', 'contrast', 'other'
  )),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  message text not null check (char_length(message) between 1 and 2000),
  line integer check (line > 0),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by text not null,
  created_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution text check (char_length(resolution) <= 2000),
  constraint layout_flags_resolution check (
    (status = 'resolved') = (resolved_at is not null and resolved_by is not null)
  )
);

create index layout_flags_block_status_idx on public.layout_flags (block_id, status);

-- --- Operator audit log (automated audits, reviews, flags, publishes) ---

create table public.operator_audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index operator_audit_log_entity_idx
  on public.operator_audit_log (entity_type, entity_id, created_at desc);

-- --- Lock down: server-side (Drizzle / service role) access only ---

alter table public.client_token_sets enable row level security;
alter table public.component_blocks enable row level security;
alter table public.taste_reviews enable row level security;
alter table public.layout_flags enable row level security;
alter table public.operator_audit_log enable row level security;

revoke all on public.client_token_sets from anon, authenticated;
revoke all on public.component_blocks from anon, authenticated;
revoke all on public.taste_reviews from anon, authenticated;
revoke all on public.layout_flags from anon, authenticated;
revoke all on public.operator_audit_log from anon, authenticated;

-- --- Realtime doorbell for the operator queue ---
-- Broadcasts only the table name and operation, never row data, on the public
-- `operator-queue` topic. The dashboard refetches through its own
-- authenticated server code when it hears one.

create function public.notify_operator_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'op', tg_op),
      'changed',
      'operator-queue',
      false
    );
  exception when others then
    -- Never block a customer or operator write because Realtime is unavailable.
    raise warning 'notify_operator_queue: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notify_operator_queue() from public, anon, authenticated;

create trigger projects_notify_operator_queue
  after insert or update or delete on public.projects
  for each row execute function public.notify_operator_queue();

create trigger component_blocks_notify_operator_queue
  after insert or update or delete on public.component_blocks
  for each row execute function public.notify_operator_queue();

create trigger layout_flags_notify_operator_queue
  after insert or update or delete on public.layout_flags
  for each row execute function public.notify_operator_queue();

create trigger taste_reviews_notify_operator_queue
  after insert on public.taste_reviews
  for each row execute function public.notify_operator_queue();
