-- Creating a household stopped working when invite-code generation changed.
--
-- The rotation migration replaced the invite code's inline default with
-- `private.new_invite_code()`, then revoked execute on it from `authenticated`
-- — as it should, since minting codes is the database's business. But a column
-- default is evaluated as the role doing the insert, so a signed-in account
-- creating a household hit `permission denied for function new_invite_code`
-- before any policy was consulted. Nobody noticed: the household that uses this
-- app already existed, and sign-ups are closed.
--
-- The fix is a BEFORE INSERT trigger. A trigger function is called by the
-- system rather than by the inserting role, so no client needs execute rights
-- on anything. It also assigns unconditionally: `authenticated` cannot write
-- the column at all, and no role that can has any business choosing a code.

create or replace function private.assign_invite_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  NEW.invite_code := private.new_invite_code();
  NEW.invite_code_set_at := now();
  return NEW;
end;
$$;
revoke all on function private.assign_invite_code() from public, anon, authenticated;

alter table public.households alter column invite_code drop default;

drop trigger if exists households_assign_invite_code on public.households;
create trigger households_assign_invite_code before insert on public.households
  for each row execute function private.assign_invite_code();
