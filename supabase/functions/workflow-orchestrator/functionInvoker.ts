import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Job, WorkflowStep, Transformer } from '../shared/types.ts';
import jp from 'npm:jsonpath';

export async function invokeTargetFunction(job: Job, currentStepConfig: WorkflowStep, transformerConfig: Transformer['config'], target_function: string, supabaseClient: SupabaseClient): Promise<{ jobId: string, status: string, message: string }> {
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

    if (invokeError) {
        return { jobId: job.id, status: 'invocation_error', message: invokeError.message || 'Invocation failed' };
    } else {
        return { jobId: job.id, status: 'invocation_sent', message: 'Step function invoked' };
    }
} 