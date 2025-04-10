import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Job } from '../shared/types.ts';

export async function handleError(job: Job, error: Error, supabaseClient: SupabaseClient): Promise<void> {
    console.error(`Error processing job ${job.id}:`, error);
    // Update job status to 'failed' or log the error in the job's history
    const { error: updateError } = await supabaseClient
        .from('jobs')
        .update({ status: 'failed', last_updated_at: new Date().toISOString() })
        .eq('id', job.id);

    if (updateError) {
        console.error(`Failed to update job ${job.id} status to 'failed':`, updateError);
    }
} 