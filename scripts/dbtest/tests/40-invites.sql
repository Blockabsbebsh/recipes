-- The invite code: how wide it is, when it changes, and what joining does.
--
-- The code is the only thing guarding a household. It used to be a permanent
-- credential — eight hex characters that never changed, so anyone holding one
-- could walk in years after the message it was pasted into.
begin;
select t.seed();

-- Twelve uppercase hex characters: 48 bits. At a thousand guesses a second the
-- old eight would have fallen inside a week, which is how long one now lives.
select t.ok((select bool_and(invite_code ~ '^[0-9A-F]{12}$') from public.households),
            'every code is twelve uppercase hex characters');
select t.eq((select count(distinct invite_code)::int from public.households), 2,
            'and no two households share one');

-- Rotation replaces a code that has been in use for a week, and only that one.
update public.households set invite_code_set_at = now() - interval '8 days' where id = t.kitchen();
select code_before, fresh_before from (
  select (select invite_code from public.households where id = t.kitchen()) as code_before,
         (select invite_code from public.households where id = t.other()) as fresh_before
) s \gset
select t.eq(private.rotate_stale_invite_codes(), 1, 'exactly the one stale code was rotated');
select t.ok((select invite_code from public.households where id = t.kitchen()) <> :'code_before',
            'the week-old code is gone');
select t.eq((select invite_code from public.households where id = t.other()), :'fresh_before',
            'and a code issued today is left alone');
select t.ok((select invite_code_set_at from public.households where id = t.kitchen()) > now() - interval '1 minute',
            'the new code is dated from now, so it lives a full week');
select t.ok((select invite_code from public.households where id = t.kitchen()) ~ '^[0-9A-F]{12}$',
            'and it is the same width as the one it replaced');
select t.eq(private.rotate_stale_invite_codes(), 0, 'a second rotation has nothing left to do');

-- The job that runs it. pg_cron is not installed here, so what is checked is
-- what the migration asked cron for.
select t.eq((select schedule from cron.job where jobname = 'rotate-invite-codes'), '15 3 * * *',
            'the rotation is checked daily, so a code lives seven days from when it was issued');
select t.ok((select command from cron.job where jobname = 'rotate-invite-codes') like '%rotate_stale_invite_codes%',
            'and the job calls the rotation');

-- Joining. A code read off one phone and typed into another arrives with
-- whatever spacing the person added.
select (select invite_code from public.households where id = t.other()) as carls_code \gset
select t.acting_as(t.dana());
select t.eq(public.join_household(:'carls_code'), t.other(), 'a right code lets someone in');
select t.eq((select count(*)::int from public.household_members where household_id = t.other()), 2,
            'and actually adds them');
select t.eq(public.join_household(lower(:'carls_code')), t.other(), 'typed in lower case');
select t.eq(public.join_household(' ' || :'carls_code' || ' '), t.other(), 'with spaces around it');
select t.eq(public.join_household(substr(:'carls_code', 1, 4) || '-' || substr(:'carls_code', 5)), t.other(),
            'with a dash through the middle');
select t.eq((select count(*)::int from public.household_members where household_id = t.other()), 2,
            'and joining twice does not add them twice');

-- A wrong code answers null rather than raising, because the attempt has to
-- survive the call for the rate limit to have counted it. Bene asks these,
-- because Dana has spent four of her five attempts above and the limit is real.
select t.acting_as(t.bene());
select t.eq(public.join_household('FFFFFFFFFFFF'), null::uuid, 'a wrong code lets nobody in');
select t.eq(public.join_household(''), null::uuid, 'nor an empty one');
select t.eq(public.join_household(null), null::uuid, 'nor no code at all');
rollback;
