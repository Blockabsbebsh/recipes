-- Keep compound app actions atomic and serialize completion of one shopping batch.

create or replace function public.complete_shopping(p_household_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare caller_id uuid := (select auth.uid()); moved_count integer;
begin
  if caller_id is null or not (select private.is_household_member(p_household_id)) then
    raise exception 'Not authorized for this household';
  end if;

  -- Two phones can finish the same basket at once. The second waits and then
  -- sees the empty queue instead of copying the same rows a second time.
  perform pg_advisory_xact_lock(hashtextextended('complete-shopping:' || p_household_id::text, 0));

  with moved as (
    insert into public.roster_entries (household_id, recipe_id, added_by)
    select sq.household_id, sq.recipe_id, caller_id
    from public.shopping_queue sq
    join public.recipes r on r.id = sq.recipe_id and r.household_id = sq.household_id
    where sq.household_id = p_household_id and r.deleted_at is null
    returning 1
  ) select count(*) into moved_count from moved;

  delete from public.shopping_queue where household_id = p_household_id;
  return moved_count;
end;
$$;
revoke all on function public.complete_shopping(uuid) from public, anon;
grant execute on function public.complete_shopping(uuid) to authenticated, service_role;

create function public.save_recipe(
  p_household_id uuid,
  p_recipe_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_notes text,
  p_source_url text,
  p_ingredient_names text[],
  p_tag_names text[],
  p_add_to_queue boolean
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  caller_id uuid := (select auth.uid());
  saved_id uuid;
begin
  if caller_id is null or not (select private.is_household_member(p_household_id)) then
    raise exception 'Not authorized for this household';
  end if;

  if p_recipe_id is null then
    insert into public.recipes (household_id, title, notes, source_url, created_by)
    values (p_household_id, trim(p_title), nullif(trim(p_notes), ''), nullif(trim(p_source_url), ''), caller_id)
    returning id into saved_id;
  else
    if p_expected_updated_at is null then
      raise exception 'An edit must include the version it started from';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('save-recipe:' || p_recipe_id::text, 0));
    update public.recipes
       set title = trim(p_title),
           notes = nullif(trim(p_notes), ''),
           source_url = nullif(trim(p_source_url), '')
     where id = p_recipe_id
       and household_id = p_household_id
       and deleted_at is null
       and updated_at = p_expected_updated_at
    returning id into saved_id;
    if saved_id is null then
      if exists (
        select 1 from public.recipes
         where id = p_recipe_id and household_id = p_household_id and deleted_at is null
      ) then
        raise exception using errcode = '40001', message = 'Recipe changed since this editor was opened';
      end if;
      raise exception 'Recipe not found';
    end if;
  end if;

  insert into public.ingredients (household_id, name)
  select distinct on (lower(trim(input.name))) p_household_id, trim(input.name)
    from unnest(coalesce(p_ingredient_names, '{}'::text[])) as input(name)
   where input.name is not null and trim(input.name) <> ''
   order by lower(trim(input.name))
  on conflict do nothing;

  delete from public.recipe_ingredients where recipe_id = saved_id;
  insert into public.recipe_ingredients (household_id, recipe_id, ingredient_id, position)
  select p_household_id, saved_id, ingredient.id, (input.ordinality - 1)::integer
    from (
      select distinct on (lower(trim(name))) trim(name) as name, ordinality
        from unnest(coalesce(p_ingredient_names, '{}'::text[])) with ordinality as source(name, ordinality)
       where name is not null and trim(name) <> ''
       order by lower(trim(name)), ordinality
    ) input
    join public.ingredients ingredient
      on ingredient.household_id = p_household_id
     and lower(trim(ingredient.name)) = lower(input.name)
   order by input.ordinality;

  insert into public.tags (household_id, name)
  select distinct on (lower(trim(input.name))) p_household_id, trim(input.name)
    from unnest(coalesce(p_tag_names, '{}'::text[])) as input(name)
   where input.name is not null and trim(input.name) <> ''
   order by lower(trim(input.name))
  on conflict do nothing;

  delete from public.recipe_tags link
  using public.tags tag
  where link.recipe_id = saved_id
    and tag.id = link.tag_id
    and (lower(tag.name) like 'tipas: %' or lower(tag.name) like 'virtuvė: %');

  insert into public.recipe_tags (household_id, recipe_id, tag_id)
  select p_household_id, saved_id, tag.id
    from (
      select distinct on (lower(trim(name))) trim(name) as name
        from unnest(coalesce(p_tag_names, '{}'::text[])) as source(name)
       where name is not null and trim(name) <> ''
       order by lower(trim(name))
    ) input
    join public.tags tag
      on tag.household_id = p_household_id
     and lower(trim(tag.name)) = lower(input.name)
  on conflict do nothing;

  if p_add_to_queue then
    insert into public.shopping_queue (household_id, recipe_id, added_by)
    values (p_household_id, saved_id, caller_id)
    on conflict (household_id, recipe_id) do nothing;
  end if;

  return saved_id;
end;
$$;
revoke all on function public.save_recipe(uuid, uuid, timestamptz, text, text, text, text[], text[], boolean)
  from public, anon;
grant execute on function public.save_recipe(uuid, uuid, timestamptz, text, text, text, text[], text[], boolean)
  to authenticated, service_role;

create function public.save_recipes_import(p_household_id uuid, p_recipes jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  imported integer := 0;
begin
  if (select auth.uid()) is null or not (select private.is_household_member(p_household_id)) then
    raise exception 'Not authorized for this household';
  end if;
  if p_recipes is null or jsonb_typeof(p_recipes) <> 'array' then
    raise exception 'Recipes must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_recipes)
  loop
    perform public.save_recipe(
      p_household_id,
      null,
      null,
      item ->> 'title',
      item ->> 'notes',
      item ->> 'source_url',
      array(select jsonb_array_elements_text(coalesce(item -> 'ingredients', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(item -> 'tags', '[]'::jsonb))),
      false
    );
    imported := imported + 1;
  end loop;
  return imported;
end;
$$;
revoke all on function public.save_recipes_import(uuid, jsonb) from public, anon;
grant execute on function public.save_recipes_import(uuid, jsonb) to authenticated, service_role;

create function public.delete_ingredient(p_household_id uuid, p_ingredient_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_household_member(p_household_id)) then
    raise exception 'Not authorized for this household';
  end if;

  delete from public.recipe_ingredients
   where household_id = p_household_id and ingredient_id = p_ingredient_id;
  delete from public.ingredients
   where household_id = p_household_id and id = p_ingredient_id;
  if not found then raise exception 'Ingredient not found'; end if;
end;
$$;
revoke all on function public.delete_ingredient(uuid, uuid) from public, anon;
grant execute on function public.delete_ingredient(uuid, uuid) to authenticated, service_role;
