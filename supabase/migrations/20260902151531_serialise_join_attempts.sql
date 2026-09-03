-- Count-then-insert is not a rate limit when requests run concurrently.
--
-- Every simultaneous request read the same count before any of them had
-- written a row, so twenty parallel calls all saw zero attempts and all
-- proceeded. The limit held only against a caller polite enough to wait for
-- each answer, which is not the caller it exists for.
--
-- A transaction-scoped advisory lock on the caller makes the read and the write
-- one step. It is held for the length of a call that does almost nothing, and
-- only ever contends with the same account trying again at the same instant.
-- The address limit stays best-effort: locking on two keys invites deadlock,
-- and the per-account limit is the one that binds.

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

  -- One caller at a time, so counting and recording cannot interleave.
  perform pg_advisory_xact_lock(hashtext('join_household:' || caller_id::text));

  v_ip := nullif(split_part(coalesce(
    current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), '');

  delete from private.join_attempts a where a.attempted_at < now() - interval '1 day';

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
  if target_id is null then return null; end if;

  insert into public.household_members (household_id, user_id, display_name)
  values (target_id, caller_id, nullif(trim(p_display_name), ''))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return target_id;
end;
$$;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.join_household(text, text) to authenticated, service_role;

-- The generator returned its last candidate whether or not it was unique, so
-- ten collisions produced a unique-violation from whatever called it. Vanishing
-- unlikely at 48 bits, but a rotation failing under a confusing error is worse
-- than one failing under a clear one.
create or replace function private.new_invite_code()
returns text language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  for _ in 1..10 loop
    candidate := upper(encode(extensions.gen_random_bytes(6), 'hex'));
    if not exists (select 1 from public.households h where h.invite_code = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'Could not generate a unique invite code in ten attempts';
end;
$$;
revoke all on function private.new_invite_code() from public, anon, authenticated;
