-- Add started_at and current_step_id columns to jobs table

ALTER TABLE public.jobs
ADD COLUMN started_at TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE public.jobs
ADD COLUMN current_step_id TEXT NULL; 