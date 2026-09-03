-- This migration used to open with an attempt to make functions private by
-- default:
--
--   alter default privileges for role postgres in schema public
--     revoke execute on functions from public, anon, authenticated, service_role;
--
-- It does not work, and it never did. PostgreSQL will not let a default
-- privilege take EXECUTE away from PUBLIC: the statement records nothing, and
-- a function created afterwards still arrives with PUBLIC's built-in grant in
-- its ACL. Checked on 16.13 six ways — with and without a prior grant in the
-- row, with `revoke all`, and with the revoke issued before and after a grant.
-- The statement is removed rather than left in place, because a line that
-- looks like protection and is not is worse than no line.
--
-- The rule stands; it is just enforced differently. Every migration that
-- creates a function in `public` revokes from PUBLIC itself, and
-- scripts/dbtest/tests/20-privileges.sql fails if any function in the schema
-- is executable by everyone. An event trigger is the only thing that could
-- make it automatic, and one that errored would break every CREATE FUNCTION
-- on the platform, Supabase's own included — too much of a footgun for what
-- it buys here.

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
