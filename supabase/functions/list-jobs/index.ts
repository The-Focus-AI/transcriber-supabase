import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

console.log('List Jobs function booting up');

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

    // 3. Query Jobs from Database
    // RLS policy ensures the user can only fetch their own jobs.
    // Ordering by creation date, newest first.
    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select(`
        id,
        status,
        created_at,
        started_at,
        completed_at,
        transcription_result,
        error_message,
        file_path,
        audio_url
      `)
      // While RLS enforces security, explicitly filtering by user_id can sometimes be clearer
      // .eq('user_id', user.id) 
      .order('created_at', { ascending: false });

    if (jobsError) {
      console.error(`Database query error for user ${user.id}:`, jobsError);
      throw new Error(`Failed to retrieve jobs: ${jobsError.message}`);
    }

    console.log(`Found ${jobs?.length ?? 0} jobs for user ${user.id}`);

    // 4. Format and Return Response
    // Map the database results to the desired API response structure
    const formattedJobs = jobs?.map(job => ({
        job_id: job.id,
        status: job.status,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        transcription: job.status === 'completed' ? job.transcription_result : null,
        error: job.status === 'failed' ? job.error_message : null,
        // Include audio_url in the response
        audio_url: job.audio_url,
        // Optionally include file_path if needed by the client
        // file_path: job.file_path
    })) ?? []; // Ensure it's an empty array if jobs is null/undefined

    const responsePayload = {
      jobs: formattedJobs,
    };

    return new Response(
      JSON.stringify(responsePayload),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in /list-jobs function:', error);
    // Type guard for error handling
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    const status = error instanceof Error && error.message.includes('Unauthorized') ? 401 : 400;

    return new Response(
        JSON.stringify({ error: message }),
        {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: status,
        }
    );
  }
});