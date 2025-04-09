import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import * as path from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "https://esm.sh/@google/genai";

// --- Load Environment Variables ---
// Ensure you have a .env file in the project root with GOOGLE_GEMINI_API_KEY
await config({ export: true, path: ".env" });
const geminiApiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");

if (!geminiApiKey) {
  console.error("Error: GOOGLE_GEMINI_API_KEY not found in .env file.");
  Deno.exit(1);
} else {
  console.log("[Verification] Using Gemini API Key starting with:", geminiApiKey.substring(0, 5) + "..." + geminiApiKey.substring(geminiApiKey.length - 5));
}


// --- Constants (Copied from process-job) ---
const TRANSCRIPTION_OUTPUT_SCHEMA = {
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "timestamp": { "type": "string", "description": "Start time of the segment in mm:ss format" },
          "ad": { "type": "boolean", "description": "Indicates if the segment is an advertisement" },
          "speaker": { "type": "string", "description": "Identified speaker (e.g., Speaker 1, Speaker 2)" },
          "text": { "type": "string", "description": "Transcribed text for the segment" },
          "tone": { "type": "string", "description": "Overall tone of the segment (e.g., informative, conversational, urgent)" }
        },
        "required": ["timestamp", "ad", "speaker", "text", "tone"]
      }
    }
  },
  "required": ["items"]
};

// --- Helper Functions (Copied & Modified) ---

// Simple helper to guess MIME type from filename
function getMimeTypeFromFilename(filename: string): string | undefined {
    const extension = path.extname(filename).toLowerCase();
    switch (extension) {
        case '.mp3': return 'audio/mpeg';
        case '.wav': return 'audio/wav';
        case '.ogg': return 'audio/ogg';
        case '.flac': return 'audio/flac';
        case '.m4a': return 'audio/mp4'; // Common for M4A
        // Add other common audio types if needed
        default: return undefined; // Let Google try to detect if unknown
    }
}

// Dummy updateJobStatus for local logging
async function updateJobStatus(jobId: string, newStatus: string, extraData: Record<string, any> = {}) {
    console.log(`\n--- [LOCAL TEST - Job ${jobId}] Status Update ---`);
    console.log(`New Status: '${newStatus}'`);
    console.log(`Extra Data: ${JSON.stringify(extraData)}`);
    console.log("-----------------------------------------------\n");
    // No database interaction here
    await Promise.resolve(); // Simulate async
}

// Copied transcribeAudioWithGemini function (exactly as in process-job/index.ts after last fix)
async function transcribeAudioWithGemini(
    audioBlob: Blob,
    originalFilePath: string,
    apiKey: string
): Promise<{ transcriptionResult: any, googleFileUri: string }> { // Return object
    const modelName = "gemini-1.5-flash-latest"; // Try the flash model
    console.log(`[Gemini] Transcribing audio file: ${originalFilePath}, size: ${audioBlob.size} using model: ${modelName}`);

    if (!apiKey) {
        throw new Error("GOOGLE_GEMINI_API_KEY environment variable not set");
    }

    const ai = new GoogleGenAI({ apiKey });
    const originalFilename = path.basename(originalFilePath);

    // --- Generate a ALWAYS UNIQUE filename (resource name) for Google File API ---
    // Use only the UUID to ensure uniqueness and stay within the 40-char limit.
    const uniqueGoogleFileName = crypto.randomUUID(); // UUID is 36 chars
    console.log(`[Gemini] Generated unique Google File API resource name (UUID): ${uniqueGoogleFileName}`);
    // We will now always upload, skipping the 'get' check.

    let googleFileUri: string;
    let googleFileMimeType: string;

    // --- Always Upload with Unique Name ---
    try {
        console.log(`[Gemini] Uploading with unique name: ${uniqueGoogleFileName}`);
        const uploadResult = await ai.files.upload({
            file: audioBlob,
            config: {
                name: uniqueGoogleFileName, // Use the UUID as the resource name
                displayName: originalFilename,
                // Explicitly set MIME type based on filename, fallback to blob type or default
                mimeType: getMimeTypeFromFilename(originalFilename) || audioBlob.type || 'audio/mpeg'
            }
        });
        console.log("[Gemini] Google File API Upload Result:", uploadResult);
        if (!uploadResult.uri || !uploadResult.mimeType) {
            throw new Error("Uploaded file does not have a valid URI or MIME type from Google File API");
        }
        googleFileUri = uploadResult.uri;
        googleFileMimeType = uploadResult.mimeType;
        console.log(`[Gemini] File uploaded successfully. URI: ${googleFileUri}, MIME Type used for upload: ${audioBlob.type || 'audio/mpeg'}`);
    } catch (uploadError) {
         console.error(`[Gemini] Error during forced upload with unique name '${uniqueGoogleFileName}':`, uploadError);
         // Re-throw the error to be caught by the main processJob handler
         throw new Error(`Failed to upload file to Google: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
    }

    // Add a delay to allow Google time to process the file
    const delaySeconds = 5;
    console.log(`[Gemini] Waiting ${delaySeconds} seconds for file processing before calling model...`);
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));

    console.log(`[Gemini] Calling Gemini model ${modelName} with file URI: ${googleFileUri}`);
    const result = await ai.models.generateContent({
        model: modelName,
        contents: createUserContent([
            createPartFromUri(googleFileUri, googleFileMimeType),
            "Please transcribe the audio.", // Simplified prompt
        ]),
    });

    const responseText = result.text?.trim();
    if (!responseText) {
        console.error("[Gemini] API returned no text response:", result);
        throw new Error("Gemini API returned an empty response.");
    }
    console.log("[Gemini] Raw Gemini Response Text:", responseText.substring(0, 200) + (responseText.length > 200 ? '...' : ''));

    // Since we removed the JSON schema, we expect plain text, not JSON.
    // We'll return the raw text and the URI.
    // The calling function (runLocalTest) will need to handle this.
    console.log("[Gemini] Received text response (no JSON parsing attempted).");
    return { transcriptionResult: responseText, googleFileUri: googleFileUri };
}


// --- Main Local Test Logic (Adapted from processJob) ---
async function runLocalTest(jobId: string, audioUrlString: string, apiKey: string) {
    console.log(`[LOCAL TEST - Job ${jobId}] Starting processing. URL: ${audioUrlString}`);
    try {
        await updateJobStatus(jobId, 'processing', { started_at: new Date().toISOString() });

        if (!audioUrlString) {
            throw new Error(`Job ${jobId} is missing the audio_url.`);
        }

        await updateJobStatus(jobId, 'downloading');
        let blob: Blob;
        let fetchedFileName: string;
        let audioContentType: string | undefined;

        // --- Direct Fetch Logic ---
        try {
            const audioUrl = new URL(audioUrlString);
            const headersToUse = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': audioUrl.origin,
                'Accept': 'audio/mpeg, audio/wav, audio/*;q=0.9, */*;q=0.8',
            };
            console.log(`[LOCAL TEST - Job ${jobId}] Attempting direct download from ${audioUrlString} with headers: ${JSON.stringify(headersToUse)}`);

            const response = await fetch(audioUrlString, { headers: headersToUse });
            console.log(`[LOCAL TEST - Job ${jobId}] Direct download response status: ${response.status} ${response.statusText}`);
            console.log(`[LOCAL TEST - Job ${jobId}] Direct download response headers:`);
            for (const [key, value] of response.headers.entries()) {
                 console.log(`  ${key}: ${value}`);
            }

            if (!response.ok) {
                let errorBody = `Download failed with status: ${response.status} ${response.statusText}`;
                 try {
                     const textBody = await response.text();
                     errorBody += `\nResponse body: ${textBody.substring(0, 500)}${textBody.length > 500 ? '...' : ''}`;
                     console.warn(`[LOCAL TEST - Job ${jobId}] Download failed response body snippet: ${errorBody}`);
                 } catch (e) {
                      console.warn(`[LOCAL TEST - Job ${jobId}] Could not read error response body:`, e);
                 }
                throw new Error(errorBody);
            }

            console.log(`[LOCAL TEST - Job ${jobId}] Direct download successful (2xx). Reading blob...`);
            blob = await response.blob();
            audioContentType = response.headers.get('Content-Type') || blob.type || 'application/octet-stream';
            console.log(`[LOCAL TEST - Job ${jobId}] Read blob: size ${blob.size}, type ${audioContentType}, blob.type property: ${blob.type}`); // Log blob.type explicitly

            // Extract filename from Content-Disposition or URL
            const disposition = response.headers.get('content-disposition');
            let filenameMatch = disposition?.match(/filename="?(.+?)"?(;|$)/i);
            fetchedFileName = filenameMatch ? filenameMatch[1] : path.basename(audioUrl.pathname);
            console.log(`[LOCAL TEST - Job ${jobId}] Derived filename: ${fetchedFileName}`);

        } catch (fetchError) {
             console.error(`[LOCAL TEST - Job ${jobId}] Failed during direct download:`, fetchError);
             throw new Error(`Failed to download audio directly: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
        // --- End Direct Fetch Logic ---

        await updateJobStatus(jobId, 'uploading');
        console.log(`[LOCAL TEST - Job ${jobId}] Calling transcribeAudioWithGemini...`);
        const { transcriptionResult, googleFileUri } = await transcribeAudioWithGemini(blob, fetchedFileName, apiKey);
        console.log(`[LOCAL TEST - Job ${jobId}] Received transcription result and Google File URI: ${googleFileUri}`);

        await updateJobStatus(jobId, 'transcribing', { google_file_id: googleFileUri });

        console.log(`[LOCAL TEST - Job ${jobId}] Transcription successful. Simulating completion.`);
        await updateJobStatus(jobId, 'completed', {
             completed_at: new Date().toISOString(),
             // transcription_result: transcriptionResult, // Don't log full result here
             google_file_id: googleFileUri,
             error_message: null,
        });
        console.log(`[LOCAL TEST - Job ${jobId}] Successfully completed.`);
        console.log("\n--- FINAL TRANSCRIPTION RESULT (Local Test - Plain Text) ---");
        console.log(transcriptionResult); // Log the plain text result
        console.log("----------------------------------------------------------");


    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unknown processing error occurred';
        console.error(`[LOCAL TEST - Job ${jobId}] Processing failed:`, message);
        console.error("Error stack:", error instanceof Error ? error.stack : "N/A");
        await updateJobStatus(jobId, 'failed', { error_message: message });
    }
}

// --- Script Execution ---
async function main() {
    const args = parse(Deno.args);
    const audioUrlArg = args._[0];

    if (typeof audioUrlArg !== 'string' || !audioUrlArg) {
        console.error("Usage: deno run --allow-env --allow-net --allow-read src/test_process_job_local.ts <audio_url>");
        console.error("Ensure .env file with GOOGLE_GEMINI_API_KEY is present in the project root.");
        Deno.exit(1);
    }

    const testJobId = `local-test-${Date.now()}`;
    console.log(`Starting local test run for Job ID: ${testJobId}`);
    await runLocalTest(testJobId, audioUrlArg, geminiApiKey!);
    console.log(`Local test run finished for Job ID: ${testJobId}`);
}

if (import.meta.main) {
    await main();
}