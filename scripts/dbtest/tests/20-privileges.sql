-- The verbs row security never sees, and the columns the client must not write.
--
-- TRUNCATE is the reason this file exists: Postgres does not consult row
-- policies for it, so a grant that looked harmless let any signed-in account
-- empty every household's recipes, not merely its own.
begin;
select t.seed();

select t.acting_as(t.ana());
select t.refused('truncate public.recipes', 'a signed-in account truncating recipes');
select t.refused('truncate public.households', 'a signed-in account truncating households');
select t.refused('truncate public.household_members', 'a signed-in account truncating the roster of members');
select t.refused('truncate public.shopping_queue', 'a signed-in account truncating the basket');

-- Invite codes are the database's to issue. A client that could write one
-- could hold a code still for ever and opt out of rotation.
select t.refused(
  format('update public.households set invite_code = %L where id = %L', 'AAAAAAAAAAAA', t.kitchen()),
  'a member rewriting their household''s invite code');
select t.refused(
  format('update public.households set invite_code_set_at = now() - interval ''1 day'' where id = %L', t.kitchen()),
  'a member backdating when the code was issued');
select t.allowed(
  format('update public.households set name = %L where id = %L', 'Nauja virtuvė', t.kitchen()),
  'a member renaming their own household');

-- Five households, not unlimited. They are private to their owner, so this was
-- never exposure — only a way to fill a free-tier disk.
select t.allowed(format('insert into public.households (name, owner_id) select ''Virtuvė '' || g, %L from generate_series(2, 5) g', t.ana()),
                 'an owner keeping a second kitchen');
select t.refused_saying(
  format('insert into public.households (name, owner_id) values (%L, %L)', 'Šeštoji', t.ana()),
  'row-level security|policy',
  'a sixth household from one account');

-- Text with no ceiling is the cheapest way to fill a database. The title is
-- caught by the tighter constraint the schema always had — the 200-character
-- one added later is belt to that pair of braces — so what is asserted is that
-- it is refused, not which constraint says so.
select t.refused_saying(
  format('insert into public.recipes (household_id, title, created_by) values (%L, repeat(''x'', 201), %L)', t.kitchen(), t.ana()),
  'check constraint',
  'a 201-character recipe title');
-- Notes had no ceiling at all until the hardening migration, so this one is
-- the only thing standing between a loop and the disk.
select t.refused_saying(
  format('insert into public.recipes (household_id, title, notes, created_by) values (%L, ''Ok'', repeat(''x'', 20001), %L)', t.kitchen(), t.ana()),
  'recipes_notes_length',
  'a 20001-character note');
select t.allowed(
  format('insert into public.recipes (household_id, title, notes, created_by) values (%L, ''Ok'', repeat(''x'', 20000), %L)', t.kitchen(), t.ana()),
  'a note right on the limit');

-- The private helpers are the database's own machinery.
select t.refused('select private.rotate_stale_invite_codes()', 'a client rotating invite codes by hand');
select t.refused('select private.new_invite_code()', 'a client minting an invite code');
select t.refused('select * from private.join_attempts', 'a client reading who has been trying to join');
select t.allowed('select private.own_household_count()', 'the policy helper a client''s own insert needs');

-- The whole table-level picture, spelled out.
--
-- A column grant does nothing while a table-level grant is still standing:
-- table-level UPDATE covers every column, and revoking a column privilege does
-- not subtract from it. Supabase's bootstrap grants the client roles everything
-- on `public`, so every carefully worded column grant in this project was
-- decoration until that blanket was taken away. Listing the result in full is
-- the only way that stays true — a single table quietly regaining UPDATE is
-- invisible in any check narrower than this one.
reset role;
select t.eq(
  (select array_agg(c.relname || ': ' || privs order by c.relname) from (
     select c.oid, c.relname, string_agg(distinct a.privilege_type, ',' order by a.privilege_type) as privs
       from pg_class c, aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and a.grantee = 'authenticated'::regrole
      group by c.oid, c.relname) c),
  array[
    'barbora_categories: SELECT',
    'household_members: INSERT,SELECT',
    'households: INSERT,SELECT',
    'ingredients: DELETE,INSERT,SELECT',
    'recipe_ingredients: DELETE,INSERT,SELECT,UPDATE',
    'recipe_tags: DELETE,INSERT,SELECT',
    'recipes: INSERT,SELECT',
    'roster_entries: INSERT,SELECT',
    'shopping_queue: DELETE,INSERT,SELECT',
    'tags: DELETE,INSERT,SELECT'
  ],
  'a signed-in client holds exactly these table-level privileges and no others');
select t.eq(
  (select count(*)::int from pg_class c, aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace and a.grantee = 'anon'::regrole),
  0, 'and the signed-out key holds nothing at all');

-- A table added later used to inherit the blanket grant. It now starts closed.
create table public.something_new (id uuid primary key default gen_random_uuid(), household_id uuid);
select t.eq(has_table_privilege('authenticated', 'public.something_new', 'TRUNCATE'), false,
            'a table added later does not hand TRUNCATE back to clients');
select t.eq(has_table_privilege('authenticated', 'public.something_new', 'SELECT'), false,
            'nor anything else until a migration says so');
select t.eq((select relrowsecurity from pg_class where oid = 'public.something_new'::regclass), true,
            'and row security is on from the moment it exists');

-- PostgreSQL will not let a default privilege take EXECUTE away from PUBLIC.
-- `alter default privileges ... revoke execute on functions from public`
-- records nothing at all, and a function created afterwards still arrives with
-- `=X/` — PUBLIC's built-in grant — in its ACL. Confirmed on 16.13 six ways:
-- with and without a prior grant in the row, with `revoke all` instead of
-- `revoke execute`, and with the revoke issued both before and after a grant.
-- Only an event trigger can actually close it, and one that errors would break
-- every CREATE FUNCTION on the platform, including Supabase's own.
--
-- So "private by default" is not something this database offers, and the
-- migration no longer pretends to buy it. What is enforceable is "nothing is
-- left open", checked here over every function that really exists — a stronger
-- test than the old one, because it fails on a function somebody forgot rather
-- than on a hypothetical future one.
select t.eq(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
  0,
  'no function in public is executable by everyone');

-- Nothing in this app is meant to be callable before you sign in: even
-- `join_household`, the one function a non-member calls, needs an account.
select t.eq(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'no function in public is executable by signed-out clients');

-- And the mechanism a migration has to use instead, end to end.
create function public.default_privilege_probe_postgres()
returns text language sql as $$ select 'postgres'::text $$;
-- PUBLIC is only one of the four. Supabase's own bootstrap grants EXECUTE to
-- anon, authenticated and service_role explicitly through default privileges,
-- so a migration that revokes from PUBLIC alone leaves the function wide open
-- to every signed-out client. All four, every time.
revoke all on function public.default_privilege_probe_postgres()
  from public, anon, authenticated, service_role;

select t.eq(has_function_privilege('anon', 'public.default_privilege_probe_postgres()', 'EXECUTE'), false,
            'a function its migration locked down is not executable by signed-out clients');
select t.eq(has_function_privilege('authenticated', 'public.default_privilege_probe_postgres()', 'EXECUTE'), false,
            'nor by signed-in clients');
select t.eq(has_function_privilege('service_role', 'public.default_privilege_probe_postgres()', 'EXECUTE'), false,
            'nor implicitly by the service role');

grant execute on function public.default_privilege_probe_postgres() to authenticated;
select t.eq(has_function_privilege('authenticated', 'public.default_privilege_probe_postgres()', 'EXECUTE'), true,
            'until an explicit grant says so');
select t.eq(has_function_privilege('anon', 'public.default_privilege_probe_postgres()', 'EXECUTE'), false,
            'and that grant does not reach signed-out clients');
rollback;
