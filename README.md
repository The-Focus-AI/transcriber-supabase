# Supabase Audio Transcription Service

This project implements a serverless audio transcription service using Supabase and Google's Gemini API.

## Overview

The service accepts a publicly accessible URL pointing to an audio file. It queues a transcription job, processes the audio asynchronously using Google Gemini (specifically `gemini-2.5-pro-preview-03-25` via the Google File API), and stores the resulting transcription JSON.

Key features include:
-   Accepts audio URLs for processing.
-   Asynchronous job queueing and processing via Supabase Edge Functions.
-   Transcription powered by Google Gemini.
-   Job status tracking (`pending`, `processing`, `completed`, `failed`).
-   Automatic retry mechanism for failed jobs.
-   User authentication via Supabase Auth.
-   RESTful API endpoints for submitting jobs and checking status.

## Workflow

1.  A user submits a request to the `/transcribe` endpoint with an `audio_url` in the JSON body.
2.  A new job record is created in the database with status `pending`.
3.  A scheduled Edge Function (`process-job`) periodically picks up pending jobs.
4.  The `process-job` function downloads the audio from the `audio_url`.
5.  The downloaded audio is uploaded to the Google File API.
6.  The Gemini API is called with the Google File URI to perform the transcription according to a defined JSON schema.
7.  The job status is updated to `completed` with the transcription result, or `failed` with an error message.
8.  Failed jobs are automatically retried based on the defined backoff strategy.
9.  Users can check job status via the `/get-job-status/{jobId}` endpoint or list their jobs via `/list-jobs`.

## Getting Started

1.  **Deployment:** Follow the instructions in [DEPLOY.md](./DEPLOY.md) to set up your Supabase project, configure environment variables, deploy database migrations, and deploy the Edge Functions.
2.  **Testing:** Follow the instructions in [TESTING.md](./TESTING.md) to create test users, obtain JWTs, and submit transcription jobs using the provided test script or `curl`.

## Project Structure

-   `supabase/`: Contains Supabase project configuration, migrations, and Edge Functions.
    -   `migrations/`: Database schema definitions.
    -   `functions/`: Source code for the Edge Functions (`transcribe`, `process-job`, etc.).
-   `src/`: Contains helper CLI scripts for testing (`get_jwt.ts`, `create_user.ts`).
-   `test_upload.sh`: Bash script for submitting test jobs via URL.
-   `DEPLOY.md`: Detailed deployment instructions.
-   `TESTING.md`: Detailed testing instructions.
-   `project-brief.md`: Original project requirements and design notes (updated for URL workflow).
