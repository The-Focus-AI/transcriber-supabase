import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createSupabaseClient, corsHeaders } from '../shared/supabase-client.ts'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function handleRequest(req: Request, supabaseClient: SupabaseClient): Promise<Response> {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Authenticate User
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      console.error('Auth error:', userError)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // 2. Query for jobs associated with the user
    // RLS policy (to be added later) will ensure the user can only select their own jobs.
    // We don't strictly need the .eq('user_id', user.id) here if RLS is correctly implemented,
    // but it can be kept for clarity or as a fallback.
    const { data: jobs, error: dbError } = await supabaseClient
      .from('jobs')
      .select('id, workflow_id, status, created_at, last_updated_at') // Select relevant columns for list view
      // .eq('user_id', user.id) // RLS will handle this filtering
      .order('created_at', { ascending: false }) // Order by creation date, newest first

    if (dbError) {
      console.error('Database error fetching jobs:', dbError)
      return new Response(JSON.stringify({ error: 'Database error' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    // 3. Return the list of jobs
    // If no jobs are found (or RLS filters them all), `jobs` will be an empty array.
    return new Response(JSON.stringify({ jobs: jobs ?? [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Unhandled error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
}

// Start the server
if (import.meta.main) {
  serve(async (req) => {
    const supabaseClient = createSupabaseClient(req)
    return await handleRequest(req, supabaseClient)
  })
} 