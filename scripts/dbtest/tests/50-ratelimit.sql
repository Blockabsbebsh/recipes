-- The throttle on joining.
--
-- `join_household` is callable by any signed-in account and answers "is this a
-- real code?" as often as it is asked. Twelve hex characters make guessing
-- hopeless on arithmetic alone, but arithmetic is a poor last line.
begin;
select t.seed();
select t.acting_as(t.dana());

select public.join_household('FFFFFFFFFFF1');
select public.join_household('FFFFFFFFFFF2');
select public.join_household('FFFFFFFFFFF3');
select public.join_household('FFFFFFFFFFF4');
select t.eq(public.join_household('FFFFFFFFFFF5'), null::uuid, 'five wrong guesses are answered');
select t.refused_saying(
  'select public.join_household(''FFFFFFFFFFF6'')',
  'Per daug bandymų',
  'a sixth guess inside fifteen minutes');

-- The limit is per account, not global: one person guessing must not lock the
-- other one out of joining.
select t.acting_as(t.bene());
select t.eq(public.join_household('FFFFFFFFFFF7'), null::uuid,
            'someone else can still try while one account is throttled');

-- And it forgets. A day-old attempt is swept on the next call rather than
-- counting against someone for ever.
reset role;
update private.join_attempts set attempted_at = now() - interval '2 days' where actor = t.dana();
select t.acting_as(t.dana());
select t.eq(public.join_household('FFFFFFFFFFF8'), null::uuid, 'yesterday''s attempts do not count against today');
reset role;
select t.eq((select count(*)::int from private.join_attempts where actor = t.dana() and attempted_at < now() - interval '1 day'), 0,
            'and the old rows are swept rather than kept for ever');

-- The right code still works for someone who has not been guessing.
select (select invite_code from public.households where id = t.other()) as code \gset
select t.acting_as(t.carl());
select t.eq(public.join_household(:'code'), t.other(), 'a throttle on one account does not shut the door for everyone');
rollback;
