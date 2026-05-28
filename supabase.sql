create table if not exists public.qsj_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  timestamp_ms bigint not null,
  entry_date date not null,
  client_id text,
  updated_at timestamptz not null default now()
);

create index if not exists qsj_entries_user_date_idx
on public.qsj_entries(user_id, entry_date, timestamp_ms);

create table if not exists public.qsj_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_date date not null,
  text text not null,
  updated_ms bigint not null,
  client_id text,
  updated_at timestamptz not null default now(),
  primary key (user_id, summary_date)
);

create table if not exists public.qsj_kanban_cards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  card_type text not null check (card_type in ('todo', 'reminder', 'quote', 'thought')),
  done boolean not null default false,
  card_date date not null,
  sort_order integer not null default 0,
  client_id text,
  updated_at timestamptz not null default now()
);

create index if not exists qsj_kanban_cards_user_order_idx
on public.qsj_kanban_cards(user_id, sort_order);

create table if not exists public.qsj_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_key text not null default '',
  base_url text not null default '',
  client_id text,
  updated_at timestamptz not null default now()
);

alter table public.qsj_entries enable row level security;
alter table public.qsj_summaries enable row level security;
alter table public.qsj_kanban_cards enable row level security;
alter table public.qsj_user_settings enable row level security;

drop policy if exists "Users can read own entries" on public.qsj_entries;
create policy "Users can read own entries"
on public.qsj_entries
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own entries" on public.qsj_entries;
create policy "Users can insert own entries"
on public.qsj_entries
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own entries" on public.qsj_entries;
create policy "Users can update own entries"
on public.qsj_entries
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own entries" on public.qsj_entries;
create policy "Users can delete own entries"
on public.qsj_entries
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own summaries" on public.qsj_summaries;
create policy "Users can read own summaries"
on public.qsj_summaries
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own summaries" on public.qsj_summaries;
create policy "Users can insert own summaries"
on public.qsj_summaries
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own summaries" on public.qsj_summaries;
create policy "Users can update own summaries"
on public.qsj_summaries
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own summaries" on public.qsj_summaries;
create policy "Users can delete own summaries"
on public.qsj_summaries
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own kanban cards" on public.qsj_kanban_cards;
create policy "Users can read own kanban cards"
on public.qsj_kanban_cards
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own kanban cards" on public.qsj_kanban_cards;
create policy "Users can insert own kanban cards"
on public.qsj_kanban_cards
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own kanban cards" on public.qsj_kanban_cards;
create policy "Users can update own kanban cards"
on public.qsj_kanban_cards
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own kanban cards" on public.qsj_kanban_cards;
create policy "Users can delete own kanban cards"
on public.qsj_kanban_cards
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own settings" on public.qsj_user_settings;
create policy "Users can read own settings"
on public.qsj_user_settings
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own settings" on public.qsj_user_settings;
create policy "Users can insert own settings"
on public.qsj_user_settings
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own settings" on public.qsj_user_settings;
create policy "Users can update own settings"
on public.qsj_user_settings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.qsj_entries;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.qsj_summaries;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.qsj_kanban_cards;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.qsj_user_settings;
exception
  when duplicate_object then null;
end $$;
