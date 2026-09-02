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

-- A table added later inherits the same grants, which is how the TRUNCATE hole
-- would come back without the default-privileges line.
reset role;
create table public.something_new (id uuid primary key default gen_random_uuid(), household_id uuid);
select t.eq(has_table_privilege('authenticated', 'public.something_new', 'TRUNCATE'), false,
            'a table added later does not hand TRUNCATE back to clients');
select t.eq(has_table_privilege('authenticated', 'public.something_new', 'TRIGGER'), false,
            'nor the right to attach a trigger to it');
select t.eq((select relrowsecurity from pg_class where oid = 'public.something_new'::regclass), true,
            'and row security is on from the moment it exists');
rollback;
