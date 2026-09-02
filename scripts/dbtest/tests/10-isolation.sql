-- One household must be invisible to another, and to an account in none.
--
-- Every check here runs as `authenticated` with a real account behind it,
-- because that is what an attacker has: sign-up is open, the publishable key is
-- in a public repository, and a token is a few seconds' work. Row security is
-- the only thing between that account and this household's kitchen.
begin;
select t.seed();

select t.acting_as(t.bene());
select t.eq((select count(*)::int from public.recipes), 1, 'Bene sees only her own household''s recipes');
select t.eq((select title from public.recipes), 'Pomidorų sriuba', 'and it is the right one');
select t.eq((select count(*)::int from public.households), 1, 'Bene sees only her own household');
select t.eq((select count(*)::int from public.household_members), 2, 'Bene sees both members of it');

-- Dana is signed in and belongs to no household at all.
select t.acting_as(t.dana());
select t.eq((select count(*)::int from public.recipes), 0, 'an account in no household sees no recipes');
select t.eq((select count(*)::int from public.households), 0, 'nor any household');
select t.eq((select count(*)::int from public.household_members), 0, 'nor who is in one');
select t.refused(
  format('insert into public.recipes (household_id, title, created_by) values (%L, %L, %L)',
         t.kitchen(), 'Ne mano', t.dana()),
  'an outsider writing a recipe into someone else''s household');
select t.refused(
  format('insert into public.household_members (household_id, user_id) values (%L, %L)',
         t.kitchen(), t.dana()),
  'an outsider adding themselves to a household');
select t.refused(
  format('insert into public.shopping_queue (household_id, recipe_id, added_by) values (%L, %L, %L)',
         t.kitchen(), '00000000-0000-4000-8000-00000000c001', t.dana()),
  'an outsider filling someone else''s basket');

-- An update names no household of its own: it finds rows through USING, so an
-- outsider's UPDATE has to match nothing rather than be refused outright.
update public.recipes set title = 'Pavogta' where id = '00000000-0000-4000-8000-00000000c001';
select t.acting_as(t.ana());
select t.eq((select title from public.recipes where id = '00000000-0000-4000-8000-00000000c001'),
            'Pomidorų sriuba', 'an outsider''s update reached no row');

-- Carl is in a household, which is not the same as being in this one.
select t.acting_as(t.carl());
select t.eq((select count(*)::int from public.recipes where household_id = t.kitchen()), 0,
            'a member of another household sees nothing of this one');
select t.refused(
  format('insert into public.recipes (household_id, title, created_by) values (%L, %L, %L)',
         t.kitchen(), 'Ne mano', t.carl()),
  'a member of another household writing into this one');

-- The signed-out key reaches the tables at all only through the grants.
select t.acting_as_stranger();
select t.refused('select count(*) from public.recipes', 'the anonymous key reading recipes');
select t.refused('select count(*) from public.households', 'the anonymous key reading households');
select t.refused(format('select public.join_household(%L)', 'ABCD1234'),
                 'the anonymous key calling join_household');
rollback;
