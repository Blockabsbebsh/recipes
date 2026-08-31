-- Fold the vocabulary the importer produced into the seeded canonical forms.
-- Recipes were written in whatever case the source list used, so the same food
-- appeared as "svogūnas" in one recipe and would have appeared as "Svogūnai"
-- in the next.

update public.ingredients i
set name = v.canonical, section = v.section, food_type = v.food_type
from (values
  ('ryžiai','Ryžiai','Pantry','Grains'),
  ('tofu','Tofu','Dairy & alternatives','Legumes'),
  ('alyvuogių aliejus','Alyvuogių aliejus','Pantry','Oils & condiments'),
  ('avinžirniai','Avinžirniai','Pantry','Legumes'),
  ('baltosios pupelės','Baltosios pupelės','Pantry','Legumes'),
  ('bazilikas','Bazilikas','Produce','Herbs & spices'),
  ('bulvės','Bulvės','Produce','Vegetables'),
  ('gochujang','Gochujang','Pantry','Oils & condiments'),
  ('juodosios pupelės','Juodosios pupelės','Pantry','Legumes'),
  ('konservuoti pomidorai','Konservuoti pomidorai','Pantry','Oils & condiments'),
  ('kukurūzai','Kukurūzai','Produce','Vegetables'),
  ('kuminas','Kuminas','Spices','Herbs & spices'),
  ('makaronai','Makaronai','Pantry','Pasta'),
  ('panko džiūvėsėliai','Panko džiūvėsėliai','Pantry','Grains'),
  ('pomidorai','Pomidorai','Produce','Vegetables'),
  ('rozmarinas','Rozmarinas','Produce','Herbs & spices'),
  ('rūkyta paprika','Rūkyta paprika','Spices','Herbs & spices'),
  ('sezamai','Sezamai','Pantry','Nuts & seeds'),
  ('sezamų aliejus','Sezamų aliejus','Pantry','Oils & condiments'),
  ('sojų padažas','Sojų padažas','Pantry','Oils & condiments'),
  ('tortilijos','Tortilijos','Bakery','Grains'),
  ('žali svogūnai','Žali svogūnai','Produce','Vegetables')
) as v(variant, canonical, section, food_type)
where lower(trim(i.name)) = v.variant;

-- Declension variants point at the seeded entry instead. The seeded entries are
-- unused at this point, so no recipe can end up holding both sides of a merge.
with merges as (
  select variant.id as variant_id, canon.id as canon_id, canon.name as canon_name
  from (values
    ('česnakas','česnakai'),
    ('svogūnas','svogūnai'),
    ('agurkas','agurkai'),
    ('citrina','citrinos'),
    ('cukinija','cukinijos'),
    ('morka','morkos'),
    ('paprika','paprikos'),
    ('sultinys','daržovių sultinys')
  ) as m(variant_name, canon_name)
  join public.ingredients variant on lower(trim(variant.name)) = m.variant_name
  join public.ingredients canon on lower(trim(canon.name)) = m.canon_name
)
update public.recipe_ingredients ri
set ingredient_id = m.canon_id, item = m.canon_name
from merges m
where ri.ingredient_id = m.variant_id;

delete from public.ingredients i
where lower(trim(i.name)) in
  ('česnakas','svogūnas','agurkas','citrina','cukinija','morka','paprika','sultinys')
  and not exists (select 1 from public.recipe_ingredients ri where ri.ingredient_id = i.id);

update public.recipe_ingredients ri
set item = i.name
from public.ingredients i
where ri.ingredient_id = i.id and ri.item is distinct from i.name;
