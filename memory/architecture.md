# Architecture Overview

## Tech Stack

- **Cloud Platform:** Supabase (Postgres, Auth, Edge Functions)
- **Language (Edge Functions):** Deno/TypeScript
- **Database:** PostgreSQL (via Supabase)
- **Schema Management:** Supabase Migrations (SQL)
- **Validation:** Zod (planned, primarily within Edge Functions)

## Directory Layout

```
.
├── memory/             # Project management and context files
├── supabase/
│   ├── migrations/     # Database schema changes
│   ├── functions/      # Deno Edge Functions
│   │   ├── shared/     # Shared types/utilities
│   │   ├── start-workflow/
│   │   ├── get-job/
│   │   ├── list-jobs/
│   │   ├── workflow-orchestrator/
│   │   ├── execute-echo/ # Example transformer executor
│   │   └── ...         # Other function directories
│   └── config.toml     # Supabase project config
└── ...                 # Other project files (e.g., package.json if needed)
```

## Implementation Patterns

- **Edge Function Structure:** Standard Supabase Edge Function structure (`index.ts`, `_shared/`, potentially tests).
- **Authentication:** Use Supabase JWT helpers within Edge Functions.
- **Database Access:** Utilize the Supabase client library within Edge Functions.
- **Error Handling:** Standard try/catch blocks, returning appropriate HTTP status codes (e.g., 401, 404, 500).
- **RLS:** Enforce data access policies directly in the database.
- **Configuration:** Store transformer-specific configs in the `transformers` table.
- **Data Flow:** Use JSONPath for mapping data between steps (planned).
- **Tech Stack:** Supabase, Deno, TypeScript.
- **Directory Layout:** `supabase/functions/workflow-orchestrator` for orchestrator logic.
- **Patterns:** Use of raw SQL queries for database interactions. 