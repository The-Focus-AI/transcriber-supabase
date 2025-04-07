import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

// Load .env file variables into Deno.env
await config({ export: true });

// --- Configuration ---
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

// --- Argument Parsing ---
const args = Deno.args;
if (args.length !== 2) {
  console.error("Usage: deno run --allow-env --allow-net src/get_jwt.ts <email> <password>");
  console.error("Ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in your environment or .env file.");
  Deno.exit(1);
}

const email = args[0];
const password = args[1];

// --- Validation ---
if (!supabaseUrl) {
  console.error("Error: SUPABASE_URL environment variable not set.");
  Deno.exit(1);
}
if (!supabaseAnonKey) {
  console.error("Error: SUPABASE_ANON_KEY environment variable not set.");
  Deno.exit(1);
}

// --- Main Logic ---
async function getJwt(email: string, password: string): Promise<string | null> {
  try {
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!);

    console.log(`Attempting to sign in as ${email}...`);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      console.error("Sign-in error:", error.message);
      return null;
    }

    if (data.session?.access_token) {
      console.log("Sign-in successful!");
      return data.session.access_token;
    } else {
      console.error("Sign-in succeeded but no access token found in session.");
      return null;
    }
  } catch (err) {
    console.error("An unexpected error occurred:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// --- Execution ---
const jwt = await getJwt(email, password);

if (jwt) {
  console.log("\n--- JWT Access Token ---");
  console.log(jwt);
  console.log("------------------------\n");
} else {
  console.error("\nFailed to retrieve JWT.");
  Deno.exit(1);
}