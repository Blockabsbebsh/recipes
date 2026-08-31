-- Keep the vocabulary Lithuanian, and resolve the entries that were never a
-- single ingredient to begin with.

insert into public.ingredients (household_id, name, section, food_type)
select h.id, 'Kario prieskoniai', 'Spices', 'Herbs & spices' from public.households h
on conflict do nothing;

-- The orzo line lost a comma on import and holds two foods. Give the second
-- one its own row before the first is renamed.
insert into public.recipe_ingredients (household_id, recipe_id, ingredient_id, position)
select t.household_id, t.recipe_id, canon.id,
  (select coalesce(max(r2.position), 0) + 1 from public.recipe_ingredients r2 where r2.recipe_id = t.recipe_id)
from (
  select ri.recipe_id, ri.household_id
  from public.recipe_ingredients ri
  join public.ingredients i on i.id = ri.ingredient_id
  where i.name = 'orzo(mini makaronai kiti) vyšniniai pomidorai'
) t
join public.ingredients canon on canon.household_id = t.household_id and canon.name = 'Vyšniniai pomidorai'
on conflict do nothing;

-- "X arba Y" is a choice the shopping list cannot act on. Keep the one that is
-- actually bought; the alternative belongs in the recipe notes.
with mapping as (
  select old.id as old_id, canon.id as canon_id, canon.name as canon_name
  from (values
    ('orzo(mini makaronai kiti) vyšniniai pomidorai', 'Orzo'),
    ('augalinė grietinėlė arba mielių dribsniai', 'Augalinė grietinėlė'),
    ('sūris arba augalinis sūris', 'Augalinis sūris'),
    ('japoniškas curry roux / kario prieskoniai', 'Kario prieskoniai'),
    ('Coconut aminos', 'Sojų padažas')
  ) as m(old_name, canon_name)
  join public.ingredients old on old.name = m.old_name
  join public.ingredients canon on canon.name = m.canon_name and canon.household_id = old.household_id
)
update public.recipe_ingredients ri
set ingredient_id = m.canon_id, item = m.canon_name
from mapping m
where ri.ingredient_id = m.old_id;

-- The restrict foreign key means anything still in use survives this.
delete from public.ingredients i
where i.name in (
  'orzo(mini makaronai kiti) vyšniniai pomidorai',
  'augalinė grietinėlė arba mielių dribsniai',
  'sūris arba augalinis sūris',
  'japoniškas curry roux / kario prieskoniai',
  'Coconut aminos', 'Curry roux', 'Garam masala', 'Halloumi', 'Miso pasta',
  'Sriracha', 'Tahini', 'Tamari', 'Fusilli', 'Penne', 'Polenta',
  'Naan duona', 'Soba makaronai', 'Udon makaronai'
)
and not exists (select 1 from public.recipe_ingredients ri where ri.ingredient_id = i.id);
