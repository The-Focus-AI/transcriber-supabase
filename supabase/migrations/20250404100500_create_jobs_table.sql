-- Enable UUID generation extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the jobs table
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- Ensure jobs are deleted if user is deleted
  file_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  state_history JSONB DEFAULT '[]'::jsonb, -- Store status changes with timestamps
  retry_count INTEGER DEFAULT 0,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  transcription_result JSONB,
  error_message TEXT
);

-- Add indexes for common queries
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_next_retry_at ON jobs(next_retry_at);

-- Function to append state changes to state_history
CREATE OR REPLACE FUNCTION record_job_state_change()
RETURNS TRIGGER AS $$
BEGIN
  NEW.state_history = COALESCE(OLD.state_history, '[]'::jsonb) || jsonb_build_object(
    'status', NEW.status,
    'timestamp', NOW(),
    'error', NEW.error_message -- Include error if status is 'failed'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update state_history when status changes
CREATE TRIGGER trigger_job_state_change
BEFORE UPDATE OF status ON jobs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_job_state_change();

-- Add initial state to history on insert
CREATE OR REPLACE FUNCTION record_initial_job_state()
RETURNS TRIGGER AS $$
BEGIN
  NEW.state_history = jsonb_build_array(jsonb_build_object(
    'status', NEW.status,
    'timestamp', NOW()
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to record initial state
CREATE TRIGGER trigger_initial_job_state
BEFORE INSERT ON jobs
FOR EACH ROW
EXECUTE FUNCTION record_initial_job_state();

-- RLS Policies (Placeholder - Enable RLS in Supabase UI first)
-- Make sure to enable Row Level Security on the 'jobs' table in your Supabase project settings.

-- Allow users to view their own jobs
-- CREATE POLICY "Allow users to view their own jobs" ON jobs
-- FOR SELECT USING (auth.uid() = user_id);

-- Allow users to insert their own jobs
-- CREATE POLICY "Allow users to insert their own jobs" ON jobs
-- FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Note: Update/Delete policies might be needed depending on application logic,
-- but typically updates are handled by backend functions.

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Grant usage on schema public to supabase_functions_user role
-- This might be necessary for Edge Functions to access the table
GRANT USAGE ON SCHEMA public TO supabase_functions_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO supabase_functions_user;
GRANT EXECUTE ON FUNCTION record_job_state_change TO supabase_functions_user;
GRANT EXECUTE ON FUNCTION record_initial_job_state TO supabase_functions_user;
-- Grant sequence usage if needed (though uuid_generate_v4 doesn't use sequences)