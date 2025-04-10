import { createSupabaseServiceClient, corsHeaders } from '../shared/supabase-client.ts';
import { fetchRunningJobs } from './jobFetcher.ts';
import { processJobStep } from './jobProcessor.ts';
import { processPendingJobs } from './pendingJobProcessor.ts';

export async function handleOrchestration(): Promise<Response> {
    console.log('Workflow orchestrator function invoked.');

    try {
        const supabaseClient = createSupabaseServiceClient();

        // Fetch running jobs
        const runningJobs = await fetchRunningJobs(supabaseClient);

        if (!runningJobs || runningJobs.length === 0) {
            console.log('No running jobs found needing step execution.');
            await processPendingJobs(supabaseClient);
            return new Response(JSON.stringify({ message: 'No running jobs found. Checked for pending jobs.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        console.log(`Found ${runningJobs.length} running jobs. Processing steps...`);

        // Process each running job
        const stepProcessingPromises = runningJobs.map(job => processJobStep(job, supabaseClient));

        // Wait for all step processing attempts
        const results = await Promise.all(stepProcessingPromises);
        const processedCount = results.length;
        const errorCount = results.filter(r => r.status === 'error' || r.status === 'invocation_error').length;

        console.log(`Step processing complete for this run. Processed: ${processedCount}, Errors/Failures: ${errorCount}`);

        await processPendingJobs(supabaseClient);

        return new Response(JSON.stringify({ 
            message: `Orchestration run finished. Processed ${processedCount} running job steps. Checked for pending jobs.`, 
            processedCount,
            errorCount,
            results
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error('Unhandled error in orchestrator:', error);
        return new Response(JSON.stringify({ error: 'Internal server error in orchestrator' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
} 