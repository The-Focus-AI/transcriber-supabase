# Deployment Instructions for Supabase Audio Transcription Service

This guide outlines the steps required to deploy and configure the serverless audio transcription service.

**IMPORTANT:** Ensure all commands are run from the **project root directory** (the directory containing this `DEPLOY.md` file and the `supabase` folder), unless otherwise specified.

## Prerequisites

1.  **Supabase Account:** You need an active Supabase project.
2.  **Supabase CLI:** Install the Supabase CLI: `npm install supabase --save-dev` (or globally).
3.  **Logged In:** Log in to the CLI: `supabase login`
4.  **Project Linked:** Link the CLI to your Supabase project. Replace `<your-project-ref>` with your actual project reference ID (found in Project Settings > General):
    ```bash
    supabase link --project-ref <your-project-ref>
    ```
5.  **Google Gemini API Key:** Obtain an API key from Google Cloud for the Gemini API you intend to use.

## 1. Database Migration

Apply the database schema defined in the migration file:

```bash
# Run from project root directory
supabase db push
```

This command creates the `jobs` table, associated functions, and triggers in your Supabase database.

## 2. Environment Variables

Set the following environment variables in your Supabase project dashboard under **Settings > Edge Functions**. Create them if they don't exist.

*   `SUPABASE_URL`: Your project's Supabase URL (e.g., `https://<your-project-ref>.supabase.co`). Found in Project Settings > API.
*   `SUPABASE_ANON_KEY`: Your project's anonymous key. Found in Project Settings > API. **Do NOT use the Service Role Key here.**
*   `SUPABASE_SERVICE_ROLE_KEY`: Your project's service role key. Found in Project Settings > API. **Keep this secret!**
*   `GOOGLE_GEMINI_API_KEY`: Your API key for the Google Gemini service. (Used by `process-job` function)
*   ~~`GEMINI_API_ENDPOINT`~~: (No longer used by `process-job` as it uses the `@google/genai` library which handles endpoints).
*   ~~`GEMINI_TRANSCRIPTION_MODEL`~~: (No longer used, the model `gemini-2.5-pro-preview-03-25` is hardcoded in `process-job`).
## 3. Supabase Configuration

Configure the necessary Supabase services via the dashboard:

1.  **Storage (Optional but Recommended):**
    *   While the primary workflow now uses URLs, having a storage bucket can be useful for other purposes or future features. If you create one:
    *   Go to **Storage**.
    *   Click **Create bucket**.
    *   A common name is `audio-files`.
    *   Make it **Private** if access should be controlled via service role keys.
    *   **File Size Limit Note:** Remember Supabase Storage has a fixed file size limit per object based on your plan (often 50MB). This limit cannot be changed in bucket settings. If you intend to use Supabase Storage directly for uploads (outside the URL-based flow), ensure files fit within this limit.
2.  **Authentication:**
    *   Go to **Authentication > Providers**.
    *   Ensure the **Email** provider is enabled. Configure settings as needed (e.g., disable email confirmations if desired for simplicity, though not recommended for production).
3.  **Row Level Security (RLS):**
    *   Go to **Authentication > Policies**.
    *   Find the `jobs` table.
    *   Click **Enable RLS**.
    *   Apply the necessary policies. You can use the SQL Editor (**Database > SQL Editor > New query**) to run the policies commented out at the end of the migration file (`supabase/migrations/20250404100500_create_jobs_table.sql`), or adapt them as needed:
        ```sql
        -- Run these in the Supabase SQL Editor

        -- Allow users to view their own jobs
        CREATE POLICY "Allow users to view their own jobs" ON public.jobs
        FOR SELECT USING (auth.uid() = user_id);

        -- Allow users to insert their own jobs (via the transcribe function)
        -- Note: The transcribe function uses the service_role key for inserts,
        -- but this policy ensures users *could* insert if they had direct DB access with their JWT.
        CREATE POLICY "Allow users to insert their own jobs" ON public.jobs
        FOR INSERT WITH CHECK (auth.uid() = user_id);

        -- IMPORTANT: Updates/Deletes are typically handled by backend functions (process-job)
        -- using the service_role key, which bypasses RLS by default.
        -- Do NOT add permissive UPDATE/DELETE policies unless absolutely necessary.
        ```

## 4. Deploy Edge Functions

Use the provided deployment script:

1.  **Make script executable (if not already):**
    ```bash
    # Run from project root directory
    chmod +x deploy_functions.sh
    ```
2.  **Run the deployment script:**
    ```bash
    # Run from project root directory
    ./deploy_functions.sh
    ```
    This deploys `transcribe`, `get-job-status`, `list-jobs`, `process-job`, and `retry-failed-jobs`. Ensure `transcribe` and `process-job` are redeployed after recent changes to the URL-based workflow.

## 5. Schedule Background Functions

This project uses `pg_cron` to schedule the `process-job` and `retry-failed-jobs` functions.

**5.1. Enable pg_cron Extension (if necessary)**

First, check if the `pg_cron` extension is enabled. Run the following query in the **Database > SQL Editor** in your Supabase dashboard:

```sql
-- Check if pg_cron is enabled
SELECT 1 FROM pg_extension WHERE extname = 'pg_cron';
```

*   If this query returns a row, `pg_cron` is already enabled, and you can proceed to step 5.2.
*   If this query returns no rows, enable the `pg_cron` extension by running the following command in the SQL Editor:
    ```sql
    -- Enable pg_cron extension
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    ```
*   **Enable `pg_net` Extension:** The cron jobs use `net.http_post` to trigger Edge Functions. Enable the required `pg_net` extension as well:
    ```sql
    -- Enable pg_net extension
    CREATE EXTENSION IF NOT EXISTS pg_net;
    ```
    Verify both extensions are enabled by running `SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');` - it should return two rows.

**5.2. Create Cron Jobs**

You can create the necessary cron jobs using either the Supabase Dashboard UI or by running SQL commands directly.

**Method A: Using the Supabase Dashboard (Recommended)**

1.  Go to **Database > Cron Jobs** in your Supabase dashboard.
2.  Click **New cron job**.
3.  **Schedule `process-job`:**
    *   **Name:** `Process Pending Jobs`
    *   **Schedule:** `* * * * *` (Runs every minute. Adjust frequency as needed.)
    *   **Function:** Choose **SQL** and paste the following, replacing placeholders:
        ```sql
        -- Trigger the process-job function
        SELECT net.http_post(
            url:='<YOUR_SUPABASE_PROJECT_URL>/functions/v1/process-job',
            headers:='{"Authorization": "Bearer <YOUR_SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb
        );
        ```
        *(Replace `<YOUR_SUPABASE_PROJECT_URL>` with your actual project URL, e.g., `https://<ref>.supabase.co`)*
        *(Replace `<YOUR_SUPABASE_SERVICE_ROLE_KEY>` with your actual service role key)*
        *(Optional: Add a custom header like `{"X-Trigger-Secret": "your-secret"}` and check for it in the function for added security)*
4.  Click **Save**.
5.  Click **New cron job** again.
6.  **Schedule `retry-failed-jobs`:**
    *   **Name:** `Retry Failed Jobs`
    *   **Schedule:** `*/5 * * * *` (Runs every 5 minutes. Adjust frequency as needed.)
    *   **Function:** Choose **SQL** and paste the following, replacing placeholders:
        ```sql
        -- Trigger the retry-failed-jobs function
        SELECT net.http_post(
            url:='<YOUR_SUPABASE_PROJECT_URL>/functions/v1/retry-failed-jobs',
            headers:='{"Authorization": "Bearer <YOUR_SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb
        );
        ```
        *(Replace placeholders as above)*
7.  Click **Save**.

**Method B: Using SQL Commands**

Alternatively, run the following SQL commands in the **Database > SQL Editor**. Remember to replace the placeholders.

```sql
-- IMPORTANT: Replace placeholders before running!
-- <YOUR_SUPABASE_PROJECT_URL> e.g., https://<ref>.supabase.co
-- <YOUR_SUPABASE_SERVICE_ROLE_KEY> Your actual service role key

-- Schedule process-job (every minute)
SELECT cron.schedule(
    'process-pending-jobs',
    '* * * * *',
    $$
    SELECT net.http_post(
        url:='<YOUR_SUPABASE_PROJECT_URL>/functions/v1/process-job',
        headers:='{"Authorization": "Bearer <YOUR_SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb
    );
    $$
);

-- Schedule retry-failed-jobs (every 5 minutes)
SELECT cron.schedule(
    'retry-failed-jobs',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url:='<YOUR_SUPABASE_PROJECT_URL>/functions/v1/retry-failed-jobs',
        headers:='{"Authorization": "Bearer <YOUR_SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb
    );
    $$
);

-- Optional: Verify jobs were created
-- SELECT * FROM cron.job;
```
*(Note: Using `cron.schedule` ensures the job is created or updated if it already exists with the same name.)*
## 6. Verify Gemini API Implementation

The core transcription logic has been implemented in `supabase/functions/process-job/index.ts`.

1.  **Review the Implementation:**
    *   Open `supabase/functions/process-job/index.ts`.
    *   Locate the `transcribeAudioWithGemini` function.
    *   This function now uses the `@google/genai` library. It performs the following steps:
        *   Uploads the audio file (downloaded from Supabase Storage) to the Google File API.
        *   Calls the hardcoded Gemini model (`gemini-2.5-pro-preview-03-25`) using the uploaded file's URI.
        *   Includes a prompt requesting transcription in a specific JSON format (defined by `TRANSCRIPTION_OUTPUT_SCHEMA` in the file).
        *   Parses the JSON response from Gemini.
2.  **Ensure API Key is Set:** Double-check that the `GOOGLE_GEMINI_API_KEY` environment variable is correctly set in your Supabase project settings (Step 2).
3.  **Deploy/Redeploy:** If you haven't deployed the function after cloning or if you make any further modifications, deploy it:
    ```bash
    # Run from project root directory
    supabase functions deploy process-job --no-verify-jwt
    ```

## 7. Testing

Follow the testing plan outlined in `project-brief.md` to ensure all components work correctly end-to-end. Use tools like `curl` or Postman to test the API endpoints, ensuring you provide a valid JWT (obtained after user login) in the `Authorization: Bearer <jwt>` header.

---

Deployment is complete once all these steps are followed. Monitor your function logs and database for any issues.