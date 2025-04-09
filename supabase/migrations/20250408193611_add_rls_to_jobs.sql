-- Enable Row Level Security for the jobs table
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow users to insert jobs for themselves
-- The user_id column is populated by the start-workflow function,
-- this policy ensures the inserted user_id matches the authenticated user.
CREATE POLICY "Allow insert for authenticated users" ON public.jobs
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Policy: Allow users to select their own jobs
CREATE POLICY "Allow select for owner" ON public.jobs
AS PERMISSIVE FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy: Allow users to update their own jobs
-- (Restricting columns that can be updated might be desirable later)
CREATE POLICY "Allow update for owner" ON public.jobs
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id); -- Ensure they can't change ownership

-- Policy: Allow users to delete their own jobs
CREATE POLICY "Allow delete for owner" ON public.jobs
AS PERMISSIVE FOR DELETE
TO authenticated
USING (auth.uid() = user_id); 