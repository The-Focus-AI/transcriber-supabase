import { assertEquals, assertThrows } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { createMockSupabaseClient } from '../shared/testUtils.ts';
import { fetchRunningJobs } from './jobFetcher.ts';

Deno.test('fetchRunningJobs: successfully fetches running jobs', async () => {
    const mockClient = createMockSupabaseClient({
        data: [
            { id: 'job1', workflow_id: 'wf1', current_step_id: 'step1', input_data: {}, step_data: {} },
            { id: 'job2', workflow_id: 'wf2', current_step_id: 'step2', input_data: {}, step_data: {} }
        ],
        error: null
    });

    const jobs = await fetchRunningJobs(mockClient);
    assertEquals(jobs.length, 2);
    assertEquals(jobs[0].id, 'job1');
    assertEquals(jobs[1].id, 'job2');
});

Deno.test('fetchRunningJobs: throws error when fetching fails', async () => {
    const mockClient = createMockSupabaseClient({
        data: null,
        error: 'Database error'
    });

    try {
        await fetchRunningJobs(mockClient);
        throw new Error('Expected error was not thrown');
    } catch (error) {
        if (error instanceof Error) {
            assertEquals(error.message, 'Database error fetching jobs');
        } else {
            throw new Error('Caught error is not an instance of Error');
        }
    }
}); 