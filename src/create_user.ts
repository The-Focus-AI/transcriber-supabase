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
  console.error("Usage: deno run --allow-env --allow-net src/create_user.ts <new_email> <new_password>");
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
async function createUser(email: string, password: string): Promise<boolean> {
  try {
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!);

    console.log(`Attempting to create user ${email}...`);
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      // You might want to add options here if needed, e.g., email confirmation settings
      // options: {
      //   emailRedirectTo: 'http://localhost:3000', // Example redirect URL
      // }
    });

    if (error) {
      console.error("Sign-up error:", error.message);
      // Check for common errors
      if (error.message.includes("User already registered")) {
         console.warn("Hint: This email address is already in use.");
      } else if (error.message.includes("Password should be at least 6 characters")) {
         console.warn("Hint: Ensure the password meets the minimum length requirement.");
      }
      return false;
    }

    // Check if user creation requires confirmation or is immediately active
    if (data.user && data.user.identities && data.user.identities.length > 0) {
        console.log(`Successfully initiated sign-up for ${email}.`);
        if (data.session) {
            console.log("User is immediately active (email confirmation might be disabled).");
        } else {
            console.log("Sign-up successful. Please check email for confirmation if enabled.");
        }
        return true;
    } else if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
        // This case might occur if email confirmation is required and the user object is returned without identities yet
        console.log("Sign-up successful. Please check email for confirmation if enabled.");
        return true;
    }
     else {
      console.error("Sign-up seemed to succeed but no user data was returned as expected.");
      return false;
    }
  } catch (err) {
    console.error("An unexpected error occurred during sign-up:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// --- Execution ---
const success = await createUser(email, password);

if (!success) {
  console.error("\nFailed to create user.");
  Deno.exit(1);
}