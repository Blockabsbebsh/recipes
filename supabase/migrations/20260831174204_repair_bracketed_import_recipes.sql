-- One-time repair of two rows imported before the parser understood brackets.
-- Both recipes had their whole line stored as the title and no ingredients.
-- The recipe ids are deliberately literal: this migration repairs specific
-- rows in this database and is not meant to generalise.

insert into public.ingredients (household_id, name, section, food_type)
select h.id, 'Sojų faršas', 'Pantry', 'Legumes' from public.households h
on conflict do nothing;

update public.recipes
set title = 'Gyozos'
where id = '270db6ae-ee21-4a2a-9d87-db31bcd2a3aa';

update public.recipes
set title = 'Lęšių sriuba',
    notes = coalesce(nullif(trim(notes), ''), 'turiu recepta visa')
where id = '8960d5c3-3e3f-45b0-8151-4ddebf657476';

insert into public.recipe_ingredients (household_id, recipe_id, ingredient_id, position)
select r.household_id, r.id, i.id, v.position
from public.recipes r
join (values
  ('270db6ae-ee21-4a2a-9d87-db31bcd2a3aa'::uuid, 'Grybai', 0),
  ('270db6ae-ee21-4a2a-9d87-db31bcd2a3aa'::uuid, 'Miltai', 1),
  ('270db6ae-ee21-4a2a-9d87-db31bcd2a3aa'::uuid, 'Sojų faršas', 2),
  ('270db6ae-ee21-4a2a-9d87-db31bcd2a3aa'::uuid, 'Sojų padažas', 3),
  ('270db6ae-ee21-4a2a-9d87-db31bcd2a3aa'::uuid, 'Kopūstai', 4),
  ('8960d5c3-3e3f-45b0-8151-4ddebf657476'::uuid, 'Žiediniai kopūstai', 0),
  ('8960d5c3-3e3f-45b0-8151-4ddebf657476'::uuid, 'Konservuoti pomidorai', 1),
  ('8960d5c3-3e3f-45b0-8151-4ddebf657476'::uuid, 'Kokosų kremas', 2),
  ('8960d5c3-3e3f-45b0-8151-4ddebf657476'::uuid, 'Coconut aminos', 3)
) as v(recipe_id, ingredient_name, position) on v.recipe_id = r.id
join public.ingredients i on i.household_id = r.household_id and i.name = v.ingredient_name
on conflict do nothing;
