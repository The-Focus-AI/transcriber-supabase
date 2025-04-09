#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Deploying Supabase functions..."

# Ensure you are in the project root directory before running this script.
# The script assumes the 'supabase' directory is present in the current directory.

# Remove transcribe function as its directory is missing
# supabase functions deploy transcribe --no-verify-jwt

# Update function names and paths based on current directory structure
supabase functions deploy get-job --no-verify-jwt
supabase functions deploy list-jobs --no-verify-jwt
supabase functions deploy workflow-orchestrator --no-verify-jwt
supabase functions deploy execute-echo --no-verify-jwt

# Add any new functions here as needed
# Example: supabase functions deploy new-function-name --no-verify-jwt

echo "All functions deployed successfully."