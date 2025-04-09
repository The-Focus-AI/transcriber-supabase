import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

// --- Configuration & Constants ---
await config({ export: true }); // Load .env file variables into Deno.env

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
const JWT_FILE_PATH = join(Deno.cwd(), ".jwt_token"); // Store JWT in the current directory

// --- Helper Functions ---

async function writeJwt(token: string): Promise<void> {
    try {
        await Deno.writeTextFile(JWT_FILE_PATH, token);
        console.info(`JWT token saved to ${JWT_FILE_PATH}`);
    } catch (err) {
        console.error(`Error saving JWT token: ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function readJwt(): Promise<string | null> {
    try {
        const token = await Deno.readTextFile(JWT_FILE_PATH);
        return token.trim();
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return null; // File doesn't exist, which is fine
        }
        console.error(`Error reading JWT token: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}

function ensureSupabaseConfig(): boolean {
    if (!supabaseUrl) {
        console.error("Error: SUPABASE_URL environment variable not set.");
        return false;
    }
    if (!supabaseAnonKey) {
        console.error("Error: SUPABASE_ANON_KEY environment variable not set.");
        return false;
    }
    return true;
}

function getSupabaseClient(): SupabaseClient | null {
     if (!ensureSupabaseConfig()) return null;
     return createClient(supabaseUrl!, supabaseAnonKey!);
}

async function makeApiRequest(endpoint: string, method: 'GET' | 'POST', jwt: string, body?: unknown): Promise<any> {
    if (!ensureSupabaseConfig()) {
        throw new Error("Supabase configuration missing.");
    }

    const url = `${supabaseUrl}${endpoint}`; // Assumes endpoint starts with /functions/v1/...
    const headers: HeadersInit = {
        'Authorization': `Bearer ${jwt}`,
        'apikey': supabaseAnonKey!,
        'Content-Type': 'application/json'
    };

    try {
        console.info(`Making ${method} request to ${url}...`);
        const response = await fetch(url, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const responseBody = await response.json();

        if (!response.ok) {
            console.error(`API Error (${response.status}): ${response.statusText}`);
            console.error("Response body:", responseBody);
            throw new Error(`API request failed with status ${response.status}`);
        }

        console.info("API Request successful.");
        return responseBody;
    } catch (err) {
        console.error(`Error during API request to ${url}: ${err instanceof Error ? err.message : String(err)}`);
        throw err; // Re-throw after logging
    }
}


// --- Command Implementations ---

async function handleLogin(args: any) {
    const email = args.email ?? args._[1];
    const password = args.password ?? args._[2];

    if (!email || !password) {
        console.error("Usage: deno run --allow-env --allow-net --allow-read --allow-write src/cli.ts login <email> <password>");
        Deno.exit(1);
    }

    const supabase = getSupabaseClient();
    if (!supabase) Deno.exit(1);

    try {
        console.log(`Attempting to sign in as ${email}...`);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            console.error("Sign-in error:", error.message);
            Deno.exit(1);
        }

        if (data.session?.access_token) {
            console.log("Sign-in successful!");
            await writeJwt(data.session.access_token);
        } else {
            console.error("Sign-in succeeded but no access token found in session.");
            Deno.exit(1);
        }
    } catch (err) {
        console.error("An unexpected error occurred during login:", err instanceof Error ? err.message : String(err));
        Deno.exit(1);
    }
}

async function handleCreateUser(args: any) {
    const email = args.email ?? args._[1];
    const password = args.password ?? args._[2];

     if (!email || !password) {
        console.error("Usage: deno run --allow-env --allow-net src/cli.ts create-user <email> <password>");
        Deno.exit(1);
    }

    const supabase = getSupabaseClient();
    if (!supabase) Deno.exit(1);

    try {
        console.log(`Attempting to create user ${email}...`);
        const { data, error } = await supabase.auth.signUp({ email, password });

        if (error) {
            console.error("Sign-up error:", error.message);
            if (error.message.includes("User already registered")) {
                console.warn("Hint: This email address is already in use.");
            } else if (error.message.includes("Password should be at least 6 characters")) {
                console.warn("Hint: Ensure the password meets the minimum length requirement.");
            }
            Deno.exit(1);
        }

        if (data.user) {
             console.log(`Successfully initiated sign-up for ${email}.`);
             if (data.session) {
                 console.log("User is immediately active (email confirmation might be disabled).");
             } else {
                 console.log("Sign-up successful. Please check email for confirmation if enabled.");
             }
        } else {
            console.error("Sign-up seemed to succeed but no user data was returned as expected.");
            Deno.exit(1);
        }
    } catch (err) {
        console.error("An unexpected error occurred during sign-up:", err instanceof Error ? err.message : String(err));
        Deno.exit(1);
    }
}

async function handleListJobs(args: any) {
    const jwt = await readJwt();
    if (!jwt) {
        console.error("Error: Not logged in. Please run 'login' first to get a JWT.");
        Deno.exit(1);
    }

    try {
        const result = await makeApiRequest('/functions/v1/list-jobs', 'GET', jwt);

        if (args.json) {
            // Output raw JSON if --json flag is present
            console.log(JSON.stringify(result, null, 2));
        } else {
            // Output formatted table by default
            console.log("\n--- User Jobs ---");
            if (result && Array.isArray(result.jobs) && result.jobs.length > 0) {
                // Simple table formatting with console.log
                // Add a new column for the last step
                console.log("Job ID                                | Status      | Last Step   | Created At           | Audio URL                           | Result / Error");
                console.log("--------------------------------------+-------------+-------------+----------------------+-------------------------------------+--------------------------");
                result.jobs.forEach((job: any) => {
                    const jobId = job.job_id?.padEnd(36) ?? 'N/A'.padEnd(36);
                    const status = job.status?.padEnd(11) ?? 'N/A'.padEnd(11);
                    const createdAt = job.created_at ? new Date(job.created_at).toISOString().substring(0, 19).replace('T', ' ') : 'N/A';
                    const audioUrl = job.audio_url?.substring(0, 35).padEnd(35) ?? 'N/A'.padEnd(35);
                    let resultOrError = 'N/A';
                    if (job.status === 'completed' && job.transcription) { // Use 'transcription' field from formattedJobs
                         resultOrError = `Completed (${JSON.stringify(job.transcription).length} chars)`;
                    } else if (job.status === 'failed' && job.error) { // Use 'error' field from formattedJobs
                        resultOrError = `Failed: ${String(job.error).substring(0, 20)}...`;
                    } else if (job.status !== 'pending' && job.status !== 'processing') {
                         resultOrError = job.status;
                    }

                    // Get last step from state_history
                    let lastStep = job.status?.padEnd(11) ?? 'N/A'.padEnd(11); // Default to main status
                    if (Array.isArray(job.state_history) && job.state_history.length > 0) {
                        const latestEvent = job.state_history[job.state_history.length - 1];
                        if (latestEvent && typeof latestEvent.status === 'string') {
                            lastStep = latestEvent.status.padEnd(11);
                        }
                    }

                    console.log(`${jobId} | ${status} | ${lastStep} | ${createdAt} | ${audioUrl} | ${resultOrError.substring(0,25).padEnd(25)}`);
                });
            } else if (result && Array.isArray(result.jobs)) {
                 console.log("No jobs found for this user.");
            } else {
                console.error("Unexpected response format:", result);
            }
            console.log("-----------------------------------------------------------------------------------------------------------------------------------------------\n"); // Adjusted line length
             console.log("Hint: Use the --json flag to see the full details for each job.");
        }
    } catch (err) {
        // Error already logged in makeApiRequest
        Deno.exit(1);
    }
}

async function handleSubmitJob(args: any) {
    const audioUrl = args.url ?? args._[1];
    if (!audioUrl) {
         console.error("Usage: deno run --allow-env --allow-net --allow-read --allow-write src/cli.ts submit-job <audio_url>");
         Deno.exit(1);
    }

    const jwt = await readJwt();
    if (!jwt) {
        console.error("Error: Not logged in. Please run 'login' first to get a JWT.");
        Deno.exit(1);
    }
    

    try {
        const result = await makeApiRequest('/functions/v1/transcribe', 'POST', jwt, { audio_url: audioUrl });
        console.log("\n--- Submit Job Result ---");
        console.log(JSON.stringify(result, null, 2));
        console.log("-------------------------\n");
        if (result.job_id) {
            console.log(`Job submitted successfully. Job ID: ${result.job_id}`);
            console.log(`Use 'get-status ${result.job_id}' to check its status.`);
        }
    } catch (err) {
        // Error already logged in makeApiRequest
        Deno.exit(1);
    }
}

async function handleGetStatus(args: any) {
    const jobId = args.jobid ?? args.jobId ?? args._[1]; // Allow different casings
     if (!jobId) {
         console.error("Usage: deno run --allow-env --allow-net --allow-read src/cli.ts get-status <job_id>");
         Deno.exit(1);
    }

    const jwt = await readJwt();
    if (!jwt) {
        console.error("Error: Not logged in. Please run 'login' first to get a JWT.");
        Deno.exit(1);
    }

    try {
        const job = await makeApiRequest(`/functions/v1/get-job-status/${jobId}`, 'GET', jwt);

        console.log(`\n--- Status for Job ${jobId} ---`);

        if (!job || typeof job !== 'object') {
            console.error("Error: Received invalid response from API.");
            Deno.exit(1);
        }

        // Display core details
        console.log(`  Job ID:          ${job.job_id}`);
        console.log(`  Current Status:  ${job.status}`);
        console.log(`  Created At:      ${job.created_at ? new Date(job.created_at).toLocaleString() : 'N/A'}`);
        console.log(`  Started At:      ${job.started_at ? new Date(job.started_at).toLocaleString() : 'N/A'}`);
        console.log(`  Completed At:    ${job.completed_at ? new Date(job.completed_at).toLocaleString() : 'N/A'}`);
        console.log(`  Google File ID:  ${job.google_file_id || 'N/A'}`);

        // Display State History
        console.log("\n  State History:");
        if (Array.isArray(job.state_history) && job.state_history.length > 0) {
            job.state_history.forEach((step: any, index: number) => {
                const timestamp = step.timestamp ? new Date(step.timestamp).toLocaleString() : 'N/A';
                console.log(`    ${index + 1}. ${step.status?.padEnd(15)} @ ${timestamp}`);
            });
        } else {
            console.log("    (No detailed history available)");
        }

        // Display Transcription or Error
        if (job.status === 'completed' && job.transcription) {
            console.log("\n  Transcription Result:");
            // Pretty print the JSON transcription
            try {
                 const transcript = typeof job.transcription === 'string'
                    ? JSON.parse(job.transcription)
                    : job.transcription;
                 console.log(JSON.stringify(transcript, null, 2).split('\n').map(line => `    ${line}`).join('\n'));
            } catch (parseError) {
                 console.error("    Error parsing transcription result:", parseError instanceof Error ? parseError.message : String(parseError));
                 console.log("    Raw transcription data:", job.transcription);
            }
        } else if (job.status === 'failed' && job.error) {
            console.log("\n  Error Message:");
            console.log(`    ${job.error}`);
        }

        console.log("-------------------------------\n");

    } catch (err) {
        // Error likely already logged in makeApiRequest
        console.error(`\nError fetching status for job ${jobId}.`);
        Deno.exit(1);
    }
}
async function handleGetTranscript(args: any) {
    const jobId = args.jobid ?? args.jobId ?? args._[1]; // Allow different casings
     if (!jobId) {
         console.error("Usage: deno run --allow-env --allow-net --allow-read src/cli.ts get-transcript <job_id>");
         Deno.exit(1);
    }

    const jwt = await readJwt();
    if (!jwt) {
        console.error("Error: Not logged in. Please run 'login' first to get a JWT.");
        Deno.exit(1);
    }

    try {
        const result = await makeApiRequest(`/functions/v1/get-job-status/${jobId}`, 'GET', jwt);

        if (result && result.status === 'completed' && result.transcription_result) {
            console.log(`\n--- Transcript for Job ${jobId} ---`);
            // Assuming transcription_result is already a JSON object or stringified JSON
            try {
                const transcript = typeof result.transcription_result === 'string'
                    ? JSON.parse(result.transcription_result)
                    : result.transcription_result;
                console.log(JSON.stringify(transcript, null, 2));
            } catch (parseError) {
                 console.error("Error parsing transcription result:", parseError instanceof Error ? parseError.message : String(parseError));
                 console.log("Raw transcription result:", result.transcription_result);
            }
             console.log("----------------------------------\n");
        } else if (result && result.status) {
            console.log(`Job ${jobId} status is '${result.status}'. Transcript not available.`);
        } else if (result && result.error) {
             console.error(`Error fetching job ${jobId}: ${result.error}`);
             Deno.exit(1);
        }
         else {
            console.error(`Could not retrieve status or transcript for job ${jobId}. Response:`, result);
            Deno.exit(1);
        }
    } catch (err) {
        // Error likely already logged in makeApiRequest, but catch here too
        console.error(`Failed to get transcript for job ${jobId}.`);
        Deno.exit(1);
    }
}


function printUsage() {
    console.log(`
Usage: deno run --allow-env --allow-net --allow-read --allow-write src/cli.ts <command> [options]

Commands:
  login <email> <password>          Sign in and save JWT token locally.
  create-user <email> <password>    Create a new user account.
  list-jobs [--json]                List jobs (default: table view). Use --json for full JSON output.
  submit-job <audio_url>            Submit a new transcription job with a public audio URL.
  get-status <job_id>               Check the status of a specific job.
  help                              Show this help message.

Environment Variables:
  SUPABASE_URL         (Required) URL of your Supabase project.
  SUPABASE_ANON_KEY    (Required) Anon key for your Supabase project.
                       (Can be set in a .env file in the project root)

Notes:
  - The 'login' command saves the JWT to a '.jwt_token' file in the current directory.
  - Other commands ('list-jobs', 'submit-job', 'get-status') read the JWT from this file.
  - Ensure necessary Deno permissions are granted (--allow-env, --allow-net, --allow-read, --allow-write).
`);
}

// --- Main Execution ---
async function main() {
    const args = parse(Deno.args);
    const command = args._[0];

    // Check for required env vars early, except for help command
    if (command !== 'help' && !ensureSupabaseConfig()) {
         printUsage();
         Deno.exit(1);
    }

    switch (command) {
        case 'login':
            await handleLogin(args);
            break;
        case 'get-transcript':
            await handleGetTranscript(args);
            break;
        case 'create-user':
            await handleCreateUser(args);
            break;
        case 'list-jobs':
            await handleListJobs(args);
            break;
        case 'submit-job':
            await handleSubmitJob(args);
            break;
        case 'get-status':
            await handleGetStatus(args);
            break;
        case 'help':
        default:
            printUsage();
            Deno.exit(command === 'help' ? 0 : 1);
    }
}

if (import.meta.main) {
    await main();
}