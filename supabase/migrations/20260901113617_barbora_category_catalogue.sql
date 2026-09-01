-- Barbora's shopping hierarchy as global reference data, plus a per-household
-- mapping from an ingredient to one category in it.
--
-- The catalogue is a shopping navigation system, not a food ontology, so it is
-- kept away from `ingredients.section` and `ingredients.food_type`. Those two
-- axes describe the food; this describes where a link should point.
--
-- The catalogue itself contains no household information: it is the same shop
-- for everyone. Only the mapping is per household, because `ingredients` is.

create table public.barbora_categories (
  -- The path is the identity. `https://barbora.lt${path}` is the shopping link,
  -- so it is stored in exactly one shape: leading slash, no query, no fragment,
  -- no trailing slash, lowercase slug segments.
  path text primary key check (path ~ '^(/[a-z0-9]+(-[a-z0-9]+)*){1,4}$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  -- Deferred so one publication can insert a whole tree without ordering it.
  parent_path text references public.barbora_categories(path)
    on update cascade deferrable initially deferred,
  depth smallint not null check (depth between 1 and 4),
  sort_order integer not null check (sort_order >= 0),
  -- A category that disappears is deactivated, never deleted: ingredients may
  -- still point at it, and a person has to decide what that means.
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- The `generatedAt` of the crawl that last published this row.
  crawl_version text,
  -- Depth and parent are not independent facts: both are read off the path.
  constraint barbora_categories_depth_matches_path
    check (depth = length(path) - length(replace(path, '/', ''))),
  constraint barbora_categories_parent_matches_path
    check (
      (depth = 1 and parent_path is null)
      or (depth > 1 and parent_path = left(path, length(path) - position('/' in reverse(path))))
    )
);

create index barbora_categories_parent_idx on public.barbora_categories (parent_path, sort_order);
create index barbora_categories_active_idx on public.barbora_categories (depth, sort_order) where active;

-- Read-only reference data for the app. Writes belong to the crawler's
-- server-side credential, so `authenticated` gets no insert, update, or delete
-- policy at all, and no grant to fall back on either.
alter table public.barbora_categories enable row level security;

create policy "members can view active categories" on public.barbora_categories
for select to authenticated using (active);

revoke all on public.barbora_categories from anon, authenticated;
grant select on public.barbora_categories to authenticated;

-- The mapping. Nullable throughout: an unmapped ingredient keeps falling back
-- to its section's broad aisle link.
alter table public.ingredients
  add column barbora_category_path text
    references public.barbora_categories(path) on update cascade on delete set null,
  add column barbora_mapping_reason text
    check (barbora_mapping_reason in ('exact', 'alias', 'parent_fallback', 'manual')),
  add column barbora_mapping_source text
    check (barbora_mapping_source in ('automatic', 'manual')),
  add column barbora_mapping_updated_at timestamptz;

alter table public.ingredients
  -- Either there is a mapping and it says where it came from, or there is none.
  add constraint ingredients_barbora_mapping_complete check (
    (barbora_category_path is null
      and barbora_mapping_reason is null
      and barbora_mapping_source is null
      and barbora_mapping_updated_at is null)
    or (barbora_category_path is not null
      and barbora_mapping_reason is not null
      and barbora_mapping_source is not null
      and barbora_mapping_updated_at is not null)
  ),
  -- A hand-picked category is the only thing that may claim the `manual`
  -- reason, and a hand-picked category may not claim any other.
  add constraint ingredients_barbora_manual_reason check (
    barbora_mapping_source is null
    or (barbora_mapping_source = 'manual') = (barbora_mapping_reason = 'manual')
  );

create index ingredients_barbora_category_idx on public.ingredients (barbora_category_path)
  where barbora_category_path is not null;

-- Column grants on `ingredients` are specific, so the new fields need adding or
-- a correct RLS policy would still leave the update silently doing nothing.
grant update (barbora_category_path, barbora_mapping_reason, barbora_mapping_source,
              barbora_mapping_updated_at) on public.ingredients to authenticated;

-- Publishing a crawled catalogue, as one transaction.
--
-- Takes the crawler's snapshot file unchanged. New paths are inserted active,
-- paths seen again are refreshed, and paths that stopped appearing are
-- deactivated rather than deleted. Execution is revoked from everyone except
-- the server-side credential the workflow uses.
create function public.publish_barbora_categories(snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  categories jsonb := snapshot -> 'categories';
  crawl_version text := snapshot ->> 'generatedAt';
  incoming_count integer;
  missing_roots text[];
  orphan_count integer;
  before_active integer;
  deactivated integer;
  stranded integer;
begin
  if jsonb_typeof(categories) is distinct from 'array' then
    raise exception 'snapshot has no categories array';
  end if;

  incoming_count := jsonb_array_length(categories);
  -- The crawler validates first; this is the last gate before the catalogue
  -- every shopping link depends on, so it refuses an obviously partial run.
  if incoming_count < 450 then
    raise exception 'refusing to publish % categories', incoming_count;
  end if;

  select array_agg(required) into missing_roots
  from unnest(array[
    '/darzoves-ir-vaisiai', '/pieno-gaminiai-kiausiniai-ir-majonezas',
    '/duonos-gaminiai-ir-konditerija', '/mesa-zuvis-ir-kulinarija',
    '/bakaleja', '/saldytas-maistas', '/gerimai'
  ]) as required
  where not exists (
    select 1 from jsonb_to_recordset(categories) as x(path text) where x.path = required
  );
  if missing_roots is not null then
    raise exception 'snapshot is missing required categories: %', array_to_string(missing_roots, ', ');
  end if;

  select count(*) into orphan_count
  from jsonb_to_recordset(categories) as child(path text, "parentPath" text)
  where child."parentPath" is not null
    and not exists (
      select 1 from jsonb_to_recordset(categories) as parent(path text)
      where parent.path = child."parentPath"
    );
  if orphan_count > 0 then
    raise exception 'snapshot has % categories without a parent', orphan_count;
  end if;

  select count(*) into before_active from public.barbora_categories where active;

  insert into public.barbora_categories
    (path, name, parent_path, depth, sort_order, active, crawl_version)
  select x.path, x.name, x."parentPath", x.depth, x."sortOrder", true, crawl_version
  from jsonb_to_recordset(categories)
    as x(path text, name text, "parentPath" text, depth smallint, "sortOrder" integer)
  order by x.depth
  on conflict (path) do update set
    name = excluded.name,
    parent_path = excluded.parent_path,
    depth = excluded.depth,
    sort_order = excluded.sort_order,
    active = true,
    last_seen_at = now(),
    crawl_version = excluded.crawl_version;

  update public.barbora_categories bc
  set active = false
  where bc.active and not exists (
    select 1 from jsonb_to_recordset(categories) as x(path text) where x.path = bc.path
  );
  get diagnostics deactivated = row_count;

  -- Reported, never repaired here: an automatic mapping can be recomputed, but
  -- a hand-picked one is a person's decision and waits for them.
  select count(*) into stranded
  from public.ingredients ing
  join public.barbora_categories bc on bc.path = ing.barbora_category_path
  where not bc.active;

  return jsonb_build_object(
    'crawlVersion', crawl_version,
    'published', incoming_count,
    'activeBefore', before_active,
    'activeAfter', (select count(*) from public.barbora_categories where active),
    'deactivated', deactivated,
    'strandedMappings', stranded
  );
end;
$$;

revoke all on function public.publish_barbora_categories(jsonb) from public, anon, authenticated;
grant execute on function public.publish_barbora_categories(jsonb) to service_role;
