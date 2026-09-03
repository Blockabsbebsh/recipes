-- Rate-limit joining because the code is the only thing guarding a household.
--
-- `join_household` is callable by any signed-in account and answers "is this a
-- real code?" as often as it is asked. Twelve hex characters make guessing
-- hopeless on arithmetic alone, but arithmetic is a poor last line: a limit
-- costs nothing and does not depend on the code staying long.
--
-- The awkward part is that a failed attempt has to be *recorded*, and the
-- function used to raise on a bad code. An exception rolls back its own
-- transaction, taking the attempt row with it, so the counter would sit at
-- zero however many times it was asked. A bad code therefore returns null now
-- instead of raising, which commits, and the client turns null into the
-- message. Only the throttle itself raises — by then the attempts it counted
-- are already committed by earlier calls.

create table if not exists private.join_attempts (
  id bigint generated always as identity primary key,
  actor uuid not null,
  from_ip text,
  attempted_at timestamptz not null default now()
);
create index if not exists join_attempts_actor_idx on private.join_attempts (actor, attempted_at desc);
create index if not exists join_attempts_ip_idx on private.join_attempts (from_ip, attempted_at desc);
revoke all on private.join_attempts from public, anon, authenticated;

create or replace function public.join_household(p_invite_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
  caller_id uuid := (select auth.uid());
  v_code text;
  v_ip text;
  v_by_actor integer;
  v_by_ip integer;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  -- The first hop in x-forwarded-for is what Supabase's edge saw. Absent in a
  -- direct SQL session, in which case the address limit simply does not apply
  -- rather than the function failing.
  v_ip := nullif(split_part(coalesce(
    current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), '');

  delete from private.join_attempts a where a.attempted_at < now() - interval '1 day';

  -- Joining a household is a once-ever act, and twice if the code was mistyped.
  select count(*) into v_by_actor from private.join_attempts a
    where a.actor = caller_id and a.attempted_at > now() - interval '15 minutes';
  if v_by_actor >= 5 then
    raise exception 'Per daug bandymų. Pabandykite po kelių minučių.';
  end if;

  if v_ip is not null then
    select count(*) into v_by_ip from private.join_attempts a
      where a.from_ip = v_ip and a.attempted_at > now() - interval '1 hour';
    if v_by_ip >= 20 then
      raise exception 'Per daug bandymų. Pabandykite vėliau.';
    end if;
  end if;

  insert into private.join_attempts (actor, from_ip) values (caller_id, v_ip);

  v_code := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_code = '' then return null; end if;

  select h.id into target_id from public.households h where h.invite_code = v_code;
  -- Null rather than an exception: the attempt above must survive this call.
  if target_id is null then return null; end if;

  insert into public.household_members (household_id, user_id, display_name)
  values (target_id, caller_id, nullif(trim(p_display_name), ''))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return target_id;
end;
$$;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.join_household(text, text) to authenticated, service_role;
