-- Column grants do nothing while a table-level grant remains.
--
-- Supabase's bootstrap hands the client roles everything on `public`:
-- `alter default privileges in schema public grant all on tables to anon,
-- authenticated, service_role`, set before any of this project's migrations
-- ran. So every table arrived with table-level SELECT, INSERT, UPDATE and
-- DELETE for `authenticated`, and the careful column grants written in each
-- migration since have been decoration — a table-level UPDATE covers every
-- column, and revoking a column privilege does not subtract from it.
--
-- Row security hid most of the consequences: there is no DELETE policy on
-- recipes or households, so the DELETE nobody meant to grant reaches no rows.
-- The exception is the one place a policy cannot reach, which is a column the
-- policy does not mention. `invite_code` is that column. The previous migration
-- revoked update on it and a member could still rewrite it, which is rotation
-- made optional — hold the code still and it never expires.
--
-- The fix has to be a table-level revoke, because that is the only thing that
-- clears a table-level grant, and it takes the column grants with it. So each
-- table is stripped and re-granted exactly what the app uses. The list is the
-- union of what every migration up to here asked for; nothing new is allowed.

revoke all on all tables in schema public from anon, authenticated;

-- And for tables added later, which would otherwise arrive with everything
-- again. A new table now starts closed and is opened deliberately.
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant select, insert on public.households to authenticated;
grant update (name, updated_at) on public.households to authenticated;

grant select, insert on public.household_members to authenticated;
grant update (display_name) on public.household_members to authenticated;

grant select, insert on public.recipes to authenticated;
grant update (title, notes, source_url, deleted_at, deleted_by, updated_at) on public.recipes to authenticated;

grant select, insert, update, delete on public.recipe_ingredients to authenticated;

grant select, insert on public.roster_entries to authenticated;
grant update (status, resolved_by, resolved_at, updated_at) on public.roster_entries to authenticated;

grant select, insert, delete on public.shopping_queue to authenticated;

grant select, insert, delete on public.ingredients to authenticated;
grant update (name, section, food_type, updated_at, barbora_category_path,
              barbora_mapping_reason, barbora_mapping_source, barbora_mapping_updated_at,
              barbora_direct_url) on public.ingredients to authenticated;

grant select, insert, delete on public.tags to authenticated;
grant update (name) on public.tags to authenticated;

grant select, insert, delete on public.recipe_tags to authenticated;

grant select on public.barbora_categories to authenticated;
