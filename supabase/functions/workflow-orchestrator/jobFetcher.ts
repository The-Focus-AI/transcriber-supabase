import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Job } from '../shared/types.ts';

export async function fetchRunningJobs(supabaseClient: SupabaseClient): Promise<Job[]> {
    console.log('Fetching running jobs...');
    const { data: runningJobs, error: fetchError } = await supabaseClient
        .from('jobs')
        .select('id, workflow_id, current_step_id, input_data, step_data')
        .eq('status', 'running')
        .neq('current_step_id', null)
        .order('last_updated_at', { ascending: true })
        .limit(10) as { data: Job[] | null, error: any };

    if (fetchError) {
        console.error('Error fetching running jobs:', fetchError);
        throw new Error('Database error fetching jobs');
    }

    return runningJobs || [];
} 