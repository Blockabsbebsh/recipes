-- Shared recipes MVP. This migration is intentionally self-contained.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index households_owner_idx on public.households (owner_id);
create index household_members_user_idx on public.household_members (user_id);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  notes text,
  source_url text check (source_url is null or char_length(source_url) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check ((deleted_at is null and deleted_by is null) or deleted_at is not null)
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  recipe_id uuid not null,
  item text not null check (char_length(trim(item)) between 1 and 120),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  foreign key (recipe_id, household_id) references public.recipes(id, household_id) on delete cascade
);
create unique index recipe_ingredients_unique_item on public.recipe_ingredients (recipe_id, lower(trim(item)));
create index recipe_ingredients_recipe_household_idx on public.recipe_ingredients (recipe_id, household_id);
create index recipe_ingredients_household_idx on public.recipe_ingredients (household_id);
create index recipes_household_active_idx on public.recipes (household_id, updated_at desc) where deleted_at is null;
create index recipes_created_by_idx on public.recipes (created_by);
create index recipes_deleted_by_idx on public.recipes (deleted_by) where deleted_by is not null;

create table public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  recipe_id uuid not null,
  status text not null default 'ready' check (status in ('ready', 'cooked', 'skipped')),
  added_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  resolved_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (recipe_id, household_id) references public.recipes(id, household_id) on delete cascade,
  check (
    (status = 'ready' and resolved_at is null and resolved_by is null)
    or (status in ('cooked', 'skipped') and resolved_at is not null)
  )
);
create index roster_household_status_idx on public.roster_entries (household_id, status, added_at desc);
create index roster_recent_cooked_idx on public.roster_entries (household_id, resolved_at desc) where status = 'cooked';
create index roster_recipe_household_idx on public.roster_entries (recipe_id, household_id);
create index roster_added_by_idx on public.roster_entries (added_by);
create index roster_resolved_by_idx on public.roster_entries (resolved_by) where resolved_by is not null;

create table public.shopping_queue (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  recipe_id uuid not null,
  added_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  added_at timestamptz not null default now(),
  foreign key (recipe_id, household_id) references public.recipes(id, household_id) on delete cascade,
  unique (household_id, recipe_id)
);
create index shopping_queue_household_idx on public.shopping_queue (household_id, added_at);
create index shopping_queue_recipe_household_idx on public.shopping_queue (recipe_id, household_id);
create index shopping_queue_added_by_idx on public.shopping_queue (added_by);

-- Small private authorization helpers avoid recursive policies on household_members.
create function private.is_household_member(target_household_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.household_members hm
    where hm.household_id = target_household_id and hm.user_id = (select auth.uid())
  );
$$;
create function private.is_household_owner(target_household_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.households h
    where h.id = target_household_id and h.owner_id = (select auth.uid())
  );
$$;
revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.is_household_owner(uuid) from public;
grant execute on function private.is_household_member(uuid), private.is_household_owner(uuid) to authenticated, service_role;

create function private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function private.touch_updated_at() from public;
create trigger households_touch_updated_at before update on public.households for each row execute function private.touch_updated_at();
create trigger recipes_touch_updated_at before update on public.recipes for each row execute function private.touch_updated_at();
create trigger roster_touch_updated_at before update on public.roster_entries for each row execute function private.touch_updated_at();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.roster_entries enable row level security;
alter table public.shopping_queue enable row level security;

create policy "members can view households" on public.households for select to authenticated
using (owner_id = (select auth.uid()) or (select private.is_household_member(id)));
create policy "users can create households" on public.households for insert to authenticated
with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "owners can update households" on public.households for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "members can view membership" on public.household_members for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "owners can add membership" on public.household_members for insert to authenticated
with check (user_id = (select auth.uid()) and (select private.is_household_owner(household_id)));
create policy "members can update their profile" on public.household_members for update to authenticated
using ((select private.is_household_member(household_id)) and user_id = (select auth.uid()))
with check ((select private.is_household_member(household_id)) and user_id = (select auth.uid()));

create policy "members can view recipes" on public.recipes for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "members can add recipes" on public.recipes for insert to authenticated
with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
create policy "members can update recipes" on public.recipes for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)) and (deleted_by is null or deleted_by = (select auth.uid())));

create policy "members can view ingredients" on public.recipe_ingredients for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "members can add ingredients" on public.recipe_ingredients for insert to authenticated
with check ((select private.is_household_member(household_id)));
create policy "members can update ingredients" on public.recipe_ingredients for update to authenticated
using ((select private.is_household_member(household_id))) with check ((select private.is_household_member(household_id)));
create policy "members can remove ingredients" on public.recipe_ingredients for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy "members can view roster" on public.roster_entries for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "members can add roster entries" on public.roster_entries for insert to authenticated
with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy "members can update roster entries" on public.roster_entries for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)) and (resolved_by is null or resolved_by = (select auth.uid())));

create policy "members can view shopping queue" on public.shopping_queue for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "members can add to shopping queue" on public.shopping_queue for insert to authenticated
with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy "members can remove from shopping queue" on public.shopping_queue for delete to authenticated
using ((select private.is_household_member(household_id)));

-- RPC used only for joining by a secret code. It checks auth.uid and is not public/anon executable.
create function public.join_household(p_invite_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid; caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  select h.id into target_id from public.households h where h.invite_code = upper(trim(p_invite_code));
  if target_id is null then raise exception 'Invalid household code'; end if;
  insert into public.household_members (household_id, user_id, display_name)
  values (target_id, caller_id, nullif(trim(p_display_name), ''))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return target_id;
end;
$$;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.join_household(text, text) to authenticated, service_role;

-- One transaction moves the completed shopping batch into the current roster.
create function public.complete_shopping(p_household_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare caller_id uuid := (select auth.uid()); moved_count integer;
begin
  if caller_id is null or not (select private.is_household_member(p_household_id)) then
    raise exception 'Not authorized for this household';
  end if;
  with moved as (
    insert into public.roster_entries (household_id, recipe_id, added_by)
    select sq.household_id, sq.recipe_id, caller_id
    from public.shopping_queue sq
    join public.recipes r on r.id = sq.recipe_id and r.household_id = sq.household_id
    where sq.household_id = p_household_id and r.deleted_at is null
    returning 1
  ) select count(*) into moved_count from moved;
  delete from public.shopping_queue where household_id = p_household_id;
  return moved_count;
end;
$$;
revoke all on function public.complete_shopping(uuid) from public, anon;
grant execute on function public.complete_shopping(uuid) to authenticated, service_role;

revoke all on public.households, public.household_members, public.recipes,
  public.recipe_ingredients, public.roster_entries, public.shopping_queue from anon;
grant select, insert on public.households to authenticated;
grant update (name, updated_at) on public.households to authenticated;
grant select, insert on public.household_members to authenticated;
grant update (display_name) on public.household_members to authenticated;
grant select, insert on public.recipes to authenticated;
grant update (title, notes, source_url, deleted_at, deleted_by, updated_at) on public.recipes to authenticated;
grant select, insert, update, delete on public.recipe_ingredients to authenticated;
grant select, insert on public.roster_entries to authenticated;
grant update (status, resolved_by, resolved_at, updated_at) on public.roster_entries to authenticated;
grant select, insert, delete on public.shopping_queue to authenticated;

alter publication supabase_realtime add table public.households, public.household_members,
  public.recipes, public.recipe_ingredients, public.roster_entries, public.shopping_queue;

-- Official Supabase pattern: automatically enable RLS on future public tables.
create function private.rls_auto_enable()
returns event_trigger language plpgsql security definer set search_path = pg_catalog as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;
revoke all on function private.rls_auto_enable() from public, anon, authenticated;
drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function private.rls_auto_enable();
