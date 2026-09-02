-- The ceilings on how much one household can hold.
--
-- Through the app these are unreachable — you would be tapping "add" for a
-- week — but a session token works against PostgREST directly, and the
-- realistic case is not malice: it is an import that goes wrong, or a script
-- run twice.
--
-- Two of them are checked by filling a household up to the line and stepping
-- over it. The rest would mean inserting fifty thousand rows to prove the same
-- mechanism, so those are checked by asking what ceiling their trigger was
-- given — which is the number, and is what a careless edit would change.
begin;
select t.seed();

-- Fifty members. Real households have two.
insert into auth.users (id, email)
  select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, g || '@example.com'
  from generate_series(1, 60) g;
insert into public.household_members (household_id, user_id)
  select t.kitchen(), ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid
  from generate_series(1, 48) g;
select t.eq((select count(*)::int from public.household_members where household_id = t.kitchen()), 50,
            'the household is now full at fifty');
select t.refused_saying(
  format('insert into public.household_members (household_id, user_id) values (%L, %L)',
         t.kitchen(), '00000000-0000-4000-8000-000000000049'),
  'pasiekė ribą',
  'a fifty-first member');
-- And the ceiling is per household, not across the database.
select t.allowed(
  format('insert into public.household_members (household_id, user_id) values (%L, %L)',
         t.other(), '00000000-0000-4000-8000-000000000049'),
  'a member joining a different household that is not full');

-- Five hundred lines in one recipe. A single recipe fills a database as well
-- as a million recipes do, and the cap on `recipes` would never see it.
insert into public.recipe_ingredients (household_id, recipe_id, item, position)
  select t.kitchen(), '00000000-0000-4000-8000-00000000c001', 'druska ' || g, g
  from generate_series(1, 500) g;
select t.refused_saying(
  format('insert into public.recipe_ingredients (household_id, recipe_id, item) values (%L, %L, ''dar druskos'')',
         t.kitchen(), '00000000-0000-4000-8000-00000000c001'),
  '500 ingredientų',
  'a five hundred and first ingredient');
select t.allowed(
  format('insert into public.recipe_ingredients (household_id, recipe_id, item) values (%L, %L, ''druska'')',
         t.other(), '00000000-0000-4000-8000-00000000c002'),
  'an ingredient on a different recipe');

-- The ceilings that are too large to reach in a test, read off the triggers
-- that carry them. A cap is a number, and this is the number.
select t.eq(
  (select array_agg(c.relname || '=' || encode(tg.tgargs, 'escape') order by c.relname)
     from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where tg.tgfoid = 'private.enforce_household_row_cap'::regproc),
  array[
    'household_members=50\000', 'ingredients=5000\000', 'recipe_tags=50000\000',
    'recipes=10000\000', 'roster_entries=50000\000', 'shopping_queue=2000\000', 'tags=1000\000'
  ],
  'every household-scoped table carries its ceiling');
rollback;
