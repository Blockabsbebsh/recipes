-- The eight recipes that predate the tag table.
insert into public.recipe_tags (household_id, recipe_id, tag_id)
select r.household_id, r.id, t.id
from (values
  ('Pasta e ceci','Makaronai'),
  ('Orzo su keptais pomidorais, cukinija ir baltosiomis pupelėmis','Makaronai'),
  ('Enchiladas su juodosiomis pupelėmis','Ankštiniai'),
  ('Japoniškas tofu katsu curry','Troškiniai'),
  ('Gyozos','Soja'),
  ('Lęšių sriuba','Sriubos'),
  ('Gochujang tofu su ryžiais ir agurkų salotom','Ryžiai')
) as v(title, tag)
join public.recipes r on lower(trim(r.title)) = lower(trim(v.title))
join public.tags t on t.household_id = r.household_id and t.name = v.tag
on conflict do nothing;
