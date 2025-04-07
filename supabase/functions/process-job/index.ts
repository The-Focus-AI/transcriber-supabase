import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Import Google GenAI modules
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
  type FileData, // Import FileData type for upload
} from "https://esm.sh/@google/genai";
import { corsHeaders } from '../_shared/cors.ts'; // Although likely not called via HTTP, good practice
import * as path from "https://deno.land/std@0.177.0/path/mod.ts"; // For extracting filename

// IMPORTANT: Set these environment variables in your Supabase project settings
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - GOOGLE_GEMINI_API_KEY
// - GOOGLE_GEMINI_API_KEY
// - GEMINI_TRANSCRIPTION_MODEL (e.g., gemini-1.5-flash-latest) - Model used for transcription

console.log('Process Job function booting up');

// Define the desired output schema for transcription
const TRANSCRIPTION_OUTPUT_SCHEMA = {
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "timestamp": {
            "type": "string",
            "description": "Start time of the segment in mm:ss format"
          },
          "ad": {
            "type": "boolean",
            "description": "Indicates if the segment is an advertisement"
          },
          "speaker": {
            "type": "string",
            "description": "Identified speaker (e.g., Speaker 1, Speaker 2)"
          },
          "text": {
            "type": "string",
            "description": "Transcribed text for the segment"
          },
          "tone": {
            "type": "string",
            "description": "Overall tone of the segment (e.g., informative, conversational, urgent)"
          }
        },
        "required": [
          "timestamp",
          "ad",
          "speaker",
          "text",
          "tone"
        ]
      }
    }
  },
  "required": [
    "items"
  ]
};

// Actual implementation using Google File API and Gemini
async function transcribeAudioWithGemini(
    audioBlob: Blob,
    originalFilePath: string, // Pass the original file path to extract filename
    apiKey: string
    // modelName parameter removed, will be hardcoded
): Promise<any> {
    const modelName = "gemini-2.5-pro-preview-03-25"; // Hardcoded model name from src/transcribe.ts
    console.log(`Transcribing audio file: ${originalFilePath}, size: ${audioBlob.size} using model: ${modelName}`);

    if (!apiKey) {
        throw new Error("GOOGLE_GEMINI_API_KEY environment variable not set");
    }
    // Removed check for modelName env var

    const ai = new GoogleGenAI({ apiKey });
    const originalFilename = path.basename(originalFilePath); // Extract filename from URL path or Content-Disposition

    // Sanitize filename for Google File API requirements:
    // - Lowercase
    // - Alphanumeric and dashes only
    // - No leading/trailing dashes
    let sanitizedFilename = originalFilename
        .toLowerCase()
        // Replace unsupported characters (anything not alphanumeric or dash) with a dash
        .replace(/[^a-z0-9-]+/g, '-')
        // Remove leading dashes
        .replace(/^-+/, '')
        // Remove trailing dashes
        .replace(/-+$/, '');

    // Handle cases where sanitization results in an empty string or just dashes
    if (!sanitizedFilename || sanitizedFilename === '-') {
        sanitizedFilename = `audio-file-${Date.now()}`; // Use a generic name + timestamp
    }

    // Ensure filename doesn't exceed potential length limits (optional, but good practice)
    // const maxLength = 100; // Example max length
    // sanitizedFilename = sanitizedFilename.substring(0, maxLength);


    // 1. Upload file to Google File API
    console.log(`Uploading sanitized filename: ${sanitizedFilename} (original: ${originalFilename}, type: ${audioBlob.type || 'audio/mpeg'}) to Google File API...`);

    // Pass the blob directly in the 'file' property, and use 'config' for metadata
    const uploadResult = await ai.files.upload({
        file: audioBlob, // Pass the Blob directly
        config: {
            name: sanitizedFilename, // Use the sanitized name for the resource ID
            displayName: originalFilename, // Keep original name for display (optional)
            mimeType: audioBlob.type || 'audio/mpeg' // Ensure MIME type is provided
        }
    });
    console.log("Google File API Upload Result:", uploadResult);

    if (!uploadResult.uri || !uploadResult.mimeType) {
        throw new Error("Uploaded file does not have a valid URI or MIME type from Google File API");
    }

    // 2. Call Gemini model with file reference and schema prompt
    console.log(`Calling Gemini model ${modelName} with file URI: ${uploadResult.uri}`);
    const result = await ai.models.generateContent({
        model: modelName,
        contents: createUserContent([
            createPartFromUri(uploadResult.uri, uploadResult.mimeType),
            "Transcribe the audio into the following JSON format, identifying speakers and segment details: " + JSON.stringify(TRANSCRIPTION_OUTPUT_SCHEMA),
        ]),
        // Optional: Add generationConfig if needed (temperature, etc.)
    });

    // 3. Extract and parse the result
    const responseText = result.text?.trim();
    if (!responseText) {
        console.error("Gemini API returned no text response:", result);
        throw new Error("Gemini API returned an empty response.");
    }

    console.log("Raw Gemini Response Text:", responseText);

    try {
        // Gemini might return the JSON within markdown ```json ... ``` tags
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        const jsonToParse = jsonMatch ? jsonMatch[1] : responseText;
        const parsedResult = JSON.parse(jsonToParse);
        console.log("Parsed Transcription Result:", parsedResult);
        return parsedResult;
    } catch (parseError) {
        // Check if parseError is an Error object before accessing message
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        console.error("Failed to parse Gemini JSON response:", errorMessage);
        console.error("Raw response was:", responseText);
        throw new Error(`Failed to parse transcription JSON: ${errorMessage}`);
    }

    // Note: Consider deleting the uploaded file from Google File API after processing
    // await ai.files.delete({ name: uploadResult.name });
    // console.log(`Deleted file ${uploadResult.name} from Google File API.`);
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


async function processJob(supabaseAdmin: any, job: any, apiKey: string) { // Removed modelName param
    console.log(`Processing job ID: ${job.id}, url: ${job.audio_url}`);
    // Bucket name no longer needed here

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

        // 2. Download audio file from URL
        if (!job.audio_url) {
            throw new Error(`Job ${job.id} is missing the audio_url.`);
        }
        console.log(`Downloading audio from URL: ${job.audio_url}`);
        let blob: Blob;
        let fetchedFileName: string; // Store filename derived from URL or Content-Disposition
        try {
            const response = await fetch(job.audio_url);
            if (!response.ok) {
                throw new Error(`Failed to fetch audio URL: ${response.status} ${response.statusText}`);
            }
            blob = await response.blob();

            // Attempt to get filename from Content-Disposition header
            const disposition = response.headers.get('content-disposition');
            let filenameMatch = disposition?.match(/filename="?(.+?)"?(;|$)/i);
            fetchedFileName = filenameMatch ? filenameMatch[1] : path.basename(new URL(job.audio_url).pathname); // Fallback to URL path

            // Basic check if content type looks like audio
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.startsWith('audio/')) {
                 console.warn(`Content-Type from URL (${contentType}) doesn't look like audio. Proceeding anyway.`);
            }

        } catch (fetchError) {
             console.error(`Failed to download audio from ${job.audio_url} for job ${job.id}:`, fetchError);
             throw new Error(`Failed to download audio file from URL: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
        console.log(`Audio downloaded successfully from URL, size: ${blob.size}, derived filename: ${fetchedFileName}`);

        // 3. Call Gemini API
        // Pass the downloaded blob and the derived filename
        const transcriptionResult = await transcribeAudioWithGemini(blob, fetchedFileName, apiKey);

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
    // Removed geminiModel retrieval

    if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) { // Removed check for geminiModel
      throw new Error('Missing required environment variables (Supabase URL/Key, Gemini Key)');
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

      await processJob(supabaseAdmin, job, geminiApiKey); // Removed geminiModel argument
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