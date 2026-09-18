-- ============================================================
-- Iron Ledger — database setup (v2: accounts + multiple boards)
--
-- Paste this whole file into Supabase -> SQL Editor -> Run.
--
-- ⚠️  This REPLACES the v1 schema and deletes everything in it.
--     Only run it if you're happy to start fresh.
--
-- The important idea: a check-in belongs to a PERSON, not to a
-- board. Log the gym once and it appears on every board you're on.
-- Goals, colours, comments and nudges stay per-board, because they
-- are about a particular group of friends.
-- ============================================================

-- ---------- out with the old ----------
drop table if exists replies     cascade;
drop table if exists rest_weeks  cascade;
drop table if exists checkins    cascade;
drop table if exists members     cascade;
drop table if exists events      cascade;
drop table if exists rooms       cascade;
drop table if exists comments    cascade;
drop table if exists reactions   cascade;
drop table if exists board_members cascade;
drop table if exists boards      cascade;
drop table if exists profiles    cascade;

-- ---------- people ----------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- A profile row is created automatically the moment somebody signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- boards ----------
create table boards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our board',
  created_by  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table board_members (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  goal        int  not null default 4,
  color       int  not null default 0,
  nudges_on   boolean not null default true,
  joined_at   timestamptz not null default now(),
  unique (board_id, user_id)
);
create index board_members_board_idx on board_members(board_id);
create index board_members_user_idx  on board_members(user_id);

-- ---------- attendance: global to the person ----------
create table checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  day         date not null,
  created_at  timestamptz not null default now(),
  unique (user_id, day)
);
create index checkins_user_idx on checkins(user_id);

create table rest_weeks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  week        date not null,                 -- the Monday of that week
  created_at  timestamptz not null default now(),
  unique (user_id, week)
);

-- ---------- conversation: scoped to one board ----------
-- A check-in is shared across your boards, but what people say about
-- it is not. Your Tuesday session shows up on both boards; the running
-- joke on one of them stays there.
create table comments (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  checkin_id  uuid not null references checkins(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index comments_board_idx   on comments(board_id);
create index comments_checkin_idx on comments(checkin_id);

create table reactions (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  checkin_id  uuid not null references checkins(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (board_id, checkin_id, user_id, emoji)
);
create index reactions_board_idx on reactions(board_id);

create table events (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references boards(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  kind           text not null,              -- 'join' | 'nudge'
  target_user_id uuid references profiles(id) on delete cascade,
  body           text,
  created_at     timestamptz not null default now()
);
create index events_board_idx on events(board_id);

-- ============================================================
-- Access rules
--
-- Two helper functions do the work. They are SECURITY DEFINER so
-- that a policy on board_members can ask "am I in this board?"
-- without the question recursing into itself.
-- ============================================================

create or replace function public.is_member(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from board_members
    where board_id = b and user_id = auth.uid()
  );
$$;

create or replace function public.shares_board(u uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from board_members mine
    join board_members theirs on theirs.board_id = mine.board_id
    where mine.user_id = auth.uid() and theirs.user_id = u
  );
$$;

alter table profiles      enable row level security;
alter table boards        enable row level security;
alter table board_members enable row level security;
alter table checkins      enable row level security;
alter table rest_weeks    enable row level security;
alter table comments      enable row level security;
alter table reactions     enable row level security;
alter table events        enable row level security;

-- Profiles: yourself, and anyone you share a board with.
create policy "read profiles"   on profiles for select
  using (id = auth.uid() or shares_board(id));
create policy "update own name" on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Boards: any signed-in person can look one up (that's how an invite
-- link shows you the board's name before you join). Only members see
-- anything inside it.
create policy "read boards"    on boards for select to authenticated using (true);
create policy "create boards"  on boards for insert to authenticated
  with check (created_by = auth.uid());
create policy "owner edits"    on boards for update using (created_by = auth.uid());
create policy "owner deletes"  on boards for delete using (created_by = auth.uid());

-- Membership: you see the roster of boards you're in; you add and
-- remove only yourself.
create policy "read roster"  on board_members for select using (is_member(board_id));
create policy "join board"   on board_members for insert to authenticated
  with check (user_id = auth.uid());
create policy "edit own row" on board_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "leave board"  on board_members for delete using (user_id = auth.uid());

-- Attendance: yours to write, visible to everyone you share a board with.
create policy "read checkins"   on checkins for select
  using (user_id = auth.uid() or shares_board(user_id));
create policy "log own"         on checkins for insert to authenticated
  with check (user_id = auth.uid());
create policy "unlog own"       on checkins for delete using (user_id = auth.uid());

create policy "read rest"       on rest_weeks for select
  using (user_id = auth.uid() or shares_board(user_id));
create policy "rest own"        on rest_weeks for insert to authenticated
  with check (user_id = auth.uid());
create policy "unrest own"      on rest_weeks for delete using (user_id = auth.uid());

-- Conversation: members of that board only.
create policy "read comments"   on comments for select using (is_member(board_id));
create policy "write comments"  on comments for insert to authenticated
  with check (is_member(board_id) and user_id = auth.uid());
create policy "delete own comment" on comments for delete using (user_id = auth.uid());

create policy "read reactions"  on reactions for select using (is_member(board_id));
create policy "write reactions" on reactions for insert to authenticated
  with check (is_member(board_id) and user_id = auth.uid());
create policy "delete own reaction" on reactions for delete using (user_id = auth.uid());

create policy "read events"     on events for select using (is_member(board_id));
create policy "write events"    on events for insert to authenticated
  with check (is_member(board_id) and user_id = auth.uid());

-- ============================================================
-- Realtime: push every change to anyone with the board open.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['boards','board_members','checkins','rest_weeks',
                           'comments','reactions','events','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
