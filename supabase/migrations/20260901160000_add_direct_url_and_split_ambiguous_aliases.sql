-- A direct product URL that bypasses the category-based link. Used when
-- Barbora's deep-link association files are stale for a particular section
-- and a specific product URL is known to work.
alter table public.ingredients
  add column barbora_direct_url text
    check (barbora_direct_url is null or barbora_direct_url like 'https://%');

grant update (barbora_direct_url) on public.ingredients to authenticated;
