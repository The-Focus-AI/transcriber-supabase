import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { config } from 'https://deno.land/x/dotenv@v3.2.0/mod.ts';
import { processJobStep } from './jobProcessor.ts';

// Load environment variables from .env file
const env = config();

// Initialize Supabase client with production credentials
const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_KEY;
const supabaseClient = createClient(supabaseUrl, supabaseKey);

async function testProcessJobStep() {
    try {
        // Fetch a job from the jobs table
        const { data: jobs, error } = await supabaseClient
            .from('jobs')
            .select('*')
            .eq('status', 'pending')
            .limit(1);

        if (error || !jobs || jobs.length === 0) {
            console.error('Failed to fetch a pending job:', error || 'No pending jobs found');
            return;
        }

        const job = jobs[0];
        console.log('Testing processJobStep with job:', job);

        // Execute the processJobStep function
        const result = await processJobStep(job, supabaseClient);
        console.log('Result:', result);
    } catch (err) {
        console.error('Error during test execution:', err);
    }
}

// Run the test
await testProcessJobStep(); 