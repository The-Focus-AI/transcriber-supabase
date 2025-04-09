# Project Plan: Generic Workflow Engine with Supabase

Based on the `planning-planning-tdd` prompt and the `project-brief.md`.

The plan focuses on building the core engine incrementally, ensuring each stage is testable before moving to the next.

**Blueprint Breakdown:**

1.  **Foundation & Auth:** Set up Supabase, define initial schemas, and configure authentication.
2.  **Core Job Lifecycle APIs:** Implement APIs to start, retrieve, and list jobs, secured by authentication and RLS.
3.  **Workflow & Transformer Definitions:** Model how workflows and reusable transformers are defined and stored.
4.  **Basic Orchestration:** Create the orchestrator function to pick up pending jobs.
5.  **Step Execution:** Enable the orchestrator to identify and trigger the correct function for a job's current step.
6.  **Simple Transformer Implementation:** Build a basic "echo" transformer and its executor function.
7.  **Data Flow:** Implement logic for passing data between workflow steps.
8.  **Error Handling & Basic Retries:** Introduce basic error handling and a simple retry mechanism.
9.  **Advanced Retries & History:** Implement configurable retries and job state history logging.
10. **Specific Transformer (Gemini):** Build the Gemini transcription transformer as a concrete example.
11. **Monitoring Hooks:** Add basic logging and identify key metrics.

**Iterative Steps & TDD Prompts:**

---

**Iteration 1: Basic Setup & Authentication** [ ]

*   **Goal:** Initialize Supabase, create basic `workflows` and `jobs` tables, and set up email authentication.
*   **Tests:**
    *   SQL script successfully creates tables.
    *   Can manually insert a row into `workflows`.
    *   Can manually insert a row into `jobs` (without user\_id initially, or using a placeholder if needed before auth).
    *   Supabase Auth allows user signup and login via email.

*   **Prompt 1:**
    ```text
    Based on the `project-brief.md`, generate the initial Supabase SQL migration script to:
    1. Enable the `uuid-ossp` extension if not already enabled.
    2. Create the `workflows` table with `id (TEXT PRIMARY KEY)`, `description (TEXT)`, `created_at`, and `updated_at` (with trigger).
    3. Create the `jobs` table with `id (UUID PRIMARY KEY)`, `workflow_id (TEXT NOT NULL REFERENCES workflows(id))`, `status (TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'awaiting_retry')) DEFAULT 'pending')`, `input_data (JSONB)`, `created_at`, `last_updated_at` (with trigger).
    4. Include basic `updated_at` trigger functions for both tables.
    Also, provide instructions on how to configure basic Email Authentication in the Supabase dashboard.
    ```

---

**Iteration 2: Link Jobs to Users & Start Workflow API** [ ]

*   **Goal:** Modify `jobs` table to link to `auth.users`, create the `start-workflow` Edge Function.
*   **Tests:**
    *   SQL migration adds `user_id` column and foreign key constraint.
    *   `start-workflow` function exists and is deployable.
    *   POST to `/workflows/start` (authenticated) with valid `workflow_id` (requires manually inserting a workflow first) and `input_data` returns 201 Created with `job_id` and `status: 'pending'`.
    *   A new row appears in `jobs` table with the correct `user_id`, `workflow_id`, `input_data`, and `status = 'pending'`.
    *   POST with non-existent `workflow_id` returns an appropriate error (e.g., 400 or 404).
    *   POST without authentication returns 401 Unauthorized.

*   **Prompt 2:**
    ```text
    Generate the following:
    1. A Supabase SQL migration script to alter the `jobs` table:
        - Add the `user_id (UUID)` column.
        - Add a foreign key constraint referencing `auth.users(id)` with `ON DELETE CASCADE`.
        - Make `user_id` `NOT NULL`.
    2. A Supabase Edge Function named `start-workflow` (using Deno/TypeScript).
        - It should handle `POST` requests to `/workflows/start`.
        - It must validate JWT authentication using Supabase helpers.
        - It should parse the request body expecting `workflow_id` (string) and `input_data` (JSON).
        - It needs to verify that the provided `workflow_id` exists in the `workflows` table. Return a 400/404 if not found.
        - If valid, it inserts a new record into the `jobs` table, setting `user_id` from the authenticated user, `workflow_id`, `input_data` from the request, and `status` to 'pending'.
        - It should return a JSON response `{ "job_id": "...", "status": "pending", "created_at": "..." }` with a 201 status code on success.
        - Include necessary Supabase client initialization and error handling (e.g., database errors, auth errors).
    3. Basic unit tests for the Edge Function verifying:
        - Authentication requirement.
        - Request body parsing and validation.
        - Workflow ID existence check.
        - Successful job insertion logic.
        - Correct response format on success and error.
    ```

---

**Iteration 3: Get/List Job APIs & RLS** [ ]

*   **Goal:** Implement `get-job` and `list-jobs` Edge Functions, enforce Row Level Security (RLS).
*   **Tests:**
    *   `get-job` and `list-jobs` functions exist and are deployable.
    *   RLS policies are applied to the `jobs` table.
    *   GET to `/jobs/{jobId}` (authenticated, user owns job) returns full job details and 200 OK.
    *   GET to `/jobs/{jobId}` (authenticated, user does *not* own job) returns 404 Not Found.
    *   GET to `/jobs` (authenticated) returns a JSON array `{"jobs": [...]}` containing only the jobs owned by the user, status 200 OK.
    *   GET requests without authentication return 401 Unauthorized.

*   **Prompt 3:**
    ```text
    Generate the following:
    1. A Supabase Edge Function named `get-job` (Deno/TypeScript):
        - Handles `GET` requests to `/jobs/{jobId}`.
        - Validates JWT authentication.
        - Extracts `jobId` from the path parameter.
        - Queries the `jobs` table for the job with the specified `id`. RLS policy should handle ownership check.
        - Returns the full job details as JSON with 200 OK if found and owned.
        - Returns 404 Not Found if the job doesn't exist or the user doesn't have access (due to RLS).
    2. A Supabase Edge Function named `list-jobs` (Deno/TypeScript):
        - Handles `GET` requests to `/jobs`.
        - Validates JWT authentication.
        - Queries the `jobs` table for all jobs belonging to the authenticated user (RLS policy handles filtering).
        - Returns a JSON response `{ "jobs": [...] }` with 200 OK. The array can be empty.
    3. Supabase SQL statements to create Row Level Security (RLS) policies on the `jobs` table:
        - Enable RLS on the table.
        - Create a policy allowing `SELECT` only if `auth.uid() = user_id`.
        - Create a policy allowing `INSERT` with a `CHECK` condition that `auth.uid() = user_id`.
        - Create policies for `UPDATE` and `DELETE` ensuring `auth.uid() = user_id`.
    4. Basic unit tests for the Edge Functions verifying:
        - Authentication requirement.
        - Correct response for owned job (`get-job`).
        - Correct response structure for `list-jobs`.
        - Handling of non-existent job IDs (`get-job`). (Testing RLS requires integration tests, focus unit tests on function logic).
    ```

---

**Iteration 4: Define Workflow Structure & Transformer Table** [ ]

*   **Goal:** Finalize schema for `workflows` (add `definition` JSONB) and create the `transformers` table. Define a simple workflow structure.
*   **Tests:**
    *   SQL migration successfully modifies `workflows` and creates `transformers`.
    *   Can insert/update a `workflows` row with a valid JSON `definition`.
    *   Can insert/retrieve rows from the `transformers` table.
    *   Example workflow JSON structure is valid.

*   **Prompt 4:**
    ```text
    Generate the following:
    1. A Supabase SQL migration script to:
        - Alter the `workflows` table: Add `definition JSONB NOT NULL`.
        - Create the `transformers` table with:
            - `id TEXT PRIMARY KEY`
            - `type TEXT NOT NULL`
            - `description TEXT`
            - `config JSONB NOT NULL`
            - `target_function TEXT NOT NULL`
            - `created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
            - `updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
        - Add the `updated_at` trigger function and trigger to the `transformers` table.
        - Add an index on `transformers(type)`.
    2. Provide an example JSON structure for the `workflows.definition` field. It should represent a simple, single-step workflow, defining the step ID, the `transformer_id` to use, and potentially how to map `job.input_data` to the transformer's input. Example:
       \`\`\`json
       {
         "start_step": "step1",
         "steps": {
           "step1": {
             "transformer_id": "echo-transformer",
             "input_map": { "data": "$.job_input.payload" }, // Using JSONPath notation
             "next_step": null // Indicates completion
           }
         },
         "output_map": { // Map final step output to job.final_result
             "result": "$.step1.output.echoed_data"
         }
       }
       \`\`\`
    3. Provide an example SQL INSERT statement for a simple 'echo-transformer' into the `transformers` table (e.g., `id='echo-transformer'`, `type='echo'`, `config='{}'`, `target_function='execute-echo'`).
    ```

---

**Iteration 5: Basic Orchestrator Logic (Pickup Pending)** [ ]

*   **Goal:** Create the `workflow-orchestrator` Edge Function that finds pending jobs and marks them as running.
*   **Tests:**
    *   `workflow-orchestrator` function exists and is deployable.
    *   Manually inserting a job with `status='pending'`.
    *   Invoking the orchestrator function (e.g., via Supabase dashboard or curl).
    *   The job's status updates to `running`.
    *   The job's `started_at` timestamp is set.
    *   The job's `last_updated_at` timestamp is updated.
    *   Add `started_at TIMESTAMP WITH TIME ZONE` column to `jobs` table.

*   **Prompt 5:**
    ```text
    Generate the following:
    1. A Supabase SQL migration script to alter the `jobs` table:
        - Add `started_at TIMESTAMP WITH TIME ZONE NULL`.
        - Add `current_step_id TEXT NULL`.
    2. A Supabase Edge Function named `workflow-orchestrator` (Deno/TypeScript).
        - This function is intended to be triggered periodically (e.g., by pg_cron or Supabase Schedules), not via HTTP request (though it might need a simple HTTP trigger for testing/manual invocation initially).
        - It should query the `jobs` table for a limited number of jobs where `status = 'pending'` (e.g., `LIMIT 10 ORDER BY created_at ASC`).
        - For each pending job found, it should update the job's record:
            - Set `status = 'running'`.
            - Set `started_at = NOW()`.
            - Set `last_updated_at = NOW()`.
            - Set `current_step_id` based on the `start_step` in the corresponding `workflow.definition`. (Requires fetching workflow definition).
        - Implement basic logging (e.g., `console.log`) indicating which jobs are being picked up.
        - Include Supabase client initialization and error handling. Handle cases where workflow definition is missing or invalid.
    3. Basic unit tests for the function verifying:
        - Query logic for pending jobs.
        - Update logic for setting status, timestamps, and initial `current_step_id`.
        - Handling of jobs associated with non-existent/invalid workflows.
    4. Instructions on how this function could be manually invoked for testing (e.g., using Supabase CLI or dashboard).
    ```

---

**Iteration 6: Step Execution Logic (Orchestrator)** [ ]

*   **Goal:** Enhance orchestrator to identify the current step, find the transformer, and invoke the target function.
*   **Prompt 6:**
    ```text
    Generate the following:
    1. Enhance the `workflow-orchestrator` Edge Function to:
       - Identify the current step for each job.
       - Fetch the corresponding transformer configuration from the `transformers` table.
       - Invoke the designated `target_function` for the transformer.
       - Update the job's `step_data` with the transformer's output.
       - Transition the job to the next step or mark it as completed.
    2. Basic unit tests for the orchestrator verifying:
       - Correct step identification and transformer fetching.
       - Successful invocation of the target function.
       - Proper job status updates and data flow.
    ```

---

**Iteration 7: Simple "Echo" Transformer & Executor** [ ]

*   **Goal:** Create the `execute-echo` Edge Function and wire it up.
*   **Prompt 7:**
    ```text
    Generate the following:
    1. A Supabase Edge Function named `execute-echo` (Deno/TypeScript):
       - Handles the execution of the "echo" transformer.
       - Receives input data, processes it, and returns the same data as output.
       - Updates the job's `step_data` with the echoed data.
    2. Basic unit tests for the `execute-echo` function verifying:
       - Correct input processing and output generation.
       - Proper job data updates.
    ```

---

**Iteration 8: Data Flow Implementation** [ ]

*   **Goal:** Implement JSONPath mapping for input/output between steps and final result.
*   **Prompt 8:**
    ```text
    Generate the following:
    1. Implement JSONPath mapping logic in the orchestrator:
       - Map input data to the transformer's input using JSONPath.
       - Map the transformer's output to the next step's input or the job's final result.
    2. Basic unit tests for the data flow logic verifying:
       - Correct input/output mapping using JSONPath.
       - Proper data transitions between steps.
    ```

---

**Iteration 9: Basic Error Handling & Retry Fields** [ ]

*   **Goal:** Add error fields to `jobs`, implement basic failure detection in executors, and update orchestrator to handle failed status.
*   **Prompt 9:**
    ```text
    Generate the following:
    1. Enhance the `jobs` table with error fields:
       - Add `error_message` and `retry_count` fields.
    2. Implement basic error handling in executor functions:
       - Detect failures and update the job's status to `failed`.
       - Log error messages and increment the `retry_count`.
    3. Update the orchestrator to handle failed jobs:
       - Transition jobs to `awaiting_retry` if retries are available.
       - Mark jobs as permanently failed if retries are exhausted.
    4. Basic unit tests for error handling and retry logic verifying:
       - Correct error detection and logging.
       - Proper job status transitions based on retry logic.
    ```

---

**Iteration 10: Advanced Retry Logic & History** [ ]

*   **Goal:** Implement retry counts, max retries, backoff (`next_retry_at`), and state history logging in `jobs`. Update orchestrator to handle `awaiting_retry`.
*   **Prompt 10:**
    ```text
    Generate the following:
    1. Enhance the `jobs` table with retry and history fields:
       - Add `max_retries`, `next_retry_at`, and `state_history` fields.
    2. Implement advanced retry logic in the orchestrator:
       - Calculate `next_retry_at` using exponential backoff.
       - Log state transitions in `state_history`.
    3. Update the orchestrator to handle `awaiting_retry` jobs:
       - Transition jobs back to `pending` when `next_retry_at` is reached.
    4. Basic unit tests for advanced retry logic and history logging verifying:
       - Correct calculation of `next_retry_at`.
       - Proper state history logging.
       - Accurate job status transitions based on retry logic.
    ```

---

**Iteration 11: Gemini Timestamp Transcriber** [ ]

*   **Goal:** Create the `gemini-timestamp-transcriber` transformer config and the `execute-gemini-prompt` Edge Function.
*   **Prompt 11:**
    ```text
    Generate the following:
    1. A Supabase Edge Function named `execute-gemini-prompt` (Deno/TypeScript):
       - Handles the execution of the Gemini transcription transformer.
       - Processes audio input and returns transcription with timestamps.
       - Updates the job's `step_data` with the transcription result.
    2. Basic unit tests for the `execute-gemini-prompt` function verifying:
       - Correct audio processing and transcription generation.
       - Proper job data updates.
    ```

---

**Iteration 12: Monitoring & Logging** [ ]

*   **Goal:** Add structured logging throughout the functions and identify key metrics/queries.
*   **Prompt 12:**
    ```text
    Generate the following:
    1. Implement structured logging in all Edge Functions:
       - Log key events, errors, and state transitions.
       - Include context such as job_id, step_id, and transformer_id.
    2. Identify and implement key metrics/queries for monitoring:
       - Track job completion rates, failure rates, and average durations.
       - Monitor orchestrator queue length and API response times.
    3. Basic unit tests for logging and monitoring verifying:
       - Correct logging of key events and errors.
       - Accurate metric calculations and queries.
    ``` 