import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createSupabaseServiceClient, corsHeaders } from '../shared/supabase-client.ts'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { WorkflowDefinition, Job, Transformer, WorkflowStep } from '../shared/types.ts' // Import shared types

const ORCHESTRATOR_SECRET = Deno.env.get('ORCHESTRATOR_SECRET')
const FUNCTION_INVOKE_TIMEOUT_MS = 30000; // Example: 30 second timeout for function invokes

// Main handler logic
// Export the handler function for testing
export async function handleOrchestration(supabaseClient: SupabaseClient): Promise<Response> {
    console.log('Workflow orchestrator function invoked.')

    try {
        // 1. Fetch RUNNING jobs with a current_step_id
        console.log('Fetching running jobs...')
        const { data: runningJobs, error: fetchError } = await supabaseClient
            .from('jobs')
            // Select fields needed for processing
            .select('id, workflow_id, current_step_id, input_data, step_data') 
            .eq('status', 'running')
            .not('current_step_id', 'is', null) // Ensure current_step_id is not null
            .order('last_updated_at', { ascending: true }) // Process older jobs first
            .limit(10) as { data: Job[] | null, error: any };

        if (fetchError) {
            console.error('Error fetching running jobs:', fetchError)
            return new Response(JSON.stringify({ error: 'Database error fetching jobs' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            })
        }

        if (!runningJobs || runningJobs.length === 0) {
            console.log('No running jobs found needing step execution.')
            // Also check for pending jobs to start them (combining logic from Iteration 5)
            await processPendingJobs(supabaseClient);
            return new Response(JSON.stringify({ message: 'No running jobs found. Checked for pending jobs.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            })
        }

        console.log(`Found ${runningJobs.length} running jobs. Processing steps...`)

        // 2. Process each running job
        const stepProcessingPromises = runningJobs.map(async (job) => {
            if (!job.current_step_id) {
                 console.warn(`Job ${job.id} is running but has no current_step_id. Skipping.`);
                 return { jobId: job.id, status: 'skipped', message: 'Missing current_step_id' };
            }

            try {
                // Fetch Workflow Definition
                const { data: workflowData, error: workflowError } = await supabaseClient
                    .from('workflows')
                    .select('definition')
                    .eq('id', job.workflow_id)
                    .maybeSingle()

                if (workflowError || !workflowData || !workflowData.definition) {
                    console.error(`Error fetching/parsing workflow ${job.workflow_id} for job ${job.id}:`, workflowError || 'Definition missing')
                    // TODO: Handle this failure more robustly (e.g., mark job as failed?)
                    return { jobId: job.id, status: 'error', message: 'Failed to fetch/parse workflow definition' }
                }
                const definition = workflowData.definition as WorkflowDefinition;

                // Get Current Step Configuration
                const currentStepConfig: WorkflowStep | undefined = definition.steps[job.current_step_id];
                if (!currentStepConfig) {
                    console.error(`Current step '${job.current_step_id}' not found in workflow ${job.workflow_id} definition for job ${job.id}.`)
                    // TODO: Handle this failure (mark job as failed?)
                    return { jobId: job.id, status: 'error', message: `Step config '${job.current_step_id}' not found` }
                }

                // Fetch Transformer Details
                const { data: transformerData, error: transformerError } = await supabaseClient
                    .from('transformers')
                    .select('target_function, config') // Select target function and its config
                    .eq('id', currentStepConfig.transformer_id)
                    .maybeSingle() as { data: Pick<Transformer, 'target_function' | 'config'> | null, error: any };

                if (transformerError || !transformerData || !transformerData.target_function) {
                    console.error(`Error fetching transformer ${currentStepConfig.transformer_id} for job ${job.id}:`, transformerError || 'Transformer not found/missing target_function')
                     // TODO: Handle this failure
                    return { jobId: job.id, status: 'error', message: `Failed to fetch transformer ${currentStepConfig.transformer_id}` }
                }
                const { target_function, config: transformerConfig } = transformerData;
                
                console.log(`Job ${job.id}: Invoking step '${job.current_step_id}', transformer '${currentStepConfig.transformer_id}', target function '${target_function}'`);

                // --- Invoke Target Function --- 
                // Prepare payload for the target function
                // TODO: Implement proper input mapping based on currentStepConfig.input_map
                const functionPayload = {
                    job_id: job.id,
                    job_input: job.input_data,
                    step_data: job.step_data, // Pass previous step data
                    transformer_config: transformerConfig,
                    current_step_id: job.current_step_id,
                    // Potentially add user_id if needed by the function?
                };

                let invokeError: Error | null = null;
                try {
                     // Invoke the target Edge Function (using 2-argument signature)
                    const { error: invokeErr } = await supabaseClient.functions.invoke(target_function, {
                        body: functionPayload,
                        // Headers can be added here if needed, e.g.:
                        // headers: { 'Content-Type': 'application/json' }
                    }); // Removed third argument for timeout
                    
                    if (invokeErr) {
                        // If invoke returns an error object, use that
                        console.error(`Job ${job.id}: Invocation returned error for target function '${target_function}':`, invokeErr);
                        invokeError = invokeErr instanceof Error ? invokeErr : new Error(String(invokeErr));
                    } else {
                        console.log(`Job ${job.id}: Successfully invoked target function '${target_function}' for step '${job.current_step_id}'.`);
                        // TODO: Process response from function (Iteration 8/9)
                        // TODO: Determine next_step or completion based on response and workflow definition
                        // TODO: Update job.step_data with output
                        // Placeholder: For now, just update last_updated_at
                    }

                } catch (err) {
                     // Catch errors thrown during the invoke call itself (e.g., network issues)
                    console.error(`Job ${job.id}: Error invoking target function '${target_function}' for step '${job.current_step_id}':`, err)
                    // Ensure the caught error is an Error instance
                    if (err instanceof Error) {
                        invokeError = err;
                    } else {
                        // Convert unknown error type to Error
                        invokeError = new Error(String(err));
                    }
                     // TODO: Implement error handling & retries (Iteration 9/10)
                     // Placeholder: For now, just log and update last_updated_at
                }

                 // Update job's last_updated_at regardless of invocation success/failure for now
                const { error: updateError } = await supabaseClient
                    .from('jobs')
                    .update({ last_updated_at: new Date().toISOString() })
                    .eq('id', job.id);
                
                if (updateError) {
                     console.error(`Job ${job.id}: Failed to update last_updated_at after step execution attempt:`, updateError);
                     // This is a secondary error, the main result is based on invocation
                }

                // Return status based on invocation attempt
                if (invokeError) {
                     return { jobId: job.id, status: 'invocation_error', message: invokeError.message || 'Invocation failed' };
                } else {
                     return { jobId: job.id, status: 'invocation_sent', message: 'Step function invoked' };
                }

            } catch (jobProcessingError) {
                console.error(`Unexpected error processing step for job ${job.id}:`, jobProcessingError)
                return { jobId: job.id, status: 'error', message: 'Unexpected error during step processing' }
            }
        });

        // Wait for all step processing attempts
        const results = await Promise.all(stepProcessingPromises);
        const processedCount = results.length;
        const errorCount = results.filter(r => r.status === 'error' || r.status === 'invocation_error').length;

        console.log(`Step processing complete for this run. Processed: ${processedCount}, Errors/Failures: ${errorCount}`)      

         // Also check for pending jobs after processing running ones
        await processPendingJobs(supabaseClient);

        // Return a summary response
        return new Response(JSON.stringify({ 
            message: `Orchestration run finished. Processed ${processedCount} running job steps. Checked for pending jobs.`, 
            processedCount,
            errorCount,
            results // Include detailed results for debugging
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        console.error('Unhandled error in orchestrator:', error)
        return new Response(JSON.stringify({ error: 'Internal server error in orchestrator' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        })
    }
}

// Helper function to process pending jobs (logic from Iteration 5)
async function processPendingJobs(supabaseClient: SupabaseClient): Promise<void> {
     console.log('Checking for pending jobs...');
     try {
         const { data: pendingJobs, error: fetchError } = await supabaseClient
            .from('jobs')
            .select('id, workflow_id')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(10) as { data: Job[] | null, error: any };

         if (fetchError) {
             console.error('Error fetching pending jobs:', fetchError); return;
         }
         if (!pendingJobs || pendingJobs.length === 0) {
             console.log('No pending jobs found.'); return;
         }

         console.log(`Found ${pendingJobs.length} pending jobs. Starting them...`);
         const updatePromises = pendingJobs.map(async (job) => {
             try {
                 const { data: workflow, error: workflowError } = await supabaseClient
                     .from('workflows')
                     .select('definition')
                     .eq('id', job.workflow_id)
                     .maybeSingle();

                 if (workflowError || !workflow || !workflow.definition) {
                     console.error(`Pending Job ${job.id}: Cannot start - Workflow ${job.workflow_id} definition missing or invalid.`, workflowError);
                     // TODO: Mark job as failed?
                     return; 
                 }
                 const definition = workflow.definition as WorkflowDefinition;
                 if (!definition.start_step) {
                     console.error(`Pending Job ${job.id}: Cannot start - Workflow ${job.workflow_id} definition missing 'start_step'.`);
                     // TODO: Mark job as failed?
                     return;
                 }
                 const startStepId = definition.start_step;

                 const { error: updateError } = await supabaseClient
                     .from('jobs')
                     .update({
                         status: 'running',
                         started_at: new Date().toISOString(),
                         current_step_id: startStepId,
                         last_updated_at: new Date().toISOString(),
                     })
                     .eq('id', job.id)
                     .eq('status', 'pending');

                 if (updateError) {
                     console.error(`Pending Job ${job.id}: Error updating status to running:`, updateError);
                 } else {
                     console.log(`Pending Job ${job.id} marked as running, current step: ${startStepId}`);
                 }
             } catch (jobError) {
                 console.error(`Pending Job ${job.id}: Unexpected error during startup:`, jobError);
             }
         });
         await Promise.all(updatePromises);
         console.log('Finished processing pending jobs.');

     } catch (error) {
          console.error('Error in processPendingJobs:', error);
     }
}


// Serve the function
serve(async (req) => {
    // 1. Check for Secret (if invoking via HTTP for testing/manual runs)
    const authHeader = req.headers.get('Authorization')
    if (!ORCHESTRATOR_SECRET || authHeader !== `Bearer ${ORCHESTRATOR_SECRET}`) {
         console.warn('Unauthorized attempt to invoke orchestrator.')
         return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 401,
        })
    }

    // 2. Create Service Client
    let supabaseClient: SupabaseClient;
    try {
        supabaseClient = createSupabaseServiceClient();
    } catch (e) {
        console.error('Failed to create Supabase service client:', e);
        return new Response(JSON.stringify({ error: 'Failed to initialize Supabase client' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }

    // 3. Handle Orchestration Logic
    return await handleOrchestration(supabaseClient);
}) 