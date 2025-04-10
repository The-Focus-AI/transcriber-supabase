import { assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { createMockSupabaseClient } from '../shared/testUtils.ts';
import { processJobStep } from './jobProcessor.ts';
import { Job } from '../shared/types.ts';

Deno.test.ignore('processJobStep: successfully processes a job step', async () => {
    const mockClient = createMockSupabaseClient({
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: () => ({
                        data: { definition: { steps: { step1: { transformer_id: 'transformer1', input_map: '$.input', output_map: '$.output' } } } },
                        error: null
                    })
                })
            })
        }),
        functions: {
            invoke: () => ({
                error: null
            })
        }
    });

    const job: Job = {
        id: 'job1',
        workflow_id: 'wf1',
        current_step_id: 'step1',
        input_data: { input: 'data' },
        step_data: {},
        status: 'running',
        created_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        user_id: 'user1',
        final_result: null,
        started_at: new Date().toISOString(),
    };

    const result = await processJobStep(job, mockClient);
    assertEquals(result.status, 'invocation_sent');
    assertEquals(result.message, 'Step function invoked');
});

Deno.test.ignore('processJobStep: handles missing step configuration', async () => {
    const mockClient = createMockSupabaseClient({
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: () => ({
                        data: { definition: { steps: {} } },
                        error: null
                    })
                })
            })
        })
    });

    const job: Job = {
        id: 'job1',
        workflow_id: 'wf1',
        current_step_id: 'step1',
        input_data: { input: 'data' },
        step_data: {},
        status: 'running',
        created_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        user_id: 'user1',
        final_result: null,
        started_at: new Date().toISOString(),
    };

    const result = await processJobStep(job, mockClient);
    assertEquals(result.status, 'error');
    assertEquals(result.message, "Step config 'step1' not found");
}); 