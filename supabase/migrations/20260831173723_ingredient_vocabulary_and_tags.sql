-- Promote ingredients from free text on a recipe to a household vocabulary,
-- and give recipes editable tags.
--
-- The backfill here is deliberately mechanical: every distinct ingredient
-- string becomes its own vocabulary entry, keeping the text exactly as typed.
-- Merging near-duplicates and assigning categories is a reviewed pass done
-- afterwards against real data, not guesswork inside a migration.

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  -- Where it sits in a shop.
  section text not null default 'Other'
    check (section in ('Produce', 'Pantry', 'Dairy & alternatives', 'Bakery', 'Frozen', 'Spices', 'Other')),
  -- What the thing actually is. Independent of aisle: pasta and legumes are
  -- both Pantry, but they are not the same food.
  food_type text not null default 'Other'
    check (food_type in ('Vegetables', 'Fruit', 'Grains', 'Pasta', 'Legumes', 'Nuts & seeds',
                         'Herbs & spices', 'Oils & condiments', 'Dairy alternatives', 'Sweeteners', 'Other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create unique index ingredients_unique_name on public.ingredients (household_id, lower(trim(name)));
create index ingredients_section_idx on public.ingredients (household_id, section);
create index ingredients_food_type_idx on public.ingredients (household_id, food_type);
create trigger ingredients_touch_updated_at before update on public.ingredients
  for each row execute function private.touch_updated_at();

-- One vocabulary entry per distinct string already in use.
insert into public.ingredients (household_id, name)
select distinct on (ri.household_id, lower(trim(ri.item))) ri.household_id, trim(ri.item)
from public.recipe_ingredients ri
order by ri.household_id, lower(trim(ri.item)), ri.created_at;

-- Expand only: `item` stays exactly where it is so the deployed app keeps
-- working untouched. A later migration drops it, once the app reads through
-- ingredient_id instead.
alter table public.recipe_ingredients add column ingredient_id uuid;
update public.recipe_ingredients ri
set ingredient_id = i.id
from public.ingredients i
where i.household_id = ri.household_id and lower(trim(i.name)) = lower(trim(ri.item));

alter table public.recipe_ingredients
  add constraint recipe_ingredients_ingredient_fk
    foreign key (ingredient_id, household_id) references public.ingredients(id, household_id) on delete restrict;
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);

-- Keeps the two representations honest while both exist. A write that supplies
-- only `item` (the current app) gets an ingredient found or created for it; a
-- write that supplies only ingredient_id (the next app) gets `item` filled in.
create function private.link_recipe_ingredient()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare found_id uuid;
begin
  if new.ingredient_id is null then
    if new.item is null or trim(new.item) = '' then
      raise exception 'recipe_ingredients needs either ingredient_id or item';
    end if;
    select i.id into found_id from public.ingredients i
    where i.household_id = new.household_id and lower(trim(i.name)) = lower(trim(new.item));
    if found_id is null then
      insert into public.ingredients (household_id, name)
      values (new.household_id, trim(new.item))
      on conflict do nothing
      returning id into found_id;
    end if;
    if found_id is null then
      select i.id into found_id from public.ingredients i
      where i.household_id = new.household_id and lower(trim(i.name)) = lower(trim(new.item));
    end if;
    new.ingredient_id = found_id;
  end if;
  if new.item is null or trim(new.item) = '' then
    select trim(i.name) into new.item from public.ingredients i where i.id = new.ingredient_id;
  end if;
  return new;
end;
$$;
revoke all on function private.link_recipe_ingredient() from public, anon;
create trigger recipe_ingredients_link before insert or update on public.recipe_ingredients
  for each row execute function private.link_recipe_ingredient();

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create unique index tags_unique_name on public.tags (household_id, lower(trim(name)));

create table public.recipe_tags (
  household_id uuid not null,
  recipe_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (recipe_id, tag_id),
  foreign key (recipe_id, household_id) references public.recipes(id, household_id) on delete cascade,
  foreign key (tag_id, household_id) references public.tags(id, household_id) on delete cascade
);
create index recipe_tags_tag_idx on public.recipe_tags (tag_id);
create index recipe_tags_household_idx on public.recipe_tags (household_id);

-- The ensure_rls event trigger switches RLS on for these automatically, but be
-- explicit rather than relying on it.
alter table public.ingredients enable row level security;
alter table public.tags enable row level security;
alter table public.recipe_tags enable row level security;

create policy "members can view ingredients vocabulary" on public.ingredients for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "members can add ingredients vocabulary" on public.ingredients for insert to authenticated
with check ((select private.is_household_member(household_id)));
create policy "members can update ingredients vocabulary" on public.ingredients for update to authenticated
using ((select private.is_household_member(household_id))) with check ((select private.is_household_member(household_id)));
create policy "members can remove unused ingredients" on public.ingredients for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy "members can view tags" on public.tags for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "members can add tags" on public.tags for insert to authenticated
with check ((select private.is_household_member(household_id)));
create policy "members can update tags" on public.tags for update to authenticated
using ((select private.is_household_member(household_id))) with check ((select private.is_household_member(household_id)));
create policy "members can remove tags" on public.tags for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy "members can view recipe tags" on public.recipe_tags for select to authenticated
using ((select private.is_household_member(household_id)));
create policy "members can add recipe tags" on public.recipe_tags for insert to authenticated
with check ((select private.is_household_member(household_id)));
create policy "members can remove recipe tags" on public.recipe_tags for delete to authenticated
using ((select private.is_household_member(household_id)));

revoke all on public.ingredients, public.tags, public.recipe_tags from anon;
grant select, insert, delete on public.ingredients to authenticated;
grant insert (ingredient_id), update (ingredient_id) on public.recipe_ingredients to authenticated;
grant update (name, section, food_type, updated_at) on public.ingredients to authenticated;
grant select, insert, delete on public.tags to authenticated;
grant update (name) on public.tags to authenticated;
grant select, insert, delete on public.recipe_tags to authenticated;

alter publication supabase_realtime add table public.ingredients, public.tags, public.recipe_tags;
