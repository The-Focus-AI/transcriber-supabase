import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function processPendingJobs(supabaseClient: SupabaseClient): Promise<void> {
    console.log('Checking for pending jobs...');
    try {
        const { data: pendingJobs, error: fetchError } = await supabaseClient
            .from('jobs')
            .select('id, workflow_id, input_data')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(10);

        if (fetchError) {
            console.error('Error fetching pending jobs:', fetchError);
            return;
        }

        if (!pendingJobs || pendingJobs.length === 0) {
            console.log('No pending jobs found.');
            return;
        }

        console.log(`Found ${pendingJobs.length} pending jobs. Starting them...`);

        const updatePromises = pendingJobs.map(async (job) => {
            const { error: updateError } = await supabaseClient
                .from('jobs')
                .update({ status: 'running', current_step_id: 'start' })
                .eq('id', job.id);

            if (updateError) {
                console.error(`Failed to start job ${job.id}:`, updateError);
            } else {
                console.log(`Job ${job.id} started.`);
            }
        });

        await Promise.all(updatePromises);

    } catch (error) {
        console.error('Unexpected error processing pending jobs:', error);
    }
} 