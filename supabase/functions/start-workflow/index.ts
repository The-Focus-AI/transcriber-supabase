import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createSupabaseClient, corsHeaders } from '../shared/supabase-client.ts'
// Import SupabaseClient type for dependency injection
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2' 

// Define the expected request body structure
interface StartWorkflowPayload {
  workflow_id: string;
  input_data?: Record<string, unknown>; // Optional input data
}

// Accept supabaseClient as an argument
export async function handleRequest(req: Request, supabaseClient: SupabaseClient): Promise<Response> {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Get User (Client is already initialized and passed in)
    // const supabaseClient = createSupabaseClient(req) // Removed: Client is now injected
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

    if (userError) {
      console.error('Auth error:', userError)
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // 2. Parse Request Body
    if (req.body === null) {
      return new Response(JSON.stringify({ error: 'Missing request body' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }
    // Check for potentially empty body after preflight which might cause json parse error
    if (req.headers.get("content-length") === "0") {
       return new Response(JSON.stringify({ error: 'Empty request body' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const payload: StartWorkflowPayload = await req.json()
    const { workflow_id, input_data } = payload

    if (!workflow_id) {
      return new Response(JSON.stringify({ error: 'Missing workflow_id in request body' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // 3. Verify Workflow ID exists
    const { data: workflow, error: workflowError } = await supabaseClient
      .from('workflows')
      .select('id')
      .eq('id', workflow_id)
      .maybeSingle() // Use maybeSingle to return null if not found

    if (workflowError) {
      console.error('Workflow fetch error:', workflowError)
      return new Response(JSON.stringify({ error: 'Database error checking workflow' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    if (!workflow) {
      return new Response(JSON.stringify({ error: `Workflow with id '${workflow_id}' not found` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404, // Use 404 Not Found
      })
    }

    // 4. Insert Job into Database
    const { data: newJob, error: insertError } = await supabaseClient
      .from('jobs')
      .insert({
        workflow_id: workflow_id,
        user_id: user.id, // Associate job with authenticated user
        status: 'pending', // Initial status
        input_data: input_data ?? {}, // Use provided input or default to empty object
      })
      .select('id, status, created_at') // Select the fields needed for the response
      .single() // Expect a single row back

    if (insertError) {
      console.error('Job insert error:', insertError)
      // Check for specific errors like RLS violation if needed
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    // 5. Return Success Response
    // Use optional chaining for potentially null newJob just in case
    console.log(`Successfully created job ${newJob?.id} for workflow ${workflow_id}`)
    return new Response(JSON.stringify(newJob), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 201, // 201 Created
    })

  } catch (error) {
    // Catch JSON parsing errors specifically
    if (error instanceof SyntaxError) {
       return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }
    console.error('Unhandled error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
}

// Start the server only when the script is run directly
if (import.meta.main) {
  serve(async (req) => {
    // Create the client here for the actual server
    const supabaseClient = createSupabaseClient(req)
    // Pass the created client to the handler
    return await handleRequest(req, supabaseClient)
  })
} 