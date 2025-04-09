// Shared types for Workflow Engine

/**
 * Represents the overall structure of a workflow definition stored in the `workflows.definition` JSONB field.
 */
export interface WorkflowDefinition {
  start_step: string; // The ID of the first step to execute
  steps: { 
    [stepId: string]: WorkflowStep; // Map of step IDs to their configurations
  };
  output_map?: { // Optional: How to map final step output to job.final_result
    [jobResultKey: string]: string; // e.g., { "result": "$.stepN.output.data" }
  };
}

/**
 * Represents the configuration for a single step within a workflow definition.
 */
export interface WorkflowStep {
  transformer_id: string; // ID of the transformer to execute for this step
  input_map?: string; // JSONPath for input mapping
  output_map?: string; // JSONPath for output mapping
  next_step?: string;
  // Potentially add step-specific retry config or other metadata later
}

/**
 * Represents the structure of a record in the `transformers` table.
 */
export interface Transformer {
  id: string;
  type: string;
  description?: string;
  config: Record<string, any>; // JSONB configuration for the transformer
  target_function: string; // Name of the Edge Function that executes this transformer type
  created_at: string;
  updated_at: string;
}

/**
 * Represents the structure of a record in the `jobs` table (relevant fields for orchestrator).
 */
export interface Job {
  id: string;
  workflow_id: string;
  user_id: string;
  current_step_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_retry';
  input_data: Record<string, any> | null;
  step_data: Record<string, any>; // Stores outputs from completed steps
  final_result: Record<string, any> | null;
  created_at: string;
  started_at: string | null;
  last_updated_at: string;
  // ... add other fields like retry_count etc. as needed
} 