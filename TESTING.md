# Testing the Supabase Audio Transcription Service

This guide outlines how to perform an end-to-end manual test of the transcription service after deployment and configuration.

## Prerequisites

Before testing, ensure you have completed **all** steps in `DEPLOY.md`, including:
1.  Database migration (`supabase db push`).
2.  Setting all required Environment Variables in Supabase Settings > Edge Functions.
3.  Configuring Supabase Storage (bucket `audio-files`), Authentication (Email provider enabled), and RLS policies.
4.  Deploying all Edge Functions (`./deploy_functions.sh`).
5.  Scheduling the `process-job` and `retry-failed-jobs` functions via pg_cron.
6.  **Crucially:** Verifying the `transcribeAudioWithGemini` function logic in `supabase/functions/process-job/index.ts` (it should be implemented using `@google/genai`) and ensuring the function is deployed.

## Testing Steps

### 0. Create Test User (if needed)

If you don't already have a test user registered in your Supabase project, you can create one using the provided script.

*   Ensure your `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set either as environment variables or in a `.env` file in the project root.
*   Run the script from the project root directory, providing the desired email and password for the new user:
    ```bash
    deno run --allow-env --allow-net src/create_user.ts <new_test_user_email> <new_test_user_password>
    ```
    *(Deno will cache dependencies on the first run)*
*   The script will attempt to sign up the user.
*   **Note:** Depending on your Supabase project's authentication settings, the user might require email confirmation before they can log in. Check the script's output and your email if necessary.

### 1. Obtain User JWT

You need a valid JSON Web Token (JWT) for an authenticated user to interact with the API endpoints.

*   **Method A: Using the `get_jwt.ts` CLI Tool (Recommended):**
    *   Ensure your `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set either as environment variables or in a `.env` file in the project root.
    *   Run the script from the project root directory, providing the email and password of a registered test user:
        ```bash
        deno run --allow-env --allow-net src/get_jwt.ts <your_test_user_email> <your_test_user_password>
        ```
        *(Deno will cache dependencies on the first run)*
    *   The script will attempt to sign in and print the JWT Access Token upon success. Copy the token.

*   **Method B: Using Your Frontend (if applicable):**
    *   Sign up or log in as a test user through your application's interface.
    *   Use your browser's developer tools (Network tab) to inspect the `Authorization: Bearer <token>` header sent with API requests after login. Copy the `<token>` part.

*   **Method C: Using Supabase JS Client (Manual Script/Console):**
    *   Use the `supabase.auth.signInWithPassword()` method from the `@supabase/supabase-js` library in a separate script or browser console connected to your project.
    *   Extract the `access_token` from the successful login response session data.

*   **Method D: Supabase Dashboard (Not Recommended for JWT):**
    *   Go to Authentication > Users.
    *   Find your test user. You *cannot* directly get a JWT here. Using the Service Role Key bypasses user-specific RLS policies and is not suitable for testing user-level API access.

**Keep the obtained JWT ready. It's typically valid for 1 hour.**

### 3. Prepare Test Script and Environment

*   **Ensure `.env` file is configured:** The `test_upload.sh` script now reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` directly from the `.env` file in the project root. Make sure this file exists and contains the correct values.
*   **Make script executable (if not already):**
    ```bash
    chmod +x test_upload.sh
    ```
### 4. Prepare Test Audio URL

*   Have a publicly accessible URL pointing to a sample audio file (e.g., MP3, WAV). This could be hosted on any web server, cloud storage (like a public S3/GCS link), etc. Ensure the URL allows direct download of the audio file.
*   **Important:** The Edge Function running `process-job` must be able to reach and download from this URL.

### 5. Run the Upload Script

*   Navigate to the project root directory in your terminal.
*   Execute the script, providing the public audio URL and the JWT obtained in Step 1:

    ```bash
    # Example:
    ./test_upload.sh "https://example.com/path/to/your/audio.mp3" <YOUR_JWT_HERE>
    ```
    *(Make sure to enclose the URL in quotes if it contains special characters)*

*   The script will output the `curl` command response. Look for a JSON object containing the `job_id`:

    ```json
    {
      "job_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "status": "pending",
      "created_at": "..."
    }
    ```
*   **Copy the `job_id`**.

### 6. Monitor Job Status

*   The `test_upload.sh` script prints a `curl` command template to check the job status. Use it, replacing `<JOB_ID>` with the actual ID you copied:

    ```bash
    # Example:
    curl -X GET \
      '<YOUR_SUPABASE_PROJECT_URL>/functions/v1/get-job-status/<JOB_ID>' \
      -H 'Authorization: Bearer <YOUR_JWT_HERE>' \
      -H 'apikey: <YOUR_SUPABASE_ANON_KEY>'
    ```

*   Run this command periodically (e.g., every 15-30 seconds).
*   Observe the `status` field in the JSON response. The expected flow is:
    1.  `pending` (Immediately after upload)
    2.  `processing` (After the `process-job` cron job picks it up)
    3.  `completed` (If Gemini transcription succeeds) OR `failed` (If an error occurs during processing or Gemini call fails).

### 7. List All User Jobs (Optional)

You can retrieve a list of all jobs submitted by the authenticated user using the `list-jobs` endpoint.

*   Use `curl` or a similar tool, providing your JWT:
    ```bash
    # Example:
    curl -X GET \
      '<YOUR_SUPABASE_PROJECT_URL>/functions/v1/list-jobs' \
      -H 'Authorization: Bearer <YOUR_JWT_HERE>' \
      -H 'apikey: <YOUR_SUPABASE_ANON_KEY>'
    ```
*   The response will be a JSON object containing a `jobs` array, where each element has the details of a job (including `job_id`, `status`, `created_at`, `audio_url`, `transcription_result` if completed, `error` if failed, etc.), ordered by creation date (newest first).

### 8. Check Details on Completion/Failure

*   **If `status` is `completed`:** The response from Step 5 should contain a `transcription_result` field with the JSON object returned by the Gemini API (as defined by the schema in `process-job/index.ts`).
*   **If `status` is `failed`:** The response should contain an `error` field with an error message. Check the `retry_count` and `next_retry_at` fields as well if applicable.

### 9. Review Logs and Database (Troubleshooting)

If the job doesn't complete as expected or gets stuck:

*   **Function Logs:** Go to your Supabase project dashboard > Edge Functions. Check the logs for:
    *   `transcribe`: For upload issues.
    *   `process-job`: For download, Gemini API call, or status update errors.
    *   `retry-failed-jobs`: For issues related to the retry mechanism.
*   **Database:** Go to Table Editor > `jobs` table. Inspect the specific job row:
    *   Check `status`, `error_message`, `retry_count`, `next_retry_at`.
    *   Examine the `state_history` JSONB column for a timestamped log of status changes.

---

Repeat these steps with different audio files or scenarios (e.g., simulate errors in the Gemini call) to thoroughly test the system.