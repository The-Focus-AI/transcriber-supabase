-- Add definition column to workflows table
-- Note: Making it NOT NULL requires existing rows to have a value or a default.
-- Adding it as NULL first, then setting NOT NULL after potential backfill or default setting.
ALTER TABLE public.workflows
ADD COLUMN definition JSONB;

-- Add constraint manually if needed after ensuring data integrity/default
-- ALTER TABLE public.workflows
-- ALTER COLUMN definition SET NOT NULL;

-- Create transformers table
CREATE TABLE public.transformers (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    description TEXT,
    config JSONB NOT NULL,
    target_function TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Index on transformer type for faster lookups
CREATE INDEX idx_transformers_type ON public.transformers(type);

-- Trigger for transformers updated_at
-- Assuming the standard update_timestamp function already exists from initial migration
CREATE TRIGGER handle_updated_at
BEFORE UPDATE ON public.transformers
FOR EACH ROW
EXECUTE FUNCTION public.update_timestamp(); 