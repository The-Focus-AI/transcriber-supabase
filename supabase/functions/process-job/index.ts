import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts'; // Although likely not called via HTTP, good practice

// IMPORTANT: Set these environment variables in your Supabase project settings
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - GOOGLE_GEMINI_API_KEY
// - GEMINI_API_ENDPOINT (e.g., https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent)

console.log('Process Job function booting up');

// Placeholder function for Gemini API call
// Replace with actual implementation based on Google's API documentation
async function transcribeAudioWithGemini(audioBlob: Blob, apiKey: string, endpoint: string): Promise<any> {
  console.log(`Calling Gemini API at ${endpoint} for audio size: ${audioBlob.size}`);

  // TODO: Replace with actual Gemini API request structure
  // This might involve multipart/form-data or base64 encoding the audio
  // Example using fetch (adjust headers, body, method as needed):
  /*
  const response = await fetch(`${endpoint}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // Or appropriate content type
    body: JSON.stringify({
      // Gemini-specific request payload structure here
      // Might involve sending the audio data directly or a reference
      contents: [{ parts: [{ inline_data: { mime_type: audioBlob.type, data: await blobToBase64(audioBlob) } }] }]
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API Error Response:', errorText);
    throw new Error(`Gemini API request failed with status ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  console.log('Gemini API Success Response:', result);
  // TODO: Extract the actual transcription from the result object
  return result; // Return the full result for now
  */

  // --- Placeholder ---
  await new Promise(resolve => setTimeout(resolve, 3000)); // Simulate network delay
  if (Math.random() < 0.1) { // Simulate occasional failure
      throw new Error("Simulated Gemini API Error");
  }
  return {
      transcription: "This is a simulated transcription result.",
      confidence: 0.95,
      words: [ { word: "this", start: 0.1, end: 0.3 }, /* ... */ ]
  };
  // --- End Placeholder ---
}

// Helper to convert Blob to Base64 (if needed by Gemini API)
// async function blobToBase64(blob: Blob): Promise<string> {
//   const arrayBuffer = await blob.arrayBuffer();
//   const uint8Array = new Uint8Array(arrayBuffer);
//   let binaryString = '';
//   uint8Array.forEach((byte) => {
//     binaryString += String.fromCharCode(byte);
//   });
//   return btoa(binaryString);
// }


async function processJob(supabaseAdmin: any, job: any, apiKey: string, endpoint: string) {
    console.log(`Processing job ID: ${job.id}, file: ${job.file_path}`);
    const bucketName = 'audio_files'; // Ensure this matches the upload bucket

    try {
        // 1. Update job status to 'processing' and set started_at
        const { error: updateStartError } = await supabaseAdmin
            .from('jobs')
            .update({ status: 'processing', started_at: new Date().toISOString() })
            .eq('id', job.id);

        if (updateStartError) {
            console.error(`Failed to update job ${job.id} to processing:`, updateStartError);
            // Don't throw here, maybe log and skip? Or attempt retry later?
            // For now, we log and stop processing this job in this run.
            return;
        }

        // 2. Download audio file from Storage
        console.log(`Downloading file: ${job.file_path} from bucket: ${bucketName}`);
        const { data: blob, error: downloadError } = await supabaseAdmin.storage
            .from(bucketName)
            .download(job.file_path);

        if (downloadError || !blob) {
            console.error(`Failed to download file ${job.file_path} for job ${job.id}:`, downloadError);
            throw new Error(`Failed to download audio file: ${downloadError?.message ?? 'Unknown error'}`);
        }
        console.log(`File downloaded successfully, size: ${blob.size}`);

        // 3. Call Gemini API
        const transcriptionResult = await transcribeAudioWithGemini(blob, apiKey, endpoint);

        // 4. Update job status to 'completed'
        console.log(`Transcription successful for job ${job.id}. Updating status to completed.`);
        const { error: updateCompleteError } = await supabaseAdmin
            .from('jobs')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                transcription_result: transcriptionResult, // Store the full result
                error_message: null, // Clear any previous error
            })
            .eq('id', job.id);

        if (updateCompleteError) {
            console.error(`Failed to update job ${job.id} to completed:`, updateCompleteError);
            // This is tricky - transcription succeeded but DB update failed.
            // Log it. The job might be re-processed, potentially re-transcribing.
            // Idempotency in the transcription API or checks could mitigate this.
        } else {
            console.log(`Job ${job.id} successfully completed.`);
        }

    } catch (error) {
        // 5. Handle errors (download, transcription, etc.) -> Update job status to 'failed'
        const message = error instanceof Error ? error.message : 'An unknown processing error occurred';
        console.error(`Processing failed for job ${job.id}:`, message);

        // Calculate retry logic based on current retry_count
        const currentRetryCount = job.retry_count || 0;
        let nextRetryAt: string | null = null;
        let newRetryCount = currentRetryCount + 1;
        const maxRetries = 3; // As per brief

        if (newRetryCount <= maxRetries) {
            let delayMinutes = 0;
            if (newRetryCount === 1) delayMinutes = 1; // 1st retry -> 1 min delay
            else if (newRetryCount === 2) delayMinutes = 2; // 2nd retry -> 2 min delay
            else if (newRetryCount === 3) delayMinutes = 5; // 3rd retry -> 5 min delay

            if (delayMinutes > 0) {
                const now = new Date();
                nextRetryAt = new Date(now.getTime() + delayMinutes * 60000).toISOString();
                console.log(`Scheduling retry ${newRetryCount} for job ${job.id} at ${nextRetryAt}`);
            } else {
                 // This case shouldn't happen with the logic above, but safety first
                 console.warn(`Job ${job.id} failed on attempt ${newRetryCount}, but no delay calculated. Marking as failed permanently.`);
                 newRetryCount = maxRetries + 1; // Ensure it's marked as permanently failed
            }
        } else {
            console.log(`Job ${job.id} has reached max retry count (${maxRetries}). Marking as permanently failed.`);
            // Keep newRetryCount as maxRetries + 1 or similar if needed, or just ensure nextRetryAt is null
        }

        const updatePayload: any = {
            status: 'failed',
            completed_at: new Date().toISOString(), // Mark attempt time
            error_message: message,
            retry_count: newRetryCount <= maxRetries ? newRetryCount : currentRetryCount, // Don't increment past max if already there
        };

        // Only set next_retry_at if a retry is actually scheduled
        if (nextRetryAt) {
            updatePayload.next_retry_at = nextRetryAt;
        } else {
             updatePayload.next_retry_at = null; // Explicitly nullify if max retries reached
        }


        const { error: updateErrorError } = await supabaseAdmin
            .from('jobs')
            .update(updatePayload)
            .eq('id', job.id);

        if (updateErrorError) {
            console.error(`Failed to update job ${job.id} status to failed (retry ${newRetryCount}):`, updateErrorError);
            // If this fails, the job might remain stuck in 'processing'. Needs monitoring.
        }
    }
}


serve(async (req: Request) => {
  // This function is intended to be triggered by a schedule or webhook,
  // not typically direct HTTP requests unless for testing/manual trigger.
  // We add basic security/check if needed.
  // For scheduled functions, Supabase might invoke it without typical headers.
  console.log(`Process Job function invoked via ${req.method} request`);

  // Optional: Add a security check, e.g., a secret header if invoked via HTTP trigger
  // const triggerSecret = req.headers.get('X-Trigger-Secret');
  // if (triggerSecret !== Deno.env.get('FUNCTION_TRIGGER_SECRET')) {
  //   return new Response('Unauthorized', { status: 401 });
  // }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    const geminiEndpoint = Deno.env.get('GEMINI_API_ENDPOINT'); // Get endpoint from env

    if (!supabaseUrl || !serviceRoleKey || !geminiApiKey || !geminiEndpoint) {
      throw new Error('Missing required environment variables (Supabase URL/Key, Gemini Key/Endpoint)');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Fetch pending jobs (limit to avoid overwhelming the function)
    const { data: pendingJobs, error: fetchError } = await supabaseAdmin
      .from('jobs')
      .select('*') // Select all columns needed for processing
      .eq('status', 'pending')
      .order('created_at', { ascending: true }) // Process oldest first
      .limit(5); // Process up to 5 jobs per invocation

    if (fetchError) {
      console.error('Error fetching pending jobs:', fetchError);
      throw new Error(`Failed to fetch pending jobs: ${fetchError.message}`);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log('No pending jobs found.');
      return new Response(JSON.stringify({ message: 'No pending jobs' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`Found ${pendingJobs.length} pending jobs to process.`);

    // Process jobs sequentially (can be parallelized with Promise.all if careful)
    for (const job of pendingJobs) {
      // Avoid processing if already picked up by another instance (simple check)
      // A more robust approach uses row-level locking (e.g., SELECT ... FOR UPDATE SKIP LOCKED)
      // but that's more complex with Supabase functions. Re-fetching status is simpler.
      const { data: currentJob, error: checkError } = await supabaseAdmin
          .from('jobs')
          .select('status')
          .eq('id', job.id)
          .single();

      if (checkError || !currentJob || currentJob.status !== 'pending') {
          console.log(`Job ${job.id} is no longer pending (status: ${currentJob?.status ?? 'not found'}). Skipping.`);
          continue;
      }

      await processJob(supabaseAdmin, job, geminiApiKey, geminiEndpoint);
    }

    return new Response(JSON.stringify({ message: `Processed ${pendingJobs.length} job(s).` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred in the main handler';
    console.error('Error in process-job handler:', message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500, // Internal Server Error
      }
    );
  }
});