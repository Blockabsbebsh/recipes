-- The parts of a Supabase database the migrations expect to already be there.
--
-- Everything here is scaffolding, never the thing under test: the roles a
-- policy names, the `auth.uid()` a policy calls, the `extensions` schema
-- `gen_random_bytes` lives in, and the publication realtime subscribes to.
-- If a test passes because of something in this file, the test is wrong.

-- Supabase's three client roles. They cannot log in; the tests reach them with
-- `set local role`, which is what PostgREST does with a request's token.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's own bootstrap, and the reason the TRUNCATE hole existed at all.
-- The platform hands the client roles everything on `public` by default, so a
-- table created by a migration arrives with TRUNCATE, TRIGGER and REFERENCES
-- already granted — none of which row security is consulted for. Without these
-- four lines the hardening migration has nothing to revoke and its tests pass
-- against a database that was never vulnerable.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- GoTrue's table, reduced to the column the foreign keys point at.
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase's own definition. PostgREST sets `request.jwt.claim.sub` from the
-- bearer token before each statement; `t.acting_as` does the same.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- pg_cron is not installed here, so the schedule is recorded rather than run.
-- What the rotation migration asks for is still asserted: that a daily job
-- exists and that it calls the rotation function.
create schema cron;
create table cron.job (
  jobid bigserial primary key, jobname text unique, schedule text, command text
);
create function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  delete from cron.job where jobname = job_name returning true
$$;

create publication supabase_realtime;
