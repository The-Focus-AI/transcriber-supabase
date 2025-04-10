import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Job, WorkflowDefinition, WorkflowStep, Transformer } from '../shared/types.ts';
import jp from 'npm:jsonpath';

async function fetchWorkflowDefinition(supabaseClient: SupabaseClient, workflowId: string): Promise<WorkflowDefinition | null> {
    const { data, error } = await supabaseClient
        .from('workflows')
        .select('definition')
        .eq('id', workflowId)
        .maybeSingle();

    if (error || !data) {
        console.error(`Error fetching/parsing workflow ${workflowId}:`, error || 'Definition missing');
        return null;
    }
    return data.definition as WorkflowDefinition;
}

async function fetchTransformerDetails(supabaseClient: SupabaseClient, transformerId: string): Promise<Pick<Transformer, 'target_function' | 'config'> | null> {
    const { data, error } = await supabaseClient
        .from('transformers')
        .select('target_function, config')
        .eq('id', transformerId)
        .maybeSingle();

    if (error || !data) {
        console.error(`Error fetching transformer ${transformerId}:`, error || 'Transformer not found');
        return null;
    }
    return data;
}

export async function processJobStep(job: Job, supabaseClient: SupabaseClient): Promise<{ jobId: string, status: string, message: string }> {
    if (!job.current_step_id) {
        console.warn(`Job ${job.id} is running but has no current_step_id. Skipping.`);
        return { jobId: job.id, status: 'skipped', message: 'Missing current_step_id' };
    }

    try {
        // Fetch Workflow Definition
        const definition = await fetchWorkflowDefinition(supabaseClient, job.workflow_id);
        if (!definition) {
            return { jobId: job.id, status: 'error', message: 'Failed to fetch/parse workflow definition' };
        }

        // Get Current Step Configuration
        const currentStepConfig: WorkflowStep | undefined = definition.steps[job.current_step_id];
        if (!currentStepConfig) {
            console.error(`Current step '${job.current_step_id}' not found in workflow ${job.workflow_id} definition for job ${job.id}.`);
            return { jobId: job.id, status: 'error', message: `Step config '${job.current_step_id}' not found` };
        }

        // Fetch Transformer Details
        const transformerData = await fetchTransformerDetails(supabaseClient, currentStepConfig.transformer_id);
        if (!transformerData) {
            return { jobId: job.id, status: 'error', message: `Failed to fetch transformer ${currentStepConfig.transformer_id}` };
        }
        const { target_function, config: transformerConfig } = transformerData;

        console.log(`Job ${job.id}: Invoking step '${job.current_step_id}', transformer '${currentStepConfig.transformer_id}', target function '${target_function}'`);

        // Prepare payload for the target function with JSONPath mapping
        const functionPayload = {
            job_id: job.id,
            job_input: jp.query(job.input_data, currentStepConfig.input_map || '$'),
            step_data: jp.query(job.step_data, currentStepConfig.input_map || '$'),
            transformer_config: transformerConfig,
            current_step_id: job.current_step_id,
        };

        let invokeError: Error | null = null;
        try {
            // Invoke the target Edge Function
            const { error: invokeErr } = await supabaseClient.functions.invoke(target_function, {
                body: functionPayload,
            });

            if (invokeErr) {
                console.error(`Job ${job.id}: Invocation returned error for target function '${target_function}':`, invokeErr);
                invokeError = invokeErr instanceof Error ? invokeErr : new Error(String(invokeErr));
            } else {
                console.log(`Job ${job.id}: Successfully invoked target function '${target_function}' for step '${job.current_step_id}'.`);
                const responseData = {}; // Assume response data is available here
                job.step_data = jp.query(responseData, currentStepConfig.output_map || '$');
            }

        } catch (err) {
            console.error(`Job ${job.id}: Error invoking target function '${target_function}' for step '${job.current_step_id}':`, err);
            invokeError = err instanceof Error ? err : new Error(String(err));
        }

        const { error: updateError } = await supabaseClient
            .from('jobs')
            .update({ last_updated_at: new Date().toISOString() })
            .eq('id', job.id);

        if (updateError) {
            console.error(`Job ${job.id}: Failed to update last_updated_at after step execution attempt:`, updateError);
        }

        if (invokeError) {
            return { jobId: job.id, status: 'invocation_error', message: invokeError.message || 'Invocation failed' };
        } else {
            return { jobId: job.id, status: 'invocation_sent', message: 'Step function invoked' };
        }

    } catch (jobProcessingError) {
        console.error(`Unexpected error processing step for job ${job.id}:`, jobProcessingError);
        return { jobId: job.id, status: 'error', message: 'Unexpected error during step processing' };
    }
} 