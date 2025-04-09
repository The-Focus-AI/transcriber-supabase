import { assertEquals, assertExists } from 'https://deno.land/std@0.177.0/testing/asserts.ts'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleOrchestration } from './index.ts'
import * as mc from "https://deno.land/std@0.177.0/testing/mock.ts";
import { Job, Transformer, WorkflowDefinition } from '../shared/types.ts'; // Import types

// Mock Results Structure
interface MockResults {
    fetchRunningJobs?: { data: Job[] | null; error: any };
    fetchPendingJobs?: { data: Job[] | null; error: any };
    fetchWorkflow?: Record<string, { data: { definition: WorkflowDefinition } | null; error: any }>;
    fetchTransformer?: Record<string, { data: Pick<Transformer, 'target_function' | 'config'> | null; error: any }>;
    updateJob?: Record<string, { error: any }>; // Keyed by Job ID for simplicity
    invokeFunction?: Record<string, { data?: any; error: any }>; // Keyed by function name
}

// Mock Supabase Client V3 (Simplified, behavior defined upfront)
const createMockSupabaseClientV3 = (results: MockResults = {}) => {

    const spies = {
        fetchRunningJobs: mc.spy(() => Promise.resolve(results.fetchRunningJobs || { data: null, error: null })),
        fetchPendingJobs: mc.spy(() => Promise.resolve(results.fetchPendingJobs || { data: null, error: null })),
        fetchWorkflow: mc.spy((id: string) => Promise.resolve(results.fetchWorkflow?.[id] || { data: null, error: null })),
        fetchTransformer: mc.spy((id: string) => Promise.resolve(results.fetchTransformer?.[id] || { data: null, error: null })),
        updateJob: mc.spy((id: string, updates: Partial<Job>) => Promise.resolve(results.updateJob?.[id] || { error: null })),
        invokeFunction: mc.spy((name: string, options: any) => Promise.resolve(results.invokeFunction?.[name] || { data: null, error: null })),
    };

    // --- Mock Client Structure --- 
    const mockClient = {
        from: mc.spy((tableName: string) => {
            // JOB TABLE MOCKS
            if (tableName === 'jobs') {
                return {
                    select: mc.spy((_select: string) => ({
                        eq: mc.spy((_col: string, _val: string) => ({
                            order: mc.spy((_col: string, _opts: any) => ({
                                limit: mc.spy((_num: number) => ({
                                    maybeSingle: mc.spy(() => spies.fetchPendingJobs()),
                                })),
                            })),
                        })),
                    })),
                    update: mc.spy((updates: Partial<Job>) => ({
                        eq: mc.spy((idCol: string, idVal: string) => {
                            spies.updateJob(idVal, updates); // Record call
                            const result = results.updateJob?.[idVal] || { error: null };
                            return Promise.resolve(result);
                        })
                     }))
                };
            }
            // WORKFLOW TABLE MOCKS
            else if (tableName === 'workflows') {
                return {
                    select: mc.spy((_select: string) => ({
                        eq: mc.spy((_col: string, idVal: string) => ({
                             // --- FINAL CALL: Fetch Workflow --- 
                            maybeSingle: mc.spy(() => {
                                spies.fetchWorkflow(idVal); // Record call
                                return Promise.resolve(results.fetchWorkflow?.[idVal] || { data: null, error: null });
                            })
                        }))
                    }))
                };
            }
            // TRANSFORMER TABLE MOCKS
            else if (tableName === 'transformers') {
                return {
                     select: mc.spy((_select: string) => ({
                        eq: mc.spy((_col: string, idVal: string) => ({
                            // --- FINAL CALL: Fetch Transformer --- 
                            maybeSingle: mc.spy(() => {
                                spies.fetchTransformer(idVal); // Record call
                                return Promise.resolve(results.fetchTransformer?.[idVal] || { data: null, error: null });
                            })
                        }))
                    }))
                };
            }
            console.warn(`MockClient: Unmocked table access: ${tableName}`);
            return {}; // Return empty object for unmocked tables
        }),
        // FUNCTIONS API MOCK
        functions: {
            invoke: spies.invokeFunction
        },
        _spies: spies // Expose spies
    } as unknown as SupabaseClient;

    return mockClient as unknown as SupabaseClient & { _spies: typeof spies };
};


// --- Unit Tests (Using V3 Mock) --- 

Deno.test('[Iteration 6] Orchestrator: No running jobs, starts one pending job', async () => {
    const workflowId = 'wf-pending';
    const startStep = 'stepP1';
    const pendingJob: Job = {
        id: 'job-pending-1', workflow_id: workflowId, user_id: 'user1', status: 'pending',
        current_step_id: null, input_data: {}, step_data: {}, final_result: null,
        created_at: new Date(Date.now() - 10000).toISOString(), started_at: null,
        last_updated_at: new Date(Date.now() - 10000).toISOString(),
    } as Job;
    
    const mockResults: MockResults = {
        fetchRunningJobs: { data: [], error: null }, // No running jobs
        fetchPendingJobs: { data: [pendingJob], error: null },
        fetchWorkflow: { 
            [workflowId]: { data: { definition: { start_step: startStep, steps: { [startStep]: { transformer_id: 't1', next_step: undefined } } } }, error: null }
        },
        updateJob: { [pendingJob.id]: { error: null } } // Expect update for pending job
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertExists(body.message.includes('No running jobs found'));
    assertExists(body.message.includes('Checked for pending jobs'));

    // Verify spies
    assertEquals(mockClient._spies.fetchRunningJobs.calls.length, 1);
    assertEquals(mockClient._spies.fetchPendingJobs.calls.length, 1);
    assertEquals(mockClient._spies.fetchWorkflow.calls.length, 1); // For pending job startup
    assertEquals(mockClient._spies.fetchTransformer.calls.length, 0);
    assertEquals(mockClient._spies.updateJob.calls.length, 1); // To mark pending as running
    assertEquals(mockClient._spies.invokeFunction.calls.length, 0);

    // Verify job state updated (via spy args)
    const updateCall = mockClient._spies.updateJob.calls[0];
    assertEquals(updateCall.args[0], pendingJob.id);
    const updatedJobData = updateCall.args[1];
    assertEquals(updatedJobData.status, 'running');
    assertEquals(updatedJobData.current_step_id, startStep);
    assertExists(updatedJobData.started_at);
});

Deno.test('[Iteration 6] Orchestrator: Processes one running job step successfully', async () => {
    const jobId = 'job-running-1';
    const workflowId = 'wf-run';
    const currentStep = 'stepR1';
    const transformerId = 'transformer-A';
    const targetFunction = 'execute-transformer-A';
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user2', status: 'running',
        current_step_id: currentStep, input_data: { key: 'val' }, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z',
    } as Job;
    
    const mockResults: MockResults = {
        fetchRunningJobs: { data: [runningJob], error: null },
        fetchPendingJobs: { data: [], error: null }, // No pending jobs this time
        fetchWorkflow: {
             [workflowId]: { data: { definition: { 
                start_step: currentStep, 
                steps: { [currentStep]: { transformer_id: transformerId, next_step: undefined } } 
            } }, error: null }
        },
        fetchTransformer: {
             [transformerId]: { data: { target_function: targetFunction, config: { cfg_key: 'cfg_val' } }, error: null }
        },
        updateJob: { [jobId]: { error: null } }, // For last_updated_at
        invokeFunction: { [targetFunction]: { data: { success: true }, error: null } }
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 0);
    assertEquals(body.results[0]?.status, 'invocation_sent');

    // Verify spies
    assertEquals(mockClient._spies.fetchRunningJobs.calls.length, 1);
    assertEquals(mockClient._spies.fetchWorkflow.calls.length, 1);
    assertEquals(mockClient._spies.fetchTransformer.calls.length, 1);
    assertEquals(mockClient._spies.invokeFunction.calls.length, 1);
    assertEquals(mockClient._spies.updateJob.calls.length, 1); // Update last_updated_at
    assertEquals(mockClient._spies.fetchPendingJobs.calls.length, 1); // Always checks pending

    // Verify function invocation details
    const invokeCall = mockClient._spies.invokeFunction.calls[0];
    assertEquals(invokeCall.args[0], targetFunction);
    const payload = invokeCall.args[1];
    assertEquals(payload.job_id, jobId);
    assertEquals(payload.current_step_id, currentStep);
    assertEquals(payload.transformer_config?.cfg_key, 'cfg_val');
    assertEquals(payload.job_input?.key, 'val');

    // Verify last_updated_at was updated
    const updateCall = mockClient._spies.updateJob.calls[0];
    assertEquals(updateCall.args[0], jobId);
    assertExists(updateCall.args[1].last_updated_at);
});

Deno.test('[Iteration 6] Orchestrator: Fails step if workflow definition missing', async () => {
    const jobId = 'job-run-no-wf';
    const workflowId = 'wf-missing';
    const currentStep = 'stepX';
    // Ensure runningJob has all required fields from Job interface
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-placeholder', status: 'running',
        current_step_id: currentStep, input_data: { msg: 'test' }, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z'
     } as Job;

    const mockResults: MockResults = {
         fetchRunningJobs: { data: [runningJob], error: null },
         fetchWorkflow: {}, // Workflow 'wf-missing' is correctly missing here
         fetchPendingJobs: { data: [], error: null },
         // Ensure updateJob mock result structure is correct, even if not expected to be called
         updateJob: { [jobId]: { error: null } }
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 1);
    assertEquals(body.results[0]?.status, 'error');
    assertExists(body.results[0]?.message.includes('Failed to fetch/parse workflow'));
    assertEquals(mockClient._spies.invokeFunction.calls.length, 0); // Should not invoke
    assertEquals(mockClient._spies.updateJob.calls.length, 1); // Should update job
});

Deno.test('[Iteration 6] Orchestrator: Fails step if step config missing', async () => {
    const jobId = 'job-run-no-step';
    const workflowId = 'wf-ok';
    const currentStep = 'step-missing';
    // Ensure runningJob has all required fields
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-placeholder', status: 'running',
        current_step_id: currentStep, input_data: {}, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z'
     } as Job;

    const mockResults: MockResults = {
        fetchRunningJobs: { data: [runningJob], error: null },
        fetchWorkflow: {
             // Ensure the WorkflowDefinition includes 'steps'
             [workflowId]: { data: { definition: { start_step: 'stepA', steps: { 'stepA': { transformer_id: 't1', next_step: undefined } } } }, error: null }
        },
        fetchPendingJobs: { data: [], error: null },
        // Ensure updateJob mock result structure is correct
        updateJob: { [jobId]: { error: null } }
     };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 1);
    assertEquals(body.results[0]?.status, 'error');
    assertExists(body.results[0]?.message.includes(`Step config '${currentStep}' not found`));
    assertEquals(mockClient._spies.invokeFunction.calls.length, 0);
    assertEquals(mockClient._spies.updateJob.calls.length, 1);
});

Deno.test('[Iteration 6] Orchestrator: Fails step if transformer missing', async () => {
    const jobId = 'job-run-no-transformer';
    const workflowId = 'wf-ok2';
    const currentStep = 'stepB';
    const transformerId = 'transformer-missing';
    // Ensure runningJob has all required fields
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-placeholder', status: 'running',
        current_step_id: currentStep, input_data: {}, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z'
     } as Job;

    const mockResults: MockResults = {
         fetchRunningJobs: { data: [runningJob], error: null },
        fetchWorkflow: {
             // Ensure the WorkflowDefinition includes 'steps'
             [workflowId]: { data: { definition: { start_step: currentStep, steps: { [currentStep]: { transformer_id: transformerId, next_step: undefined } } } }, error: null }
        },
        fetchTransformer: { // Transformer 'transformer-missing' is correctly missing here
             'transformer-exists': { data: { target_function: 'fn', config: {} }, error: null }
        },
        fetchPendingJobs: { data: [], error: null },
        // Ensure updateJob mock result structure is correct
        updateJob: { [jobId]: { error: null } }
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 1);
    assertEquals(body.results[0]?.status, 'error');
    assertExists(body.results[0]?.message.includes(`Failed to fetch transformer ${transformerId}`));
    assertEquals(mockClient._spies.invokeFunction.calls.length, 0);
    assertEquals(mockClient._spies.updateJob.calls.length, 1);
});

Deno.test('[Iteration 6] Orchestrator: Handles function invocation error', async () => {
    const jobId = 'job-run-invoke-fail';
    const workflowId = 'wf-run-if';
    const currentStep = 'stepIF1';
    const transformerId = 'transformer-IF';
    const targetFunction = 'execute-transformer-IF';
    // Ensure runningJob has all required fields
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-placeholder', status: 'running',
        current_step_id: currentStep, input_data: {}, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z'
     } as Job;

    const mockResults: MockResults = {
        fetchRunningJobs: { data: [runningJob], error: null },
        fetchWorkflow: {
             // Ensure the WorkflowDefinition includes 'steps'
             [workflowId]: { data: { definition: { start_step: currentStep, steps: { [currentStep]: { transformer_id: transformerId, next_step: undefined } } } }, error: null }
        },
        fetchTransformer: {
             [transformerId]: { data: { target_function: targetFunction, config: {} }, error: null }
        },
         // Ensure updateJob result structure is { error: any }
        updateJob: { [jobId]: { error: null } }, 
        invokeFunction: { 
            [targetFunction]: { error: new Error('Function execution timeout') }
        },
        fetchPendingJobs: { data: [], error: null },
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 1);
    assertEquals(body.results[0]?.status, 'invocation_error');
    assertExists(body.results[0]?.message.includes('Function execution timeout'));
    assertEquals(mockClient._spies.invokeFunction.calls.length, 1);
    assertEquals(mockClient._spies.updateJob.calls.length, 1); // last_updated_at should still be updated
});

Deno.test('Orchestrator: Correctly maps input data using JSONPath', async () => {
    const jobId = 'job-jsonpath-input';
    const workflowId = 'wf-jsonpath';
    const currentStep = 'step-jsonpath';
    const transformerId = 'transformer-jsonpath';
    const targetFunction = 'execute-transformer-jsonpath';
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-jsonpath', status: 'running',
        current_step_id: currentStep, input_data: { key: 'value' }, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z',
    } as Job;

    const mockResults: MockResults = {
        fetchRunningJobs: { data: [runningJob], error: null },
        fetchWorkflow: {
            [workflowId]: { data: { definition: { 
                start_step: currentStep, 
                steps: { [currentStep]: { transformer_id: transformerId, input_map: '$.key', output_map: '$', next_step: undefined } } 
            } }, error: null }
        },
        fetchTransformer: {
            [transformerId]: { data: { target_function: targetFunction, config: {} }, error: null }
        },
        invokeFunction: { [targetFunction]: { data: { transformed: 'value' }, error: null } }
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 0);
    assertEquals(body.results[0]?.status, 'invocation_sent');

    // Verify input mapping
    const invokeCall = mockClient._spies.invokeFunction.calls[0];
    assertEquals(invokeCall.args[1].body.job_input, ['value']);
});

Deno.test('Orchestrator: Correctly maps output data using JSONPath', async () => {
    const jobId = 'job-jsonpath-output';
    const workflowId = 'wf-jsonpath';
    const currentStep = 'step-jsonpath';
    const transformerId = 'transformer-jsonpath';
    const targetFunction = 'execute-transformer-jsonpath';
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-jsonpath', status: 'running',
        current_step_id: currentStep, input_data: {}, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z',
    } as Job;

    const mockResults: MockResults = {
        fetchRunningJobs: { data: [runningJob], error: null },
        fetchWorkflow: {
            [workflowId]: { data: { definition: { 
                start_step: currentStep, 
                steps: { [currentStep]: { transformer_id: transformerId, input_map: '$', output_map: '$.transformed', next_step: undefined } } 
            } }, error: null }
        },
        fetchTransformer: {
            [transformerId]: { data: { target_function: targetFunction, config: {} }, error: null }
        },
        invokeFunction: { [targetFunction]: { data: { transformed: 'output-value' }, error: null } }
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 0);
    assertEquals(body.results[0]?.status, 'invocation_sent');

    // Verify output mapping
    const updateCall = mockClient._spies.updateJob.calls[0];
    assertEquals(updateCall.args[1].step_data, ['output-value']);
});

Deno.test('Orchestrator: Handles missing workflow definition', async () => {
    const jobId = 'job-456';
    const workflowId = 'wf-def';

    const mockClient = createMockSupabaseClientV3({
        fetchPendingJobs: { data: [{ id: jobId, workflow_id: workflowId, user_id: 'user-placeholder', current_step_id: null, status: 'pending', input_data: {}, step_data: {}, final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: null, last_updated_at: '2023-01-01T10:05:00Z' }], error: null },
        fetchWorkflow: {
            'another-wf': { data: { definition: { start_step: 'stepA', steps: {} } }, error: null }
        },
        updateJob: { [jobId]: { error: null } } // Update shouldn't be called
    });

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.successCount, 0);
    assertEquals(body.errorCount, 1);
    assertEquals(body.results[0], { jobId: jobId, status: 'error', message: 'Workflow definition missing or invalid' });

    // Assert that updateJob was *not* called
    assertEquals(mockClient._spies.fetchPendingJobs.calls.length, 1);
    assertEquals(mockClient._spies.fetchWorkflow.calls.length, 1);
    assertEquals(mockClient._spies.updateJob.calls.length, 0);
});

Deno.test('Orchestrator: Handles workflow definition missing start_step', async () => {
    const jobId = 'job-789';
    const workflowId = 'wf-ghi';

    const mockClient = createMockSupabaseClientV3({
        fetchPendingJobs: { data: [{ id: jobId, workflow_id: workflowId, user_id: 'user-placeholder', current_step_id: null, status: 'pending', input_data: {}, step_data: {}, final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: null, last_updated_at: '2023-01-01T10:05:00Z' }], error: null },
        fetchWorkflow: {
            [workflowId]: { data: { definition: { start_step: '', steps: {} } }, error: null }
        },
        updateJob: { [jobId]: { error: null } }
    });

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.successCount, 0);
    assertEquals(body.errorCount, 1);
    assertEquals(body.results[0], { jobId: jobId, status: 'error', message: 'Workflow definition missing start_step' });
    assertEquals(mockClient._spies.fetchPendingJobs.calls.length, 1);
    assertEquals(mockClient._spies.fetchWorkflow.calls.length, 1);
    assertEquals(mockClient._spies.updateJob.calls.length, 0);
});

Deno.test('Orchestrator: Handles error fetching jobs', async () => {
    const mockClient = createMockSupabaseClientV3({
        fetchPendingJobs: { data: null, error: { error: new Error('DB connection failed') } }
    });

    const response = await handleOrchestration();
    assertEquals(response.status, 500);
    const body = await response.json();
    assertEquals(body.error, 'Database error fetching jobs');
    assertEquals(mockClient._spies.fetchPendingJobs.calls.length, 1);
    assertEquals(mockClient._spies.fetchWorkflow.calls.length, 0);
    assertEquals(mockClient._spies.updateJob.calls.length, 0);
});

Deno.test('Orchestrator: Handles error updating job', async () => {
    const jobId = 'job-err';
    const workflowId = 'wf-err';
    const startStep = 'step1-err';

    const mockClient = createMockSupabaseClientV3({
        fetchPendingJobs: { data: [{ id: jobId, workflow_id: workflowId, user_id: 'user-placeholder', current_step_id: null, status: 'pending', input_data: {}, step_data: {}, final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: null, last_updated_at: '2023-01-01T10:05:00Z' }], error: null },
        fetchWorkflow: {
            [workflowId]: { data: { definition: { start_step: startStep, steps: {} } }, error: null }
        },
        updateJob: { [jobId]: { error: { error: new Error('Update conflict') } } } // Simulate update error
    });

    const response = await handleOrchestration();
    assertEquals(response.status, 200); // Handler catches update error, returns 200 overall
    const body = await response.json();
    assertEquals(body.successCount, 0);
    assertEquals(body.errorCount, 1);
    assertEquals(body.results[0], { jobId: jobId, status: 'error', message: 'Failed to update job status' });
    assertEquals(mockClient._spies.fetchPendingJobs.calls.length, 1);
    assertEquals(mockClient._spies.fetchWorkflow.calls.length, 1);
    assertEquals(mockClient._spies.updateJob.calls.length, 1);
});

// Note: Testing the serve() part with secret validation requires more complex mocking
// of the request object and Deno.env. It's often tested via integration tests.
// Example sketch (might need adjustments based on serve/handleRequest structure):
/*
Deno.test('Orchestrator HTTP Trigger: Requires secret', async () => {
    // Mock Deno.env
    const originalEnvGet = Deno.env.get;
    Deno.env.get = (key: string) => {
        if (key === 'ORCHESTRATOR_SECRET') return 'test-secret';
        if (key === 'SUPABASE_URL') return 'mock-url';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'mock-key';
        return originalEnvGet(key);
    };

    // Need to import the serve function and potentially the top-level handler
    // You might need to refactor index.ts slightly to export the main request handler if serve wraps it directly
    // For now, assume serve calls a main handler we can import/test
    // import { mainRequestHandler } from './index.ts';

    const reqWithoutSecret = new Request('http://localhost/orchestrate', { method: 'POST' });
    //const response = await mainRequestHandler(reqWithoutSecret); // Assuming refactor
    //assertEquals(response.status, 401);

    const reqWithWrongSecret = new Request('http://localhost/orchestrate', {
         method: 'POST',
         headers: { 'Authorization': 'Bearer wrong-secret' }
     });
    //const responseWrong = await mainRequestHandler(reqWithWrongSecret);
    //assertEquals(responseWrong.status, 401);

     const reqWithCorrectSecret = new Request('http://localhost/orchestrate', {
         method: 'POST',
         headers: { 'Authorization': 'Bearer test-secret' }
     });
     // Mock the handleOrchestration part for this specific test
     //const responseCorrect = await mainRequestHandler(reqWithCorrectSecret); 
     // Expect 200 or other success code depending on mock

    // Restore Deno.env.get
    Deno.env.get = originalEnvGet;
});
*/ 

// --- Unit Tests for JSONPath Mapping ---

Deno.test('Orchestrator: Correctly maps input data using JSONPath', async () => {
    const jobId = 'job-jsonpath-input';
    const workflowId = 'wf-jsonpath';
    const currentStep = 'step-jsonpath';
    const transformerId = 'transformer-jsonpath';
    const targetFunction = 'execute-transformer-jsonpath';
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-jsonpath', status: 'running',
        current_step_id: currentStep, input_data: { key: 'value' }, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z',
    } as Job;

    const mockResults: MockResults = {
        fetchRunningJobs: { data: [runningJob], error: null },
        fetchWorkflow: {
            [workflowId]: { data: { definition: { 
                start_step: currentStep, 
                steps: { [currentStep]: { transformer_id: transformerId, input_map: '$.key', output_map: '$', next_step: undefined } } 
            } }, error: null }
        },
        fetchTransformer: {
            [transformerId]: { data: { target_function: targetFunction, config: {} }, error: null }
        },
        invokeFunction: { [targetFunction]: { data: { transformed: 'value' }, error: null } }
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 0);
    assertEquals(body.results[0]?.status, 'invocation_sent');

    // Verify input mapping
    const invokeCall = mockClient._spies.invokeFunction.calls[0];
    assertEquals(invokeCall.args[1].body.job_input, ['value']);
});

Deno.test('Orchestrator: Correctly maps output data using JSONPath', async () => {
    const jobId = 'job-jsonpath-output';
    const workflowId = 'wf-jsonpath';
    const currentStep = 'step-jsonpath';
    const transformerId = 'transformer-jsonpath';
    const targetFunction = 'execute-transformer-jsonpath';
    const runningJob: Job = {
        id: jobId, workflow_id: workflowId, user_id: 'user-jsonpath', status: 'running',
        current_step_id: currentStep, input_data: {}, step_data: {},
        final_result: null, created_at: '2023-01-01T10:00:00Z', started_at: '2023-01-01T10:05:00Z',
        last_updated_at: '2023-01-01T10:05:00Z',
    } as Job;

    const mockResults: MockResults = {
        fetchRunningJobs: { data: [runningJob], error: null },
        fetchWorkflow: {
            [workflowId]: { data: { definition: { 
                start_step: currentStep, 
                steps: { [currentStep]: { transformer_id: transformerId, input_map: '$', output_map: '$.transformed', next_step: undefined } } 
            } }, error: null }
        },
        fetchTransformer: {
            [transformerId]: { data: { target_function: targetFunction, config: {} }, error: null }
        },
        invokeFunction: { [targetFunction]: { data: { transformed: 'output-value' }, error: null } }
    };
    const mockClient = createMockSupabaseClientV3(mockResults);

    const response = await handleOrchestration();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.processedCount, 1);
    assertEquals(body.errorCount, 0);
    assertEquals(body.results[0]?.status, 'invocation_sent');

    // Verify output mapping
    const updateCall = mockClient._spies.updateJob.calls[0];
    assertEquals(updateCall.args[1].step_data, ['output-value']);
}); 