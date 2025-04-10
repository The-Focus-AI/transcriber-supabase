import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Job } from '../shared/types.ts';

export async function updateJobStatus(job: Job, status: string, supabaseClient: SupabaseClient): Promise<void> {
    console.log(`Updating job ${job.id} status to '${status}'.`);
    const { error: updateError } = await supabaseClient
        .from('jobs')
        .update({ status, last_updated_at: new Date().toISOString() })
        .eq('id', job.id);

    if (updateError) {
        console.error(`Failed to update job ${job.id} status to '${status}':`, updateError);
    }
} 