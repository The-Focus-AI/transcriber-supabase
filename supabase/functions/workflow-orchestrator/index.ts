import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { handleOrchestration } from './orchestrator.ts';

const ORCHESTRATOR_SECRET = Deno.env.get('ORCHESTRATOR_SECRET');

// Serve the function
serve(async (req) => {
    // Check for secret in request headers
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${ORCHESTRATOR_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    // Call the orchestrator function
    return await handleOrchestration();
}); 