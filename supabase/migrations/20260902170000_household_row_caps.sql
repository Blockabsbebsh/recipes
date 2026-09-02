-- Ceilings on how much one household can hold.
--
-- Nothing bounded how many rows a member could insert. Through the app that is
-- unreachable — you would be tapping "add recipe" for a week — but a session
-- token works against PostgREST directly, and a loop does not get bored. The
-- realistic case is not malice: it is an import that goes wrong, or a script
-- run twice.
--
-- Enforced by triggers rather than by policies. A policy on `recipes` that
-- counts `recipes` re-enters itself, which Postgres stops with a recursion
-- error — inserts would simply break. A trigger function runs as its owner and
-- never consults row security, so there is nothing to recurse into.
--
-- The counting stops at the ceiling rather than counting the whole table, so
-- the cost of the check does not grow with what is already stored.

create or replace function private.enforce_household_row_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cap integer := TG_ARGV[0]::integer;
  used integer;
begin
  -- TG_TABLE_NAME comes from the trigger definition, never from a caller.
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

-- Numbers chosen to be unreachable rather than tuned: a household that has
-- cooked every day for thirty years has some eleven thousand roster entries.
create trigger recipes_row_cap before insert on public.recipes
  for each row execute function private.enforce_household_row_cap('10000');
create trigger ingredients_row_cap before insert on public.ingredients
  for each row execute function private.enforce_household_row_cap('5000');
create trigger tags_row_cap before insert on public.tags
  for each row execute function private.enforce_household_row_cap('1000');
create trigger roster_entries_row_cap before insert on public.roster_entries
  for each row execute function private.enforce_household_row_cap('50000');
create trigger shopping_queue_row_cap before insert on public.shopping_queue
  for each row execute function private.enforce_household_row_cap('2000');
create trigger recipe_tags_row_cap before insert on public.recipe_tags
  for each row execute function private.enforce_household_row_cap('50000');
create trigger household_members_row_cap before insert on public.household_members
  for each row execute function private.enforce_household_row_cap('50');

/**
 * Ingredients belong to a recipe rather than to a household directly, and a
 * single recipe with a million lines fills a database as well as a million
 * recipes do.
 */
create or replace function private.enforce_recipe_ingredient_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  select count(*) into used
    from (select 1 from public.recipe_ingredients ri where ri.recipe_id = NEW.recipe_id limit 500) s;
  if used >= 500 then
    raise exception 'Receptas pasiekė 500 ingredientų ribą.' using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;
revoke all on function private.enforce_recipe_ingredient_cap() from public, anon, authenticated;

create trigger recipe_ingredients_row_cap before insert on public.recipe_ingredients
  for each row execute function private.enforce_recipe_ingredient_cap();
