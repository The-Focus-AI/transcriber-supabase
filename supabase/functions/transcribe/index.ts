import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts'; // We'll create this shared file next

console.log('Transcribe function booting up');

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Initialize Supabase Client
    // Ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in project env vars
    // Use Service Role Key for admin actions like inserting into 'jobs' and uploading files
    // Ensure SUPABASE_SERVICE_ROLE_KEY is set in project env vars
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 2. Get User from JWT
    // Create a client scoped to the user's request to verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
        console.error('Auth error:', userError);
        return new Response(JSON.stringify({ error: 'Unauthorized: ' + (userError?.message ?? 'Invalid token') }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
    console.log('User authenticated:', user.id);

    // 3. Parse JSON Body for audio_url
    if (req.headers.get("content-type") !== "application/json") {
      throw new Error("Request body must be JSON");
    }
    const body = await req.json();
    const audioUrl = body.audio_url;

    if (!audioUrl || typeof audioUrl !== 'string') {
      throw new Error('Missing or invalid "audio_url" in JSON request body.');
    }

    // Basic URL validation (can be made more robust)
    try {
      new URL(audioUrl); // Check if it's a valid URL structure
    } catch (_) {
      throw new Error(`Invalid URL format provided: ${audioUrl}`);
    }
    console.log(`Received audio URL: ${audioUrl}`);

    // 4. File Upload to Supabase Storage is REMOVED

    // 5. Create Job Record in Database
    const { data: jobData, error: jobError } = await supabaseAdmin
      .from('jobs')
      .insert({
        user_id: user.id,
        audio_url: audioUrl, // Store the provided URL
        file_path: null, // Set file_path to null as we are using URL
        status: 'pending', // Initial status
      })
      .select('id, status, created_at') // Select the fields needed for the response
      .single(); // Expecting a single row insertion

    if (jobError) {
      console.error('Database insert error:', jobError);
      // No storage upload to roll back
      throw new Error(`Failed to create job record: ${jobError.message}`);
    }

    console.log('Job created successfully:', jobData);

    // 6. Return Response
    return new Response(
      JSON.stringify({
        job_id: jobData.id,
        status: jobData.status,
        created_at: jobData.created_at,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 201, // 201 Created
      }
    );

  } catch (error) {
    console.error('Error in /transcribe function:', error);
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