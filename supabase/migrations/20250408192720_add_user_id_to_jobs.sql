-- Add user_id column to jobs table
ALTER TABLE public.jobs
ADD COLUMN user_id UUID;

-- Add foreign key constraint to auth.users
-- Note: We don't make it NOT NULL immediately to avoid issues if there are existing rows.
-- It will be populated and made NOT NULL in a subsequent step or application logic
-- if necessary, or handled by RLS policies.
ALTER TABLE public.jobs
ADD CONSTRAINT jobs_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;

-- Add an index on user_id for faster lookups
CREATE INDEX idx_jobs_user_id ON public.jobs(user_id);

-- Make the user_id column NOT NULL after potentially backfilling existing rows.
-- If there are no existing rows or backfilling is handled elsewhere, this can be done.
-- For a new table setup, it's safer to ensure RLS handles inserts correctly first.
-- Commenting out for now, will be added via RLS/Function logic implicitly.
-- ALTER TABLE public.jobs
-- ALTER COLUMN user_id SET NOT NULL; 