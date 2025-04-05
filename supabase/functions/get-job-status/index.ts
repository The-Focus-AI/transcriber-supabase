import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

console.log('Get Job Status function booting up');

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Initialize Supabase Client (User Scoped)
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 2. Verify User Authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized: ' + (userError?.message ?? 'Invalid token') }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log('User authenticated:', user.id);

    // 3. Extract Job ID from URL Path
    // URL pattern is expected to be /functions/v1/get-job-status/{jobId}
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const jobId = pathParts[pathParts.length - 1]; // Get the last part of the path

    if (!jobId) {
        throw new Error('Missing job ID in request URL.');
    }
    console.log(`Fetching status for job ID: ${jobId}`);

    // 4. Query Job from Database
    // RLS policy ensures the user can only fetch their own jobs
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(`
        id,
        status,
        created_at,
        started_at,
        completed_at,
        transcription_result,
        error_message
      `)
      .eq('id', jobId)
      .single(); // Expecting one job or null

    if (jobError) {
        // If error is PGRST116, it means no rows found (or RLS blocked it)
        if (jobError.code === 'PGRST116') {
            console.warn(`Job not found or access denied for job ID: ${jobId}, user: ${user.id}`);
            return new Response(JSON.stringify({ error: 'Job not found or access denied' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        // Otherwise, it's a different database error
        console.error(`Database query error for job ID ${jobId}:`, jobError);
        throw new Error(`Failed to retrieve job: ${jobError.message}`);
    }

    if (!job) {
        // This case should ideally be caught by PGRST116, but added for safety
        console.warn(`Job not found after query for job ID: ${jobId}, user: ${user.id}`);
        return new Response(JSON.stringify({ error: 'Job not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    console.log(`Job found: ${job.id}, Status: ${job.status}`);

    // 5. Format and Return Response
    const responsePayload = {
        job_id: job.id,
        status: job.status,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        transcription: job.status === 'completed' ? job.transcription_result : null,
        error: job.status === 'failed' ? job.error_message : null,
    };

    return new Response(
      JSON.stringify(responsePayload),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in /get-job-status function:', error);
    // Type guard for error handling
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 400; // Default status
    if (error instanceof Error) {
        if (error.message.includes('Unauthorized')) {
            status = 401;
        } else if (error.message.includes('not found')) {
            status = 404;
        }
    }

    return new Response(
        JSON.stringify({ error: message }),
        {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: status,
        }
    );
  }
});