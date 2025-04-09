import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function createSupabaseClient(req: Request) {
  // Create a Supabase client with the user's auth token
  const client = createClient(
    // Supabase API URL - env var recommended for production
    Deno.env.get('SUPABASE_URL') ?? '',
    // Supabase API ANON KEY - env var recommended for production
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    // Create client with Auth context of the user that called the function.
    // This way your row-level-security (RLS) policies are applied.
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  )
  return client
}

// Function to create a client with service role privileges
export function createSupabaseServiceClient() {
  // Ensure environment variables are available
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
    // Optionally throw an error or handle appropriately
    throw new Error('Missing Supabase environment variables for service client.');
  }

  const client = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      // The service role key bypasses RLS, so no specific auth context is needed.
      auth: {
          // This prevents the client from trying to automatically refresh tokens,
          // which is not applicable for the service role key.
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
      }
    }
  );
  return client;
}

// Simple CORS headers utility (can be expanded)
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Adjust in production!
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} 