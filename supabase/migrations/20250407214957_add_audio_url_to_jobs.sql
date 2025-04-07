-- Add the new audio_url column
ALTER TABLE public.jobs
ADD COLUMN audio_url TEXT;

-- Make the existing file_path column nullable
ALTER TABLE public.jobs
ALTER COLUMN file_path DROP NOT NULL;

-- Optional: Add an index if you expect to query by audio_url often
-- CREATE INDEX idx_jobs_audio_url ON jobs(audio_url);