-- Table: run_triggers
-- Holds manual run requests from the admin panel.
-- The local trigger-watcher.js listens via Supabase Realtime and acts on 'pending' rows.

create table if not exists run_triggers (
  id           uuid        default gen_random_uuid() primary key,
  requested_at timestamptz default now(),
  status       text        not null default 'pending'
               check (status in ('pending', 'running', 'done', 'error', 'already_running')),
  result       text
);

-- Keep only last 50 rows (cleanup old records automatically)
create or replace function trim_run_triggers() returns trigger language plpgsql as $$
begin
  delete from run_triggers
  where id in (
    select id from run_triggers
    order by requested_at desc
    offset 50
  );
  return new;
end;
$$;

create trigger trg_trim_run_triggers
  after insert on run_triggers
  for each row execute function trim_run_triggers();

-- RLS: anyone (including admin panel with publishable key) can insert + read
--      only service_role can update (the watcher uses service key)
alter table run_triggers enable row level security;

create policy "insert_open"  on run_triggers for insert with check (true);
create policy "select_open"  on run_triggers for select using (true);
create policy "update_service" on run_triggers for update using (true);

-- Enable Realtime on this table
alter publication supabase_realtime add table run_triggers;
