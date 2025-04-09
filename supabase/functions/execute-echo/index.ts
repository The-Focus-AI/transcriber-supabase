import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

console.log(`Function "execute-echo" up and running!`);

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } }); // Basic CORS header
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Parse the request body
    const requestBody = await req.json();
    console.log("Received request body:", requestBody);

    // Extract the job details and payload sent by the orchestrator
    // Adjust the expected structure based on what workflow-orchestrator sends
    const { jobId, payload } = requestBody;

    if (!payload) {
      console.error('Missing payload in request body');
      return new Response(JSON.stringify({ error: 'Missing "payload" in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- Echo Logic ---
    // Simply take the received payload and return it under an 'output' key
    const outputData = {
        echoed_payload: payload
    };
    // ---------------

    console.log(`Echoing payload for job ${jobId}:`, outputData);

    // Return the result
    return new Response(
      JSON.stringify({ output: outputData }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error processing echo request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// To run locally:
// deno run --allow-net --allow-read supabase/functions/execute-echo/index.ts
//
// Example curl request:
// curl -X POST http://localhost:8000/ \
//   -H "Content-Type: application/json" \
//   -d '{
//         "jobId": "job-123",
//         "payload": { "message": "hello world", "count": 42 }
//       }' 