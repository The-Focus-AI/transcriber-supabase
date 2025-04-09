import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createSupabaseClient, corsHeaders } from '../shared/supabase-client.ts'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Helper to extract jobId from URL
const getJobIdFromUrl = (url: string): string | null => {
  try {
    const urlPattern = new URLPattern({ pathname: '/jobs/:jobId' })
    const match = urlPattern.exec(url)
    return match?.pathname?.groups?.jobId ?? null
  } catch (error) {
    console.error("Error parsing URL:", error)
    return null
  }
}

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

    // 2. Extract Job ID from URL path
    const jobId = getJobIdFromUrl(req.url)
    if (!jobId) {
        return new Response(JSON.stringify({ error: 'Invalid URL or missing Job ID' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // 3. Query for the specific job
    // RLS policy (to be added later) will ensure the user can only select their own jobs.
    const { data: job, error: dbError } = await supabaseClient
      .from('jobs')
      .select('*') // Select all columns for the job details
      .eq('id', jobId)
      .maybeSingle() // Returns null if not found (or RLS prevents access)

    if (dbError) {
      console.error('Database error fetching job:', dbError)
      return new Response(JSON.stringify({ error: 'Database error' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    // 4. Return Job or 404
    if (!job) {
      // This happens if the job doesn't exist OR RLS prevents access
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    // Return the found job details
    return new Response(JSON.stringify(job), {
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