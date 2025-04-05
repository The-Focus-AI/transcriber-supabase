# Testing the Supabase Audio Transcription Service

This guide outlines how to perform an end-to-end manual test of the transcription service after deployment and configuration.

## Prerequisites

Before testing, ensure you have completed **all** steps in `DEPLOY.md`, including:
1.  Database migration (`supabase db push`).
2.  Setting all required Environment Variables in Supabase Settings > Edge Functions.
3.  Configuring Supabase Storage (bucket `audio_files`), Authentication (Email provider enabled), and RLS policies.
4.  Deploying all Edge Functions (`./deploy_functions.sh`).
5.  Scheduling the `process-job` and `retry-failed-jobs` functions via pg_cron.
6.  **Crucially:** Implementing the actual `transcribeAudioWithGemini` function logic in `supabase/functions/process-job/index.ts` and redeploying that function.

## Testing Steps

### 1. Obtain User JWT

You need a valid JSON Web Token (JWT) for an authenticated user to interact with the API endpoints.

*   **Method A: Using Your Frontend (if applicable):**
    *   Sign up or log in as a test user through your application's interface.
    *   Use your browser's developer tools (Network tab) to inspect the `Authorization: Bearer <token>` header sent with API requests after login. Copy the `<token>` part.
*   **Method B: Using Supabase JS Client (Script/Console):**
    *   Use the `supabase.auth.signInWithPassword()` method from the `@supabase/supabase-js` library in a simple script or browser console connected to your project.
    *   Extract the `access_token` from the successful login response session data.
*   **Method C: Supabase Dashboard (for quick tests, less secure):**
    *   Go to Authentication > Users.
    *   Find your test user. You *cannot* directly get a JWT here, but you can use the Service Role Key for testing *if* you temporarily modify the API functions to accept it or bypass auth checks (NOT recommended for regular testing).

**Keep the obtained JWT ready. It's typically valid for 1 hour.**

### 2. Configure Test Script

*   Open the `test_upload.sh` script.
*   Replace the placeholder values for `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your actual project details.
*   Save the script.
*   Make sure the script is executable: `chmod +x test_upload.sh`

### 3. Prepare Test Audio File

*   Have a sample audio file (e.g., `test.mp3`, `test.wav`) ready on your local machine.

### 4. Run the Upload Script

*   Navigate to the project root directory in your terminal.
*   Execute the script, providing the path to your audio file and the JWT obtained in Step 1:

    ```bash
    # Example:
    ./test_upload.sh /path/to/your/audio/test.mp3 <YOUR_JWT_HERE>
    ```

*   The script will output the `curl` command response. Look for a JSON object containing the `job_id`:

    ```json
    {
      "job_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "status": "pending",
      "created_at": "..."
    }
    ```
*   **Copy the `job_id`**.

### 5. Monitor Job Status

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

### 6. Check Details on Completion/Failure

*   **If `status` is `completed`:** The response from Step 5 should contain a `transcription` field with the result from the Gemini API.
*   **If `status` is `failed`:** The response should contain an `error` field with an error message. Check the `retry_count` and `next_retry_at` fields as well if applicable.

### 7. Review Logs and Database (Troubleshooting)

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