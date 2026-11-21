# Architecture

- `src/api` holds HTTP handlers only.
- `src/billing` and `src/orgs` hold domain logic.
- `src/db` is the only code that talks to the database.
