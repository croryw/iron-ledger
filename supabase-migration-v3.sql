-- ============================================================
-- Iron Ledger — migration v3: private meal and weight logs
--
-- Paste into Supabase -> SQL Editor -> New query -> Run.
--
-- SAFE TO RUN ON A LIVE PROJECT. This one only ADDS things —
-- it drops nothing and touches no existing row. Do NOT re-run
-- supabase-setup.sql, which would wipe your accounts and boards.
--
-- Everything here is private to the person who logged it. The
-- policies below have no "shares_board" escape hatch: only
-- auth.uid() = user_id can read a row, so nobody on any board can
-- see your meals or your weight, whatever the app does.
-- ============================================================

-- How many meals you're aiming for each day, and which unit you
-- think in. Both live on your profile, not on a board.
alter table profiles add column if not exists meal_goal   int  not null default 4;
alter table profiles add column if not exists weight_unit text not null default 'kg';

-- One row per day, holding that day's count.
create table if not exists meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  day         date not null,
  count       int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists meals_user_idx on meals(user_id, day);

-- Weight is always stored in kilograms; the app converts for
-- display. One entry per day, and logging is entirely optional.
create table if not exists weights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  day         date not null,
  kg          numeric(6,2) not null check (kg > 0 and kg < 500),
  created_at  timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists weights_user_idx on weights(user_id, day);

-- ---------- private, and enforced by the database ----------
alter table meals   enable row level security;
alter table weights enable row level security;

drop policy if exists "own meals read"    on meals;
drop policy if exists "own meals write"   on meals;
drop policy if exists "own meals update"  on meals;
drop policy if exists "own meals delete"  on meals;
create policy "own meals read"   on meals for select using (user_id = auth.uid());
create policy "own meals write"  on meals for insert to authenticated
  with check (user_id = auth.uid());
create policy "own meals update" on meals for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own meals delete" on meals for delete using (user_id = auth.uid());

drop policy if exists "own weights read"   on weights;
drop policy if exists "own weights write"  on weights;
drop policy if exists "own weights update" on weights;
drop policy if exists "own weights delete" on weights;
create policy "own weights read"   on weights for select using (user_id = auth.uid());
create policy "own weights write"  on weights for insert to authenticated
  with check (user_id = auth.uid());
create policy "own weights update" on weights for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own weights delete" on weights for delete using (user_id = auth.uid());

-- ---------- realtime, so a second device keeps up ----------
do $$
declare t text;
begin
  foreach t in array array['meals','weights'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
