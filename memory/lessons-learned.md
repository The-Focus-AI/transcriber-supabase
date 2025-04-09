# Lessons Learned

*This document captures insights, solutions, and best practices discovered during development.*

---

## Running `psql` with `dotenvx` and Environment Variables

**Date:** 2025-04-08

**Context:** Attempting to verify Supabase schema using `psql` and a `DATABASE_URL` stored in `.env`.

**Problem:**
Running `dotenvx run -- psql $DATABASE_URL -c "\\d table_name"` failed with a local socket connection error (`/tmp/.s.PGSQL.5432`). This indicated that `$DATABASE_URL` was not being correctly expanded or passed to `psql` in the execution context provided by `dotenvx` alone.

**Solution:**
Wrap the command intended for `psql` within `bash -c '...'`. This ensures that the shell (`bash`) correctly handles the variable expansion (`$DATABASE_URL`) after `dotenvx` has loaded the environment.

**Correct Command Format:**
```bash
dotenvx run -- bash -c 'psql $DATABASE_URL -c "\\d table_name"' | cat
```
Note the single quotes around the `bash` command string and escaped double quotes/backslashes within the `psql` command itself. 