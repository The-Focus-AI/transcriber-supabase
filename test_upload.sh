#!/bin/bash

# Simple script to upload an audio file for transcription testing.
# Usage: ./test_upload.sh <path_to_audio_file> <user_jwt>

# --- Configuration ---
# Replace with your actual Supabase project URL and Anon Key
SUPABASE_URL="<YOUR_SUPABASE_PROJECT_URL>"
SUPABASE_ANON_KEY="<YOUR_SUPABASE_ANON_KEY>"
# --- End Configuration ---

# Check if arguments are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <path_to_audio_file> <user_jwt>"
  exit 1
fi

AUDIO_FILE_PATH="$1"
USER_JWT="$2"
FILENAME=$(basename "$AUDIO_FILE_PATH")

# Check if file exists
if [ ! -f "$AUDIO_FILE_PATH" ]; then
    echo "Error: File not found at '$AUDIO_FILE_PATH'"
    exit 1
fi

# Construct the API endpoint URL
TRANSCRIBE_ENDPOINT="${SUPABASE_URL}/functions/v1/transcribe"

echo "Uploading '$FILENAME' to $TRANSCRIBE_ENDPOINT..."

# Perform the upload using curl
curl -X POST \
  "$TRANSCRIBE_ENDPOINT" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -F "audio=@${AUDIO_FILE_PATH}"

echo "" # Newline for clarity
echo "Upload request sent. Check the response above for the job_id."
echo "Use the job_id to check the status periodically:"
echo "curl -X GET '${SUPABASE_URL}/functions/v1/get-job-status/<JOB_ID>' -H 'Authorization: Bearer $USER_JWT' -H 'apikey: $SUPABASE_ANON_KEY'"