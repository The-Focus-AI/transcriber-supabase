#!/bin/bash

# Simple script to upload an audio file for transcription testing.
# Usage: ./test_upload.sh <audio_url> <user_jwt>

# --- Configuration ---
# Reads configuration from .env file in the current directory
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Configuration file '$ENV_FILE' not found."
    echo "Please create a .env file in the project root with SUPABASE_URL and SUPABASE_ANON_KEY."
    exit 1
fi

# Read values from .env file, ignoring commented lines and handling potential whitespace
SUPABASE_URL=$(grep -E '^\s*SUPABASE_URL\s*=' "$ENV_FILE" | grep -v '^\s*#' | cut -d '=' -f 2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
SUPABASE_ANON_KEY=$(grep -E '^\s*SUPABASE_ANON_KEY\s*=' "$ENV_FILE" | grep -v '^\s*#' | cut -d '=' -f 2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Validate that values were read
if [ -z "$SUPABASE_URL" ]; then
    echo "Error: SUPABASE_URL not found or empty in '$ENV_FILE'."
    exit 1
fi

if [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "Error: SUPABASE_ANON_KEY not found or empty in '$ENV_FILE'."
    exit 1
fi
# --- End Configuration ---

# Check if arguments are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <audio_url> <user_jwt>"
  exit 1
fi

AUDIO_URL="$1"
USER_JWT="$2"

# Basic check if it looks like a URL (can be improved)
if [[ ! "$AUDIO_URL" =~ ^https?:// ]]; then
  echo "Error: The first argument '$AUDIO_URL' does not look like a valid HTTP/HTTPS URL."
  exit 1
fi

# Construct the API endpoint URL
TRANSCRIBE_ENDPOINT="${SUPABASE_URL}/functions/v1/transcribe"

echo "Sending transcription request for URL '$AUDIO_URL' to $TRANSCRIBE_ENDPOINT..."

# Perform the request using curl, sending JSON data
curl -X POST \
  "$TRANSCRIBE_ENDPOINT" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"audio_url\": \"$AUDIO_URL\"}"

echo "" # Newline for clarity
echo "Upload request sent. Check the response above for the job_id."
echo "Use the job_id to check the status periodically:"
echo "curl -X GET '${SUPABASE_URL}/functions/v1/get-job-status/<JOB_ID>' -H 'Authorization: Bearer $USER_JWT' -H 'apikey: $SUPABASE_ANON_KEY'"