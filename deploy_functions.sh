#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Deploying Supabase functions..."

# Ensure you are in the project root directory before running this script.
# The script assumes the 'supabase' directory is present in the current directory.

supabase functions deploy transcribe --no-verify-jwt
supabase functions deploy get-job-status --no-verify-jwt
supabase functions deploy list-jobs --no-verify-jwt
supabase functions deploy process-job --no-verify-jwt
supabase functions deploy retry-failed-jobs --no-verify-jwt

echo "All functions deployed successfully."