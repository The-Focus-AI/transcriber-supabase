import { assertEquals, assertExists } from 'https://deno.land/std@0.177.0/testing/asserts.ts'
import { handleRequest } from './index.ts'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// --- Mock Interfaces ---
interface MockSupabase { 
  auth: { getUser: () => Promise<any> }; 
  from: (table: string) => MockTable;
}
interface MockTable { 
  select: (columns?: string) => MockQuery;
}
interface MockQuery { 
  eq: (column: string, value: any) => MockQuery; // .eq() returns MockQuery
  maybeSingle?: () => Promise<{ data: any; error: Error | null }>; 
  order?: (column: string, options: { ascending: boolean }) => Promise<{ data: any[]; error: Error | null }>; 
}

// --- Mock Creation Function (Simplified) --- 
const createDefaultMockSupabase = (jobData: any | null = { id: 'job-123', status: 'completed', workflow_id: 'wf-abc' }): MockSupabase => ({
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: 'test-user-id' } }, error: null }),
  },
  from: (table: string): MockTable => {
    const mockQuery: MockQuery = { // Define the chainable query object
       // Default implementation for eq
      eq: function(col: string, id: string): MockQuery {
        if (table === 'jobs' && col === 'id') {
          // Modify behavior specifically for jobs.id query
          this.maybeSingle = () => Promise.resolve({ 
            data: id === 'job-123' ? jobData : null, 
            error: null 
          });
        }
        // Always return this for chaining
        return this; 
      },
      // Default implementations (can be overridden by .eq() if needed)
      maybeSingle: () => Promise.resolve({ data: jobData, error: null }), 
      order: () => Promise.resolve({ data: jobData ? [jobData] : [], error: null }), 
    };

    if (table === 'jobs') {
      return {
        select: () => mockQuery // Return the pre-defined query object
      } as MockTable;
    }

    // Fallback for unhandled tables
    console.warn(`MockSupabase (get-job): Unhandled table requested: ${table}`);
    const fallbackError = new Error(`Unexpected table: ${table}`);
    const errorQuery: MockQuery = {
      eq: function(): MockQuery { 
        this.maybeSingle = () => Promise.resolve({ data: null, error: fallbackError });
        this.order = () => Promise.resolve({ data: [], error: fallbackError });
        return this; 
      },
      maybeSingle: () => Promise.resolve({ data: null, error: fallbackError }),
      order: () => Promise.resolve({ data: [], error: fallbackError }),
    };
    return { select: () => errorQuery } as MockTable;
  },
});

// --- Test Suite --- 
Deno.test('get-job tests', async (t) => {
  let mockSupabaseInstance: MockSupabase;

  await t.step('OPTIONS request returns ok', async () => {
    const req = new Request('http://localhost/jobs/job-123', { method: 'OPTIONS' });
    const res = await handleRequest(req, {} as SupabaseClient);
    assertEquals(res.status, 200);
    assertEquals(await res.text(), 'ok');
  });

  await t.step('GET without auth returns 401', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    mockSupabaseInstance.auth.getUser = () => Promise.resolve({ data: { user: null }, error: new Error('Auth error') });
    const req = new Request('http://localhost/jobs/job-123', { method: 'GET' });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, 'Unauthorized');
  });

  await t.step('GET with invalid URL returns 400', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const req = new Request('http://localhost/invalid/url', { 
      method: 'GET', 
      headers: { 'Authorization': 'Bearer test' } 
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'Invalid URL or missing Job ID');
  });

  await t.step('GET with non-existent job ID returns 404', async () => {
    mockSupabaseInstance = createDefaultMockSupabase({ id: 'job-123' }); // Ensure default mock has a job
    const req = new Request('http://localhost/jobs/non-existent-id', { 
      method: 'GET', 
      headers: { 'Authorization': 'Bearer test' } 
    });
    // Mock `maybeSingle` will return null because ID doesn't match 'job-123'
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 404);
    assertEquals((await res.json()).error, 'Job not found');
  });

  await t.step('GET with job ID returns job details (simulating RLS allowing access)', async () => {
    const mockJob = { id: 'job-123', status: 'completed', user_id: 'test-user-id', workflow_id: 'wf-abc' };
    mockSupabaseInstance = createDefaultMockSupabase(mockJob); // Mock finds this job
    const req = new Request('http://localhost/jobs/job-123', { 
      method: 'GET', 
      headers: { 'Authorization': 'Bearer test' } 
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, mockJob); // Check if the full job details are returned
  });

   await t.step('GET returns 404 if job exists but maybeSingle returns null (simulating RLS block)', async () => {
    mockSupabaseInstance = createDefaultMockSupabase(null); // Simulate maybeSingle returning null
    const req = new Request('http://localhost/jobs/job-123', { 
      method: 'GET', 
      headers: { 'Authorization': 'Bearer test' } 
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 404);
    assertEquals((await res.json()).error, 'Job not found');
  });

  // Test for database error during fetch
  await t.step('GET returns 500 on database error', async () => {
     mockSupabaseInstance = createDefaultMockSupabase(); // Start with default
     const dbError = new Error('DB connection failed');
     
     // Modify the mock behavior for the jobs table specifically
     mockSupabaseInstance.from = (table: string): MockTable => {
       if (table === 'jobs') {
          const errorQuery: MockQuery = {
            eq: function(): MockQuery { 
              this.maybeSingle = () => Promise.resolve({ data: null, error: dbError }); 
              return this;
            },
            // Provide default implementations even for error case if needed by interface
            maybeSingle: () => Promise.resolve({ data: null, error: dbError }),
            order: () => Promise.resolve({ data: [], error: dbError }),
          };
          return { select: () => errorQuery } as MockTable;
       }
       // Fallback to default for other tables (important if other tables are called)
       return createDefaultMockSupabase().from(table); 
     };

    const req = new Request('http://localhost/jobs/job-123', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer test' }
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, 'Database error');
   });

}); 