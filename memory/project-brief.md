# Generic Workflow Engine with Supabase

## Project Overview
A serverless workflow engine built on Supabase that accepts job requests via API, orchestrates multi-step workflows involving various tasks (like API calls, data transformations, notifications), and manages job state, data flow, and retries. Initially demonstrated with an audio transcription workflow using Google Gemini.

## Core Features
- API endpoint to trigger workflows with custom input data.
- Support for defining multi-step workflows with configurable tasks (transformers).
- Asynchronous job processing and orchestration.
- Job status tracking (pending, running, completed, failed, awaiting_retry).
- Intermediate data passing between workflow steps.
- Configurable retry mechanisms for failed steps/jobs.
- User authentication (jobs are associated with users).
- RESTful API endpoints for starting jobs and retrieving status/results.

## Technical Specifications

### Authentication
- Implemented using Supabase Auth.
- Required email-based authentication (or other configured providers).
- API endpoints require authentication via JWT.

### Storage
- Supabase Storage can be utilized by specific workflow steps (e.g., for downloading/uploading assets) but is not a core requirement for all workflows. Usage depends on the transformer configuration.

### Database Schema

#### `jobs` Table
```sql
-- Stores the state and data for each individual workflow execution
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id), -- Link to the workflow definition
  current_step_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'awaiting_retry')) DEFAULT 'pending',
  input_data JSONB,
  step_data JSONB DEFAULT '{}'::jsonb,
  final_result JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3, -- Default, can be overridden by workflow/step
  next_retry_at TIMESTAMP WITH TIME ZONE,
  state_history JSONB DEFAULT '[]'::jsonb
);
-- Add indexes for user_id, status/current_step, workflow_id, status/next_retry_at
-- Add trigger to update last_updated_at
-- Add RLS policies
```

#### `workflows` Table
```sql
-- Stores the definitions of different workflow types
CREATE TABLE workflows (
    id TEXT PRIMARY KEY, -- e.g., 'audio_transcription_v1'
    description TEXT,
    definition JSONB NOT NULL, -- JSON defining steps, transformers, data flow, retry policy
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Add trigger to update updated_at
```

#### `transformers` Table
```sql
-- Stores configurations for reusable task execution units
CREATE TABLE transformers (
    id TEXT PRIMARY KEY, -- e.g., 'gemini-timestamp-transcriber'
    type TEXT NOT NULL, -- e.g., 'gemini_prompt', 'http_download', 'webhook_call'
    description TEXT,
    config JSONB NOT NULL, -- Specific config (e.g., API keys, URLs, prompt templates)
    target_function TEXT NOT NULL, -- The Edge Function that executes this transformer type
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Add index on type
-- Add trigger to update updated_at
```

### API Endpoints

#### 1. Start Workflow Job
```
POST /workflows/start
Authorization: Bearer <jwt>
Content-Type: application/json

Request Body: {
  "workflow_id": "your_workflow_id", // e.g., "audio_transcription_v1"
  "input_data": { ... } // JSON object specific to the workflow's needs
}

Response: {
  "job_id": "uuid",
  "status": "pending",
  "created_at": "timestamp"
}
```

#### 2. Get Job Details
```
GET /jobs/{jobId}
Authorization: Bearer <jwt>

Response: {
  // Full job details from the 'jobs' table, including status,
  // step_data, final_result (if completed), error_message (if failed), etc.
  "job_id": "uuid",
  "workflow_id": "...",
  "status": "...",
  "input_data": { ... },
  "step_data": { ... },
  "final_result": { ... },
  "error_message": "...",
   ...
}
```

#### 3. List User's Jobs
```
GET /jobs
Authorization: Bearer <jwt>

Response: {
  "jobs": [
    {
      // Array of job details (similar structure to single job response)
    }
  ]
}
```

### Job Processing

- **Orchestration:** A central `workflow-orchestrator` Edge Function (triggered periodically, e.g., by `pg_cron`) is responsible for advancing jobs through their workflow steps.
- **Step Execution:** The orchestrator identifies the current step for a job, looks up the associated transformer configuration, and invokes the designated `target_function` (another Edge Function, e.g., `execute-gemini-prompt`, `execute-http-download`).
- **Executor Functions:** These specific functions perform the actual task (call API, download file, etc.), update the job's `step_data` or `final_result` based on the transformer's output mapping, and set the job status accordingly (ready for next step, failed, awaiting retry).
- **Data Flow:** Input data is provided at job start. Intermediate results are stored in `step_data` and mapped as inputs to subsequent steps as defined in the workflow.

#### Retry Logic
- Configurable per workflow or even per step within a workflow definition.
- Uses fields like `retry_count`, `max_retries`, `next_retry_at` in the `jobs` table.
- Supports exponential backoff or other strategies defined in the orchestrator/workflow definition.

### Monitoring and Logging

#### Metrics Tracked
- Job completion rates (by workflow_id)
- Job failure rates (by workflow_id, step_id, error type)
- Average job duration (by workflow_id)
- Step execution times (by transformer_id)
- Queue length (pending/awaiting_retry jobs)
- API endpoint response times

#### Logging
- Job state transitions (including current_step_id changes)
- Step execution start/end/success/failure
- Errors with context (job_id, step_id, transformer_id)
- Input/Output data for steps (optional, consider sensitivity)
- Orchestrator decisions and actions

#### Alerts
- High failure rates
- Stalled jobs (long time in 'running' or 'awaiting_retry')
- Long orchestrator queue processing times
- Errors during workflow/transformer configuration lookup

## Implementation Notes

### Supabase Setup
1.  Set up email authentication (or chosen providers).
2.  Configure database with `jobs`, `workflows`, and `transformers` tables.
3.  Create Edge Functions:
    *   `workflow-orchestrator`
    *   Executor functions (`execute-gemini-prompt`, `execute-http-download`, etc.)
    *   API endpoint functions (`start-workflow`, `get-job`, `list-jobs`)
4.  Schedule the `workflow-orchestrator` using `pg_cron` or Supabase scheduled tasks.
5.  Populate `transformers` and `workflows` tables with initial configurations.

### Security Considerations
- Validate `input_data` against expected schema for each workflow.
- Secure executor functions; ensure they only perform intended actions based on transformer config.
- Sanitize data used in templates (e.g., webhook URLs, prompt templates).
- Implement rate limiting on API endpoints.
- Enforce Row Level Security (RLS) strictly on all tables.
- Manage secrets (API keys etc.) securely using Supabase environment variables referenced in transformer configs (e.g., using `api_key_env_var`).

### Performance Optimization
- Optimize database queries, especially for fetching runnable jobs by the orchestrator.
- Ensure appropriate indexes are created on tables.
- Consider batching operations within the orchestrator and executor functions where applicable.
- Monitor Edge Function execution times and memory usage.

## Testing Plan

### Unit Tests
- Input data validation logic.
- Workflow definition parsing.
- Input/output mapping logic.
- Retry calculation logic.
- Individual transformer configuration validation.

### Integration Tests
- End-to-end job processing for sample workflows.
- Correct data flow between steps.
- API endpoint functionality (start, get status, list).
- Error handling and retry mechanism across steps.
- RLS policy enforcement.

### Load Tests
- Concurrent job creation and processing.
- Orchestrator performance under load.
- Database performance with many active jobs.
- API endpoint responsiveness.

## Future Enhancements (Optional)
- Support for branching logic/conditional steps in workflows.
- Manual approval steps.
- More sophisticated scheduling options.
- UI for defining/monitoring workflows.
- Support for more transformer types (database queries, message queues, etc.).
- Versioning for workflows and transformers. 