-- Make database functions private by default. Public RPCs must opt in with an
-- explicit grant in the migration that creates them.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- Serialize each table's count-and-insert check per household. Without the
-- lock, concurrent transactions can all observe the same remaining capacity.
create or replace function private.enforce_household_row_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cap integer := TG_ARGV[0]::integer;
  used integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'household-row-cap:' || TG_TABLE_SCHEMA || ':' || TG_TABLE_NAME || ':' || NEW.household_id::text,
      0
    )
  );

  execute format(
    'select count(*) from (select 1 from public.%I where household_id = $1 limit $2) s',
    TG_TABLE_NAME
  ) into used using NEW.household_id, cap;
  if used >= cap then
    raise exception 'Namų ūkis pasiekė ribą: % eilučių lentelėje %.', cap, TG_TABLE_NAME
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;
revoke all on function private.enforce_household_row_cap() from public, anon, authenticated;

-- Recipe ingredients have a per-recipe limit, so they use the recipe as the
-- lock key instead of the household.
create or replace function private.enforce_recipe_ingredient_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('recipe-ingredient-row-cap:' || NEW.recipe_id::text, 0)
  );

  select count(*) into used
    from (select 1 from public.recipe_ingredients ri where ri.recipe_id = NEW.recipe_id limit 500) s;
  if used >= 500 then
    raise exception 'Receptas pasiekė 500 ingredientų ribą.' using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;
revoke all on function private.enforce_recipe_ingredient_cap() from public, anon, authenticated;
