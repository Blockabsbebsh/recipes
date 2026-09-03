-- Invite codes expire and are wide enough that a week is not enough time.
--
-- A code was a permanent credential: it never changed, and anyone holding one
-- could join the household and read and write everything in it, years after
-- the message it was pasted into. Weekly rotation caps that exposure.
--
-- Rotation alone would not have been enough. The old code was eight hex
-- characters — 32 bits, about 4.3 billion — and `join_household` is callable
-- by any signed-in account. At a thousand guesses a second, a week is about
-- 14% of that space, so a rotating 8-character code is a lottery an attacker
-- enters every week and eventually wins. Twelve characters is 48 bits, and the
-- same thousand guesses a second would need some nine thousand years. Hex has
-- no O, I or L, so nothing in it can be misread when it is typed by hand.

create or replace function private.new_invite_code()
returns text language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  -- Six random bytes as twelve uppercase hex characters. Looped because the
  -- column is unique: at 48 bits a collision will not happen, but a unique
  -- violation from a scheduled job would be a silent failure to rotate.
  for _ in 1..10 loop
    candidate := upper(encode(extensions.gen_random_bytes(6), 'hex'));
    exit when not exists (select 1 from public.households h where h.invite_code = candidate);
  end loop;
  return candidate;
end;
$$;
revoke all on function private.new_invite_code() from public, anon, authenticated;

alter table public.households
  add column if not exists invite_code_set_at timestamptz not null default now();

alter table public.households
  alter column invite_code set default private.new_invite_code();

-- Every code in existence is an eight-character one that has already done its
-- job: this household's members are both in. Replace them now rather than
-- leaving a week of the old width.
update public.households set invite_code = private.new_invite_code(), invite_code_set_at = now();

/**
 * Replace any code that has been in use for a week.
 *
 * Runs from pg_cron rather than from the app, so a code expires whether or not
 * anyone opens the app — a rotation that only happens when someone looks is
 * not a rotation.
 */
create or replace function private.rotate_stale_invite_codes()
returns integer language plpgsql security definer set search_path = '' as $$
declare rotated integer;
begin
  with stale as (
    update public.households
    set invite_code = private.new_invite_code(), invite_code_set_at = now()
    where invite_code_set_at < now() - interval '7 days'
    returning 1
  ) select count(*) into rotated from stale;
  return rotated;
end;
$$;
revoke all on function private.rotate_stale_invite_codes() from public, anon, authenticated;

create extension if not exists pg_cron;

-- Checked daily rather than run weekly, so each code lives seven days from
-- when it was issued rather than until whichever day the job happens to fall.
select cron.unschedule('rotate-invite-codes')
where exists (select 1 from cron.job where jobname = 'rotate-invite-codes');

select cron.schedule('rotate-invite-codes', '15 3 * * *', $job$select private.rotate_stale_invite_codes()$job$);

-- A code read off one phone and typed into another arrives with whatever
-- spacing and punctuation the person added. Only the characters matter.
create or replace function public.join_household(p_invite_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid; caller_id uuid := (select auth.uid()); code text;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  code := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if code = '' then raise exception 'Invalid household code'; end if;
  select h.id into target_id from public.households h where h.invite_code = code;
  if target_id is null then raise exception 'Invalid household code'; end if;
  insert into public.household_members (household_id, user_id, display_name)
  values (target_id, caller_id, nullif(trim(p_display_name), ''))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return target_id;
end;
$$;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.join_household(text, text) to authenticated, service_role;
