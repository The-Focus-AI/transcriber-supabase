import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// IMPORTANT: Set these environment variables in your Supabase project settings
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

console.log('Retry Failed Jobs function booting up');

const MAX_RETRIES = 3; // Consistent with process-job logic

serve(async (req: Request) => {
  // Intended for scheduled invocation. Add security if needed for HTTP triggers.
  console.log(`Retry Failed Jobs function invoked via ${req.method}`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase environment variables (URL/Service Key)');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date().toISOString();

    // 1. Find jobs eligible for retry
    // Status is 'failed', retry_count is less than max, and next_retry_at is in the past
    const { data: jobsToRetry, error: fetchError } = await supabaseAdmin
      .from('jobs')
      .select('id, retry_count') // Select only needed fields
      .eq('status', 'failed')
      .lt('retry_count', MAX_RETRIES) // Check if retry_count < 3
      .lte('next_retry_at', now) // Check if scheduled retry time is now or in the past
      .order('next_retry_at', { ascending: true }) // Process earliest scheduled first
      .limit(10); // Limit batch size per invocation

    if (fetchError) {
      console.error('Error fetching jobs eligible for retry:', fetchError);
      throw new Error(`Failed to fetch jobs for retry: ${fetchError.message}`);
    }

    if (!jobsToRetry || jobsToRetry.length === 0) {
      console.log('No jobs found eligible for retry at this time.');
      return new Response(JSON.stringify({ message: 'No jobs to retry' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`Found ${jobsToRetry.length} jobs eligible for retry.`);

    // 2. Update status back to 'pending' for eligible jobs
    const jobIdsToUpdate = jobsToRetry.map(job => job.id);

    const { data: updateData, error: updateError } = await supabaseAdmin
        .from('jobs')
        .update({
            status: 'pending',
            // Optionally clear the error message and next_retry_at upon retry attempt
            // error_message: null,
            // next_retry_at: null
            // Keeping them might be useful for debugging history, process-job will overwrite on next failure anyway.
        })
        .in('id', jobIdsToUpdate); // Update all found jobs in one go

    if (updateError) {
        console.error(`Error updating status for jobs [${jobIdsToUpdate.join(', ')}]:`, updateError);
        // Partial success is possible. Log the error but report success for those potentially updated.
        // A more robust system might track individual update failures.
        throw new Error(`Failed to update some jobs to pending: ${updateError.message}`);
    }

    console.log(`Successfully reset status to 'pending' for ${jobIdsToUpdate.length} jobs.`);

    return new Response(JSON.stringify({ message: `Triggered retry for ${jobIdsToUpdate.length} job(s).` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred in the retry handler';
    console.error('Error in retry-failed-jobs handler:', message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500, // Internal Server Error
      }
    );
  }
});