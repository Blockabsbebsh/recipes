-- Compound recipe changes must commit as a unit and stale editors must not win.
begin;
select t.seed();
-- Make the fixture version older than this transaction. now() is otherwise
-- stable for the whole test and would make two edits look simultaneous.
alter table public.recipes disable trigger recipes_touch_updated_at;
update public.recipes
   set updated_at = clock_timestamp() - interval '1 second'
 where id = '00000000-0000-4000-8000-00000000c001';
alter table public.recipes enable trigger recipes_touch_updated_at;
select t.acting_as(t.ana());

select updated_at as original_updated_at
  from public.recipes
 where id = '00000000-0000-4000-8000-00000000c001'
\gset

select public.save_recipe(
  t.kitchen(),
  '00000000-0000-4000-8000-00000000c001',
  :'original_updated_at',
  'Atnaujinta sriuba',
  'Pastaba',
  null,
  array['Pomidorai', 'Svogūnai'],
  array['Tipas: Sriubos', 'Virtuvė: Lietuvių'],
  true
);

select t.eq(
  (select title from public.recipes where id = '00000000-0000-4000-8000-00000000c001'),
  'Atnaujinta sriuba',
  'the transactional writer updates the recipe');
select t.eq(
  (select count(*)::int from public.recipe_ingredients where recipe_id = '00000000-0000-4000-8000-00000000c001'),
  2,
  'the transactional writer replaces all ingredient links');
select t.eq(
  (select count(*)::int from public.recipe_tags where recipe_id = '00000000-0000-4000-8000-00000000c001'),
  2,
  'the transactional writer replaces recipe classifications');
select t.eq(
  (select count(*)::int from public.shopping_queue where recipe_id = '00000000-0000-4000-8000-00000000c001'),
  1,
  'the optional basket row is in the same write');

select t.refused_saying(
  format(
    'select public.save_recipe(%L, %L, %L, %L, null, null, %L::text[], %L::text[], false)',
    t.kitchen(),
    '00000000-0000-4000-8000-00000000c001',
    :'original_updated_at',
    'Stale title',
    '{}',
    '{}'
  ),
  'changed since',
  'a stale editor overwriting a newer recipe');
select t.eq(
  (select title from public.recipes where id = '00000000-0000-4000-8000-00000000c001'),
  'Atnaujinta sriuba',
  'the rejected stale edit changes nothing');

select updated_at as current_updated_at
  from public.recipes
 where id = '00000000-0000-4000-8000-00000000c001'
\gset

select t.refused(
  format(
    'select public.save_recipe(%L, %L, %L, %L, null, null, array[%L], %L::text[], false)',
    t.kitchen(),
    '00000000-0000-4000-8000-00000000c001',
    :'current_updated_at',
    'Must roll back',
    repeat('x', 121),
    '{}'
  ),
  'an invalid ingredient after the recipe row was updated');
select t.eq(
  (select title from public.recipes where id = '00000000-0000-4000-8000-00000000c001'),
  'Atnaujinta sriuba',
  'a later ingredient failure rolls the recipe update back');
select t.eq(
  (select count(*)::int from public.recipe_ingredients where recipe_id = '00000000-0000-4000-8000-00000000c001'),
  2,
  'a failed save preserves the previous ingredient links');

select t.refused(
  format(
    'select public.save_recipe(%L, null, null, %L, null, null, %L::text[], %L::text[], false)',
    t.other(),
    'Intrusion',
    '{}',
    '{}'
  ),
  'a member writing into another household');

select public.save_recipes_import(
  t.kitchen(),
  jsonb_build_array(
    jsonb_build_object(
      'title', 'Importas vienas',
      'ingredients', jsonb_build_array('Ryžiai'),
      'tags', jsonb_build_array('Tipas: Kita', 'Virtuvė: Tarptautinė')
    ),
    jsonb_build_object(
      'title', 'Importas du',
      'ingredients', jsonb_build_array('Pupelės'),
      'tags', jsonb_build_array('Tipas: Troškiniai ir kariai', 'Virtuvė: Tarptautinė')
    )
  )
);
select t.eq(
  (select count(*)::int from public.recipes where title like 'Importas %'),
  2,
  'a valid bulk import writes every recipe');

select t.refused(
  format(
    'select public.save_recipes_import(%L, %L::jsonb)',
    t.kitchen(),
    jsonb_build_array(
      jsonb_build_object('title', 'Rollback one', 'ingredients', jsonb_build_array('Morkos'), 'tags', '[]'::jsonb),
      jsonb_build_object('title', repeat('x', 161), 'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb)
    )::text
  ),
  'an invalid recipe halfway through an import');
select t.eq(
  (select count(*)::int from public.recipes where title = 'Rollback one'),
  0,
  'a failed bulk import rolls its earlier recipes back');

rollback;
