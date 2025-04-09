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
  // eq needed if filtering by user_id explicitly
  // eq?: (column: string, value: any) => MockQuery;
  // maybeSingle not needed for list
  // maybeSingle?: () => Promise<{ data: any; error: Error | null }>; 
  order: (column: string, options: { ascending: boolean }) => Promise<{ data: any[]; error: Error | null }>; 
}

// --- Mock Creation Function --- 
const createDefaultMockSupabase = (jobsData: any[] | null = [{ id: 'job-1', status: 'pending' }, { id: 'job-2', status: 'completed' }]): MockSupabase => ({
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: 'test-user-id' } }, error: null }),
  },
  from: (table: string): MockTable => {
     const mockQuery: MockQuery = {
      // RLS handles filtering, so .eq('user_id', ...) is not mocked here
      // Default implementation for order
      order: () => Promise.resolve({ data: jobsData ?? [], error: null }),
    };

    if (table === 'jobs') {
      return {
        select: () => mockQuery // Return the pre-defined query object
      } as MockTable;
    }

    // Fallback for unhandled tables
    console.warn(`MockSupabase (list-jobs): Unhandled table requested: ${table}`);
    const fallbackError = new Error(`Unexpected table: ${table}`);
    const errorQuery: MockQuery = {
       order: () => Promise.resolve({ data: [], error: fallbackError }),
    };
    return { select: () => errorQuery } as MockTable;
  },
});

// --- Test Suite --- 
Deno.test('list-jobs tests', async (t) => {
  let mockSupabaseInstance: MockSupabase;

  await t.step('OPTIONS request returns ok', async () => {
    const req = new Request('http://localhost/jobs', { method: 'OPTIONS' });
    const res = await handleRequest(req, {} as SupabaseClient);
    assertEquals(res.status, 200);
    assertEquals(await res.text(), 'ok');
  });

  await t.step('GET without auth returns 401', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    mockSupabaseInstance.auth.getUser = () => Promise.resolve({ data: { user: null }, error: new Error('Auth error') });
    const req = new Request('http://localhost/jobs', { method: 'GET' });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, 'Unauthorized');
  });

  await t.step('GET returns list of jobs (simulating RLS allowing access)', async () => {
    const mockJobs = [{ id: 'job-a', workflow_id: 'wf-1' }, { id: 'job-b', workflow_id: 'wf-2' }];
    mockSupabaseInstance = createDefaultMockSupabase(mockJobs);
    const req = new Request('http://localhost/jobs', { 
      method: 'GET', 
      headers: { 'Authorization': 'Bearer test' } 
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.jobs, mockJobs);
  });

  await t.step('GET returns empty list if no jobs found (or RLS filters all)', async () => {
    mockSupabaseInstance = createDefaultMockSupabase([]); // Simulate empty list
    const req = new Request('http://localhost/jobs', { 
      method: 'GET', 
      headers: { 'Authorization': 'Bearer test' } 
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.jobs, []);
  });

  await t.step('GET returns 500 on database error', async () => {
     mockSupabaseInstance = createDefaultMockSupabase();
     const dbError = new Error('DB connection failed');
     mockSupabaseInstance.from = (table: string): MockTable => {
       if (table === 'jobs') {
          const errorQuery: MockQuery = {
             order: () => Promise.resolve({ data: [], error: dbError })
          };
          return { select: () => errorQuery } as MockTable;
       }
       return createDefaultMockSupabase().from(table);
     };

    const req = new Request('http://localhost/jobs', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer test' }
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, 'Database error');
   });

}); 