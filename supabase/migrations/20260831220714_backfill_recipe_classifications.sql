-- Classification tags use the existing household-scoped tags relation.
-- The prefixes keep the two axes machine-readable while the app presents
-- friendly labels: dish type drives library groups; cuisine is an extra tag.

with classification_names(name) as (
  values
    ('Tipas: Pusryčiai'),
    ('Tipas: Sriubos'),
    ('Tipas: Troškiniai ir kariai'),
    ('Tipas: Makaronai'),
    ('Tipas: Salotos'),
    ('Tipas: Ryžių ir kruopų patiekalai'),
    ('Tipas: Bulvių patiekalai'),
    ('Tipas: Sumuštiniai ir kebabai'),
    ('Tipas: Užkandžiai'),
    ('Tipas: Kepiniai ir picos'),
    ('Tipas: Desertai'),
    ('Tipas: Kita'),
    ('Virtuvė: Italų'),
    ('Virtuvė: Meksikiečių'),
    ('Virtuvė: Indų'),
    ('Virtuvė: Tailando'),
    ('Virtuvė: Japonų'),
    ('Virtuvė: Korėjiečių'),
    ('Virtuvė: Graikų'),
    ('Virtuvė: Artimųjų Rytų'),
    ('Virtuvė: Lietuvių'),
    ('Virtuvė: Prancūzų'),
    ('Virtuvė: Ispanų'),
    ('Virtuvė: Marokiečių'),
    ('Virtuvė: Švedų'),
    ('Virtuvė: Tarptautinė')
)
insert into public.tags (household_id, name)
select h.id, cn.name
from public.households h
cross join classification_names cn
where not exists (
  select 1
  from public.tags t
  where t.household_id = h.id
    and lower(trim(t.name)) = lower(trim(cn.name))
);

with classified as (
  select
    r.id as recipe_id,
    r.household_id,
    case
      when lower(r.title) ~ '(pusry|aviž|blynel|blynai|scramble|shakshuka|košė|puding)' then 'Pusryčiai'
      when lower(r.title) ~ '(sriub|ramen|minestrone|šaltibar)' then 'Sriubos'
      when lower(r.title) ~ '(troškin|karis|curry|tagin|chili|čili)' then 'Troškiniai ir kariai'
      when lower(r.title) ~ '(makaron|pasta|spage|lazan|lasagn|gnocchi|orzo)' then 'Makaronai'
      when lower(r.title) ~ '(salot|tabbouleh|panzanella)' then 'Salotos'
      when lower(r.title) ~ '(ryži|risotto|paella|polenta|griki|kuskus|quinoa|bolivin)' then 'Ryžių ir kruopų patiekalai'
      when lower(r.title) ~ '(bulv|kugelis)' then 'Bulvių patiekalai'
      when lower(r.title) ~ '(sumušt|kebab|gyros|burger|taco|burrito|wrap)' then 'Sumuštiniai ir kebabai'
      when lower(r.title) ~ '(humus|falafel|užkand|dip|gyoza)' then 'Užkandžiai'
      when lower(r.title) ~ '(pica|pizza|pyrag|quiche|tart)' then 'Kepiniai ir picos'
      when lower(r.title) ~ '(desert|tort|sausain|brownie|ledai)' then 'Desertai'
      else 'Kita'
    end as dish_type,
    case
      when lower(r.title) ~ '(pasta|spage|lazan|lasagn|risotto|gnocchi|orzo|panzanella|pesto|polenta|ceci|pizza|pica)' then 'Italų'
      when lower(r.title) ~ '(meksik|enchilada|taco|burrito|quesadilla)' then 'Meksikiečių'
      when lower(r.title) ~ '(indišk|tikka masala|dal |dhal)' then 'Indų'
      when lower(r.title) ~ '(tailand|pad thai)' then 'Tailando'
      when lower(r.title) ~ '(japon|ramen|gyoza|katsu|sushi)' then 'Japonų'
      when lower(r.title) ~ '(korėj|gochujang|kimchi)' then 'Korėjiečių'
      when lower(r.title) ~ '(graik|gyros|tzatziki)' then 'Graikų'
      when lower(r.title) ~ '(falafel|humus|tahini|shakshuka|tabbouleh)' then 'Artimųjų Rytų'
      when lower(r.title) ~ '(lietuvi|kugelis|šaltibar|cepelin|bulviniai blynai)' then 'Lietuvių'
      when lower(r.title) ~ '(prancūz|bourguignon)' then 'Prancūzų'
      when lower(r.title) ~ '(ispan|paella)' then 'Ispanų'
      when lower(r.title) ~ '(marok|tagin)' then 'Marokiečių'
      when lower(r.title) ~ '(šved)' then 'Švedų'
      else 'Tarptautinė'
    end as cuisine
  from public.recipes r
  where r.deleted_at is null
), desired_tags as (
  select recipe_id, household_id, 'Tipas: ' || dish_type as tag_name from classified
  union all
  select recipe_id, household_id, 'Virtuvė: ' || cuisine as tag_name from classified
)
insert into public.recipe_tags (household_id, recipe_id, tag_id)
select d.household_id, d.recipe_id, t.id
from desired_tags d
join public.tags t
  on t.household_id = d.household_id
 and lower(trim(t.name)) = lower(trim(d.tag_name))
on conflict (recipe_id, tag_id) do nothing;
