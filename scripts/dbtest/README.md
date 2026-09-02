# Database harness

Applies every migration to a throwaway PostgreSQL and checks what the database does on its own: who can read whose kitchen, what a signed-in account is allowed to write, where the ceilings are, how invite codes rotate, and whether the throttle on joining survives twenty simultaneous requests.

```bash
npm run dbtest            # every file, plus the concurrency run
npm run dbtest -- caps invites
```

It needs PostgreSQL 16 and `psql` on PATH — on Debian and Ubuntu, `postgresql` and `postgresql-client`. The cluster is created under `/var/tmp`, used, and deleted; **nothing touches the Supabase project**.

This is the half of the app the phone harness cannot see. Every policy, grant and trigger in `supabase/migrations/` was written, reviewed by reading, and applied to production without ever being executed against a test. The first run found two faults that had been live for a day.

## What it is

| File | |
| --- | --- |
| `shim.sql` | the parts of a Supabase database the migrations expect to already exist: the client roles, `auth.uid()`, the `extensions` schema, the realtime publication, a `cron` stand-in — and Supabase's blanket default grants, which are not decoration (see below) |
| `helpers.sql` | the vocabulary the tests are written in: `t.acting_as`, `t.ok`, `t.eq`, `t.refused`, `t.refused_saying`, `t.allowed`, and a seed of two households |
| `run.mjs` | starts the cluster, applies the shim and every migration in order, runs each test file, and runs the concurrency case |
| `tests/*.sql` | one file per subject, each wrapped in a transaction it rolls back |

There is no PostgREST here, so the tests stand where PostgREST stands: `set local role authenticated` with the caller's id in `request.jwt.claim.sub`, which is exactly the shape a request arrives in.

## Subjects

- **`isolation`** — one household is invisible to another, to an account in no household, and to the signed-out key. Every check runs as a real signed-in account, because that is what an attacker has.
- **`privileges`** — TRUNCATE, the columns a client may not write, the ceiling on households per account, the length limits, and the full table-level privilege matrix spelled out.
- **`caps`** — the row ceilings, two of them by filling a household to the line and stepping over it, the rest by reading the number off the trigger that carries it.
- **`invites`** — twelve hex characters, rotation replacing a week-old code and only that one, the daily job, and every shape a code can be typed in.
- **`ratelimit`** — five guesses in fifteen minutes, per account, forgotten after a day.
- **`concurrency`** — twenty guesses arriving at once. Not a SQL file: twenty `psql` processes that sleep until the same instant inside the database and then all call `join_household`.

## What it found

**Creating a household had been broken for a day.** The rotation migration replaced the invite code's column default with `private.new_invite_code()` and revoked execute on that function from `authenticated` — both correct on their own. But a column default is evaluated as the role doing the insert, so `insert into households` died on `permission denied for function new_invite_code` before any policy was consulted. Nobody noticed, because the household using this app already existed and sign-ups are closed. A `BEFORE INSERT` trigger assigns the code instead: a trigger function is called by the system, not by the inserting role.

**Every column grant in the project was decoration.** Supabase's bootstrap runs `alter default privileges in schema public grant all on tables to anon, authenticated, service_role` before any of this project's migrations, so every table arrived with table-level SELECT, INSERT, UPDATE and DELETE. A table-level UPDATE covers every column, and revoking a column privilege does not subtract from it — so the migration that revoked `update (invite_code)` changed nothing, and a member could rewrite their household's invite code and opt out of rotation for ever. Row security hid the rest: there is no DELETE policy on recipes, so the DELETE nobody meant to grant reached no rows. The fix is a table-level revoke and an explicit re-grant, with the resulting matrix pinned in `tests/20-privileges.sql`.

## Pitfalls, learned the hard way

**A shim that is too clean tests a database that was never vulnerable.** The first version left out Supabase's blanket default grants, so the TRUNCATE checks passed — and went on passing when the revoke that closes the hole was deleted. A mutation that cannot break a test is telling you the test is measuring the shim. Reproduce the platform's defaults, especially the generous ones.

**A guard can be masked by a broader one beside it.** With the blanket grant taken away, deleting the original `revoke truncate` changes nothing, because `revoke all` already covers it. That does not make either line wrong — it means the mutation has to remove the *mechanism*, not one of two redundant statements. The mutation that proves the TRUNCATE checks is `grant truncate ... to authenticated`, which is the platform default coming back.

**Assert the behaviour, not the constraint's name.** A 201-character recipe title is refused by `recipes_title_check`, the tighter limit the schema always had, not by the `recipes_title_length` added later. Both are wanted; only one can fire.

**Processes started together are not simultaneous.** Twenty `psql` processes take longer to start than the race window they are meant to hit, so the unlocked version passed. Every client now sleeps until a shared instant *inside* the database and only then opens the transaction. Without the advisory lock, 17 of 20 guesses get through.

**A check on `information_schema` sees only what the current role may see.** `pg_class` and `aclexplode` do not filter, so the privilege matrix is read from those.

**Production is PostgreSQL 17 and this runs on 16.** Nothing under test depends on the difference so far — 17's `MAINTAIN` privilege is covered by `revoke all` and is never granted — but a privilege list is exactly the kind of thing a major version can change under you. Check the live database as well when the subject is grants.

## Trusting it

Every check has been run against the broken database it is meant to catch:

| Subject | Reverted | Reported |
| --- | --- | --- |
| `concurrency` | the advisory lock that makes counting and recording one step | `17 of 20 simultaneous guesses were answered, not 5` |
| `privileges` | TRUNCATE revoked (by granting it back, as the platform default had it) | `a signed-in account truncating the roster of members — the database allowed it` |
| `privileges` | the table-level revoke, leaving the blanket grant standing | `a member rewriting their household's invite code — the database allowed it` |
| `privileges` | the trigger that assigns an invite code | `an owner keeping a second kitchen — the database refused it: permission denied for function new_invite_code` |
| `privileges` | the ceiling on households per account | `a sixth household from one account — the database allowed it` |
| `isolation` | the policy scoping recipes to a household | `Bene sees only her own household's recipes — got 2, wanted 1` |
| `caps` | the member ceiling, set to a number nobody reaches | `a fifty-first member — the database allowed it` |
| `invites` | the twelve-character code, back to eight | `every code is twelve uppercase hex characters` |
| `invites` | rotation at seven days | `exactly the one stale code was rotated — got 0, wanted 1` |
| `ratelimit` | five attempts, raised to five hundred | `a sixth guess inside fifteen minutes — the database allowed it` |

Do the same for anything you add.
