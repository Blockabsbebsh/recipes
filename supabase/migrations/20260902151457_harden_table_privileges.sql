-- TRUNCATE is not subject to row security.
--
-- Every household table granted TRUNCATE to `authenticated`, and Postgres does
-- not check row policies for it: a signed-in account could have emptied
-- `recipes` for every household in the database, not merely its own. Sign-up is
-- open and the publishable key is in a public repository, so "a signed-in
-- account" means anybody at all. RLS was doing its job on every other verb and
-- was never consulted for this one.
--
-- TRIGGER goes with it — the right to attach a trigger to a shared table is the
-- right to run code when someone else writes to it — and REFERENCES, which the
-- app has never needed.

revoke truncate, trigger, references on all tables in schema public from authenticated, anon;

-- And for tables added later, which would otherwise inherit the same grant.
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated, anon;

-- Invite codes are generated and rotated by the database. The app has never
-- written either column, and letting a client choose its own code would make
-- rotation something the household could opt out of by holding one still.
revoke insert (invite_code, invite_code_set_at), update (invite_code, invite_code_set_at)
  on public.households from authenticated, anon;

/**
 * How many households this account already owns.
 *
 * A counting function rather than a subquery in the policy, because a policy on
 * `households` that reads `households` recurses. Takes no argument, so it can
 * only ever answer for the caller.
 */
create or replace function private.own_household_count()
returns integer language sql security definer stable set search_path = '' as $$
  select count(*)::integer from public.households h where h.owner_id = (select auth.uid());
$$;
revoke all on function private.own_household_count() from public, anon;
grant execute on function private.own_household_count() to authenticated;

-- Nothing stopped an account creating households without end. They are private
-- to their owner, so this was never exposure — only a way to fill the disk.
-- Five rather than one: a person may reasonably keep a second kitchen.
drop policy if exists "users can create households" on public.households;
create policy "users can create households" on public.households
  for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and owner_id = (select auth.uid())
    and (select private.own_household_count()) < 5
  );

-- Text with no ceiling is the cheapest way to fill a free-tier database. The
-- longest of anything real is a 190-character note.
alter table public.recipes
  add constraint recipes_title_length check (length(title) <= 200),
  add constraint recipes_notes_length check (notes is null or length(notes) <= 20000),
  add constraint recipes_source_url_length check (source_url is null or length(source_url) <= 2000);
alter table public.ingredients
  add constraint ingredients_name_length check (length(name) <= 200);
alter table public.recipe_ingredients
  add constraint recipe_ingredients_item_length check (item is null or length(item) <= 200);
alter table public.tags
  add constraint tags_name_length check (length(name) <= 120);
alter table public.households
  add constraint households_name_length check (length(name) <= 120);
alter table public.household_members
  add constraint household_members_display_name_length check (display_name is null or length(display_name) <= 120);
