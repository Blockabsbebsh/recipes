-- The vocabulary the tests are written in.
--
-- Two things only: a way to become a signed-in account, and a way to say what
-- should and should not be allowed. Nothing here knows anything about the app.

create schema t;

-- Fixed accounts, so a failure names someone rather than a UUID.
create function t.ana()  returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000a001'::uuid $$;
create function t.bene() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000a002'::uuid $$;
create function t.carl() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000a003'::uuid $$;
create function t.dana() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000a004'::uuid $$;
create function t.kitchen() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000b001'::uuid $$;
create function t.other()   returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000b002'::uuid $$;

/**
 * Ana and Bene share a kitchen. Carl has his own. Dana has neither — she is
 * signed in and belongs nowhere, which is the account every policy has to hold
 * against.
 */
create function t.seed() returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values
    (t.ana(), 'ana@example.com'), (t.bene(), 'bene@example.com'),
    (t.carl(), 'carl@example.com'), (t.dana(), 'dana@example.com');

  insert into public.households (id, name, owner_id) values
    (t.kitchen(), 'Mūsų virtuvė', t.ana()),
    (t.other(), 'Kito virtuvė', t.carl());
  insert into public.household_members (household_id, user_id, display_name) values
    (t.kitchen(), t.ana(), 'Ana'), (t.kitchen(), t.bene(), 'Bene'),
    (t.other(), t.carl(), 'Carl');

  insert into public.recipes (id, household_id, title, created_by) values
    ('00000000-0000-4000-8000-00000000c001', t.kitchen(), 'Pomidorų sriuba', t.ana()),
    ('00000000-0000-4000-8000-00000000c002', t.other(), 'Slaptas receptas', t.carl());
end $$;

-- What PostgREST does with a request: the role from the key, the account from
-- the token. `set local` so it lasts the transaction and no longer.
create function t.acting_as(who uuid) returns void language plpgsql as $$
begin
  reset role;   -- the session is postgres; come back to it before switching
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
end $$;

-- A request with no token at all, which is what the sign-in page sends.
create function t.acting_as_stranger() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
end $$;

create function t.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then raise exception 'FAILED: %', what; end if;
end $$;

create function t.eq(got anyelement, want anyelement, what text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAILED: % — got %, wanted %', what, coalesce(got::text, 'null'), coalesce(want::text, 'null');
  end if;
end $$;

/** The statement must be refused. Succeeding is the failure. */
create function t.refused(statement text, what text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    return;
  end;
  raise exception 'FAILED: % — the database allowed it', what;
end $$;

/** The statement must go through. Any error is the failure, reported as itself. */
create function t.allowed(statement text, what text) returns void language plpgsql as $$
begin
  execute statement;
exception when others then
  raise exception 'FAILED: % — the database refused it: %', what, sqlerrm;
end $$;

/** Refused, and for the stated reason — a limit and a bug both raise. */
create function t.refused_saying(statement text, pattern text, what text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlerrm !~ pattern then
      raise exception 'FAILED: % — refused, but saying "%" rather than matching %', what, sqlerrm, pattern;
    end if;
    return;
  end;
  raise exception 'FAILED: % — the database allowed it', what;
end $$;

-- The tests speak as `authenticated` and `anon`, so the vocabulary has to be
-- reachable from there. Nothing in `t` reads or writes the app's tables.
grant usage on schema t to authenticated, anon;
grant execute on all functions in schema t to authenticated, anon;
